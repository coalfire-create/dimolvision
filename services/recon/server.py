"""
디몰비전 3D 복원 서비스 — COLMAP SfM 을 HTTP 로 감싼다.

영상에서 뽑은 프레임들을 받아 카메라 위치와 희소 점군(sparse point cloud)을 만든다.
밀집 복원(dense/MVS)은 L4 한 장에서 수십 분이 걸려 요청-응답 안에 담기 어렵고,
철거 현장의 무늬 없는 벽에서는 실패율도 높다. 견적에 필요한 건 정밀한 표면이 아니라
"공간이 얼마나 큰가" 이므로 희소 점군으로 시작한다.

스케일에 대하여:
  사진만으로 만든 복원은 크기를 모른다(단위 없는 좌표계). 그래서 이 서비스는 부피를
  말하지 않고 **점군과 상대 치수만** 돌려준다. 실제 길이는 호출하는 쪽에서 기준 하나를
  받아 곱한다. 여기서 임의로 미터를 붙이면 그건 지어낸 숫자다.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

MAX_IMAGES = 120
# COLMAP 이 실패하거나 지나치게 오래 걸릴 때 요청을 붙잡고 있지 않도록.
SFM_TIMEOUT_SEC = int(os.environ.get("SFM_TIMEOUT_SEC", "900"))


def run(cmd: list[str], timeout: int) -> tuple[int, str]:
    """COLMAP 하위 명령 실행. 실패해도 예외 대신 코드·로그를 돌려 호출부가 판단하게 한다."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout + p.stderr)[-4000:]
    except subprocess.TimeoutExpired:
        return 124, f"timeout: {' '.join(cmd[:3])}"


def read_points3d(path: str) -> np.ndarray:
    """COLMAP points3D.txt → (N,3) 좌표. 주석(#)과 빈 줄은 건너뛴다."""
    pts = []
    with open(path, "r") as f:
        for line in f:
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            try:
                pts.append([float(parts[1]), float(parts[2]), float(parts[3])])
            except ValueError:
                continue
    return np.array(pts, dtype=np.float64) if pts else np.zeros((0, 3))


def read_camera_centers(path: str) -> np.ndarray:
    """images.txt 에서 카메라 중심을 뽑는다. 촬영 동선 길이를 재는 데 쓴다."""
    centers = []
    with open(path, "r") as f:
        lines = [l for l in f if l.strip() and not l.startswith("#")]
    # images.txt 는 이미지마다 2줄(포즈 줄 + 2D 점 줄)이다.
    for i in range(0, len(lines), 2):
        parts = lines[i].split()
        if len(parts) < 8:
            continue
        try:
            qw, qx, qy, qz = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]))
            tx, ty, tz = (float(parts[5]), float(parts[6]), float(parts[7]))
        except ValueError:
            continue
        # 카메라 중심 C = -R^T t
        n = qw * qw + qx * qx + qy * qy + qz * qz
        if n == 0:
            continue
        s = 2.0 / n
        R = np.array([
            [1 - s * (qy * qy + qz * qz), s * (qx * qy - qz * qw), s * (qx * qz + qy * qw)],
            [s * (qx * qy + qz * qw), 1 - s * (qx * qx + qz * qz), s * (qy * qz - qx * qw)],
            [s * (qx * qz - qy * qw), s * (qy * qz + qx * qw), 1 - s * (qx * qx + qy * qy)],
        ])
        centers.append((-R.T @ np.array([tx, ty, tz])).tolist())
    return np.array(centers, dtype=np.float64) if centers else np.zeros((0, 3))


def robust_extent(pts: np.ndarray) -> dict:
    """
    이상치에 흔들리지 않는 크기. 희소 점군에는 멀리 튄 점이 섞이므로
    상하위 2% 를 잘라낸 백분위 범위를 쓴다.
    """
    if len(pts) == 0:
        return {"x": 0.0, "y": 0.0, "z": 0.0, "diagonal": 0.0}
    lo = np.percentile(pts, 2, axis=0)
    hi = np.percentile(pts, 98, axis=0)
    d = np.maximum(hi - lo, 0)
    return {
        "x": float(d[0]),
        "y": float(d[1]),
        "z": float(d[2]),
        "diagonal": float(np.linalg.norm(d)),
    }


