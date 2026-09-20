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
  /** 실제로 이어진 사진의 파일명(0000.jpg 형식). 어느 구간이 끊겼는지 되짚는 근거. */
  registeredNames?: string[];
  /** COLMAP 이 만든 모델 수. 2 이상이면 촬영이 중간에 끊겨 조각났다는 뜻이다. */
  modelCount?: number;
  /** 어떤 설정으로 성공했는지(balanced | aggressive). */
  profile?: string;
}

/** 끊긴 구간 — 이어지지 않은 사진이 연속으로 몰린 곳. */
export interface MissingSegment {
  fromSec: number;
  toSec: number;
  frames: number;
}

/**
 * 어느 구간을 다시 찍어야 하는지 찾는다.
 *
 * "다시 찍으세요" 만으로는 처음부터 다 찍게 된다. 실제로는 한두 구간만 끊긴 경우가
 * 대부분이라, 그 지점으로 돌아가 이어 찍는 편이 훨씬 빠르다. 등록된 사진 이름을
 * 촬영 시각으로 되돌려 비어 있는 구간을 찾는다.
 *
 * minRun 이상 연속으로 빠진 곳만 낸다 — 한두 장 빠진 건 정상이고, 그것까지 알리면
 * 화면이 경고로 뒤덮여 정작 중요한 구간이 묻힌다.
 */
export function findMissingSegments(
  registeredNames: readonly string[] | undefined,
  frameTimes: readonly number[],
  minRun = 3,
): MissingSegment[] {
  if (!registeredNames || frameTimes.length === 0) return [];
  const ok = new Set<number>();
  for (const name of registeredNames) {
    const m = /(\d+)/.exec(name);
    if (m) ok.add(Number(m[1]));
  }
  if (ok.size === 0) return [];

  const out: MissingSegment[] = [];
  let runStart = -1;
  const flush = (endExclusive: number) => {
    if (runStart < 0) return;
    const len = endExclusive - runStart;
    if (len >= minRun) {
      out.push({
        fromSec: frameTimes[runStart] ?? 0,
        toSec: frameTimes[endExclusive - 1] ?? 0,
        frames: len,
      });
    }
    runStart = -1;
  };
  for (let i = 0; i < frameTimes.length; i += 1) {
    if (ok.has(i)) flush(i);
    else if (runStart < 0) runStart = i;
  }
  flush(frameTimes.length);
  return out;
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

/**
 * 복원 공급자를 우선순위로 시도한다.
 *
 * 왜 둘을 두는가: COLMAP(SfM)은 사진에서 같은 지점을 찾아 맞추는 방식이라 맞출 무늬가
 * 없으면 원리적으로 실패한다. 철거 현장의 도배·페인트 벽이 정확히 그 조건이고,
 * 실측에서 "매칭 990개·45장 전부 연결" 인데도 초기 쌍을 못 찾아 모델이 아예 생기지
 * 않는 실패를 반복했다. VGGT 는 신경망이 한 번의 추론으로 포즈와 깊이를 함께 내므로
 * 그 실패 모드가 없다. 그래서 VGGT 를 먼저 쓰고, 그쪽이 죽었을 때만 COLMAP 으로 간다.
 */
export class ReconstructionChain {
  constructor(private readonly providers: ReconstructionClient[]) {}

  async warmup(): Promise<void> {
    await Promise.all(this.providers.map((p) => p.warmup()));
  }

  async reconstruct(frames: string[]): Promise<ReconstructionResponse> {
    let last: ReconstructionResponse = {
      ok: false,
      stage: 'input',
      log: '복원 공급자가 없습니다.',
    };
    for (const provider of this.providers) {
      const r = await provider.reconstruct(frames);
      if (r.ok) return r;
      last = r;
      // 입력 자체가 모자란 건 다음 공급자로 가도 같다.
      if (r.stage === 'input') return r;
    }
    return last;
  }
}

export class ReconstructionClient {
  constructor(private readonly config: ReconstructionConfig) {}

  /**
   * GPU 컨테이너를 깨운다. 실패해도 무시한다 — 못 깨우면 원래대로 첫 요청이
   * 콜드스타트를 겪을 뿐, 복원 자체가 막히지는 않는다.
   */
  async warmup(): Promise<void> {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 90_000);
      await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/health`, {
        signal: controller.signal,
        ...(this.config.apiKey ? { headers: { authorization: `Bearer ${this.config.apiKey}` } } : {}),
      });
    } catch {
      // 깨우기는 최선 노력이다.
    }
  }

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
  // 실패했을 때 무엇을 고쳐야 하는지는 숫자가 가른다.
  // 정합은 됐는데 점이 안 나오면 무늬 문제이고, 정합 자체가 안 되면 겹침·시차 문제다.
  // 한 문장으로 "제자리에서 돌렸다" 고 단정하면 제대로 걷고도 실패한 사람에게 틀린 지적이 된다.
  const few = r.totalImages < 40;
  let advice: string;
  if (few) {
    advice =
      `프레임이 ${r.totalImages}장뿐이라 이어 붙일 근거가 부족합니다. ` +
      '실측에서 28장은 4장만 정합돼 실패했고 60장에서야 제대로 나왔습니다. ' +
      '끊지 말고 20~30초 계속 걸으며 다시 촬영해 주세요.';
  } else if (ratio >= 0.5) {
    advice =
      `사진은 ${r.registeredImages}장이나 이어졌는데 3D 점이 ${r.pointCount}개뿐입니다. ` +
      '맞출 무늬가 부족하다는 뜻입니다. 민무늬 벽·천장만 담지 말고 가구·배관·창틀·' +
      '바닥 패턴이 화면에 들어오게, 조명을 켜고 다시 촬영해 주세요.';
  } else {
    advice =
      `${r.totalImages}장 중 ${r.registeredImages}장만 이어졌습니다. 사진끼리 겹치는 부분이 ` +
      '부족하거나, 카메라가 제자리에서 돌기만 한 구간이 많다는 뜻입니다. ' +
      '벽에서 2~3m 떨어져 카메라를 벽으로 향한 채 **몸이 옆으로 이동**하도록, ' +
      '더 천천히 다시 촬영해 주세요.';
  }
  return { level: 'POOR', registeredRatio: ratio, advice };
}
