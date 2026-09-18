import { siteAnalysisToWasteItems, type DetectedMaterial } from '@dimol/shared';
import { describe, expect, it } from 'vitest';
import express from 'express';
import { MockSiteAnalyzer } from './analyzer.js';
import { HeuristicVolumeEstimator } from '../estimation/provider.js';
import { createSiteAnalysisRouter } from '../routes/site-analysis.js';

function material(category: DetectedMaterial['category']): DetectedMaterial {
  return { category, name: category, confidence: 'MEDIUM', recyclable: true, hazardous: false };
}

describe('siteAnalysisToWasteItems — 사진 소재 → 요청 항목', () => {
  it('식별 소재를 VisionMaterialCode 로 매핑하고 중복은 합친다 (estimatedKg 합산)', () => {
    const items = siteAnalysisToWasteItems([
      { ...material('CONCRETE'), estimatedKg: 1000 },
      { ...material('STEEL'), estimatedKg: 500 },
      { ...material('CONCRETE'), estimatedKg: 2000 }, // 중복 → 합산 (3000)
    ]);
    expect(items).toHaveLength(2); // 콘크리트 중복 제거
    
    const concrete = items.find(i => i.material === 'REINFORCED_CONCRETE');
    const steel = items.find(i => i.material === 'METAL');
    expect(concrete?.kg).toBe(3000);
    expect(steel?.kg).toBe(500);
  });

  it('총 중량(kg)이 있으면 소재 수로 균등 분배한다', () => {
    const items = siteAnalysisToWasteItems([material('CONCRETE'), material('WOOD')], 6000);
    expect(items).toHaveLength(2);
    expect(items[0].kg).toBe(3000);
    expect(items[1].kg).toBe(3000);
  });

  it('총 중량이 없으면 각 소재의 estimatedKg를 사용하고 없으면 기본값으로 채운다', () => {
    const items = siteAnalysisToWasteItems([
      { ...material('BRICK'), estimatedKg: 1200 },
      { ...material('WOOD') } // estimatedKg 없음
    ]);
    expect(items).toHaveLength(2);
    const brick = items.find(i => i.material === 'BRICK_MASONRY');
    const wood = items.find(i => i.material === 'WOOD');
    expect(brick?.kg).toBe(1200);
    expect(wood?.kg).toBe(500); // DEFAULT_PHOTO_MATERIAL_KG
  });

  it('타일(TILE) 카테고리가 SANITARY_TILE 코드로 정상 매핑된다', () => {
    const items = siteAnalysisToWasteItems([
      { ...material('TILE'), estimatedKg: 400 }
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].material).toBe('SANITARY_TILE');
    expect(items[0].kg).toBe(400);
  });

  it('식별 소재가 없으면 빈 배열', () => {
    expect(siteAnalysisToWasteItems([])).toEqual([]);
  });
});

describe('waste-items 면적 추정 연동', () => {
  const IMG = 'A'.repeat(200);

  async function post(body: unknown) {
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use(
      '/api',
      createSiteAnalysisRouter([new MockSiteAnalyzer()], new HeuristicVolumeEstimator()),
    );
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/site-analysis/waste-items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()) as Record<string, any>;
    } finally {
      server.close();
    }
  }

  it('면적을 주면 추정 결과(트럭 대수 포함)를 함께 돌려준다', async () => {
    const r = await post({ imageBase64: IMG, floorAreaM2: 200 });
    expect(r.estimate).toBeDefined();
    expect(r.estimate.estimatedTons).toBeGreaterThan(0);
    expect(r.estimate.rangeMinTons).toBeLessThan(r.estimate.estimatedTons);
    expect(r.estimate.rangeMaxTons).toBeGreaterThan(r.estimate.estimatedTons);
    expect(r.estimate.truckLoads.length).toBeGreaterThan(0);
    expect(r.estimate.truckLoads[0].count).toBeGreaterThan(0);
  });

  it('구조를 주면 보정이 들어가 신뢰도가 올라간다', async () => {
    const plain = await post({ imageBase64: IMG, floorAreaM2: 200 });
    const withStructure = await post({ imageBase64: IMG, floorAreaM2: 200, structure: 'WOOD' });
    expect(plain.estimate.confidence).toBe('LOW');
    expect(withStructure.estimate.confidence).toBe('MEDIUM');
    expect(withStructure.estimate.estimatedTons).not.toBe(plain.estimate.estimatedTons);
  });

  it('층수를 주면 연면적으로 환산한다', async () => {
    const r = await post({ imageBase64: IMG, floorAreaM2: 100, floors: 3 });
    expect(r.estimate.floorAreaM2).toBe(300);
  });

  it('면적이 없으면 estimate 없이 소재 분석만 돌려준다', async () => {
    const r = await post({ imageBase64: IMG });
    expect(r.estimate).toBeUndefined();
    expect(r.wasteItems.length).toBeGreaterThan(0);
  });

  it('잘못된 면적이어도 사진 분석은 성공한다', async () => {
    const r = await post({ imageBase64: IMG, floorAreaM2: 999999999 });
    expect(r.analysis.materials.length).toBeGreaterThan(0);
    expect(r.estimate).toBeUndefined();
  });
});