def reconstruct(work: str, opts: dict | None = None) -> dict:
    """
    특징점 추출 → 매칭 → 증분 SfM. 각 단계 실패를 구분해 돌려준다.

    매칭 전략과 해상도는 요청으로 바꿀 수 있게 열어 뒀다. 어떤 조합이 현장 영상에
    맞는지는 실측으로만 알 수 있는데, 조합마다 이미지를 새로 굽는 건 낭비다.
    """
    opts = opts or {}
    matcher = opts.get("matcher") or "sequential"
    max_edge = int(opts.get("maxImageSize") or 2000)
    overlap = int(opts.get("overlap") or 20)
    img_dir = os.path.join(work, "images")
    db = os.path.join(work, "db.db")
    sparse = os.path.join(work, "sparse")
    os.makedirs(sparse, exist_ok=True)
    started = time.time()

    # COLMAP 버전에 따라 SIFT 옵션 네임스페이스가 달라진다(3.10 부터 --SiftExtraction.* 이
    # 인식되지 않는 빌드가 있다). CUDA 빌드는 GPU 를 기본으로 쓰므로 굳이 지정하지 않고,
    # 버전별로 흔들리는 옵션은 붙였다가 거부되면 뺀 채로 한 번 더 시도한다.
    extra = ["--SiftExtraction.max_image_size", str(max_edge)]
    code, log = run([
        "colmap", "feature_extractor",
        "--database_path", db, "--image_path", img_dir,
        "--ImageReader.single_camera", "1",
        *extra,
    ], SFM_TIMEOUT_SEC)
    if code != 0 and "unrecognised option" in log:
        code, log = run([
            "colmap", "feature_extractor",
            "--database_path", db, "--image_path", img_dir,
            "--ImageReader.single_camera", "1",
        ], SFM_TIMEOUT_SEC)
    if code != 0:
        # 어떤 옵션이 유효한지 알아야 고칠 수 있다 — 도움말을 함께 싣는다.
        _, help_log = run(["colmap", "feature_extractor", "--help"], 60)
        return {"ok": False, "stage": "feature_extractor", "log": log, "help": help_log[:3000]}

    # 매칭 전략. 손으로 든 카메라는 1초 사이에도 크게 움직여 인접 프레임만으로는
    # 겹침이 모자랄 수 있다. exhaustive 는 모든 쌍을 보므로 느리지만 놓치지 않는다.
    if matcher == "exhaustive":
        mcmd = ["colmap", "exhaustive_matcher", "--database_path", db]
    else:
        mcmd = [
            "colmap", "sequential_matcher", "--database_path", db,
            "--SequentialMatching.overlap", str(overlap),
        ]
    code, log = run(mcmd, SFM_TIMEOUT_SEC)
    if code != 0 and "unrecognised option" in log:
        code, log = run(mcmd[:4], SFM_TIMEOUT_SEC)
    if code != 0:
        _, help_log = run([mcmd[1], "--help"], 60)
        return {"ok": False, "stage": mcmd[1], "log": log, "help": help_log[:3000]}

    code, log = run([
        "colmap", "mapper",
        "--database_path", db, "--image_path", img_dir, "--output_path", sparse,
    ], SFM_TIMEOUT_SEC)
    if code != 0:
        _, help_log = run(["colmap", "mapper", "--help"], 60)
        return {"ok": False, "stage": "mapper", "log": log, "help": help_log[:2000]}

    model = os.path.join(sparse, "0")
    if not os.path.isdir(model):
        # 매칭이 부족하면 모델이 아예 안 생긴다 — 촬영이 문제라는 뜻이라 그대로 알린다.
        return {"ok": False, "stage": "mapper", "log": "재구성 모델이 생성되지 않았습니다(매칭 부족)."}

    code, log = run([
        "colmap", "model_converter",
        "--input_path", model, "--output_path", model, "--output_type", "TXT",
    ], 300)
    if code != 0:
        return {"ok": False, "stage": "model_converter", "log": log}

    pts = read_points3d(os.path.join(model, "points3D.txt"))
    cams = read_camera_centers(os.path.join(model, "images.txt"))
    total = len([f for f in os.listdir(img_dir) if f.lower().endswith((".jpg", ".png"))])

    # 점이 많으면 전송량이 커진다 — 균등 표본으로 줄인다(형상은 유지된다).
    sample = pts
    if len(pts) > 20000:
        idx = np.linspace(0, len(pts) - 1, 20000).astype(int)
        sample = pts[idx]

    # 촬영 동선 길이 — 기준 길이를 입력할 때 어느 축을 쓸지 판단하는 데 참고가 된다.
    path_len = float(np.sum(np.linalg.norm(np.diff(cams, axis=0), axis=1))) if len(cams) > 1 else 0.0

    return {
        "ok": True,
        "registeredImages": int(len(cams)),
        "totalImages": int(total),
        "pointCount": int(len(pts)),
        # 단위 없는 좌표계다. 미터로 바꾸는 건 호출부의 몫.
        "extent": robust_extent(pts),
        "cameraPathLength": path_len,
        "points": [[round(v, 4) for v in p] for p in sample.tolist()],
        "cameras": [[round(v, 4) for v in c] for c in cams.tolist()],
        "elapsedSec": round(time.time() - started, 1),
    }


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/health"):
            self._json(200, {"ok": True, "service": "recon"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/reconstruct"):
            self._json(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(n))
        except Exception:
            self._json(400, {"error": "본문을 읽지 못했습니다."})
            return

        frames = payload.get("frames") or []
        if not isinstance(frames, list) or len(frames) < 8:
            self._json(400, {"error": "프레임이 8장 이상 필요합니다.", "received": len(frames)})
            return

        work = tempfile.mkdtemp(prefix="recon-")
        try:
            img_dir = os.path.join(work, "images")
            os.makedirs(img_dir, exist_ok=True)
            for i, b64 in enumerate(frames[:MAX_IMAGES]):
                try:
                    data = base64.b64decode(str(b64).split(",")[-1])
                except Exception:
                    continue
                with open(os.path.join(img_dir, f"{i:04d}.jpg"), "wb") as f:
                    f.write(data)
            self._json(200, reconstruct(work, {
                "matcher": payload.get("matcher"),
                "maxImageSize": payload.get("maxImageSize"),
                "overlap": payload.get("overlap"),
            }))
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "stage": "server", "log": str(e)[:500]})
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def log_message(self, *args) -> None:  # 요청 로그로 이미지 내용이 새지 않게 침묵
        return


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
