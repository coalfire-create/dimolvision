# 디몰비전 (DimolVision) — 경량형

철거 현장 사진 한 장으로 **소재 식별 · 철거 공정 안내 · 위험요소 경고 · 폐기물 물량 추정**을
해주는 AI. 디몰링크(철거 매칭 플랫폼)에서 **현장 분석 기능만 분리**한 독립 제품이다.

> 경량형 = 호스팅 VLM(Groq/Gemini/Claude) 직접 호출. 키만 넣으면 실제 분석 결과가 바로 나온다.
> 자체 GPU 로 돌리는 **본격형**도 같은 코드에서 환경변수 하나로 전환된다 — `infra/gcp/README.md`.

**서비스 URL: https://dimolvision.vercel.app** (회원가입·로그인 없이 바로 이용)
공모전 제출 정보는 `SUBMISSION.md` 참고.

## 구조 (npm workspaces)

```
packages/shared   공통 타입·상수·순수 로직(@dimol/shared) — 디몰링크와 동일 소스
apps/api          Express 분석 API (무상태, DB·인증 없음)
                  · site-analysis/analyzer  Groq/Gemini/Claude/Mock 비전 어댑터
                  · estimation/provider     면적 기반 물량 추정(휴리스틱)
                  · routes/site-analysis    POST /api/site-analysis/{analyze,waste-items}
apps/app          Expo(React Native + web) 단일 화면 앱
                  · 현장 AI 분석 화면 + 가이드 촬영(순서·방향 강제 + 품질검증)
                  · public/  무로그인 체험용 샘플 사진 + 개인정보처리방침·이용약관
services/vlm      자체 VLM 추론 서버 이미지(vLLM, Cloud Run GPU 용)
infra/gcp         GPU 상용화 배포 스크립트·가이드(Google Cloud)
```

## 빠른 시작

### 1) API
```bash
cp apps/api/.env.example apps/api/.env   # 비전 키 입력(없으면 mock 동작)
npm install
npm run api:dev                          # http://localhost:8080
curl localhost:8080/api/health           # {"ok":true,"provider":"groq|gemini|claude|mock"}
```

비전 공급자 우선순위: **자체 GPU VLM > Groq(무료·카드불필요) > Gemini(무료티어) >
Claude(유료) > mock**. 아무 것도 없으면 결정적 샘플(mock)로 UI/배관이 그대로 돈다.
`/api/health` 가 현재 쓰는 공급자를 알려준다.

### 2) 앱
```bash
# API 주소 지정(로컬 기본값 http://localhost:8080/api)
echo "EXPO_PUBLIC_API_BASE_URL=http://localhost:8080/api" > apps/app/.env
npm run app:start        # Expo Dev — 웹/iOS/Android
# 또는 웹 정적 export
npm run build:web -w @dimolvision/app
```

## 검증 상태
- `apps/api`: 타입체크 통과, 유닛테스트 31개 통과, health/analyze/waste-items 스모크 OK.
- `apps/app`: 타입체크 통과, 웹 번들 export 성공(카메라·방향센서·jpeg-js 포함).

## 배포 메모
- **웹**: 프로덕션 빌드는 동일 오리진 `/api` 를 호출한다. API 호스트에서 정적 웹을 함께
  서빙하거나(예: Express static), Vercel/Netlify 에서 `/api/*` → API 호스트로 rewrite 한다.
- **API**: `PORT`, `CORS_ORIGINS`, 비전 키만 있으면 어디든(Railway/Fly/Render) 배포 가능.
- **네이티브(Android/iOS)**: `EXPO_PUBLIC_API_BASE_URL` 를 배포된 API 로 지정해 EAS 빌드.
  방향 게이트(DeviceMotion)는 네이티브 모듈이라 실기기/네이티브 빌드에서 동작한다.

## GPU 상용화(본격형)

`VLM_BASE_URL` 하나만 설정하면 호스팅 API 대신 **자체 GPU 추론 서버**를 쓴다.
Google Cloud Run GPU(NVIDIA L4) 위의 vLLM 을 호출하며, 호출당 외부 과금이 사라지고
현장 사진이 외부 사업자로 나가지 않는다.

```bash
PROJECT_ID=<프로젝트ID> ./infra/gcp/deploy-vlm.sh
```

결제 계정 활성화·GPU 쿼터 신청이 선행돼야 한다. 비용 구조와 손익분기 판단법은
`infra/gcp/README.md` 에 정리했다.

## 디몰링크와의 관계
`packages/shared` 는 디몰링크 모노레포와 동일한 소스를 복사한 것이다(vision 타입/상수의
단일 원천은 여전히 TS shared). 분석 계약(SiteAnalysis)이 바뀌면 양쪽을 함께 갱신한다.
