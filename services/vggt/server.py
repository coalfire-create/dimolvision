"""
디몰비전 3D 복원 — VGGT(feed-forward 3D reconstruction).

왜 COLMAP 대신인가:
  SfM 은 사진에서 같은 지점을 찾아 맞추는 방식이라, 맞출 무늬가 없으면 원리적으로
  실패한다. 철거 현장은 도배·페인트 벽이 대부분이라 그 조건이 기본값이다.
  실측에서 "매칭 990개, 45장 전부 연결됨" 인데도 초기 이미지 쌍을 못 찾아
  모델이 아예 생성되지 않는 실패를 반복했다.

  VGGT 는 신경망이 한 번의 추론으로 카메라 포즈와 조밀 깊이를 함께 낸다.
  특징점 매칭 단계가 없으므로 "초기화 실패" 라는 실패 모드 자체가 없다.

응답 형식은 COLMAP 서비스와 같게 맞춘다 — 호출부가 둘을 바꿔 끼울 수 있어야 한다.

스케일에 대하여:
  VGGT 도 사진만으로는 절대 크기를 모른다(단위 없는 좌표계). COLMAP 과 마찬가지로
  점군과 상대 치수만 돌려주고, 미터 환산은 호출부가 기준 하나를 받아 처리한다.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch

from vggt.models.vggt import VGGT
from vggt.utils.load_fn import load_and_preprocess_images
from vggt.utils.pose_enc import pose_encoding_to_extri_intri
from vggt.utils.geometry import unproject_depth_map_to_point_map

# 한 번에 넣는 최대 장수. VGGT 는 모든 프레임을 함께 보므로 메모리가 장수의 제곱으로
# 늘어난다. L4(24GB)에서 안전한 범위로 잡고, 더 오면 고르게 솎아 쓴다.
MAX_VIEWS = int(os.environ.get("VGGT_MAX_VIEWS", "48"))
# 돌려줄 점 개수 상한.
#
# 2만 개로 두었더니 화면이 "점들의 집합" 으로만 보였다. 방처럼 보이려면 두 가지가
# 필요하다 — 점이 충분히 조밀할 것, 그리고 **각 점이 제 색을 가질 것**.
# 좌표를 JSON 숫자로 보내면 점당 30자가 넘어 금방 한계에 닿으므로,
# float32/uint8 바이너리를 base64 로 실어 보낸다(점당 15바이트).
MAX_POINTS = 150000
# 신뢰도 하위 구간은 버린다. 하늘·유리처럼 깊이를 못 정한 화소가 형상을 망친다.
CONF_PERCENTILE = 50.0

# 메시로 바꿀 때 쓰는 점 개수. 전부 넣으면 Poisson 이 수 분 걸린다.
MESH_SAMPLE = 120000

_model = None
_device = "cuda" if torch.cuda.is_available() else "cpu"
_dtype = torch.bfloat16 if (
    torch.cuda.is_available() and torch.cuda.get_device_capability()[0] >= 8
) else torch.float16


def model():
    """첫 요청 때 한 번만 올린다. 콜드스타트를 줄이려 가중치는 이미지에 구워 두었다."""
    global _model
    if _model is None:
        _model = VGGT.from_pretrained("facebook/VGGT-1B").to(_device).eval()
    return _model


def pick_even(paths: list[str], keep: int) -> list[str]:
    """장수를 줄여야 하면 고르게 솎는다 — 앞부분만 쓰면 한 면만 복원된다."""
    if len(paths) <= keep:
        return paths
    idx = np.linspace(0, len(paths) - 1, keep).astype(int)
    return [paths[i] for i in idx]


def robust_extent(pts: np.ndarray) -> dict:
    """이상치에 흔들리지 않는 크기. 상하위 2% 를 잘라낸 백분위 범위를 쓴다."""
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


def build_mesh(pts: np.ndarray, rgb: np.ndarray) -> dict | None:
    """
    점군 → 삼각형 면(메시).

    점을 크게 찍어 겹치게 하면 멀리서는 벽처럼 보이지만 가까이 가면 다시 점이다.
    진짜 면을 만들려면 법선을 추정하고 표면을 맞춰야 한다. Poisson 재구성은
    닫힌 매끄러운 표면을 만들어 주는데, 밀도가 낮은 곳까지 억지로 메우므로
    그런 부분은 잘라낸다 — 안 그러면 없는 벽이 생긴다.
    """
    try:
        import open3d as o3d
    except Exception:
        return None
    if len(pts) < 5000:
        return None
    try:
        idx = (np.linspace(0, len(pts) - 1, MESH_SAMPLE).astype(int)
               if len(pts) > MESH_SAMPLE else np.arange(len(pts)))
        pc = o3d.geometry.PointCloud()
        pc.points = o3d.utility.Vector3dVector(pts[idx].astype(np.float64))
        if rgb is not None and rgb.shape[0] == pts.shape[0]:
            pc.colors = o3d.utility.Vector3dVector((rgb[idx] / 255.0).astype(np.float64))

        # 이상치를 먼저 뺀다. 튄 점이 남으면 표면이 그쪽으로 끌려간다.
        pc, _ = pc.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
        pc.estimate_normals(o3d.geometry.KDTreeSearchParamKNN(knn=30))
        pc.orient_normals_consistent_tangent_plane(30)

        mesh, dens = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
            pc, depth=9, linear_fit=True
        )
        # 점이 거의 없던 곳에 생긴 면은 지운다(하위 6%).
        d = np.asarray(dens)
        if d.size:
            mesh.remove_vertices_by_mask(d < np.quantile(d, 0.06))
        mesh.remove_degenerate_triangles()
        mesh.remove_duplicated_vertices()
        mesh = mesh.simplify_quadric_decimation(150000)
        mesh.compute_vertex_normals()

        v = np.asarray(mesh.vertices, dtype=np.float32)
        f = np.asarray(mesh.triangles, dtype=np.uint32)
        if len(v) < 100 or len(f) < 100:
            return None
        vc = np.asarray(mesh.vertex_colors)
        return {
            "verticesB64": base64.b64encode(v.tobytes()).decode(),
            "facesB64": base64.b64encode(f.tobytes()).decode(),
            "vertexColorsB64": (
                base64.b64encode((vc * 255).astype(np.uint8).tobytes()).decode()
                if vc.size else None
            ),
            "vertexCount": int(len(v)),
            "faceCount": int(len(f)),
        }
    except Exception:
        # 메시는 덤이다. 실패해도 점군은 그대로 보여 준다.
        return None


def reconstruct(img_dir: str) -> dict:
    started = time.time()
    names = sorted(
        f for f in os.listdir(img_dir) if f.lower().endswith((".jpg", ".png"))
    )
    total = len(names)
    if total < 2:
        return {"ok": False, "stage": "input", "log": "사진이 2장 이상 필요합니다."}

    used = pick_even([os.path.join(img_dir, n) for n in names], MAX_VIEWS)
    images = load_and_preprocess_images(used).to(_device)

    with torch.no_grad():
        with torch.autocast(device_type="cuda" if _device == "cuda" else "cpu", dtype=_dtype):
            pred = model()(images)

    # 포즈 인코딩 → 외부/내부 파라미터. 이미지 크기는 전처리된 텐서 기준이다.
    extrinsic, intrinsic = pose_encoding_to_extri_intri(pred["pose_enc"], images.shape[-2:])
    extrinsic = extrinsic.squeeze(0).float().cpu().numpy()
    intrinsic = intrinsic.squeeze(0).float().cpu().numpy()

    depth = pred["depth"].squeeze(0).float().cpu().numpy()          # (S, H, W, 1)
    conf = pred["depth_conf"].squeeze(0).float().cpu().numpy()      # (S, H, W)

    world = unproject_depth_map_to_point_map(depth, extrinsic, intrinsic)  # (S, H, W, 3)
    pts = np.asarray(world).reshape(-1, 3)
    c = np.asarray(conf).reshape(-1)

    # 각 점의 색 = 그 점이 나온 화소의 색. 이게 없으면 형상이 맞아도 방처럼 보이지 않는다.
    # images 는 (S, 3, H, W) 이고 0~1 범위다. 깊이와 화소가 1:1 로 대응한다.
    rgb = (
        images.squeeze(0).permute(0, 2, 3, 1).float().cpu().numpy().reshape(-1, 3)
        if images.dim() == 5
        else images.permute(0, 2, 3, 1).float().cpu().numpy().reshape(-1, 3)
    )
    rgb = np.clip(rgb * 255.0, 0, 255)

    # 신뢰도가 낮은 화소를 버린다. 색도 같이 버려야 좌표와 어긋나지 않는다.
    if c.size == pts.shape[0] and c.size > 0:
        thr = np.percentile(c, CONF_PERCENTILE)
        keep = c >= thr
        if keep.sum() >= 100:
            pts, rgb = pts[keep], rgb[keep] if rgb.shape[0] == keep.shape[0] else rgb
    finite = np.isfinite(pts).all(axis=1)
    pts = pts[finite]
    if rgb.shape[0] == finite.shape[0]:
        rgb = rgb[finite]
    if len(pts) == 0:
        return {"ok": False, "stage": "depth", "log": "깊이를 추정하지 못했습니다."}

    sample, sample_rgb = pts, rgb
    if len(pts) > MAX_POINTS:
        idx = np.linspace(0, len(pts) - 1, MAX_POINTS).astype(int)
        sample = pts[idx]
        if rgb.shape[0] == pts.shape[0]:
            sample_rgb = rgb[idx]

    # 카메라 중심 C = -R^T t
    cams = []
    for e in extrinsic:
        R, t = e[:3, :3], e[:3, 3]
        cams.append((-R.T @ t).tolist())
    mesh = build_mesh(pts, rgb if rgb.shape[0] == pts.shape[0] else None)

    cams_np = np.array(cams, dtype=np.float64)
    path_len = (
        float(np.sum(np.linalg.norm(np.diff(cams_np, axis=0), axis=1)))
        if len(cams_np) > 1 else 0.0
    )

    return {
        "ok": True,
        # VGGT 는 넣은 사진을 전부 쓴다 — COLMAP 처럼 "등록 실패" 로 빠지는 장이 없다.
        # 그래서 totalImages 는 **실제로 쓴 장수**다. 보낸 장수를 쓰면 메모리 때문에
        # 솎아낸 것이 "복원 실패" 로 보여, 멀쩡한 결과에 "일부 구간이 복원되지
        # 않았습니다" 라는 틀린 안내가 붙는다.
        "registeredImages": int(len(used)),
        "totalImages": int(len(used)),
        "inputFrames": int(total),
        "pointCount": int(len(pts)),
        "extent": robust_extent(pts),
        "cameraPathLength": path_len,
        # 바이너리로 싣는다. 같은 용량에 7배 많은 점을 담을 수 있다.
        "pointsB64": base64.b64encode(sample.astype(np.float32).tobytes()).decode(),
        "colorsB64": (
            base64.b64encode(sample_rgb.astype(np.uint8).tobytes()).decode()
            if sample_rgb.shape[0] == sample.shape[0] else None
        ),
        # 구형 클라이언트 호환용 축약본(바이너리를 못 읽을 때).
        "points": [[round(float(v), 3) for v in p] for p in sample[:: max(1, len(sample) // 8000)].tolist()],
        "cameras": [[round(float(v), 4) for v in c2] for c2 in cams],
        "registeredNames": [os.path.basename(p) for p in used],
        "modelCount": 1,
        "profile": "vggt",
        # 삼각형 면. 있으면 화면이 점 대신 이걸 그려 진짜 벽으로 보인다.
        **({"mesh": mesh} if mesh else {}),
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
            # 모델을 미리 올려 둔다 — 깨우기 호출이 곧 준비 완료가 되게.
            try:
                model()
                self._json(200, {"ok": True, "service": "vggt", "device": _device})
            except Exception as e:  # noqa: BLE001
                self._json(503, {"ok": False, "log": str(e)[:300]})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/reconstruct"):
            self._json(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(n))
        except Exception:  # noqa: BLE001
            self._json(400, {"error": "본문을 읽지 못했습니다."})
            return

        frames = payload.get("frames") or []
        if not isinstance(frames, list) or len(frames) < 2:
            self._json(400, {"error": "프레임이 2장 이상 필요합니다.", "received": len(frames)})
            return

        work = tempfile.mkdtemp(prefix="vggt-")
        try:
            img_dir = os.path.join(work, "images")
            os.makedirs(img_dir, exist_ok=True)
            for i, b64 in enumerate(frames):
                try:
                    data = base64.b64decode(str(b64).split(",")[-1])
                except Exception:  # noqa: BLE001
                    continue
                with open(os.path.join(img_dir, f"{i:04d}.jpg"), "wb") as f:
                    f.write(data)
            self._json(200, reconstruct(img_dir))
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            self._json(200, {
                "ok": False, "stage": "memory",
                "log": f"사진이 많아 GPU 메모리가 부족했습니다(최대 {MAX_VIEWS}장).",
            })
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "stage": "server", "log": str(e)[:500]})
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def log_message(self, *args) -> None:  # 요청 로그로 이미지 내용이 새지 않게 침묵
        return


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
