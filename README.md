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
                  · public-data/            건축물대장(표제부·층별개요)·건물 외곽선
                  · recon/reconstruction    3D 복원 결과 → 평면도 격자·치수 환산
                  · routes/site-analysis    POST /api/site-analysis/{analyze,waste-items}
                                            GET  /api/building-register  (표제부+층별개요)
                                            GET  /api/building-outline   (건물 외곽선)
                                            GET  /api/geo/parcel         (좌표→지번)
                                            POST /api/recon/reconstruct  (영상→3D+평면도)
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

- 타입체크 전 워크스페이스 통과.
- 테스트 219개 통과 — `apps/api` 177, `packages/shared` 37, `apps/app` 5.
- `apps/app`: 웹 번들 export 성공(카메라·방향센서·jpeg-js 포함).

```bash
npm run typecheck && npm run test        # 둘 다 루트에서
npm run build:web -w @dimolvision/app    # 웹 번들이 실제로 나오는지
```

## 새 기기에서 시작하기

```bash
git clone https://github.com/coalfire-create/dimolvision.git
cd dimolvision
nvm use                                  # .nvmrc = Node 20
npm install                              # 워크스페이스 전체
cp apps/api/.env.example apps/api/.env   # 키 채우기(전부 선택 — 없으면 그 기능만 꺼진다)
npm run api:dev                          # http://localhost:8080
curl localhost:8080/api/health           # 어떤 공급자가 붙었는지 확인

# 다른 터미널에서
echo "EXPO_PUBLIC_API_BASE_URL=http://localhost:8080/api" > apps/app/.env
npm run app:start
```

키를 하나도 안 넣어도 목(mock)으로 화면과 배관이 전부 돈다. 무엇이 켜졌는지는
`/api/health` 가 알려 주므로, 기능이 안 보이면 거기부터 본다.

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

### 철거 대상 범위 — 연면적이 아니라 "무엇을 철거하는가"

표제부의 연면적은 **건물 전체**다. "3층만 철거" 인데 연면적으로 물량을 잡으면 3층 건물에서
세 배가 나온다. 그래서 대상 범위를 따로 받는다(우선순위: 범위 지정 > 대장 연면적 > 직접 입력).

- **층별개요**(`getBrFlrOulnInfo`): 주소를 찍으면 층 목록이 뜨고, 고른 층의 **대장 등재 면적**이
  대상 범위가 된다. 등재값이라 사진 눈대중·영상 복원보다 확실하다.
- **방 단위 실측**: 인테리어 부분 철거처럼 층 단위로도 안 맞으면 공간별로 넣는다. 가로·세로를
  몰라도 되게 `/recon.html` 에서 영상으로 재거나, 아는 치수를 직접 넣는다.
- **건물 외곽선**(GIS건물통합정보): 건물 전체 철거면 영상 없이 실제 형상과 건축면적이 나온다.

> 평면도(건축물현황도)는 「건축물대장의 기재 및 관리 등에 관한 규칙」상 **소유자 본인만**
> 열람할 수 있어 서비스가 대신 받아올 수 없다. 본인 소유 건물이면 정부24에서 발급받아
> 도면 치수를 넣는 편이 가장 정확하고, 화면에도 그 경로를 안내한다.

### 3D 복원 평면도의 한계 — 믿을 때만 견적에 쓴다

점군을 바닥면에 투영해 평면 윤곽을 뽑고, 거기서 면적·둘레를 잰다. 바운딩박스가 빈 구역까지
삼키는 L자·ㄷ자 공간에서 특히 정확하다(합성 검증: L자 실제 18㎡ → 바운딩 24㎡ → 평면도 18.4㎡).

다만 복원이 성기면 벽이 끊겨 윤곽이 안으로 말리고 **면적이 작게** 나온다. 같은 24㎡ 방을
복원 품질만 바꿔 재면 점 12,000개 → 26.0㎡(+8%), 2,194개 → 19.9㎡(-17%), 800개 → 8.8㎡(-63%).
과소 견적은 계약 뒤 추가정산 분쟁이 되므로 **신뢰도 GOOD 일 때만 면적을 견적에 넘기고**,
아니면 형상만 보여 주고 재촬영을 안내한다(`FloorPlanGrid.reliability`).

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
