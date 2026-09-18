import express from 'express';
import cors from 'cors';
import {
  ClaudeSiteAnalyzer,
  GeminiSiteAnalyzer,
  GroqSiteAnalyzer,
  MockSiteAnalyzer,
  SelfHostedVlmAnalyzer,
  type SiteAnalyzer,
} from './site-analysis/analyzer.js';
import { HeuristicVolumeEstimator } from './estimation/provider.js';
import { createSiteAnalysisRouter } from './routes/site-analysis.js';
import { env, activeVisionProvider } from './config/env.js';

/**
 * 디몰비전 API(경량형) — 현장 사진 → 소재/공정/위험 분석 + 물량 추정.
 * 무상태. DB·인증 없음. 비전 공급자는 env 키로 선택하고, 실패 시 목으로 폴백한다.
 */
/**
 * 설정된 키에 따라 비전 공급자를 고른다(env.activeVisionProvider 와 같은 우선순위).
 * 자체 GPU VLM 이 최우선 — 상용 운영에서 호출당 외부 과금 없이 단가를 고정하기 위함.
 */
function selectAnalyzer(fallback: SiteAnalyzer): SiteAnalyzer {
  const { visionTimeoutMs } = env.ai;
  if (env.ai.vlmBaseUrl) {
    return new SelfHostedVlmAnalyzer({
      baseUrl: env.ai.vlmBaseUrl,
      model: env.ai.vlmModel,
      apiKey: env.ai.vlmApiKey,
      timeoutMs: visionTimeoutMs,
    });
  }
  if (env.ai.groqApiKey) {
    return new GroqSiteAnalyzer({
      apiKey: env.ai.groqApiKey,
      model: env.ai.groqModel,
      timeoutMs: visionTimeoutMs,
    });
  }
  if (env.ai.geminiApiKey) {
    return new GeminiSiteAnalyzer({
      apiKey: env.ai.geminiApiKey,
      model: env.ai.geminiModel,
      timeoutMs: visionTimeoutMs,
    });
  }
  if (env.ai.anthropicApiKey) {
    return new ClaudeSiteAnalyzer({
      apiKey: env.ai.anthropicApiKey,
      model: env.ai.anthropicModel,
      timeoutMs: visionTimeoutMs,
    });
  }
  return fallback;
}

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.corsOrigins.includes('*') ? true : env.corsOrigins }));
  // 현장 사진은 base64 로 들어온다 — 넉넉한 본문 한도.
  app.use(express.json({ limit: '15mb' }));

  const mock = new MockSiteAnalyzer();
  const primary = selectAnalyzer(mock);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, provider: activeVisionProvider() });
  });

  // [임시 진단] 이 계정이 실제로 쓸 수 있는 Groq 모델 목록. 모델 404 원인 확인용 — 확인 후 제거한다.
  app.get('/api/_diag/models', async (_req, res) => {
    if (!env.ai.groqApiKey) {
      res.json({ error: 'no groq key' });
      return;
    }
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { authorization: `Bearer ${env.ai.groqApiKey}` },
      });
      const body = (await r.json()) as { data?: Array<{ id?: string }> };
      res.json({
        status: r.status,
        configured: env.ai.groqModel,
        models: (body.data ?? []).map((m) => m.id).sort(),
      });
    } catch (err) {
      res.json({ error: err instanceof Error ? err.message : 'failed' });
    }
  });

  app.use('/api', createSiteAnalysisRouter(primary, mock, new HeuristicVolumeEstimator()));

  return app;
}
