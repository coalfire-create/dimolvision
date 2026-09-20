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


# ── COLMAP 설정 사다리 ────────────────────────────────────────────────
#
# 철거 현장은 SfM 에 불리한 조건이 겹친다: 도배·페인트 벽은 무늬가 거의 없고,
# 좁은 통로에서는 화면이 빨리 흐르며, 실내는 어둡다. COLMAP 기본값은 깨끗한
# 실외 촬영에 맞춰져 있어 이런 현장에서는 초기화조차 못 하고 끝나는 일이 잦다.
#
# 그래서 한 번에 포기하지 않고 단계적으로 느슨하게 풀며 다시 시도한다.
# 1차에서 충분히 나오면 거기서 끝내고(빠르다), 부족할 때만 더 공격적으로 간다.
PROFILES = [
    {
        "name": "balanced",
        # 무늬가 약한 벽에서도 특징점을 더 많이 잡게 한다.
        #   max_num_features 8192 → 16384, peak_threshold 0.0067 → 0.004(약한 점도 채택)
        #   edge_threshold 10 → 16(문틀·몰딩 같은 선형 구조를 버리지 않는다)
        "sift": ["--SiftExtraction.max_num_features", "16384",
                 "--SiftExtraction.peak_threshold", "0.004",
                 "--SiftExtraction.edge_threshold", "16"],
        # 비율 검정과 재투영 허용치를 조금 풀어 매칭 수를 늘린다.
        "match": ["--SiftMatching.max_ratio", "0.85",
                  "--SiftMatching.max_error", "5",
                  "--SiftMatching.guided_matching", "1"],
        # 초기화·등록 문턱을 낮춘다. 기본값(init 100 / abs_pose 30 / min_matches 15)은
        # 현장 영상에서 너무 높아 "모델이 아예 안 생기는" 원인이 된다.
        "mapper": ["--Mapper.init_min_num_inliers", "50",
                   "--Mapper.abs_pose_min_num_inliers", "15",
                   "--Mapper.min_num_matches", "8",
                   "--Mapper.filter_max_reproj_error", "8",
                   "--Mapper.multiple_models", "1"],
    },
    {
        "name": "aggressive",
        # 마지막 수단. affine shape + domain size pooling 은 시점 차이가 큰 쌍도
        # 맞춰 주지만 CPU 로 돌아 훨씬 느리다. 1차가 실패했을 때만 쓴다.
        "sift": ["--SiftExtraction.max_num_features", "32768",
                 "--SiftExtraction.peak_threshold", "0.002",
                 "--SiftExtraction.edge_threshold", "20",
                 "--SiftExtraction.estimate_affine_shape", "1",
                 "--SiftExtraction.domain_size_pooling", "1"],
        "match": ["--SiftMatching.max_ratio", "0.9",
                  "--SiftMatching.max_error", "6",
                  "--SiftMatching.guided_matching", "1",
                  "--TwoViewGeometry.min_num_inliers", "10"],
        "mapper": ["--Mapper.init_min_num_inliers", "25",
                   "--Mapper.abs_pose_min_num_inliers", "8",
                   "--Mapper.min_num_matches", "5",
                   "--Mapper.filter_max_reproj_error", "12",
                   "--Mapper.abs_pose_min_inlier_ratio", "0.15",
                   "--Mapper.multiple_models", "1"],
    },
]

# 2차 시도에 최소한 이만큼은 남아 있어야 시작한다(중간에 잘리면 아무것도 못 얻는다).
AGGRESSIVE_MIN_BUDGET_SEC = 330


def run_tolerant(base: list[str], extra: list[str], timeout: int) -> tuple[int, str]:
    """
    옵션을 붙여 실행하고, 그 빌드가 모르는 옵션이면 하나씩 떼어내며 다시 시도한다.
    COLMAP 은 버전마다 옵션 이름이 달라 하드코딩하면 배포본에서만 깨진다.
    """
    code, log = run([*base, *extra], timeout)
    while code != 0 and "unrecognised option" in log and extra:
        bad = None
        for i in range(0, len(extra), 2):
            if extra[i].lstrip("-") in log or extra[i] in log:
                bad = i
                break
        if bad is None:
            extra = []
        else:
            extra = extra[:bad] + extra[bad + 2:]
        code, log = run([*base, *extra], timeout)
    return code, log


def read_model_images(model: str) -> list[str]:
    """등록된 이미지 파일명. 어느 구간이 이어지지 않았는지 알려주는 근거가 된다."""
    path = os.path.join(model, "images.txt")
    if not os.path.isfile(path):
        return []
    names = []
    with open(path, "r") as f:
        lines = [l for l in f if l.strip() and not l.startswith("#")]
    for i in range(0, len(lines), 2):
        parts = lines[i].split()
        if len(parts) >= 10:
            names.append(parts[9])
    return names


def best_model(sparse: str) -> str | None:
    """
    COLMAP 은 장면이 끊기면 모델을 여러 개 만든다(sparse/0, sparse/1, ...).
    예전에는 sparse/0 만 읽었는데, 0 번이 가장 큰 모델이라는 보장이 없다 —
    코너에서 끊긴 촬영이면 0 번이 짧은 조각이고 1 번이 본체인 경우가 실제로 생긴다.
    등록 이미지가 가장 많은 모델을 고른다.
    """
    if not os.path.isdir(sparse):
        return None
    best, best_n = None, -1
    for name in sorted(os.listdir(sparse)):
        d = os.path.join(sparse, name)
        if not os.path.isdir(d):
            continue
        n = len(read_model_images(d))
        if n == 0 and os.path.isfile(os.path.join(d, "images.bin")):
            n = 0  # TXT 변환 전이면 나중에 다시 센다
        if n > best_n:
            best, best_n = d, n
    return best


