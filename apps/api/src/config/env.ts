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
    vlmModel: process.env.VLM_MODEL ?? 'Qwen/Qwen2.5-VL-7B-Instruct',
    /** Cloud Run 을 비공개로 둘 때 쓰는 공유 토큰(선택). */
    vlmApiKey: process.env.VLM_API_KEY,
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
   * 공공데이터포털 인증키(건축물대장). 없으면 공공데이터 보강 없이 사진만으로 분석한다.
   * 발급: https://www.data.go.kr → '건축물대장정보 서비스' 활용신청 → 일반 인증키(Decoding)
   */
  publicData: {
    serviceKey: process.env.DATA_GO_KR_SERVICE_KEY,
    timeoutMs: Number(process.env.PUBLIC_DATA_TIMEOUT_MS ?? 5_000),
  },
} as const;

/** 선택된 비전 공급자 이름(로그·헬스체크용, 키 값은 노출하지 않는다). */
export function activeVisionProvider(): 'self-hosted-vlm' | 'groq' | 'gemini' | 'claude' | 'mock' {
  if (env.ai.vlmBaseUrl) return 'self-hosted-vlm';
  if (env.ai.groqApiKey) return 'groq';
  if (env.ai.geminiApiKeys.length > 0) return 'gemini';
  if (env.ai.anthropicApiKey) return 'claude';
  return 'mock';
}
