/**
 * 철거 현장 "가이드 촬영" 공통 로직 — 슬롯 정의 · 방향 게이트 · 품질 검증 · 상태머신.
 * (로드맵 Phase 1 §4.2 현장 사진, [[site-photo]] 업로드 규칙과 함께 쓰인다.)
 *
 * 목적: 사용자가 현장을 대충 찍어 일부만 담기는 문제를 막기 위해, 정해진 순서와
 * 방향으로만 촬영이 진행되도록 강제한다. UI(모바일/웹)·검증·테스트가 이 순수 로직을
 * 공유하며, 플랫폼별 코드(센서 접근, 캔버스 픽셀 추출)는 여기 정의된 함수에 값을 넣는다.
 *
 * 방위각(azimuth)은 절대 방위를 그대로 쓰지 않는다 — 나침반 캘리브레이션 오차 때문에
 * 첫 슬롯(정면벽) 촬영 시점의 azimuth 를 0도 "기준"으로 잡고, 이후 슬롯은 그 기준
 * 대비 상대각으로만 판정한다.
 */

/** 촬영 슬롯 식별자 — 순서대로 진행한다. */
export type SiteCaptureSlotId =
  | 'FRONT_WALL' // ① 정면벽 (기준 0도)
  | 'RIGHT_WALL' // ② 우측벽 (+90도)
  | 'BACK_WALL' //  ③ 후면벽 (+180도)
  | 'LEFT_WALL' //  ④ 좌측벽 (+270도)
  | 'FLOOR' //      ⑤ 바닥 (아래로)
  | 'CEILING' //    ⑥ 천장 (위로)
  | 'DAMAGE'; //    ⑦ 손상부위 클로즈업 (선택 · 다중)

export interface SiteCaptureSlot {
  id: SiteCaptureSlotId;
  /** 1-based 표시 순번. */
  order: number;
  /** 사용자에게 그대로 노출하는 슬롯 안내 문구. */
  instruction: string;
  /**
   * 기준(정면벽) 대비 목표 상대 방위각(도, 0~359). 방향 제한이 없는 슬롯은 null.
   * 실제 목표 절대각 = (기준 azimuth + relativeAzimuth) mod 360.
   */
  relativeAzimuth: number | null;
  /** 목표 pitch 범위 [min, max] (도). 벽·손상부위처럼 상하 제한이 없으면 null. */
  pitchRange: readonly [number, number] | null;
  /** 건너뛰기 허용(선택 슬롯). */
  optional: boolean;
  /** 한 슬롯에서 여러 장 촬영 허용(손상부위 보강 촬영). */
  allowMultiple: boolean;
}

/** 방위각 허용 오차(도) — 목표각 ±20도 안이면 방향이 맞은 것으로 본다. */
export const AZIMUTH_TOLERANCE = 20;

/** 순차 진행 슬롯 정의(순서 고정). 문구는 기획 확정본을 그대로 사용한다. */
export const SITE_CAPTURE_SLOTS: readonly SiteCaptureSlot[] = [
  {
    id: 'FRONT_WALL',
    order: 1,
    instruction: '지금 서 계신 자리에서 정면 벽을 화면 가득 채워 찍어주세요.',
    relativeAzimuth: 0,
    pitchRange: null,
    optional: false,
    allowMultiple: false,
  },
  {
    id: 'RIGHT_WALL',
    order: 2,
    instruction: '오른쪽으로 90도 돌아, 우측 벽 전체가 보이게 찍어주세요.',
    relativeAzimuth: 90,
    pitchRange: null,
    optional: false,
    allowMultiple: false,
  },
  {
    id: 'BACK_WALL',
    order: 3,
    instruction: '계속 오른쪽으로 돌아, 뒤쪽 벽을 찍어주세요.',
    relativeAzimuth: 180,
    pitchRange: null,
    optional: false,
    allowMultiple: false,
  },
  {
    id: 'LEFT_WALL',
    order: 4,
    instruction: '마지막 벽입니다. 왼쪽 벽을 찍어주세요.',
    relativeAzimuth: 270,
    pitchRange: null,
    optional: false,
    allowMultiple: false,
  },
  {
    id: 'FLOOR',
    order: 5,
    instruction: '폰을 아래로 향해 바닥 전체가 보이게 찍어주세요.',
    relativeAzimuth: null,
    pitchRange: [-90, -70],
    optional: false,
    allowMultiple: false,
  },
  {
    id: 'CEILING',
    order: 6,
    instruction: '폰을 위로 들어 천장을 찍어주세요.',
    relativeAzimuth: null,
    pitchRange: [70, 90],
    optional: false,
    allowMultiple: false,
  },
  {
    id: 'DAMAGE',
    order: 7,
    instruction:
      '철거 시 주의가 필요한 부분(균열, 누수, 파손)이 있다면 가까이서 찍어주세요. 없으면 건너뛰기.',
    relativeAzimuth: null,
    pitchRange: null,
    optional: true,
    allowMultiple: true,
  },
];