def attempt(work: str, profile: dict, matcher: str, max_edge: int, overlap: int,
            budget: int) -> dict:
    """설정 하나로 전 과정을 한 번 돌린다."""
    img_dir = os.path.join(work, "images")
    db = os.path.join(work, "db_%s.db" % profile["name"])
    sparse = os.path.join(work, "sparse_%s" % profile["name"])
    os.makedirs(sparse, exist_ok=True)

    code, log = run_tolerant(
        ["colmap", "feature_extractor", "--database_path", db,
         "--image_path", img_dir, "--ImageReader.single_camera", "1"],
        ["--SiftExtraction.max_image_size", str(max_edge), *profile["sift"]],
        budget,
    )
    if code != 0:
        return {"ok": False, "stage": "feature_extractor", "log": log}

    if matcher == "exhaustive":
        mbase = ["colmap", "exhaustive_matcher", "--database_path", db]
    else:
        mbase = ["colmap", "sequential_matcher", "--database_path", db,
                 "--SequentialMatching.overlap", str(overlap)]
    code, log = run_tolerant(mbase, profile["match"], budget)
    if code != 0:
        return {"ok": False, "stage": mbase[1], "log": log}

    code, log = run_tolerant(
        ["colmap", "mapper", "--database_path", db,
         "--image_path", img_dir, "--output_path", sparse],
        profile["mapper"], budget,
    )
    if code != 0:
        return {"ok": False, "stage": "mapper", "log": log}

    models = [d for d in sorted(os.listdir(sparse))
              if os.path.isdir(os.path.join(sparse, d))]
    if not models:
        return {"ok": False, "stage": "mapper",
                "log": "재구성 모델이 생성되지 않았습니다(매칭 부족)."}

    # 모든 모델을 TXT 로 바꿔 놓고 가장 큰 것을 고른다.
    for d in models:
        m = os.path.join(sparse, d)
        run(["colmap", "model_converter", "--input_path", m,
             "--output_path", m, "--output_type", "TXT"], 300)

    model = best_model(sparse)
    if model is None:
        return {"ok": False, "stage": "mapper", "log": "모델을 읽지 못했습니다."}

    pts = read_points3d(os.path.join(model, "points3D.txt"))
    cams = read_camera_centers(os.path.join(model, "images.txt"))
    return {
        "ok": True,
        "model": model,
        "points": pts,
        "cameras": cams,
        "registeredNames": read_model_images(model),
        "modelCount": len(models),
        "profile": profile["name"],
    }


def reconstruct(work: str, opts: dict | None = None) -> dict:
    """
    설정 사다리를 타며 가장 좋은 결과를 돌려준다.

    1차(balanced)로 충분하면 거기서 끝낸다. 부족하면 남은 시간을 보고 2차(aggressive)를
    돌려 둘 중 더 많이 등록된 쪽을 쓴다. 한 번 실패했다고 포기하면, 조금만 풀어주면
    복원됐을 촬영까지 "실패" 로 돌려보내게 된다.
    """
    opts = opts or {}
    matcher = opts.get("matcher") or "exhaustive"
    max_edge = int(opts.get("maxImageSize") or 1600)
    overlap = int(opts.get("overlap") or 20)
    img_dir = os.path.join(work, "images")
    total = len([f for f in os.listdir(img_dir) if f.lower().endswith((".jpg", ".png"))])
    started = time.time()

    best = None
    last_fail = None
    for i, profile in enumerate(PROFILES):
        elapsed = time.time() - started
        remaining = SFM_TIMEOUT_SEC - elapsed
        if i > 0:
            # 1차가 쓸 만하면 더 안 돌린다 — 2차는 몇 배 느리다.
            if best and (len(best["cameras"]) >= total * 0.6 or len(best["points"]) >= 3000):
                break
            if remaining < AGGRESSIVE_MIN_BUDGET_SEC:
                break
        r = attempt(work, profile, matcher, max_edge, overlap, int(max(60, remaining)))
        if not r.get("ok"):
            last_fail = r
            continue
        if best is None or len(r["cameras"]) > len(best["cameras"]):
            best = r

    if best is None:
        return last_fail or {"ok": False, "stage": "mapper", "log": "복원에 실패했습니다."}

    pts, cams = best["points"], best["cameras"]
    sample = pts
    if len(pts) > 20000:
        idx = np.linspace(0, len(pts) - 1, 20000).astype(int)
        sample = pts[idx]
    path_len = (float(np.sum(np.linalg.norm(np.diff(cams, axis=0), axis=1)))
                if len(cams) > 1 else 0.0)

    return {
        "ok": True,
        "registeredImages": int(len(cams)),
        "totalImages": int(total),
        "pointCount": int(len(pts)),
        "extent": robust_extent(pts),
        "cameraPathLength": path_len,
        "points": [[round(v, 4) for v in p] for p in sample.tolist()],
        "cameras": [[round(v, 4) for v in c] for c in cams.tolist()],
        # 어느 사진이 이어졌는지. 클라이언트가 촬영 시각으로 되돌려
        # "어느 구간을 다시 찍어야 하는지" 를 알려주는 데 쓴다.
        "registeredNames": best["registeredNames"],
        "modelCount": best["modelCount"],
        "profile": best["profile"],
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
