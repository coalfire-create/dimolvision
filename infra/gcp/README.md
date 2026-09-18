# 디몰비전 GPU 상용화 — Google Cloud 구성

경량형(호스팅 VLM 직접 호출)에서 **본격형(자체 GPU 추론)** 으로 넘어가는 경로다.
`services/vlm` 의 vLLM 서버를 **Cloud Run GPU(NVIDIA L4)** 에 올리고, 디몰비전 API 가
`VLM_BASE_URL` 로 그 서버를 호출한다.

```
[웹/앱] ──▶ [Vercel: 디몰비전 API] ──▶ [Cloud Run GPU: vLLM + Qwen2.5-VL]
                    │                         (요청 없으면 0 인스턴스)
                    └─(VLM 미설정 시) 호스팅 API(Groq/Gemini/Claude) 또는 목
```

## 왜 Cloud Run GPU인가

상용화에서 걸리는 건 세 가지고, 이 구성이 셋 다 해결한다.

| 문제 | 호스팅 API(현재) | 자체 GPU(이 구성) |
| --- | --- | --- |
| 단가 | 호출당 과금 — 사용량이 늘수록 원가가 선형으로 증가 | 시간당 과금 — 동시처리로 호출당 원가가 내려감 |
| 데이터 주권 | 현장 사진이 해외 사업자로 나감 | 내 프로젝트 안에서만 처리 |
| 모델 | 범용 모델 고정 | 철거 도메인 파인튜닝 가능(같은 엔드포인트 유지) |

GPU VM(GCE)이 아니라 Cloud Run 을 고른 이유는 **요청이 없을 때 0 으로 줄어들기** 때문이다.
초기 트래픽이 들쭉날쭉한 단계에서 GPU VM 을 24시간 켜두면 원가가 그대로 손실이 된다.

## 사전 준비 (한 번만)

