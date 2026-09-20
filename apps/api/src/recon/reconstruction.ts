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
  const dims = [extent.x, extent.y, extent.z].map((v) => v * metersPerUnit).sort((a, b) => b - a);

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
 * 평면도 격자 — 점군을 바닥면에 투영해 위에서 내려다본 도면.
 *
 * 왜 필요한가: {@link scaleDimensions} 는 공간을 직육면체 하나로 보고 바운딩박스의 두 변을
 * 곱해 면적을 낸다. 직사각형 방이면 맞지만 L자 공간이나 방 두 개를 한 영상에 담으면
 * 빈 공간까지 감싸 면적을 과대평가한다. 점군을 위에서 눌러 보면 벽이 선으로 나타나고,
 * 그 윤곽이 실제 형상이다 — 여기서 면적과 둘레를 다시 구한다.
 *
 * 격자는 단위 없는 복원 좌표계 그대로다. 미터 환산은 {@link scaleFloorPlan} 이 한다
 * (기준 길이를 바꿀 때마다 복원을 다시 하지 않아도 되게 분리했다).
 */
export interface FloorPlanGrid {
  /** 칸 한 변(복원 좌표 단위). */
  cellSize: number;
  cols: number;
  rows: number;
  /** 벽·물체가 잡힌 칸(행 우선 인덱스 = row × cols + col). 도면의 선이 되는 칸들. */
  wallCells: number[];
  /** 공간 내부로 판정된 칸. 면적 산정의 근거. */
  footprintCells: number[];
  /** 내부 칸들의 외곽선 길이(칸 변 개수). 미터 환산은 × cellSize. */
  perimeterEdges: number;
  /** 높이로 본 축 — scaleDimensions 와 같은 규칙(가장 짧은 축). */
  upAxis: 'x' | 'y' | 'z';
  /**
   * 근거율(0~1) — 윤곽 안의 줄(행·열) 중 벽을 실제로 만난 줄의 비율.
   * 나머지는 이웃 줄에서 추측해 이어 붙인 것이라, 낮을수록 도면이 추측에 기대고 있다.
   */
  wallClosure: number;
  /**
   * 이 도면의 면적을 견적에 써도 되는지.
   * GOOD 일 때만 물량 산정에 넣는다 — 성긴 복원은 면적이 작게 나와 견적을 과소하게 만든다.
   */
  reliability: 'GOOD' | 'FAIR' | 'POOR';
  /**
   * 이상점을 잘라낸 크기(복원 단위). **미터 환산은 이걸 기준으로 해야 한다.**
   *
   * 복원 서버가 주는 extent 는 점군 전체의 바운딩박스라 공간 밖으로 튄 점 몇 개가 그대로
   * 들어간다. 그 늘어난 축에 "층고 2.4m" 를 걸면 1단위가 실제보다 작게 잡혀 **모든 치수가
   * 같은 비율로 줄어든다**. 검증에서 격자 면적은 +19% 였는데 최종값이 -17% 로 뒤집힌
   * 원인이 정확히 이것이었다 — 오차의 주범은 도면이 아니라 배율이었다.
   */
  trimmedExtent: ReconExtent;
}

/** 평면도를 만들 최소 점 개수. 이보다 적으면 윤곽이 아니라 잡음이다. */
export const MIN_PLAN_POINTS = 200;

/** 격자 긴 변의 최대 칸 수. 이보다 잘게 나눠도 전송량만 늘고 윤곽은 더 안 보인다. */
const PLAN_GRID_MAX = 72;

/** 최소 칸 수. 이보다 성기면 도면이라 부를 수 없다. */
const PLAN_GRID_MIN = 16;

/**
 * 점 개수 → 격자 칸 수.
 *
 * 이게 평면도 정확도를 가르는 값이다. 칸을 잘게 나눌수록 윤곽이 또렷해 보이지만, 점이
 * 성기면 칸마다 점이 한두 개도 안 들어와 벽이 끊긴 점선이 된다. 그러면 행·열의 양 끝이
 * 무너지면서 내부가 통째로 사라진다 — 합성 검증에서 2,194점을 72칸에 넣었더니 면적이
 * 실제의 44%로 나왔다. 점 수의 제곱근에 비례해 칸을 잡으면 칸당 점 밀도가 일정하게
 * 유지돼, 성긴 복원에서도 벽이 이어진다.
 */
