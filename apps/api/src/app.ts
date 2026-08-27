import express from 'express';
import cors from 'cors';
import {
  ClaudeSiteAnalyzer,
  GeminiSiteAnalyzer,
  GroqSiteAnalyzer,
  MockSiteAnalyzer,
  type SiteAnalyzer,
} from './site-analysis/analyzer.js';
import { HeuristicVolumeEstimator } from './estimation/provider.js';
import { createSiteAnalysisRouter } from './routes/site-analysis.js';
import { env, activeVisionProvider } from './config/env.js';

/**
 * 디몰비전 API(경량형) — 현장 사진 → 소재/공정/위험 분석 + 물량 추정.
 * 무상태. DB·인증 없음. 비전 공급자는 env 키로 선택하고, 실패 시 목으로 폴백한다.
 */
export function createApp() {
  const app = express();
  app.use(cors({ origin: env.corsOrigins.includes('*') ? true : env.corsOrigins }));
  // 현장 사진은 base64 로 들어온다 — 넉넉한 본문 한도.
  app.use(express.json({ limit: '15mb' }));

  const mock = new MockSiteAnalyzer();
  const primary: SiteAnalyzer = env.ai.groqApiKey
    ? new GroqSiteAnalyzer({
        apiKey: env.ai.groqApiKey,
        model: env.ai.groqModel,
        timeoutMs: env.ai.visionTimeoutMs,
      })
    : env.ai.geminiApiKey
      ? new GeminiSiteAnalyzer({
          apiKey: env.ai.geminiApiKey,
          model: env.ai.geminiModel,
          timeoutMs: env.ai.visionTimeoutMs,
        })
      : env.ai.anthropicApiKey
        ? new ClaudeSiteAnalyzer({
            apiKey: env.ai.anthropicApiKey,
            model: env.ai.anthropicModel,
            timeoutMs: env.ai.visionTimeoutMs,
          })
        : mock;

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, provider: activeVisionProvider() });
  });

  app.use('/api', createSiteAnalysisRouter(primary, mock, new HeuristicVolumeEstimator()));

  return app;
}
