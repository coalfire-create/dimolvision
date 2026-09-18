import { Router } from 'express';
import { siteAnalysisToWasteItems, type SiteAnalysis, type VolumeEstimate } from '@dimol/shared';
import {
  SiteAnalysisValidationError,
  VisionProviderError,
  type AnalyzeSiteInput,
  type SiteAnalyzer,
} from '../site-analysis/analyzer.js';
import type { VolumeEstimator } from '../estimation/provider.js';

/**
 * 현장 사진 AI 분석 API (로드맵 Phase 6).
 *
 * chain 은 우선순위 순서의 분석기 목록이고 마지막 항목이 최종 폴백(목)이다.
 * 앞에서부터 시도해 런타임 실패하면 다음으로 넘어간다 — 화면이 멈추지 않게 하는
 * 올바로 폴백과 같은 원칙이다. 자체 GPU VLM 을 쓸 때 특히 중요한데, GPU 가 잠깐
 * 흔들려도(콜드스타트·쿼터·재배포) 곧바로 목으로 떨어지지 않고 호스팅 API 가 받아
 * 분석 품질을 유지한다. PII/이미지 원본은 로그에 남기지 않는다.
 *
 * estimator 는 사진 기반 자동 채움(waste-items)에서 총 중량 추정에 쓴다(디몰비전 VLM 연동 시 교체).
 */
export interface SiteAnalysisRouterOptions {
  /** 공급자 1곳당 시도 횟수(1 = 재시도 없음). 기본 2 — 일시적 429/503 을 한 번 더 받아준다. */
  attemptsPerAnalyzer?: number;
  /** 재시도 전 대기(ms). 기본 700. */
  retryDelayMs?: number;
}

export function createSiteAnalysisRouter(
  chain: SiteAnalyzer[],
  estimator?: VolumeEstimator,
  options: SiteAnalysisRouterOptions = {},
): Router {
  if (chain.length === 0) throw new Error('분석기 체인이 비어 있습니다.');
  const attempts = Math.max(1, options.attemptsPerAnalyzer ?? 2);
  const retryDelayMs = options.retryDelayMs ?? 700;
  const router = Router();

  function parseInput(body: Record<string, unknown>): AnalyzeSiteInput {
    const images = Array.isArray(body.images)
      ? body.images
          .filter(
            (it): it is { imageBase64: string; mimeType?: unknown } =>
              typeof it === 'object' &&
              it !== null &&
              typeof (it as { imageBase64?: unknown }).imageBase64 === 'string',
          )
          .map((it) => ({
            imageBase64: it.imageBase64,
            mimeType: typeof it.mimeType === 'string' ? it.mimeType : undefined,
          }))
      : undefined;
    return {
      imageBase64: typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined,
      mimeType: typeof body.mimeType === 'string' ? body.mimeType : undefined,
      images: images && images.length > 0 ? images : undefined,
      note: typeof body.note === 'string' ? body.note : undefined,
      buildingStructure: typeof body.buildingStructure === 'string' ? body.buildingStructure : undefined,
    };
  }

  /**
   * 체인을 앞에서부터 시도한다. 입력 자체가 잘못된 경우(검증 오류)는 다음으로 넘겨도
   * 똑같이 실패하므로 즉시 올린다. 마지막 항목까지 실패하면 그 오류를 그대로 던진다.
   */
  async function analyzeWithFallback(input: AnalyzeSiteInput): Promise<SiteAnalysis> {
    let lastError: unknown;
    for (let i = 0; i < chain.length; i += 1) {
      // 같은 공급자를 몇 번 시도한다. 실제 관측된 실패가 429(레이트리밋)·503(과부하) 처럼
      // 잠깐 뒤엔 풀리는 종류라, 곧장 다음으로 넘기기보다 한 번 더 두드리는 편이 낫다.
      // 목(마지막 항목)은 실패하지 않으므로 재시도 대상이 아니다.
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return await chain[i]!.analyze(input);
        } catch (err) {
          if (err instanceof SiteAnalysisValidationError) throw err;
          lastError = err;
          const message = err instanceof Error ? err.message : 'error';
          console.error(
            `[site-analysis] 분석 실패 ${i + 1}/${chain.length} (시도 ${attempt}/${attempts})`,
            message,
          );
          // 레이트리밋이면 같은 공급자를 다시 두드려도 같은 창에서는 풀리지 않는다.
          // 한도만 더 태우고 응답만 느려지므로 즉시 다음 공급자로 넘긴다.
          if (err instanceof VisionProviderError && err.isRateLimited) break;
          if (attempt < attempts) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
      }
    }
    throw lastError;
  }

  // POST /api/site-analysis/analyze  { imageBase64, mimeType?, note? }
  router.post('/site-analysis/analyze', async (req, res) => {
    const input = parseInput((req.body ?? {}) as Record<string, unknown>);
    try {
      res.json(await analyzeWithFallback(input));
    } catch (err) {
      if (err instanceof SiteAnalysisValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: '현장 분석 처리 오류' });
    }
  });

  // POST /api/site-analysis/waste-items
  //   { imageBase64|images, mimeType?, note?, floorAreaM2?, floors?, structure? }
  //  사진 → 소재 식별(SiteAnalyzer) + 면적 기반 물량 추정(VolumeEstimator) →
  //  요청서 소재별 항목(wasteItems)으로 자동 변환.
  //
  //  추정 결과(estimate)를 그대로 함께 돌려준다. 예전에는 총 중량만 뽑아 쓰고
  //  트럭 대수·추정 범위·신뢰도를 버렸는데, 현장에서 견적을 잡을 때 정작 필요한 건
  //  "몇 톤이고 트럭 몇 대냐" 라서 클라이언트가 쓸 수 있게 내보낸다.
  router.post('/site-analysis/waste-items', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input = parseInput(body);
    const floorAreaM2 =
      typeof body.floorAreaM2 === 'number' && body.floorAreaM2 > 0 ? body.floorAreaM2 : undefined;
    const floors =
      typeof body.floors === 'number' && Number.isInteger(body.floors) && body.floors > 0
        ? body.floors
        : undefined;
    const structure =
      body.structure === 'RC' || body.structure === 'BRICK' || body.structure === 'WOOD'
        ? body.structure
        : undefined;
    try {
      const analysis = await analyzeWithFallback(input);
      let totalKg: number | undefined;
      let estimate: VolumeEstimate | undefined;
      if (estimator && floorAreaM2 !== undefined) {
        try {
          estimate = await estimator.estimate({ floorAreaM2, floors, structure });
          totalKg = estimate.estimatedTons * 1000;
        } catch {
          // 면적 입력이 잘못돼도 사진 분석 자체는 성공이므로 소재별 기본값으로 진행한다.
        }
      }
      res.json({
        analysis,
        wasteItems: siteAnalysisToWasteItems(analysis.materials, totalKg),
        ...(estimate ? { estimate } : {}),
      });
    } catch (err) {
      if (err instanceof SiteAnalysisValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: '현장 분석 처리 오류' });
    }
  });

  return router;
}
