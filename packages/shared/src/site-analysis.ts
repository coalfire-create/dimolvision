/**
 * 현장 사진 AI 분석 (로드맵 Phase 6 · AI 고도화).
 * 철거 현장 사진 → ①구성 소재 식별 ②철거 공정(순서·주의) 안내 ③위험 요소 경고.
 * 실제 비전 AI(Claude) 연동 전/키 미설정 시에는 목(mock)이 동작한다 — 항상 참고용.
 *
 * ⚠️ 안전: 철거는 구조 안전·석면 등 위험을 수반한다. 이 결과는 참고용이며
 * 실제 작업은 전문가 현장 실사·구조안전진단·석면조사·관계 법령을 따라야 한다.
 */

import type { WasteItem } from './request.js';
import type { VisionMaterialCode } from './vision-taxonomy.js';

export type AnalysisConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/** 식별 소재 분류. HAZARD 는 석면·중금속 등 위험/특별관리 대상. */
export type MaterialCategory =
  | 'CONCRETE'
  | 'STEEL'
  | 'BRICK'
  | 'WOOD'
  | 'GLASS'
  | 'GYPSUM'
  | 'INSULATION'
  | 'ROOFING'
  | 'TILE'
  | 'HAZARD'
  | 'OTHER';

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  CONCRETE: '콘크리트',
  STEEL: '철골·철근',
  BRICK: '벽돌·조적',
  WOOD: '목재',
  GLASS: '유리',
  GYPSUM: '석고보드',
  INSULATION: '단열재',
  ROOFING: '지붕재',
  TILE: '위생도기·타일',
  HAZARD: '위험·특별관리',
  OTHER: '기타',
};

export interface DetectedMaterial {
  category: MaterialCategory;
  /** 사람이 읽는 소재명 (예: '철근콘크리트 벽체'). */
  name: string;
  confidence: AnalysisConfidence;
  /** 재활용(분리배출) 가능 추정. */
  recyclable: boolean;
  /** 위험/특별관리 대상 여부(석면 의심 등). true 면 UI 강조. */
  hazardous: boolean;
  /** 처리·분리 관련 참고 메모(선택). */
  note?: string;
  /** 사진에서 유추한 해당 소재의 예상 폐기물 무게(kg, 선택). */
  estimatedKg?: number;
}

export interface DemolitionStep {
  /** 1부터 시작하는 공정 순서. */
  order: number;
  title: string;
  description: string;
  /** 안전/주의 사항(선택). */
  caution?: string;
}


/**
 * 건설폐기물 법정 분류 — 처리 단가가 분류마다 다르고, 특히 혼합은 크게 비싸다.
 * 견적의 처리비는 "분류별 톤수 × 분류별 단가" 로 잡히므로 소재명만으로는 계산이 안 된다.
 */
export type ConstructionWasteClass =
  | 'CONCRETE'
  | 'ASPHALT'
  | 'BRICK_BLOCK'
  | 'WOOD'
  | 'PLASTIC'
  | 'METAL'
  | 'GLASS'
  | 'BOARD'
  | 'MIXED'
  | 'DESIGNATED';

export const WASTE_CLASS_LABELS: Record<ConstructionWasteClass, string> = {
  CONCRETE: '폐콘크리트',
  ASPHALT: '폐아스팔트콘크리트',
  BRICK_BLOCK: '폐벽돌·폐블록',
  WOOD: '폐목재',
  PLASTIC: '폐합성수지',
  METAL: '폐금속류',
  GLASS: '폐유리',
  BOARD: '폐보드류(석고보드 등)',
  MIXED: '혼합건설폐기물',
  DESIGNATED: '지정폐기물(석면 등)',
};

/** 분류별 예상 배출량. separable=false 면 혼합으로 빠져 단가가 올라간다. */
export interface WasteClassSummary {
  wasteClass: ConstructionWasteClass;
  estimatedKg: number;
  /** 현장에서 분리 배출이 가능한지(가능하면 단가가 내려간다). */
  separable: boolean;
  note?: string;
}

/** 투입 장비 제안. */
export interface EquipmentPlan {
  /** 장비명 (예: 굴착기). */
  name: string;
  /** 규격·사양 (예: 06W 압쇄기 장착). */
  spec?: string;
  /** 왜 필요한지. */
  reason: string;
}

/**
 * 견적·시공계획 기초자료.
 * 사진만으로 확정할 수 없는 것이 많아, 현장에서 확인해야 할 항목(siteChecklist)을
 * 함께 낸다. "모르는 것을 모른다고 말하는" 것이 견적 실무에서는 더 유용하다.
 */
export interface SiteQuoteBasis {
  /** 법정 분류별 배출량 — 처리비 산정의 입력값. */
  wasteByClass: WasteClassSummary[];
  /** 투입 장비 제안. */
  equipment: EquipmentPlan[];
  /** 예상 공기(일). */
  estimatedWorkDays?: number;
  /** 예상 투입 인원(명/일). */
  estimatedCrewSize?: number;
  /** 사진으로 확인할 수 없어 현장 실사에서 반드시 볼 항목. */
  siteChecklist: string[];
  /** 단가를 좌우하는 요인(접근성·양중·석면 등). */
  costDrivers: string[];
}

/**
 * 사진 한 장에서 잡아낸 특이사항.
 *
 * 왜 사진과 묶어야 하는가: 견적을 받는 사람은 "석면 의심 자재가 있습니다" 라는 문장만
 * 보면 그게 어디를 말하는지 알 수 없다. 현장에 가 본 적이 없기 때문이다. 그 장면을
 * 함께 보여 줘야 "아, 저 천장" 이 된다. 철거업자가 현장 답사 후 사진을 찍어 보내며
 * 설명하는 것과 같은 방식이다.
 */
