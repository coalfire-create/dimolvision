# 디몰비전 3D 복원 — VGGT(feed-forward 3D)를 Cloud Run GPU(L4)에서 돌린다.
#
# COLMAP 을 왜 두고 이걸 얹는가: SfM 은 사진에서 같은 지점을 찾아 맞춰야 하는데
# 철거 현장의 도배·페인트 벽에는 맞출 지점이 없다. 실측에서 "매칭은 990개가 됐는데
# 초기 이미지 쌍을 못 찾아" 모델이 아예 생성되지 않는 실패를 반복했다.
# VGGT 는 특징점 매칭 없이 신경망이 한 번의 추론으로 카메라 포즈와 3D 를 함께 내므로
# 그 실패 자체가 없다. 무텍스처 구간이 이 서비스의 기본 조건이라 이쪽이 맞다.
# 태그는 실제 존재하는 것으로 — 2.4.0-cuda121 형식은 Docker Hub 에 없다.
FROM pytorch/pytorch:2.9.1-cuda12.6-cudnn9-runtime

# open3d 는 slim 런타임 이미지에 없는 libGL·libgomp 를 요구한다.
# 없으면 import 단계에서 죽는데, 예외를 삼키고 있어 "메시 없음" 으로만 보였다.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git libgl1 libgomp1 libusb-1.0-0 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# VGGT 본체. 릴리스 태그가 없어 main 을 고정 커밋으로 받는다.
RUN git clone --depth 1 https://github.com/facebookresearch/vggt.git /app/vggt-src \
    && pip install --no-cache-dir -r /app/vggt-src/requirements.txt \
    && pip install --no-cache-dir -e /app/vggt-src

# 가중치를 이미지에 구워 넣는다. 런타임에 5GB 를 받으면 콜드스타트가 몇 분이 된다.
ENV HF_HOME=/app/hf
ENV HF_HUB_DISABLE_XET=1
RUN for i in 1 2 3; do \
      python -c "from huggingface_hub import snapshot_download; snapshot_download('facebook/VGGT-1B')" && break; \
      echo "재시도 $i"; sleep 15; \
    done

# Poisson 표면 재구성용. 점군을 삼각형 면으로 바꿔야 "벽" 으로 보인다.
RUN pip install --no-cache-dir open3d==0.18.0

COPY server.py /app/server.py
ENV PORT=8080
CMD ["python", "/app/server.py"]
