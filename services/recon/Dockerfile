# 디몰비전 3D 복원 서비스 — COLMAP(SfM) 을 Cloud Run GPU 에서 돌린다.
# 공식 COLMAP 이미지는 CUDA 빌드라 L4 에서 GPU 특징점 추출·매칭이 그대로 동작한다.
FROM colmap/colmap:latest

# 표준 라이브러리 HTTP 서버 + numpy 만 쓴다(웹 프레임워크를 얹을 이유가 없다).
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-numpy \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.py /app/server.py

ENV PORT=8080
# COLMAP 이미지의 ENTRYPOINT 가 colmap 실행이라 비워야 파이썬이 뜬다.
ENTRYPOINT []
CMD ["python3", "/app/server.py"]
