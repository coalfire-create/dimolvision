import 'dotenv/config';

/**
 * 디몰비전 API 환경설정(경량형). 모든 비밀키는 .env 전용, 코드/로그에 남기지 않는다.
 * 비전 공급자 우선순위: 자체 GPU VLM(Cloud Run) > Groq(무료·카드불필요) > Gemini(무료티어) >
 * Claude(유료) > 목(mock). 아무 것도 없으면 목 분석으로 폴백해 키 없이도 UI/배관이 돈다.
 * 자체 VLM 을 최우선에 둔 이유: 호출당 외부 과금이 없어 상용 단가를 고정할 수 있고,
 * 현장 사진이 외부 사업자로 나가지 않는다(데이터 주권).
 */
export const env = {
  port: Number(process.env.PORT ?? 8080),
  /** CORS 허용 오리진(쉼표 구분). 미설정 시 전체 허용(데모 편의). */
  corsOrigins: (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  ai: {
    /** 자체 호스팅 VLM(vLLM on Cloud Run GPU)의 OpenAI 호환 엔드포인트. 예: https://.../v1 */
    vlmBaseUrl: process.env.VLM_BASE_URL,
    /** infra/gcp/deploy-vlm.sh 가 띄우는 served-model-name 과 반드시 같아야 한다(다르면 404). */
    vlmModel: process.env.VLM_MODEL ?? 'Qwen/Qwen2.5-VL-7B-Instruct-AWQ',
    /** Cloud Run 을 비공개로 둘 때 쓰는 공유 토큰(선택). */
    vlmApiKey: process.env.VLM_API_KEY,
    /**
     * 자체 VLM 을 체인의 어디에 둘지.
     * - 'primary'  : 맨 앞(호출당 외부 과금 0·데이터 주권). 모델 품질이 호스팅과 대등할 때.
     * - 'fallback' : 호스팅 공급자 뒤, 목 앞. 호스팅이 레이트리밋에 걸릴 때만 받는다.
     *   무료 티어가 막혀도 목(사진과 무관한 고정 응답)으로 떨어지지 않게 하는 안전망.
     */
    vlmPriority: process.env.VLM_PRIORITY === 'fallback' ? 'fallback' : 'primary',
    /** 자체 VLM 은 호스팅 API 보다 느리다(7B 실측 24초). 전용 타임아웃을 둔다. */
    vlmTimeoutMs: Number(process.env.VLM_TIMEOUT_MS ?? 120_000),
    groqApiKey: process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL ?? 'qwen/qwen3.8-27b',
    /**
     * Gemini 키 목록(쉼표 구분). 무료 티어 한도는 **프로젝트마다 따로** 걸리므로,
     * 서로 다른 프로젝트의 키를 여러 개 넣으면 그만큼 처리량이 늘어난다.
     * 하나가 429 면 체인이 다음 키로 넘어간다. GEMINI_API_KEY(단수)도 계속 받는다.
     */
    geminiApiKeys: (process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    visionTimeoutMs: Number(process.env.VISION_TIMEOUT_MS ?? 30_000),
  },
  /**
   * 카카오 로컬 API — 지도에서 찍은 좌표를 지번(법정동코드·본번·부번)으로 옮긴다.
   * 건축물대장이 주소 문자열을 받지 않아 이 변환이 필요하다.
   * 발급: https://developers.kakao.com → 앱 생성 → REST API 키
   */
  kakao: {
    restApiKey: process.env.KAKAO_REST_API_KEY,
    timeoutMs: Number(process.env.KAKAO_TIMEOUT_MS ?? 5_000),
  },
  /**
   * 3D 복원 서비스(Cloud Run GPU 위의 COLMAP). 없으면 복원 기능이 꺼진다.
   * COLMAP 은 수 분이 걸리므로 비전 분석과 타임아웃을 공유하지 않는다.
   */
  recon: {
    baseUrl: process.env.RECON_BASE_URL,
    timeoutMs: Number(process.env.RECON_TIMEOUT_MS ?? 600_000),
    apiKey: process.env.RECON_API_KEY,
  },
  /**
   * 공공데이터포털 인증키(건축물대장). 없으면 공공데이터 보강 없이 사진만으로 분석한다.
   * 발급: https://www.data.go.kr → '건축물대장정보 서비스' 활용신청 → 일반 인증키(Decoding)
   */
  publicData: {
    serviceKey: process.env.DATA_GO_KR_SERVICE_KEY,
    timeoutMs: Number(process.env.PUBLIC_DATA_TIMEOUT_MS ?? 5_000),
  },
  /**
   * GIS건물통합정보(WFS) — 건물 외곽선. 평면 형상을 공공데이터로 얻는 유일한 경로다
   * (건축물대장 평면도는 소유자 동의가 있어야 열람된다). 인증키는 publicData 것을 함께 쓴다.
   *
   * 엔드포인트·레이어명을 환경변수로 둔 이유: 이 서비스는 건축HUB 등으로 이관되며 주소와
   * typename 이 바뀌어 왔다. 바뀔 때 배포만으로 고칠 수 있어야 한다.
   * 발급: https://www.data.go.kr → 'GIS건물통합정보(WMS/WFS)' 활용신청
   */
  buildingOutline: {
    baseUrl: process.env.BUILDING_OUTLINE_WFS_URL,
    typeName: process.env.BUILDING_OUTLINE_TYPENAME,
  },
} as const;

/** 선택된 비전 공급자 이름(로그·헬스체크용, 키 값은 노출하지 않는다). */
export function activeVisionProvider(): 'self-hosted-vlm' | 'groq' | 'gemini' | 'claude' | 'mock' {
  if (env.ai.vlmBaseUrl && env.ai.vlmPriority === 'primary') return 'self-hosted-vlm';
  if (env.ai.groqApiKey) return 'groq';
  if (env.ai.geminiApiKeys.length > 0) return 'gemini';
  if (env.ai.anthropicApiKey) return 'claude';
  if (env.ai.vlmBaseUrl) return 'self-hosted-vlm';
  return 'mock';
}
