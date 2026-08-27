import { siteAnalysisToWasteItems, type DetectedMaterial } from '@dimol/shared';
import { describe, expect, it } from 'vitest';

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
