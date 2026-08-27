import {
  DEMOLITION_TON_PER_M2,
  ESTIMATE_RANGE_RATIO,
  STRUCTURE_FACTORS,
  toTruckLoads,
  type BuildingStructure,
  type VolumeEstimate,
} from '@dimol/shared';

/**
 * AI 물량 산정 어댑터 (로드맵 Phase 6).
 * 실제 AI(현장 사진 비전 분석) 계약/연동 전이므로 원단위 휴리스틱 목으로 시작한다.
 * 연동 시 이 인터페이스 구현체만 교체한다 (사진 키를 입력으로 받는 이유).
 */

export class EstimationValidationError extends Error {}

/** 입력 상한 — 오타(예: 100000평)로 말도 안 되는 값이 나가지 않게 막는다. */
const MAX_FLOOR_AREA_M2 = 100_000;
const MAX_FLOORS = 50;

export interface EstimateVolumeInput {
  /**
   * 면적(㎡). floors 를 함께 주면 "한 층 바닥면적"으로 해석해 층수를 곱하고,
   * 없으면 연면적 그대로 쓴다. 휴리스틱 목에서는 필수.
   */
  floorAreaM2?: number;
  /** 층수(선택, 1 이상 정수). 지정 시 floorAreaM2 × floors = 연면적. */
  floors?: number;
  structure?: BuildingStructure;
  /** 현장 사진 키 — AI 비전 연동 시 사용. 목에서는 무시된다. */
  sitePhotoKeys?: string[];
}

export interface VolumeEstimator {
  estimate(input: EstimateVolumeInput): Promise<VolumeEstimate>;
}

const DISCLAIMER =
  '원단위 기반 참고 추정치입니다. 실제 물량은 현장 실사로 확정하며, 견적·계약의 근거로 단독 사용하지 마세요.';

/** 소수 1자리 반올림. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 원단위 휴리스틱 목 — 연면적 × 원단위 × 구조 보정. 결정적(같은 입력 → 같은 결과). */
export class HeuristicVolumeEstimator implements VolumeEstimator {
  estimate(input: EstimateVolumeInput): Promise<VolumeEstimate> {
    const { floorAreaM2, floors, structure } = input;
    if (typeof floorAreaM2 !== 'number' || !Number.isFinite(floorAreaM2) || floorAreaM2 <= 0) {
      throw new EstimationValidationError(
        'floorAreaM2(연면적 ㎡, 양수)가 필요합니다. 사진만으로 추정하는 AI 분석은 준비중입니다.',
      );
    }
    if (floors !== undefined) {
      if (!Number.isInteger(floors) || floors < 1 || floors > MAX_FLOORS) {
        throw new EstimationValidationError(`floors(층수)는 1~${MAX_FLOORS} 사이 정수여야 합니다.`);
      }
    }
    if (structure !== undefined && !(structure in STRUCTURE_FACTORS)) {
      throw new EstimationValidationError('structure 는 RC | BRICK | WOOD 여야 합니다.');
    }

    // 층수를 주면 바닥면적으로 보고 연면적을 만든다(층수 없으면 이미 연면적).
    const totalAreaM2 = round1(floorAreaM2 * (floors ?? 1));
    if (totalAreaM2 > MAX_FLOOR_AREA_M2) {
      throw new EstimationValidationError(
        `연면적이 너무 큽니다(${MAX_FLOOR_AREA_M2}㎡ 초과). 입력값을 확인해 주세요.`,
      );
    }

    const factor = structure ? STRUCTURE_FACTORS[structure] : 1.0;
    const estimatedTons = round1(totalAreaM2 * DEMOLITION_TON_PER_M2 * factor);

    // 구조 정보가 있으면 편차가 줄어드니 범위를 절반으로 좁힌다.
    const ratio = structure ? ESTIMATE_RANGE_RATIO / 2 : ESTIMATE_RANGE_RATIO;
    const rangeMinTons = round1(estimatedTons * (1 - ratio));
    const rangeMaxTons = round1(estimatedTons * (1 + ratio));

    return Promise.resolve({
      estimatedTons,
      rangeMinTons,
      rangeMaxTons,
      floorAreaM2: totalAreaM2,
      truckLoads: toTruckLoads(estimatedTons),
      // 구조 정보가 있으면 보정이 들어가 신뢰도 한 단계 위.
      confidence: structure ? 'MEDIUM' : 'LOW',
      method: 'AREA_HEURISTIC',
      disclaimer: DISCLAIMER,
      estimatedAt: new Date().toISOString(),
    });
  }
}