function planGridFor(pointCount: number): number {
  const grid = Math.round(Math.sqrt(pointCount) / 2.2);
  return Math.max(PLAN_GRID_MIN, Math.min(PLAN_GRID_MAX, grid));
}

/**
 * 이상점 잘라내기 비율. COLMAP 점군에는 공간 밖으로 튄 점이 섞이고, 그대로 두면 격자가
 * 늘어나 실제 공간이 한쪽 구석에 뭉친다. 축마다 상·하위 2%를 버린다.
 */
const PLAN_TRIM = 0.02;

/** 한 축의 이상점을 잘라낸 최소·최대. */
function trimmedBounds(values: number[]): { min: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * PLAN_TRIM);
  return { min: sorted[cut]!, max: sorted[sorted.length - 1 - cut]! };
}

/**
 * 점군 → 평면도 격자.
 *
 * 채우는 방법에 대하여: 벽만 잡혀 속이 빈 경우와, 바닥까지 잡혀 이미 찬 경우가 둘 다 나온다.
 * 그래서 **행마다 양 끝 사이를 채우고, 열마다 양 끝 사이를 채운 뒤 교집합**을 쓴다. 각각은
 * 실제 내부를 반드시 포함하는 상한이므로 교집합이 가장 조인 상한이고, L자·ㄷ자처럼 꺾인
 * 공간에서 바운딩박스가 삼키던 빈 구역이 여기서 빠진다.
 */
export interface FloorPlanOptions {
  /** 격자 긴 변의 칸 수. 기본은 점 개수에서 정한다({@link planGridFor}) — 튜닝 검증용으로만 넘긴다. */
  grid?: number;
}

