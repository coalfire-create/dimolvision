import {
  DEMOLITION_TON_PER_M2,
  ESTIMATE_RANGE_RATIO,
  ESTIMATE_RANGE_RATIO_MEASURED,
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
  /**
   * floorAreaM2 가 (건물 전체 원단위 어림이 아니라) 방 단위 실측 합계처럼 이미 확정된
   * 값이면 true. 면적 자체의 불확실성이 없어지므로 추정 범위를 좁히고 신뢰도를 올린다.
   * floors 는 무시한다 — 실측 합계는 이미 철거할 전체 범위다.
   */
  measured?: boolean;
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
    const { floorAreaM2, structure, measured } = input;
    // 실측 합계는 이미 전체 범위이므로 층수를 곱하지 않는다(곱하면 방을 중복 계상한다).
    const floors = measured ? undefined : input.floors;
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

    // 실측이면 면적 자체의 오차가 없으니 기본 범위보다 좁게, 구조 정보가 있으면 거기서 절반으로.
    const baseRatio = measured ? ESTIMATE_RANGE_RATIO_MEASURED : ESTIMATE_RANGE_RATIO;
    const ratio = structure ? baseRatio / 2 : baseRatio;
    const rangeMinTons = round1(estimatedTons * (1 - ratio));
    const rangeMaxTons = round1(estimatedTons * (1 + ratio));

    // 신뢰도: 실측+구조 확정이 가장 높고(HIGH), 둘 중 하나만 있으면 MEDIUM, 둘 다 없으면 LOW.
    const confidence = structure && measured ? 'HIGH' : structure || measured ? 'MEDIUM' : 'LOW';

    return Promise.resolve({
      estimatedTons,
      rangeMinTons,
      rangeMaxTons,
      floorAreaM2: totalAreaM2,
      truckLoads: toTruckLoads(estimatedTons),
      confidence,
      method: measured ? 'ROOM_MEASUREMENT' : 'AREA_HEURISTIC',
      disclaimer: DISCLAIMER,
      estimatedAt: new Date().toISOString(),
    });
  }
}
