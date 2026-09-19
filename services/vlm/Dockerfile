# 디몰비전 자체 VLM 추론 서버 — Google Cloud Run GPU(NVIDIA L4) 용 이미지.
#
# vLLM 의 OpenAI 호환 서버를 그대로 띄우고, apps/api 의 SelfHostedVlmAnalyzer 가
# /v1/chat/completions 로 호출한다(호스팅 API 와 요청 형태가 같아 코드 분기가 없다).
#
# 핵심 설계: 모델 가중치를 이미지에 미리 구워 넣는다(baked weights).
#   Cloud Run 은 요청이 없으면 0 으로 줄었다가 다시 뜨는데, 그때마다 허깅페이스에서
#   수 GB 를 내려받으면 콜드스타트가 수 분이 된다. 이미지에 넣어두면 Cloud Run 의
#   이미지 스트리밍이 필요한 레이어만 당겨써서 기동이 크게 빨라진다.

FROM vllm/vllm-openai:v0.8.5

# AWQ 4bit 양자화본이 기본 — L4(24GB) 에 KV 캐시까지 여유 있게 들어간다.
# bf16 원본을 쓰려면 빌드 인자로 모델을 바꾸고 --gpu-memory-utilization 을 낮춘다.
ARG MODEL_ID=Qwen/Qwen2.5-VL-7B-Instruct-AWQ
ENV MODEL_ID=${MODEL_ID}
ENV HF_HOME=/models

# 비공개(gated) 모델을 쓸 때만 필요. Qwen2.5-VL 은 공개 모델이라 없어도 된다.
ARG HF_TOKEN=""

# 20GB 급 모델은 다운로드가 중간에 끊기는 일이 잦다(CAS/IncompleteBody).
# xet 전송을 끄고 재시도를 둬서 빌드가 한 번의 네트워크 흔들림으로 날아가지 않게 한다.
ENV HF_HUB_DISABLE_XET=1
ENV HF_HUB_ENABLE_HF_TRANSFER=0
RUN mkdir -p /models && \
    for i in 1 2 3 4 5; do \
      HF_TOKEN=${HF_TOKEN} huggingface-cli download "${MODEL_ID}" \
        --exclude "*.pth" "*.bin" "original/*" && break || \
      { echo "다운로드 재시도 $i/5"; sleep 20; }; \
    done && \
    rm -rf /root/.cache/pip

# Cloud Run 은 $PORT 로 트래픽을 보낸다(기본 8080).
ENV PORT=8080

# --limit-mm-per-prompt image=6 : apps/api 의 MAX_ANALYZE_IMAGES 와 맞춘다(다중 촬영 종합 분석).
# --max-model-len 8192          : 현장 사진 + JSON 리포트에 충분하고 KV 캐시를 아낀다.
# 셸 폼이라 $PORT 가 런타임에 치환된다.
ENTRYPOINT []
CMD vllm serve "${MODEL_ID}" \
      --host 0.0.0.0 \
      --port "${PORT}" \
      --served-model-name "${MODEL_ID}" \
      --max-model-len 8192 \
      --limit-mm-per-prompt image=6 \
      --gpu-memory-utilization 0.90 \
      --disable-log-requests
