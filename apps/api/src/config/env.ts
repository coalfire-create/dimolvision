import 'dotenv/config';

/**
 * 디몰비전 API 환경설정(경량형). 모든 비밀키는 .env 전용, 코드/로그에 남기지 않는다.
 * 비전 공급자 우선순위: Groq(무료·카드불필요) > Gemini(무료티어) > Claude(유료) > 목(mock).
 * 아무 키도 없으면 목 분석으로 폴백해 키 없이도 UI/배관이 돈다.
 */
export const env = {
  port: Number(process.env.PORT ?? 8080),
  /** CORS 허용 오리진(쉼표 구분). 미설정 시 전체 허용(데모 편의). */
  corsOrigins: (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  ai: {
    groqApiKey: process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL ?? 'qwen/qwen3.6-27b',
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    visionTimeoutMs: Number(process.env.VISION_TIMEOUT_MS ?? 30_000),
  },
} as const;

/** 선택된 비전 공급자 이름(로그·헬스체크용, 키 값은 노출하지 않는다). */
export function activeVisionProvider(): 'groq' | 'gemini' | 'claude' | 'mock' {
  if (env.ai.groqApiKey) return 'groq';
  if (env.ai.geminiApiKey) return 'gemini';
  if (env.ai.anthropicApiKey) return 'claude';
  return 'mock';
}
