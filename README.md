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

## 공공데이터 연동 — 건축물대장

사진만으로는 마감재에 가린 주구조를 단정할 수 없고 연면적도 알 수 없다. 건축물대장이
그 둘을 권위 있게 알려준다. `DATA_GO_KR_SERVICE_KEY` 를 넣으면 요청에 주소 코드
(`sigunguCd`·`bjdongCd`·`bun`·`ji`)를 함께 보낼 때 표제부를 조회해

- **주구조** → 분석 힌트 + 물량 추정 보정계수
- **연면적·층수** → 사용자가 입력하지 않아도 물량 추정
- **사용승인연도** → 석면 판단. 한국은 **2009년 석면 사용 전면 금지**라, 그 이전 건축물이면
  슬레이트·천장텍스·배관 보온재·뿜칠 내화피복을 석면 의심으로 다루도록 지시한다.
- **주용도** → 해당 용도에서 흔한 마감재를 우선 고려

실측 효과(같은 사진, 1985년 건축 힌트 추가): 식별 소재 4종 → 7종, 위험요소 3건 → 6건,
그리고 **천장 텍스를 석면 의심으로 별도 식별**했다(힌트 없을 때는 놓쳤다).

키가 없어도 서비스는 그대로 돈다. 화면에서 건축년도·주구조를 직접 입력해도 같은 효과가 난다.
`/api/health` 의 `publicData.buildingRegister` 로 활성 여부를 확인한다.

### 석면 표현 가드

석면은 사진만으로 판별할 수 없고 석면안전관리법상 해체 전 전문기관 조사가 의무다.
프롬프트로 확정 표현을 금지하고, 응답 파싱 단계에서 한 번 더 거른다
(`softenAsbestosClaims`) — "석면입니다" → "석면 의심", "석면이 없습니다" →
"석면 함유 여부는 조사로 확인해야 합니다".

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
