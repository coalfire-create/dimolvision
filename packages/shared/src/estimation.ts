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
  RC: 1.0, // 1.58 * 1.0 = 1.58 (철근콘크리트)
  BRICK: 0.73, // 1.58 * 0.73 ≈ 1.15 (조적조)
  WOOD: 0.33, // 1.58 * 0.33 ≈ 0.52 (목조)
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

/**
 * 방 단위 실측(rooms) 입력일 때의 범위 폭. 연면적을 건물 전체 평균으로 어림하는 게 아니라
 * 줄자로 잰 값이라, 오차의 가장 큰 원인(면적 자체를 모르는 것)이 사라진다. 남는 편차는
 * 원단위(㎡당 발생량) 자체의 현장 편차뿐이라 휴리스틱 기본 범위보다 좁게 잡는다.
 */
export const ESTIMATE_RANGE_RATIO_MEASURED = 0.15;

/** 방 1개 실측 상한(㎡). 오타(예: 길이·폭에 cm를 m로 입력)로 비정상 값이 섞이지 않게 막는다. */
export const MAX_ROOM_AREA_M2 = 500;

/** 부분 철거 견적을 위한 방(공간) 단위 실측값 — 철거업체가 실사에서 줄자로 재는 값 그대로. */
export interface RoomMeasurement {
  /** 방 이름(예: '거실', '주방', '방1'). */
  name: string;
  /** 실측 길이(m). */
  lengthM: number;
  /** 실측 폭(m). */
  widthM: number;
  /**
   * 평면도 윤곽으로 직접 구한 면적(㎡). 있으면 가로×세로 대신 이 값을 쓴다.
   *
   * 왜 따로 받는가: 가로×세로는 공간이 직사각형일 때만 맞다. L자·ㄷ자 공간에서는 빈 구역까지
   * 곱해 들어가 면적이 20~33% 부풀고, 그만큼 물량과 금액이 통째로 과대해진다. 3D 복원이
   * 만든 평면도는 형상을 그대로 잰 값이라 그 오차가 없다.
   */
  areaM2?: number;
}

/**
 * 방 목록의 실측 면적 합(㎡, 소수 1자리).
 *
 * 방마다 평면도 면적(areaM2)이 있으면 그것을, 없으면 가로×세로를 쓴다.
 * 값이 양수가 아니거나 한 방이 {@link MAX_ROOM_AREA_M2}를 넘으면 그 방은 건너뛴다 —
 * 오타 한 줄이 전체 견적을 부풀리는 것보다, 그 방만 빠지고 나머지가 맞는 편이 낫다.
 */
export function sumRoomAreaM2(rooms: readonly RoomMeasurement[]): number {
  const total = rooms.reduce((sum, r) => {
    const area = roomAreaM2(r);
    if (area === undefined || area > MAX_ROOM_AREA_M2) return sum;
    return sum + area;
  }, 0);
  return Math.round(total * 10) / 10;
}

/** 방 하나의 면적(㎡). 평면도 면적이 우선이고, 없으면 가로×세로. 쓸 수 없으면 undefined. */
export function roomAreaM2(room: RoomMeasurement): number | undefined {
  if (room.areaM2 !== undefined) {
    return Number.isFinite(room.areaM2) && room.areaM2 > 0 ? room.areaM2 : undefined;
  }
  if (!Number.isFinite(room.lengthM) || room.lengthM <= 0) return undefined;
  if (!Number.isFinite(room.widthM) || room.widthM <= 0) return undefined;
  return room.lengthM * room.widthM;
}

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
  /**
   * 추정 방법 식별자.
   * AREA_HEURISTIC: 연면적(건물 전체 또는 사용자 입력) × 원단위.
   * ROOM_MEASUREMENT: 방 단위 실측(rooms) 합계 × 원단위 — 면적 자체의 오차가 없다.
   * AI_VISION: 사진 분석 — 연동 후.
   */
  method: 'AREA_HEURISTIC' | 'ROOM_MEASUREMENT' | 'AI_VISION';
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