1. **결제 계정 활성화** — 현재 계정(`010504-A634F9-0E7A07`)은 `OPEN: False` 상태라
   이대로는 GPU 가 뜨지 않는다. [결제 콘솔](https://console.cloud.google.com/billing)에서
   활성화하고 프로젝트에 연결한다.
   ```bash
   gcloud billing projects link "$PROJECT_ID" --billing-account=010504-A634F9-0E7A07
   ```
2. **GPU 쿼터 신청** — 신규 프로젝트는 Cloud Run GPU 쿼터가 0 이다.
   [IAM & 관리 → 할당량](https://console.cloud.google.com/iam-admin/quotas)에서
   `Total Nvidia L4 GPU allocation, per project per region` 을 검색해 배포할 리전에
   최소 1 이상을 신청한다. 승인까지 보통 1~2 영업일이 걸리니 **가장 먼저** 해둘 것.
3. **리전 선택** — L4 는 모든 리전에 있지 않다. 서울(`asia-northeast3`) 제공 여부는
   프로젝트마다 다르므로 [Cloud Run GPU 문서](https://cloud.google.com/run/docs/configuring/services/gpu)의
   지원 리전 표에서 확인한 뒤 `REGION` 을 정한다. 한국 사용자 지연시간이 중요하면
   아시아 리전을, 확실한 가용성이 우선이면 `us-central1` 을 쓴다.

## 배포

```bash
PROJECT_ID=<프로젝트ID> REGION=us-central1 ./infra/gcp/deploy-vlm.sh
```

스크립트가 하는 일: API 활성화 → Artifact Registry 생성 → 이미지 빌드(모델 가중치 포함)
→ Cloud Run 배포 → 연결용 환경변수 출력.

빌드는 모델을 이미지에 굽기 때문에 **20~40분** 걸린다. 콜드스타트를 줄이려는 의도적인
선택이다(매 기동마다 허깅페이스에서 수 GB 를 받으면 첫 응답이 수 분이 된다).

배포가 끝나면 출력된 값을 디몰비전 API 환경에 넣는다.

```bash
vercel env add VLM_BASE_URL production   # https://dimolvision-vlm-xxxx.run.app/v1
vercel env add VLM_MODEL production      # Qwen/Qwen2.5-VL-7B-Instruct-AWQ
vercel --prod
```

설정 즉시 `GET /api/health` 가 `{"provider":"self-hosted-vlm"}` 로 바뀐다.
**호스팅 API 키는 지우지 말 것** — VLM 호출이 실패하면 라우터가 목으로 폴백하는데,
키가 남아 있으면 그 전에 호스팅 API 로 대체할 수 있는 여지를 남긴다.

## 비용 구조

Cloud Run GPU 는 **인스턴스가 살아 있는 시간**에 대해 GPU·CPU·메모리를 각각 과금한다.
요청이 없으면 0 으로 줄어 과금도 멈춘다.

호출당 원가는 이렇게 결정된다.

```
호출당 원가 ≈ (시간당 인스턴스 요금) ÷ (시간당 처리 건수)
시간당 처리 건수 = 3600초 ÷ 건당 처리시간 × 동시처리수(concurrency)
```

L4 한 장에 7B 모델이면 사진 1장 분석이 대략 3~6초다. `--concurrency 4` 로 묶으면
시간당 대략 2,400~4,800건을 처리한다. 즉 **시간당 요금을 처리 건수로 나누면 호출당
원가가 호스팅 API 보다 한 자릿수 이상 낮아지는 구간**이 트래픽이 붙기 시작하는 시점이다.

> 실제 단가는 리전·시점에 따라 바뀌므로 반드시
> [Cloud Run 가격표](https://cloud.google.com/run/pricing)에서 해당 리전의
> GPU 초당 요금을 확인해 위 식에 넣어 계산할 것. 여기에 숫자를 박아두면 금방 틀린 값이 된다.

**손익분기 판단법**: 호스팅 API 의 1,000건당 비용과, 위 식으로 구한 자체 GPU 1,000건당
비용을 비교한다. 트래픽이 적을 때는 호스팅 API 가 싸고(0건이면 0원), 일정 수준을 넘으면
자체 GPU 가 싸진다. 그래서 두 경로를 코드에서 **환경변수로 전환 가능하게** 유지했다.

### 비용 사고 방지

```bash
# 예산 알림 — 임계치 초과 시 메일
gcloud billing budgets create \
  --billing-account=010504-A634F9-0E7A07 \
  --display-name="디몰비전 GPU" \
  --budget-amount=100USD \
  --threshold-rule=percent=50 --threshold-rule=percent=90

# 상한 조정 — max-instances 가 곧 비용 상한이다
gcloud run services update dimolvision-vlm --region "$REGION" --max-instances 2
```

`--min-instances 0` 을 유지하는 한 유휴 비용은 발생하지 않는다. 콜드스타트를 없애려고
`--min-instances 1` 로 바꾸면 **24시간 GPU 과금**이 시작되니, 실제 트래픽이 붙은 뒤에만
검토한다.

## 운영 체크리스트

| 항목 | 명령 |
| --- | --- |
| 동작 확인 | `curl -s "$URL/v1/models"` |
| 로그 | `gcloud run services logs tail dimolvision-vlm --region "$REGION"` |
| 롤백 | `gcloud run services update-traffic dimolvision-vlm --to-revisions=<이전리비전>=100 --region "$REGION"` |
| 중단(과금 정지) | `gcloud run services delete dimolvision-vlm --region "$REGION"` |

## 보안

기본값은 `ALLOW_UNAUTH=true` — 데모·심사 편의를 위한 공개 설정이다. 상용 전환 시에는
엔드포인트를 공개로 두면 안 된다(누구나 내 GPU 를 쓸 수 있다). 두 가지 중 하나를 쓴다.

1. **Cloud Run IAM (권장)** — `ALLOW_UNAUTH=false` 로 배포하고, 디몰비전 API 쪽에서
   서비스 계정 ID 토큰을 받아 `Authorization` 헤더로 보낸다.
2. **공유 토큰** — Cloud Run 앞단에 토큰 검증을 두고 `VLM_API_KEY` 를 맞춘다.
   `SelfHostedVlmAnalyzer` 가 이미 `VLM_API_KEY` 를 `Bearer` 로 실어 보낸다.

## 다음 단계 — 도메인 파인튜닝

엔드포인트가 OpenAI 호환이라, 모델을 바꿔도 `apps/api` 코드는 그대로다.

1. 실제 현장 사진 + 검수된 분석 결과로 데이터셋을 만든다(`packages/shared` 의
   `SiteAnalysis` 스키마가 그대로 라벨 포맷이다).
2. Vertex AI 또는 GPU VM 에서 Qwen2.5-VL 을 LoRA 파인튜닝한다.
3. 결과 어댑터를 병합해 `MODEL_ID` 만 바꿔 재배포한다.

이 단계에서 석면 슬레이트·내화피복 같은 **한국 철거 현장 특유의 소재 식별 정확도**가
범용 모델 대비 올라가고, 그게 경량형이 흉내 낼 수 없는 제품의 해자가 된다.
