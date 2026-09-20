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
import {
  BuildingRegisterClient,
  type RegisterCacheStore,
} from './public-data/building-register.js';
import {
  createAnalysisCache,
  createRegisterCache,
  type AnalysisCacheStore,
} from './cache/analysis-cache.js';
import { ReconstructionChain, ReconstructionClient } from './recon/reconstruction.js';
import { ParcelLookupClient } from './geo/parcel.js';

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

  const selfHosted = env.ai.vlmBaseUrl
    ? new SelfHostedVlmAnalyzer({
        baseUrl: env.ai.vlmBaseUrl,
        model: env.ai.vlmModel,
        apiKey: env.ai.vlmApiKey,
        timeoutMs: env.ai.vlmTimeoutMs,
      })
    : undefined;

  if (selfHosted && env.ai.vlmPriority === 'primary') chain.push(selfHosted);
  if (env.ai.groqApiKey) {
    chain.push(
      new GroqSiteAnalyzer({
        apiKey: env.ai.groqApiKey,
        model: env.ai.groqModel,
        timeoutMs: visionTimeoutMs,
      }),
    );
  }
  // 키 하나당 분석기 하나. 무료 티어 한도가 프로젝트 단위라 키를 늘리면 처리량이 늘어난다.
  for (const apiKey of env.ai.geminiApiKeys) {
    chain.push(
      new GeminiSiteAnalyzer({ apiKey, model: env.ai.geminiModel, timeoutMs: visionTimeoutMs }),
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
  // 백업 자리: 호스팅이 전부 막혔을 때 받는다. 목보다는 언제나 낫다 —
  // 목은 사진과 무관한 고정 응답이지만, 자체 VLM 은 실제로 그 사진을 본다.
  if (selfHosted && env.ai.vlmPriority === 'fallback') chain.push(selfHosted);

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
    res.json({
      ok: true,
      provider: activeVisionProvider(),
      publicData: { buildingRegister: Boolean(env.publicData.serviceKey) },
      recon: Boolean(env.recon.baseUrl),
      mapPicker: Boolean(env.kakao.restApiKey),
    });
  });

  // 공공데이터 키가 있을 때만 건축물대장 보강을 켠다(없으면 사진만으로 분석).
  //
  // 대장 조회는 **반드시 성공해야 하는** 경로다. 연면적이 없으면 물량도 견적도 못 낸다.
  // 그래서 재시도(3회)와 캐시를 함께 건다. 한 번 성공한 지번은 외부 호출 없이 응답한다.
  let registerCachePromise: Promise<RegisterCacheStore> | undefined;
  const registerCache: RegisterCacheStore = {
    async get(key) {
      registerCachePromise ??= createRegisterCache();
      return (await registerCachePromise).get(key);
    },
    async set(key, value, ttl) {
      registerCachePromise ??= createRegisterCache();
      return (await registerCachePromise).set(key, value, ttl);
    },
  };
  const registry = env.publicData.serviceKey
    ? new BuildingRegisterClient({
        serviceKey: env.publicData.serviceKey,
        timeoutMs: env.publicData.timeoutMs,
        cache: registerCache,
      })
    : undefined;

  // 같은 사진·같은 조건이면 계산을 재사용한다. 샘플 체험처럼 동일 입력에 몰릴 때
  // 응답이 즉시가 되고 외부 API 호출이 사라져 무료 티어 한도에 걸리지 않는다.
  //
  // 캐시 생성은 비동기(Vercel 런타임 모듈 동적 로드)라 첫 요청 때 한 번만 만든다.
  // createApp 을 async 로 바꾸면 서버리스 진입점이 Promise 를 내보내게 돼 깨진다.
  let cachePromise: Promise<AnalysisCacheStore> | undefined;
  const cache: AnalysisCacheStore = {
    async get(key) {
      cachePromise ??= createAnalysisCache();
      return (await cachePromise).get(key);
    },
    async set(key, value, ttl) {
      cachePromise ??= createAnalysisCache();
      return (await cachePromise).set(key, value, ttl);
    },
  };

  // 3D 복원은 GPU 서비스가 설정됐을 때만 켠다(없으면 엔드포인트가 503 을 낸다).
  // VGGT 를 먼저, COLMAP 을 폴백으로. 둘 다 없으면 복원 엔드포인트가 503 을 낸다.
  const reconProviders: ReconstructionClient[] = [];
  if (env.recon.vggtBaseUrl) {
    reconProviders.push(
      new ReconstructionClient({
        baseUrl: env.recon.vggtBaseUrl,
        timeoutMs: env.recon.vggtTimeoutMs,
        ...(env.recon.apiKey ? { apiKey: env.recon.apiKey } : {}),
      }),
    );
  }
  if (env.recon.baseUrl) {
    reconProviders.push(
      new ReconstructionClient({
        baseUrl: env.recon.baseUrl,
        timeoutMs: env.recon.timeoutMs,
        ...(env.recon.apiKey ? { apiKey: env.recon.apiKey } : {}),
      }),
    );
  }
  const recon = reconProviders.length > 0 ? new ReconstructionChain(reconProviders) : undefined;

  // 지도에서 찍은 좌표를 지번으로 옮기는 변환(키가 있을 때만).
  const parcel = env.kakao.restApiKey
    ? new ParcelLookupClient({
        restApiKey: env.kakao.restApiKey,
        timeoutMs: env.kakao.timeoutMs,
      })
    : undefined;

  app.use(
    '/api',
    createSiteAnalysisRouter(
      chain,
      new HeuristicVolumeEstimator(),
      { cache, recon, parcel },
      registry,
    ),
  );

  return app;
}