export interface SiteFinding {
  /** 몇 번째 사진인지(0부터). 화면이 그 사진을 찾아 함께 보여준다. */
  imageIndex: number;
  /** 한 줄 제목 (예: "천장 텍스 — 석면 의심"). */
  title: string;
  /** 무엇이 보이는가. 사진에서 확인되는 사실만. */
  observed: string;
  /** 왜 특이한가 — 견적·공정에 미치는 영향. */
  why: string;
  /** 시공 시 주의사항 — 실제로 무엇을 해야 하는가. */
  caution: string;
  /** 심각도. HIGH 면 화면에서 붉게 강조한다. */
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  /** 이 항목이 비용에 미치는 영향(선택). */
  costImpact?: string;
}

export interface SiteAnalysis {
  /** 한 줄 요약(현장 개요). */
  summary: string;
  materials: DetectedMaterial[];
  /** 권장 철거 공정 순서. */
  demolitionSteps: DemolitionStep[];
  /** 위험 요소 경고(석면·붕괴·전기 등). 비어 있을 수 있음. */
  hazards: string[];
  /** 분석 방법: MOCK(목) | AI_VISION(실제 비전 분석). */
  /** 견적·시공계획 기초자료. AI 가 채우며, 구형 응답에는 없을 수 있다. */
  quoteBasis?: SiteQuoteBasis;
  /**
   * 사진별 특이사항. 어느 사진의 무엇이, 왜 문제이고, 시공 때 무엇을 조심해야 하는지.
   * 견적을 받는 쪽이 현장을 보지 않고도 판단할 수 있게 하는 자료다.
   */
  findings?: SiteFinding[];
  method: 'MOCK' | 'AI_VISION';
  confidence: AnalysisConfidence;
  /** UI 필수 노출 문구 — 참고용/안전 한계 고지. */
  disclaimer: string;
  analyzedAt: string;
}

/** UI·응답에 반드시 함께 노출하는 안전 고지. */
export const SITE_ANALYSIS_DISCLAIMER =
  '사진 기반 참고용 분석입니다. 실제 철거는 구조안전진단·석면조사 등 전문가 현장 실사와 관계 법령을 반드시 따르세요. 위험 소재(석면 등)는 임의로 제거하지 마세요.';

/**
 * 사진 분석 소재(MaterialCategory 10종) → 디몰비전 자재 분류(VisionMaterialCode 12종) 매핑.
 * 사진 기반 자동 채움에서 요청서의 wasteItems 소재 코드로 변환하는 단일 원천이다.
 */
export const SITE_ANALYSIS_TO_VISION_MATERIAL: Record<MaterialCategory, VisionMaterialCode> = {
  CONCRETE: 'REINFORCED_CONCRETE',
  STEEL: 'METAL',
  BRICK: 'BRICK_MASONRY',
  WOOD: 'WOOD',
  GLASS: 'GLASS',
  GYPSUM: 'GYPSUM_BOARD',
  INSULATION: 'WATERPROOF_INSULATION',
  ROOFING: 'ROOFING_SLATE',
  TILE: 'SANITARY_TILE',
  HAZARD: 'MIXED_WASTE',
  OTHER: 'MIXED_WASTE',
};

/**
 * 총 중량 정보가 없을 때 소재별로 채우는 기본 참고 중량(kg).
 * 사진만으로는 중량 확정이 어려우므로 사용자가 조정하도록 유도한다(디몰비전 VLM 연동 시 대체).
 */
export const DEFAULT_PHOTO_MATERIAL_KG = 500;

/**
 * 사진 분석 결과 → 요청서 소재별 항목(wasteItems)으로 변환.
 * - 식별 소재를 VisionMaterialCode 로 매핑하고 중복 코드는 합쳐(균등 분배) 항목화한다.
 * - totalKg(예: VolumeEstimator 추정 톤×1000)가 있으면 소재 수로 균등 분배하고,
 *   없으면 소재별 기본 중량으로 채운다. 어느 경우든 참고값 — 사용자가 최종 조정한다.
 */
export function siteAnalysisToWasteItems(
  materials: readonly DetectedMaterial[],
  totalKg?: number,
): WasteItem[] {
  const map = new Map<VisionMaterialCode, number>();
  for (const m of materials) {
    const code = SITE_ANALYSIS_TO_VISION_MATERIAL[m.category];
    const kg = m.estimatedKg && m.estimatedKg > 0 ? m.estimatedKg : 0;
    map.set(code, (map.get(code) ?? 0) + kg);
  }
  
  if (map.size === 0) return [];
  
  const codes = Array.from(map.keys());

  // totalKg가 있으면 모든 코드로 균등 분배 (기존 호환 유지 - 예: 전체 부피 추정기가 있는 경우)
  if (typeof totalKg === 'number' && totalKg > 0) {
    const per = Math.max(1, Math.round(totalKg / codes.length));
    return codes.map((material) => ({ material, kg: per }));
  }

  // totalKg가 없으면 각 품목별 estimatedKg를 사용하되, 0인 항목은 기본값(500kg) 사용
  return codes.map((material) => {
    const kg = map.get(material) ?? 0;
    return { material, kg: kg > 0 ? kg : DEFAULT_PHOTO_MATERIAL_KG };
  });
}
