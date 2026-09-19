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

/** 한 번에 보내는 상한. 많을수록 느려지고 이득은 완만하게 줄어든다. */
export const MAX_RECON_FRAMES = 40;

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
        body: JSON.stringify({ frames: use }),
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

/** 기준 길이 입력 — 단위 없는 좌표계를 미터로 옮기는 유일한 근거. */
export interface ScaleReference {
  /** 복원 좌표계에서 잰 길이. 보통 가장 긴 축(extent 의 최댓값)을 쓴다. */
  axis: 'x' | 'y' | 'z' | 'diagonal';
  /** 그 축의 실제 길이(m). 사용자가 줄자로 잰 값이나 도면 치수. */
  realMeters: number;
}

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
  const unit = ref.axis === 'diagonal' ? extent.diagonal : extent[ref.axis];
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
  if (ratio >= 0.8 && r.pointCount >= 2000) return { level: 'GOOD', registeredRatio: ratio };
  if (ratio >= 0.5 && r.pointCount >= 500) {
    return {
      level: 'FAIR',
      registeredRatio: ratio,
      advice: '일부 구간이 복원되지 않았습니다. 그 부분을 천천히 다시 촬영하면 정확해집니다.',
    };
  }
  return {
    level: 'POOR',
    registeredRatio: ratio,
    advice:
      '복원이 충분하지 않습니다. 벽에 무늬가 없거나 조명이 어두우면 실패합니다. ' +
      '건물을 한 바퀴 돌며 천천히, 이전 화면과 절반 이상 겹치게 촬영해 주세요.',
  };
}
