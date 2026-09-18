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
 * 설정된 키로 분석기 체인을 우선순위 순서대로 만든다(env.activeVisionProvider 와 같은 순서).
 *
 * 하나만 고르지 않고 **설정된 것을 전부** 순서대로 쌓는 이유는, 앞선 공급자가 런타임에
 * 실패해도 뒤가 받아주기 때문이다. 자체 GPU VLM 을 최우선에 두되(호출당 외부 과금 없음·
 * 데이터 주권), GPU 가 콜드스타트나 쿼터로 흔들리는 순간 호스팅 API 가 대신 처리해
 * 목(MOCK)으로 떨어지는 걸 막는다. 목은 항상 체인의 마지막이다.
 */
function buildAnalyzerChain(mock: SiteAnalyzer): SiteAnalyzer[] {
  const { visionTimeoutMs } = env.ai;
  const chain: SiteAnalyzer[] = [];
  if (env.ai.vlmBaseUrl) {
    chain.push(
      new SelfHostedVlmAnalyzer({
        baseUrl: env.ai.vlmBaseUrl,
        model: env.ai.vlmModel,
        apiKey: env.ai.vlmApiKey,
        timeoutMs: visionTimeoutMs,
      }),
    );
  }
  if (env.ai.groqApiKey) {
    chain.push(
      new GroqSiteAnalyzer({
        apiKey: env.ai.groqApiKey,
        model: env.ai.groqModel,
        timeoutMs: visionTimeoutMs,
      }),
    );
  }
  if (env.ai.geminiApiKey) {
    chain.push(
      new GeminiSiteAnalyzer({
        apiKey: env.ai.geminiApiKey,
        model: env.ai.geminiModel,
        timeoutMs: visionTimeoutMs,
      }),
    );
  }
  if (env.ai.anthropicApiKey) {
    chain.push(
      new ClaudeSiteAnalyzer({
        apiKey: env.ai.anthropicApiKey,
        model: env.ai.anthropicModel,
        timeoutMs: visionTimeoutMs,
      }),
    );
  }
  chain.push(mock);
  return chain;
}

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.corsOrigins.includes('*') ? true : env.corsOrigins }));
  // 현장 사진은 base64 로 들어온다 — 넉넉한 본문 한도.
  app.use(express.json({ limit: '15mb' }));

  const mock = new MockSiteAnalyzer();
  const chain = buildAnalyzerChain(mock);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, provider: activeVisionProvider() });
  });

  app.use('/api', createSiteAnalysisRouter(chain, new HeuristicVolumeEstimator()));

  return app;
}