/** 전체 슬롯 수(진행률 분모). */
export const SITE_CAPTURE_TOTAL = SITE_CAPTURE_SLOTS.length;

/** UI 문구(그대로 노출). 화면에서 문자열을 하드코딩하지 말고 여기서 가져다 쓴다. */
export const SITE_CAPTURE_COPY = {
  /** 상단 진행률. n = 완료된 슬롯 수. */
  progress: (n: number): string =>
    `철거 현장 전체를 빠짐없이 기록해주세요 (진행률: ${n}/${SITE_CAPTURE_TOTAL})`,
  /** 방향이 목표 범위에 들어왔을 때. */
  aligned: '지금 각도가 맞습니다. 촬영해주세요',
  /** 방향 불일치. */
  misaligned: '방향이 맞지 않습니다. 화면 안내에 맞춰 폰을 돌려주세요.',
  /** 촬영 품질 미달(암전/흐림/렌즈 가림) 재촬영. */
  qualityFail: '사진이 너무 어둡거나 흐립니다. 다시 찍어주세요.',
  /** 전체 완료. */
  complete: '현장 기록이 완료되었습니다. 다음 단계로 진행합니다.',
} as const;

// ────────────────────────────────────────────────────────────────────────────
// 방향(azimuth/pitch) 판정
// ────────────────────────────────────────────────────────────────────────────

/** 두 방위각 사이의 최소 원형 거리(0~180도). 359도와 1도는 2도로 취급한다. */
export function azimuthDelta(a: number, b: number): number {
  return Math.abs(((((a - b + 540) % 360) + 360) % 360) - 180);
}

/**
 * 현재 방위각이 목표 방위각의 허용 오차 안(±tolerance)에 있는지.
 * 0/360 경계를 원형으로 처리한다(기획 참고 로직과 동일).
 */
export function isWithinTarget(
  currentAzimuth: number,
  targetAzimuth: number,
  tolerance: number = AZIMUTH_TOLERANCE,
): boolean {
  const diff = Math.abs(((currentAzimuth - targetAzimuth + 540) % 360) - 180);
  return diff <= tolerance;
}

/** 기준 방위각 대비 현재의 상대각(0~359). */
export function relativeAzimuth(current: number, base: number): number {
  return (((current - base) % 360) + 360) % 360;
}

/** pitch 가 목표 범위 [min,max] 안인지. */
export function isPitchWithin(pitch: number, range: readonly [number, number]): boolean {
  return pitch >= range[0] && pitch <= range[1];
}

/** 기기 방향 1회 측정값. azimuth: 0~360, pitch: -90(아래)~+90(위). */
export interface OrientationReading {
  azimuth: number;
  pitch: number;
}

/**
 * 해당 슬롯이 요구하는 방향에 현재 기기 방향이 맞는지 판정.
 * - 방위각 슬롯(벽): 기준(base) 미설정이면 아직 판정 불가 → false.
 * - pitch 슬롯(바닥/천장): pitch 범위로 판정(방위 무관).
 * - 제한 없는 슬롯(손상부위): 항상 true.
 */