export function buildFloorPlan(
  points: readonly number[][],
  options: FloorPlanOptions = {},
): FloorPlanGrid | undefined {
  const valid = points.filter(
    (p) => p.length >= 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]),
  );
  if (valid.length < MIN_PLAN_POINTS) return undefined;

  const bounds = [0, 1, 2].map((axis) => trimmedBounds(valid.map((p) => p[axis]!)));
  const spans = bounds.map((b) => b.max - b.min);
  // 가장 짧은 축을 높이로 본다 — scaleDimensions 와 같은 규칙이어야 두 결과가 어긋나지 않는다.
  const up = spans.indexOf(Math.min(...spans));
  const [a, b] = [0, 1, 2].filter((i) => i !== up) as [number, number];
  const spanA = spans[a]!;
  const spanB = spans[b]!;
  if (!(spanA > 0) || !(spanB > 0)) return undefined;

  const cellSize = Math.max(spanA, spanB) / (options.grid ?? planGridFor(valid.length));
  const cols = Math.max(1, Math.ceil(spanA / cellSize));
  const rows = Math.max(1, Math.ceil(spanB / cellSize));

  /**
   * 좌표 → 칸 번호. 잘라낸 범위를 벗어난 이상점은 버리고(-1), 범위 안이면 마지막 칸으로
   * 물린다. 경계에 **정확히** 걸린 점을 버리면 안 된다 — 벽면은 바로 그 경계에 몰려 있어서,
   * 버리는 순간 반대쪽 두 벽이 도면에서 통째로 사라진다.
   */
  const cellOf = (v: number, axis: number, n: number): number => {
    const { min, max } = bounds[axis]!;
    if (v < min || v > max) return -1;
    return Math.min(n - 1, Math.floor((v - min) / cellSize));
  };

  const counts = new Uint32Array(cols * rows);
  for (const p of valid) {
    const ca = cellOf(p[a]!, a, cols);
    const cb = cellOf(p[b]!, b, rows);
    if (ca < 0 || cb < 0) continue;
    counts[cb * cols + ca]! += 1;
  }

  // 점 하나만 찍힌 칸은 잡음이다. 점이 촘촘한 복원에서는 기준도 함께 올린다.
  const expected = valid.length / (cols * rows);
  const threshold = Math.max(2, Math.ceil(expected * 0.5));
  const wallCells: number[] = [];
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i]! >= threshold) wallCells.push(i);
  }
  if (wallCells.length === 0) return undefined;

  /**
   * 줄(행/열)마다 벽을 처음·마지막으로 만난 칸. 만나지 못한 줄은 [-1, -1].
   *
   * 벽이 하나도 안 잡힌 줄은 "여기가 비었다" 가 아니라 **"모른다"** 다. 카메라가 그 구간을
   * 안 비췄거나 민무늬 벽이라 점이 안 붙은 것뿐이다. 그런데 이걸 빈 줄로 처리하면 채우기가
   * 그 줄을 통째로 지워, 멀쩡한 공간 한복판에 띠 모양 구멍이 생긴다(검증에서 면적 -34%의
   * 원인이 정확히 이것이었다). 그래서 아래에서 이웃 줄로부터 이어 준다.
   */
  function spansAlong(
    lineCount: number,
    cellCount: number,
    at: (line: number, cell: number) => number,
  ) {
    const spans: Array<[number, number]> = [];
    for (let line = 0; line < lineCount; line += 1) {
      let lo = -1;
      let hi = -1;
      for (let cell = 0; cell < cellCount; cell += 1) {
        if (counts[at(line, cell)]! >= threshold) {
          if (lo < 0) lo = cell;
          hi = cell;
        }
      }
      spans.push([lo, hi]);
    }
    return spans;
  }

  /**
   * 벽을 못 만난 줄을 이웃에서 이어 준다. **바깥쪽 줄은 건드리지 않는다** — 처음 벽을 만난
   * 줄보다 앞, 마지막보다 뒤는 건물 밖이다. 사이에 낀 줄만 위아래 이웃 span 의 교집합으로
   * 채워, 없는 공간을 지어내지 않으면서 구멍도 만들지 않는다.
   * 이어 붙인 줄 수를 함께 돌려준다 — 추측으로 메운 양이 곧 도면을 못 믿을 근거다.
   */
  function bridgeSpans(spans: Array<[number, number]>): { bridged: number; evidence: number } {
    const first = spans.findIndex(([lo]) => lo >= 0);
    if (first < 0) return { bridged: 0, evidence: 0 };
    let last = spans.length - 1;
    while (last > first && spans[last]![0] < 0) last -= 1;

    let bridged = 0;
    let evidence = 0;
    for (let i = first; i <= last; i += 1) {
      if (spans[i]![0] >= 0) {
        evidence += 1;
        continue;
      }
      let prev = i - 1;
      while (prev >= first && spans[prev]![0] < 0) prev -= 1;
      let next = i + 1;
      while (next <= last && spans[next]![0] < 0) next += 1;
      const a = spans[prev]!;
      const b = spans[next]!;
      spans[i] = [Math.max(a[0], b[0]), Math.min(a[1], b[1])];
      bridged += 1;
    }
    return { bridged, evidence };
  }

  const rowSpans = spansAlong(rows, cols, (r, c) => r * cols + c);
  const colSpans = spansAlong(cols, rows, (c, r) => r * cols + c);
  const rowBridge = bridgeSpans(rowSpans);
  const colBridge = bridgeSpans(colSpans);

  const rowFill = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    const [lo, hi] = rowSpans[r]!;
    for (let c = lo; c >= 0 && c <= hi; c += 1) rowFill[r * cols + c] = 1;
  }
  const colFill = new Uint8Array(cols * rows);
  for (let c = 0; c < cols; c += 1) {
    const [lo, hi] = colSpans[c]!;
    for (let r = lo; r >= 0 && r <= hi; r += 1) colFill[r * cols + c] = 1;
  }

  // 근거율 = 벽을 실제로 만난 줄의 비율. 나머지는 이웃에서 추측해 메운 줄이다.
  const lines = rowBridge.bridged + rowBridge.evidence + colBridge.bridged + colBridge.evidence;
  const wallClosure = lines > 0 ? (rowBridge.evidence + colBridge.evidence) / lines : 0;

  const inside = new Uint8Array(cols * rows);
  const footprintCells: number[] = [];
  for (let i = 0; i < inside.length; i += 1) {
    if (rowFill[i] === 1 && colFill[i] === 1) {
      inside[i] = 1;
      footprintCells.push(i);
    }
  }
  if (footprintCells.length === 0) return undefined;

  // 둘레 = 내부 칸이 외부(또는 격자 밖)와 맞닿은 변의 개수.
  let perimeterEdges = 0;
  for (const i of footprintCells) {
    const c = i % cols;
    const r = (i - c) / cols;
    if (c === 0 || inside[i - 1] !== 1) perimeterEdges += 1;
    if (c === cols - 1 || inside[i + 1] !== 1) perimeterEdges += 1;
    if (r === 0 || inside[i - cols] !== 1) perimeterEdges += 1;
    if (r === rows - 1 || inside[i + cols] !== 1) perimeterEdges += 1;
  }

  return {
    cellSize,
    cols,
    rows,
    wallCells,
    footprintCells,
    perimeterEdges,
    upAxis: (['x', 'y', 'z'] as const)[up]!,
    wallClosure: Math.round(wallClosure * 100) / 100,
    reliability: planReliability(valid.length, wallClosure),
    trimmedExtent: {
      x: spans[0]!,
      y: spans[1]!,
      z: spans[2]!,
      diagonal: Math.hypot(spans[0]!, spans[1]!, spans[2]!),
    },
  };
}

