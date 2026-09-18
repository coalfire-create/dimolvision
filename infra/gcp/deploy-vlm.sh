#!/usr/bin/env bash
# 디몰비전 자체 VLM — Google Cloud Run GPU(NVIDIA L4) 배포 스크립트.
#
# 사용법:
#   PROJECT_ID=my-project ./infra/gcp/deploy-vlm.sh
#
# 되돌리기: gcloud run services delete "$SERVICE" --region "$REGION"
#
# 이 스크립트는 과금이 발생하는 리소스를 만든다. 실행 전 infra/gcp/README.md 의
# 비용·쿼터 절을 반드시 읽을 것.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-central1}"          # L4 GPU 제공 리전. README 의 리전 표 참고.
SERVICE="${SERVICE:-dimolvision-vlm}"
REPO="${REPO:-dimolvision}"
MODEL_ID="${MODEL_ID:-Qwen/Qwen2.5-VL-7B-Instruct-AWQ}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/vlm:latest"

# 공개 접근 여부. false 면 Cloud Run 을 비공개로 두고 서비스 계정 토큰이 필요하다.
ALLOW_UNAUTH="${ALLOW_UNAUTH:-true}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "PROJECT_ID 가 필요합니다. PROJECT_ID=... 로 지정하거나 gcloud config set project 를 먼저 실행하세요." >&2
  exit 1
fi

echo "==> 프로젝트: ${PROJECT_ID} / 리전: ${REGION} / 모델: ${MODEL_ID}"

echo "==> 1/5 필요한 API 활성화"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project "$PROJECT_ID"

echo "==> 2/5 Artifact Registry 저장소 준비"
if ! gcloud artifacts repositories describe "$REPO" \
      --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location "$REGION" \
    --description "디몰비전 컨테이너 이미지" \
    --project "$PROJECT_ID"
fi

echo "==> 3/5 이미지 빌드 (모델 가중치를 굽기 때문에 20~40분 걸릴 수 있음)"
# 기본 워커로는 디스크·메모리가 부족하다 — 큰 머신과 넉넉한 디스크를 지정한다.
gcloud builds submit services/vlm \
  --tag "$IMAGE" \
  --machine-type=e2-highcpu-32 \
  --disk-size=200GB \
  --timeout=3600s \
  --project "$PROJECT_ID"

echo "==> 4/5 Cloud Run 배포 (NVIDIA L4 1장)"
AUTH_FLAG="--no-allow-unauthenticated"
[[ "$ALLOW_UNAUTH" == "true" ]] && AUTH_FLAG="--allow-unauthenticated"

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --gpu 1 \
  --gpu-type nvidia-l4 \
  --no-gpu-zonal-redundancy \
  --cpu 8 \
  --memory 32Gi \
  --max-instances 3 \
  --min-instances 0 \
  --concurrency 4 \
  --timeout 600 \
  --port 8080 \
  --set-env-vars "MODEL_ID=${MODEL_ID}" \
  --execution-environment gen2 \
  $AUTH_FLAG

URL="$(gcloud run services describe "$SERVICE" \
        --region "$REGION" --project "$PROJECT_ID" --format 'value(status.url)')"

echo "==> 5/5 완료"
echo
echo "VLM 엔드포인트: ${URL}/v1"
echo
echo "디몰비전 API 에 연결하려면 배포 환경변수에 아래를 넣으세요:"
echo "  VLM_BASE_URL=${URL}/v1"
echo "  VLM_MODEL=${MODEL_ID}"
echo
echo "Vercel 이라면:"
echo "  vercel env add VLM_BASE_URL production   # 값: ${URL}/v1"
echo "  vercel env add VLM_MODEL production      # 값: ${MODEL_ID}"
echo
echo "동작 확인:"
echo "  curl -s ${URL}/v1/models | head"
