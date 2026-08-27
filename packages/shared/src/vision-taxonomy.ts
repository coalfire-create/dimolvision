/**
 * 디몰비전 자재 분류 체계 v1 (기획서 §2.3 · Phase V0 산출물).
 *
 * 파인튜닝 라벨과 분석 리포트 출력 스키마가 공유하는 단일 원천이다
 * (기획서 §10 — 공유 상수는 packages/shared 에 두어 본체와 단일 원천 유지).
 * v1 은 파일럿 범위(건설폐기물·철거 현장)에 맞춰 12종으로 시작하며,
 * 분류 확장은 파일럿 이후 데이터 근거로만 결정한다(임의 확장 금지).
 *
 * ⚠️ 구 Phase-6 설계의 `site-analysis.ts`(MaterialCategory 10종, 외부 API 기반)와는
 * 별개다. 디몰비전(자체 VLM) 리포트는 이 12종 코드를 사용한다.
 */

/** 자재 분류 코드 (12종). 모델 라벨·리포트 materials[].category 와 동일 코드. */
export type VisionMaterialCode =
  | 'REINFORCED_CONCRETE'
  | 'PLAIN_CONCRETE'
  | 'BRICK_MASONRY'
  | 'WOOD'
  | 'METAL'
  | 'GLASS'
  | 'GYPSUM_BOARD'
  | 'ROOFING_SLATE'
  | 'WATERPROOF_INSULATION'
  | 'WASTE_SYNTHETIC_RESIN'
  | 'SANITARY_TILE'
  | 'MIXED_WASTE';

export interface VisionMaterialDef {
  code: VisionMaterialCode;
  /** 리포트·라벨 UI 에 노출하는 한국어 명칭. */
  label: string;
  /**
   * 석면 의심 연동 자재 여부. true 이면 인식 시 hazards[] 에
   * ASBESTOS_SUSPECT 를 연동하고 전문 조사 안내를 강제한다(기획서 §2.3, §7.1).
   * AI 가 석면 유무를 확정하는 표현은 절대 출력하지 않는다.
   */
  asbestosSuspect: boolean;
}

/** 자재 분류 체계 v1 정의(정렬 순서 = 리포트 표기 우선순위). */
export const VISION_MATERIAL_TAXONOMY_V1: readonly VisionMaterialDef[] = [
  { code: 'REINFORCED_CONCRETE', label: '철근콘크리트', asbestosSuspect: false },
  { code: 'PLAIN_CONCRETE', label: '무근콘크리트', asbestosSuspect: false },
  { code: 'BRICK_MASONRY', label: '벽돌/조적', asbestosSuspect: false },
  { code: 'WOOD', label: '목재(구조·창호)', asbestosSuspect: false },
  { code: 'METAL', label: '금속(철골/샤시/배관)', asbestosSuspect: false },
  { code: 'GLASS', label: '유리', asbestosSuspect: false },
  { code: 'GYPSUM_BOARD', label: '석고보드', asbestosSuspect: false },
  { code: 'ROOFING_SLATE', label: '지붕재(슬레이트)', asbestosSuspect: true },
  { code: 'WATERPROOF_INSULATION', label: '방수/단열재', asbestosSuspect: false },
  { code: 'WASTE_SYNTHETIC_RESIN', label: '폐합성수지(장판·창틀 등)', asbestosSuspect: false },
  { code: 'SANITARY_TILE', label: '위생도기/타일', asbestosSuspect: false },
  { code: 'MIXED_WASTE', label: '혼합폐기물', asbestosSuspect: false },
] as const;

/** 코드 → 정의 조회 맵. */
export const VISION_MATERIAL_BY_CODE: Record<VisionMaterialCode, VisionMaterialDef> =
  Object.fromEntries(VISION_MATERIAL_TAXONOMY_V1.map((m) => [m.code, m])) as Record<
    VisionMaterialCode,
    VisionMaterialDef
  >;

/** 모든 자재 코드 목록(모델 프롬프트·검증용). */
export const VISION_MATERIAL_CODES: readonly VisionMaterialCode[] =
  VISION_MATERIAL_TAXONOMY_V1.map((m) => m.code);

export function isVisionMaterialCode(value: string): value is VisionMaterialCode {
  return value in VISION_MATERIAL_BY_CODE;
}

/** 석면 의심 연동 자재인지. ROOFING_SLATE 등. */
export function isAsbestosSuspectMaterial(code: VisionMaterialCode): boolean {
  return VISION_MATERIAL_BY_CODE[code].asbestosSuspect;
}

/** 코드 → 한국어 라벨. 미정의 코드는 코드 문자열 그대로 반환. */
export function visionMaterialLabel(code: VisionMaterialCode): string {
  return VISION_MATERIAL_BY_CODE[code]?.label ?? code;
}
