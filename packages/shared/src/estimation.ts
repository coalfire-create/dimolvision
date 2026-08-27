/**
 * AI 물량 산정 (로드맵 Phase 6 · 고도화).
 * 현장 정보(연면적/구조/사진)로 철거 폐기물 발생량(톤)을 추정한다.
 * 실제 AI(사진 분석) 연동 전까지는 원단위 휴리스틱 목이 동작한다 — 항상 참고용.
 */

/** 건물 구조 (철거 폐기물 발생 원단위 보정용). */
export type BuildingStructure = 'RC' | 'BRICK' | 'WOOD';

export const BUILDING_STRUCTURE_LABELS: Record<BuildingStructure, string> = {
  RC: '철근콘크리트',
  BRICK: '조적(벽돌)',
  WOOD: '목조',
};

/** 구조 선택을 돕는 한 줄 설명 — 사용자가 자기 건물이 뭔지 모를 때가 많다. */
export const BUILDING_STRUCTURE_HINTS: Record<BuildingStructure, string> = {
  RC: '아파트·상가·대부분의 콘크리트 건물',
  BRICK: '벽돌 쌓아 지은 단독주택·소형 건물',
  WOOD: '목조 주택·황토집·경량 구조물',
};

/**
 * 연면적 1㎡당 철거 폐기물 발생 원단위(톤/㎡) 초기값.
 * 파일럿 실측 데이터로 보정한다 — 이 파일에서만 수정 (하드코딩 금지).
 */
export const DEMOLITION_TON_PER_M2 = 1.58;

/** 구조별 보정 계수 (환경부 건설폐기물 발생 원단위 기준). */
export const STRUCTURE_FACTORS: Record<BuildingStructure, number> = {
  RC: 1.0,      // 1.58 * 1.0 = 1.58 (철근콘크리트)
  BRICK: 0.73,  // 1.58 * 0.73 ≈ 1.15 (조적조)
  WOOD: 0.33,   // 1.58 * 0.33 ≈ 0.52 (목조)
};

/** 1평 = 3.305785㎡ (한국 사용자는 평 단위로 면적을 인지한다). */
export const PYEONG_TO_M2 = 3.305785;

/** 평 → ㎡ (소수 1자리). */
export function pyeongToM2(pyeong: number): number {
  return Math.round(pyeong * PYEONG_TO_M2 * 10) / 10;
}

/** ㎡ → 평 (소수 1자리). */
export function m2ToPyeong(m2: number): number {
  return Math.round((m2 / PYEONG_TO_M2) * 10) / 10;
}

/**
 * 추정 범위 폭(±비율). 원단위 휴리스틱은 현장 편차가 크므로 단일 수치로
 * 과도한 정밀도를 주장하지 않고 범위로 보여준다. 구조 정보가 있으면 절반으로 좁힌다.
 */
export const ESTIMATE_RANGE_RATIO = 0.3;

/** 운반 차량 정격 적재량(톤) — 대수 환산 안내용. */
export const TRUCK_CAPACITY_TONS = [5, 25] as const;

export type EstimateConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/** 추정 물량을 차량 대수로 환산한 결과(감을 잡기 위한 참고값). */
export interface TruckLoad {
  /** 차량 정격 적재량(톤). */
  capacityTons: number;
  /** 필요 대수(올림). */
  count: number;
}

export interface VolumeEstimate {
  /** 추정 폐기물량(톤, 소수 1자리). 범위의 중앙값. */
  estimatedTons: number;
  /** 추정 범위 하한(톤, 소수 1자리). */
  rangeMinTons: number;
  /** 추정 범위 상한(톤, 소수 1자리). */
  rangeMaxTons: number;
  /** 계산에 실제로 사용된 연면적(㎡) — 바닥면적×층수를 서버가 확정한 값. */
  floorAreaM2: number;
  /** 차량 대수 환산(참고). */
  truckLoads: TruckLoad[];
  confidence: EstimateConfidence;
  /** 추정 방법 식별자 (AREA_HEURISTIC: 원단위, AI_VISION: 사진 분석 — 연동 후). */
  method: 'AREA_HEURISTIC' | 'AI_VISION';
  /** UI 필수 노출 문구 — 추정치의 한계 고지. */
  disclaimer: string;
  estimatedAt: string;
}

/** 추정 톤수 → 차량별 필요 대수(올림). 0톤 이하는 빈 배열. */
export function toTruckLoads(tons: number): TruckLoad[] {
  if (!Number.isFinite(tons) || tons <= 0) return [];
  return TRUCK_CAPACITY_TONS.map((capacityTons) => ({
    capacityTons,
    count: Math.ceil(tons / capacityTons),
  }));
}
