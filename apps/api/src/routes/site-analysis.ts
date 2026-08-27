import { Router } from 'express';
import { siteAnalysisToWasteItems, type SiteAnalysis } from '@dimol/shared';
import {
  SiteAnalysisValidationError,
  type AnalyzeSiteInput,
  type SiteAnalyzer,
} from '../site-analysis/analyzer.js';
import type { VolumeEstimator } from '../estimation/provider.js';

/**
 * 현장 사진 AI 분석 API (로드맵 Phase 6).
 * primary(실제 Claude 또는 목) 로 분석하고, 실제 분석이 런타임 실패하면 목으로 폴백한다
 * (올바로 폴백과 같은 원칙 — 화면이 멈추지 않게). PII/이미지 원본은 로그에 남기지 않는다.
 *
 * estimator 는 사진 기반 자동 채움(waste-items)에서 총 중량 추정에 쓴다(디몰비전 VLM 연동 시 교체).
 */
export function createSiteAnalysisRouter(
  primary: SiteAnalyzer,
  fallback: SiteAnalyzer,
  estimator?: VolumeEstimator,
): Router {
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

  /** 실제 분석 실패 → 목으로 폴백(방법=MOCK 이라 사용자에게 구분됨). */
  async function analyzeWithFallback(input: AnalyzeSiteInput): Promise<SiteAnalysis> {
    try {
      return await primary.analyze(input);
    } catch (err) {
      if (err instanceof SiteAnalysisValidationError) throw err;
      console.error('[site-analysis] 분석 폴백', err instanceof Error ? err.message : 'error');
      return fallback.analyze(input);
    }
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

  // POST /api/site-analysis/waste-items  { imageBase64, mimeType?, note?, floorAreaM2? }
  //  사진 → 소재 식별(SiteAnalyzer) + 총 중량 추정(VolumeEstimator, floorAreaM2 있을 때) →
  //  요청서 소재별 항목(wasteItems)으로 자동 변환. 소비자 직접 운반요청 등에서 프리필에 쓴다.
  router.post('/site-analysis/waste-items', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input = parseInput(body);
    const floorAreaM2 =
      typeof body.floorAreaM2 === 'number' && body.floorAreaM2 > 0 ? body.floorAreaM2 : undefined;
    try {
      const analysis = await analyzeWithFallback(input);
      let totalKg: number | undefined;
      if (estimator && floorAreaM2 !== undefined) {
        try {
          const estimate = await estimator.estimate({ floorAreaM2 });
          totalKg = estimate.estimatedTons * 1000;
        } catch {
          // 중량 추정 실패해도 소재별 기본값으로 진행(사진 분석 자체는 성공).
        }
      }
      res.json({ analysis, wasteItems: siteAnalysisToWasteItems(analysis.materials, totalKg) });
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
