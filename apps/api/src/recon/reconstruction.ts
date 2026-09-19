/**
 * 3D 복원 클라이언트 — Cloud Run GPU 위의 COLMAP 서비스를 호출한다.
 *
 * 복원 결과는 **단위 없는 좌표계**다. 사진만으로 만든 재구성은 크기를 알 수 없기 때문이다
 * (같은 형상이 1m 일 수도 10m 일 수도 있다). 그래서 이 모듈은 부피를 미터로 말하지 않고,
 * 호출부가 기준 길이를 하나 주면 그때 실제 치수로 환산한다. 기준 없이 미터를 붙이면
 * 그건 측정이 아니라 창작이다.
 */

export interface ReconExtent {
  x: number;
  y: number;
  z: number;
  diagonal: number;
}

/** COLMAP 복원 결과(좌표계 단위 없음). */
export interface ReconstructionResult {
  ok: true;
  /** 실제로 위치가 잡힌 이미지 수. 전체보다 크게 적으면 촬영이 부족했다는 신호다. */
  registeredImages: number;
  totalImages: number;
  pointCount: number;
  extent: ReconExtent;
  cameraPathLength: number;
  points: number[][];
  cameras: number[][];
  elapsedSec: number;
}

export interface ReconstructionFailure {
  ok: false;
  /** 어느 단계에서 멈췄는지 — 사용자에게 무엇을 고쳐야 하는지 알려줄 근거. */
  stage: string;
  log: string;
}

export type ReconstructionResponse = ReconstructionResult | ReconstructionFailure;

/** 복원에 최소한 필요한 프레임 수. 이보다 적으면 삼각측량이 성립하지 않는다. */
export const MIN_RECON_FRAMES = 8;

/**
 * 한 번에 보내는 상한. 실측에서 60장 근처가 정확도 대비 시간이 가장 좋았다.
 *   60장  → 정합 27 · 점 2,194 · 54초
 *   112장 → 정합 27 · 점 2,161 · 41초  (더 넣어도 붙는 프레임은 그대로)
 * 그 이상은 복원되지 않는 프레임만 늘려 전송량과 시간을 낭비한다.
 */
export const MAX_RECON_FRAMES = 64;

export interface ReconstructionConfig {
  baseUrl: string;
  /** COLMAP 은 수 분이 걸린다. 비전 분석과 같은 타임아웃을 쓰면 무조건 끊긴다. */
  timeoutMs: number;
  apiKey?: string;
}

export class ReconstructionClient {
  constructor(private readonly config: ReconstructionConfig) {}