/**
 * 면적을 견적에 넣어도 되는지 판정.
 *
 * 기준은 합성 검증에서 왔다. 같은 6×4 방(24㎡)을 잡음·이상점·미촬영 구간만 바꿔 재면:
 *   점 12,000 · 근거율 0.98 → 26.0㎡ (+8%)   쓸 수 있다
 *   점  2,194 · 근거율 0.89 → 19.9㎡ (-17%)  형상은 보이지만 금액 근거로는 못 쓴다
 *   점    800 · 근거율 0.92 → 8.8㎡  (-63%)  쓰면 안 된다
 *
 * 점이 적을수록 면적이 **작게** 나오는 쪽으로 무너진다(벽이 끊겨 윤곽이 안으로 말린다).
 * 과소 견적은 계약 뒤 추가정산 분쟁이 되므로 애매하면 쓰지 않는 쪽으로 판정한다.
 * 근거율만으로는 못 거른다 — 위 표에서 보듯 800점짜리도 0.92가 나온다. 점 개수가
 * 1차 기준이고 근거율은 보조다.
 */
function planReliability(pointCount: number, wallClosure: number): 'GOOD' | 'FAIR' | 'POOR' {
  if (pointCount >= 6000 && wallClosure >= 0.9) return 'GOOD';
  if (pointCount >= 1500 && wallClosure >= 0.7) return 'FAIR';
  return 'POOR';
}

export interface ScaledFloorPlan {
  /** 윤곽 기준 바닥면적(㎡) — 직사각형 가정 없이 실제 형상으로 낸 값. */
  floorAreaM2: number;
  /** 외곽선 길이(m) — 벽 철거 물량을 잡을 때 쓰는 둘레. */
  perimeterM: number;
  /** 칸 한 변(m) — 도면의 해상도. 이보다 작은 요철은 표현되지 않는다. */
  cellSizeM: number;
}

/** 평면도 격자를 미터로 환산한다. 기준 길이가 없으면 환산하지 않는다(근거 없는 미터는 안 붙인다). */
export function scaleFloorPlan(
  plan: FloorPlanGrid,
  metersPerUnit: number,
): ScaledFloorPlan | undefined {
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0) return undefined;
  const cellSizeM = plan.cellSize * metersPerUnit;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    floorAreaM2: r1(plan.footprintCells.length * cellSizeM * cellSizeM),
    perimeterM: r1(plan.perimeterEdges * cellSizeM),
    cellSizeM: Math.round(cellSizeM * 1000) / 1000,
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