export function isSlotAligned(
  slot: SiteCaptureSlot,
  base: number | null,
  reading: OrientationReading,
  tolerance: number = AZIMUTH_TOLERANCE,
): boolean {
  if (slot.relativeAzimuth !== null) {
    if (base === null) return false;
    const target = (base + slot.relativeAzimuth) % 360;
    return isWithinTarget(reading.azimuth, target, tolerance);
  }
  if (slot.pitchRange !== null) {
    return isPitchWithin(reading.pitch, slot.pitchRange);
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// 촬영 즉시 품질 검증(밝기 평균 · 명암 분산)
// ────────────────────────────────────────────────────────────────────────────

/**
 * 품질 임계값 튜닝 가이드.
 * 값은 0~255 밝기 기준의 초기 추정치다. 실제 현장 사진으로 보정한다:
 * - mean 하한을 올리면 어두운 실내 사진이 자주 반려되고, 내리면 암전을 놓친다.
 * - variance 하한을 올리면 안개/흐림·단색 벽을 더 엄격히 거르지만 매끈한 벽면
 *   정상 사진도 반려될 수 있다.
 * 조정은 이 두 상수만 바꾼다(호출부·UI 하드코딩 금지). subsampleRgba 의 perAxis 를
 * 키우면 표본이 늘어 분산 추정이 안정되지만 계산 비용이 증가한다.
 */
/** 평균 밝기 하한 — 이보다 어두우면 암전/렌즈 가림으로 본다. */
export const QUALITY_MEAN_MIN = 25;
/** 명암 분산 하한 — 이보다 낮으면 흐림/단색(가림)으로 본다. */
export const QUALITY_VARIANCE_MIN = 200;

export interface LumaStats {
  /** 평균 밝기(0~255). */
  mean: number;
  /** 밝기 분산(명암 대비 지표). */
  variance: number;
}

/**
 * RGBA 픽셀 배열(캔버스 ImageData.data 형태)의 평균 밝기와 분산을 계산한다.
 * AI 호출 없이 순수 클라이언트 연산. pixels 는 [r,g,b,a, r,g,b,a, ...] 순서.
 */
export function computeLumaStats(pixels: ArrayLike<number>): LumaStats {
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    const gray = (r + g + b) / 3;
    sum += gray;
    sumSq += gray * gray;
  }
  const n = pixels.length / 4;
  if (n === 0) return { mean: 0, variance: 0 };
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return { mean, variance };
}

/** 품질 기준 통과 여부(밝기·분산 하한 모두 초과해야 통과). */
export function isPhotoQualityOk(stats: LumaStats): boolean {
  return stats.mean > QUALITY_MEAN_MIN && stats.variance > QUALITY_VARIANCE_MIN;
}

/**
 * 큰 이미지의 RGBA 를 목표 축당 표본 수(perAxis)에 맞춰 균등 간격으로 골라
 * 작은 RGBA 배열로 압축한다(밝기·분산 계산 비용을 상수 시간으로 묶는다).
 * data 는 [r,g,b,a, ...] 순서(길이 = width*height*4).
 */
export function subsampleRgba(
  data: ArrayLike<number>,
  width: number,
  height: number,
  perAxis = 64,
): number[] {
  if (width <= 0 || height <= 0) return [];
  const stepX = Math.max(1, Math.floor(width / perAxis));
  const stepY = Math.max(1, Math.floor(height / perAxis));
  const out: number[] = [];
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const idx = (y * width + x) * 4;
      out.push(data[idx] ?? 0, data[idx + 1] ?? 0, data[idx + 2] ?? 0, 255);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 촬영 세션 상태머신 (순수 reducer)
// ────────────────────────────────────────────────────────────────────────────

/** 한 슬롯에서 촬영된 사진 1장. base64 는 서버 분석 API 로 그대로 넘긴다. */
export interface CapturedSlotPhoto {
  slotId: SiteCaptureSlotId;
  base64: string;
  mimeType: string;
  uri: string;
}

export interface SiteCaptureState {
  /** 현재 진행 중 슬롯 인덱스(SITE_CAPTURE_SLOTS 기준). done 이면 total 과 같다. */
  currentIndex: number;
  /** 첫 슬롯 촬영 시 잡은 0도 기준 방위각. 미설정이면 null. */
  baseAzimuth: number | null;
  /** 촬영된 사진들(슬롯 id 포함, 순서대로). */
  photos: CapturedSlotPhoto[];
  /** 완료(또는 건너뜀)된 슬롯 id 목록. 진행률 분자. */
  completed: SiteCaptureSlotId[];
  /** 모든 슬롯 종료 여부. */
  done: boolean;
}

export type SiteCaptureAction =
  | { type: 'CAPTURE'; photo: Omit<CapturedSlotPhoto, 'slotId'>; atAzimuth?: number | null }
  | { type: 'SKIP' }
  | { type: 'FINISH_MULTIPLE' }
  | { type: 'RESET' };

/** 빈 촬영 세션. */
export function createSiteCaptureSession(): SiteCaptureState {
  return { currentIndex: 0, baseAzimuth: null, photos: [], completed: [], done: false };
}

function advance(state: SiteCaptureState, slotId: SiteCaptureSlotId): SiteCaptureState {
  const nextIndex = state.currentIndex + 1;
  return {
    ...state,
    completed: [...state.completed, slotId],
    currentIndex: nextIndex,
    done: nextIndex >= SITE_CAPTURE_TOTAL,
  };
}

/**
 * 촬영 세션 상태 전이(순수 함수).
 * - CAPTURE: 현재 슬롯에 사진 추가. 첫 슬롯이면 atAzimuth 로 기준각을 잡는다.
 *   다중 슬롯(손상부위)은 슬롯에 머무르고, 단일 슬롯은 완료 후 다음으로 넘어간다.
 * - SKIP: 선택 슬롯만 건너뛰고 다음으로.
 * - FINISH_MULTIPLE: 다중 슬롯에서 "완료"를 눌러 다음으로.
 */
export function reduceSiteCapture(
  state: SiteCaptureState,
  action: SiteCaptureAction,
): SiteCaptureState {
  if (action.type === 'RESET') return createSiteCaptureSession();
  if (state.done) return state;

  const slot = SITE_CAPTURE_SLOTS[state.currentIndex];
  if (!slot) return state;

  switch (action.type) {
    case 'CAPTURE': {
      // 첫 슬롯(정면벽) 촬영 시점의 방위각을 0도 기준으로 고정한다.
      const baseAzimuth =
        state.currentIndex === 0 && action.atAzimuth != null ? action.atAzimuth : state.baseAzimuth;
      const photos = [...state.photos, { ...action.photo, slotId: slot.id }];
      if (slot.allowMultiple) {
        // 다중 슬롯: 사진만 쌓고 슬롯에 머무른다(사용자가 FINISH_MULTIPLE 로 종료).
        return { ...state, baseAzimuth, photos };
      }
      return advance({ ...state, baseAzimuth, photos }, slot.id);
    }
    case 'SKIP': {
      if (!slot.optional) return state;
      return advance(state, slot.id);
    }
    case 'FINISH_MULTIPLE': {
      if (!slot.allowMultiple) return state;
      return advance(state, slot.id);
    }
    default:
      return state;
  }
}

/** 진행률 분자(완료된 슬롯 수). */
export function completedCount(state: SiteCaptureState): number {
  return state.completed.length;
}

/** 현재 슬롯(없으면 null — 세션 완료). */
export function currentSlot(state: SiteCaptureState): SiteCaptureSlot | null {
  return SITE_CAPTURE_SLOTS[state.currentIndex] ?? null;
}

/** 특정 슬롯에 촬영된 사진들. */
export function photosForSlot(
  state: SiteCaptureState,
  slotId: SiteCaptureSlotId,
): CapturedSlotPhoto[] {
  return state.photos.filter((p) => p.slotId === slotId);
}