  async reconstruct(frames: string[]): Promise<ReconstructionResponse> {
    const use = frames.slice(0, MAX_RECON_FRAMES);
    if (use.length < MIN_RECON_FRAMES) {
      return {
        ok: false,
        stage: 'input',
        log: `프레임이 ${MIN_RECON_FRAMES}장 이상 필요합니다(받은 수: ${use.length}).`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/reconstruct`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({ frames: use, matcher: 'exhaustive', maxImageSize: 1600 }),
      });
      const body = (await res.json()) as ReconstructionResponse;
      if (!res.ok) {
        return {
          ok: false,
          stage: (body as ReconstructionFailure).stage ?? `http-${res.status}`,
          log: (body as ReconstructionFailure).log ?? `복원 서버 오류 ${res.status}`,
        };
      }
      return body;
    } catch (err) {
      return {
        ok: false,
        stage: 'network',
        log: err instanceof Error ? err.message : '복원 서버에 연결하지 못했습니다.',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 기준 길이 입력 — 단위 없는 좌표계를 미터로 옮기는 유일한 근거.
 *
 * 축을 x·y·z 로만 받으면 쓸 수 없다. COLMAP 좌표축은 중력 방향과 무관해서 사용자가
 * "어느 게 높이냐" 를 알 방법이 없기 때문이다. 그래서 사람이 실제로 아는 길이
 * (층고 2.4m, 실내 문 2.1m, 건물 전면 폭)를 그대로 넣을 수 있게 **가장 짧은 축**과
 * **가장 긴 축**을 이름으로 받는다. 실내 공간은 높이가 가장 짧고 폭이 가장 길다.
 */
export interface ScaleReference {
  /** 기준으로 삼을 축. shortest=높이류, longest=폭류, diagonal=대각선. */
  axis: 'x' | 'y' | 'z' | 'diagonal' | 'shortest' | 'longest';
  /** 그 축의 실제 길이(m). 줄자로 잰 값, 도면 치수, 또는 층고·문 높이 같은 표준 치수. */
  realMeters: number;
}

/**
 * 사람이 아는 표준 치수 — 줄자 없이도 크기 기준을 잡을 수 있게 한다.
 * 정확한 실측보다는 못하지만, 기준이 아예 없어 "치수를 낼 수 없습니다" 로 끝나는 것보다 낫다.
 * 각 값이 어디서 온 표준인지 라벨에 적어 사용자가 자기 현장과 대조할 수 있게 한다.
 */
export const SCALE_PRESETS = [
  { id: 'door', label: '실내 문 높이', meters: 2.1, axis: 'shortest' as const },
  { id: 'floor24', label: '주택 층고', meters: 2.4, axis: 'shortest' as const },
  { id: 'floor27', label: '상가·사무실 층고', meters: 2.7, axis: 'shortest' as const },
  { id: 'floor30', label: '공장·창고 층고', meters: 3.0, axis: 'shortest' as const },
];

export interface ScaledDimensions {
  /** 미터 단위 치수. */
  widthM: number;
  depthM: number;
  heightM: number;
  /** 바닥 면적(㎡) — 폭 × 깊이. */
  floorAreaM2: number;
  /** 공간 부피(㎥). */
  volumeM3: number;
  /** 1 복원단위 = 몇 미터인가. */
  metersPerUnit: number;
}

/**
 * 복원 치수를 실제 미터로 환산한다.
 *
 * 축 대응에 대하여: COLMAP 좌표계는 중력 방향을 모른다. 그래서 x·y·z 중 무엇이 높이인지
 * 알 수 없다. 실내 공간은 대개 높이가 가장 짧으므로 **가장 짧은 축을 높이로** 본다.
 * 완벽한 규칙은 아니지만, 임의로 정하는 것보다 맞을 확률이 높고 근거를 댈 수 있다.
 */
export function scaleDimensions(
  extent: ReconExtent,
  ref: ScaleReference,
): ScaledDimensions | undefined {
  const sorted = [extent.x, extent.y, extent.z].sort((a, b) => a - b);
  const unit =
    ref.axis === 'diagonal'
      ? extent.diagonal
      : ref.axis === 'shortest'
        ? sorted[0]!
        : ref.axis === 'longest'
          ? sorted[2]!
          : extent[ref.axis];
  if (!Number.isFinite(unit) || unit <= 0) return undefined;
  if (!Number.isFinite(ref.realMeters) || ref.realMeters <= 0) return undefined;

  const metersPerUnit = ref.realMeters / unit;
  const dims = [extent.x, extent.y, extent.z]
    .map((v) => v * metersPerUnit)
    .sort((a, b) => b - a);

  const [widthM, depthM, heightM] = dims as [number, number, number];
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    widthM: r1(widthM),
    depthM: r1(depthM),
    heightM: r1(heightM),
    floorAreaM2: r1(widthM * depthM),
    volumeM3: r1(widthM * depthM * heightM),
    metersPerUnit,
  };
}

/**
 * 복원 품질 판정. 등록률이 낮으면 결과를 믿기 어렵다.
 * 사용자에게 "다시 찍으세요" 를 말할 근거가 되므로 수치와 함께 이유를 낸다.
 */
export function reconQuality(r: ReconstructionResult): {
  level: 'GOOD' | 'FAIR' | 'POOR';
  registeredRatio: number;
  advice?: string;
} {
  const ratio = r.totalImages > 0 ? r.registeredImages / r.totalImages : 0;

  // 판정 기준은 실측에서 왔다(현장 영상 33초, 실내 촬영):
  //   정합 4/28 · 점 125    → 형상이 안 나온다. 쓸 수 없다.
  //   정합 27/60 · 점 2,194 → 공간 윤곽이 보이고 상대 치수를 잴 수 있다.
  // 정합률만 보면 안 된다. 제자리 회전 구간이 섞이면 그 프레임들은 원리적으로 복원이
  // 불가능해 비율을 끌어내리는데, 나머지가 제대로 붙었으면 결과는 쓸 만하다.
  // 그래서 **점 개수를 1차 기준**으로, 정합률은 보조로 본다.
  if (r.pointCount >= 8000 && ratio >= 0.7) return { level: 'GOOD', registeredRatio: ratio };
  if (r.pointCount >= 1500) {
    return {
      level: 'FAIR',
      registeredRatio: ratio,
      advice:
        ratio < 0.6
          ? '일부 구간이 복원되지 않았습니다. 제자리에서 카메라만 돌린 구간은 시차가 없어 ' +
            '복원되지 않습니다. 벽을 따라 걸으며 다시 촬영하면 정확해집니다.'
          : '복원이 되었습니다. 더 촘촘히 돌면 정밀도가 올라갑니다.',
    };
  }
  return {
    level: 'POOR',
    registeredRatio: ratio,
    advice:
      '복원에 실패했습니다. 가장 흔한 원인은 **제자리에서 카메라만 돌린 촬영**입니다. ' +
      '3D 는 같은 지점을 다른 위치에서 본 차이로 깊이를 계산하므로, 카메라가 실제로 ' +
      '이동해야 합니다. 벽을 따라 옆으로 걸으며 2~3m 거리에서 천천히 다시 촬영해 주세요. ' +
      '민무늬 벽만 잡히면 맞출 기준점이 없으니 가구·배관·창틀이 화면에 들어오게 하세요.',
  };
}
