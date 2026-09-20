import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_RECON_FRAMES,
  ReconstructionClient,
  buildFloorPlan,
  reconQuality,
  scaleDimensions,
  scaleFloorPlan,
  type FloorPlanGrid,
  type ReconExtent,
  type ReconstructionResult,
} from './reconstruction.js';

const extent: ReconExtent = { x: 10, y: 6, z: 3, diagonal: 12.04 };

describe('scaleDimensions — 단위 없는 좌표를 미터로', () => {
  it('기준 축 길이로 전체를 환산한다', () => {
    // x=10 단위가 실제 20m → 1단위 = 2m
    const d = scaleDimensions(extent, { axis: 'x', realMeters: 20 })!;
    expect(d.metersPerUnit).toBe(2);
    expect(d.widthM).toBe(20);
    expect(d.depthM).toBe(12);
    expect(d.heightM).toBe(6);
    expect(d.floorAreaM2).toBe(240);
    expect(d.volumeM3).toBe(1440);
  });

  it('가장 짧은 축을 높이로 본다 — 실내는 대개 높이가 가장 짧다', () => {
    const d = scaleDimensions({ x: 3, y: 12, z: 8, diagonal: 15 }, { axis: 'y', realMeters: 12 })!;
    expect(d.widthM).toBeGreaterThanOrEqual(d.depthM);
    expect(d.depthM).toBeGreaterThanOrEqual(d.heightM);
    expect(d.heightM).toBe(3);
  });

  it('대각선을 기준으로도 환산한다', () => {
    const d = scaleDimensions(extent, { axis: 'diagonal', realMeters: 24.08 })!;
    expect(d.metersPerUnit).toBeCloseTo(2, 3);
  });

  it('기준이 잘못되면 환산하지 않는다 — 억지로 숫자를 내면 안 된다', () => {
    expect(scaleDimensions(extent, { axis: 'x', realMeters: 0 })).toBeUndefined();
    expect(scaleDimensions(extent, { axis: 'x', realMeters: -5 })).toBeUndefined();
    expect(
      scaleDimensions({ x: 0, y: 0, z: 0, diagonal: 0 }, { axis: 'x', realMeters: 10 }),
    ).toBeUndefined();
  });
});

describe('reconQuality — 결과를 믿어도 되는지', () => {
  const mk = (registered: number, total: number, points: number): ReconstructionResult => ({
    ok: true,
    registeredImages: registered,
    totalImages: total,
    pointCount: points,
    extent,
    cameraPathLength: 5,
    points: [],
    cameras: [],
    elapsedSec: 10,
  });

  it('대부분 등록되고 점이 충분하면 GOOD', () => {
    expect(reconQuality(mk(28, 30, 12000)).level).toBe('GOOD');
  });

  it('실측 성공 사례(27/60 · 2194점)는 FAIR — 쓸 수 있는 결과다', () => {
    const q = reconQuality(mk(27, 60, 2194));
    expect(q.level).toBe('FAIR');
    expect(q.advice).toContain('제자리');
  });

  it('실측 실패 사례(4/28 · 125점)는 POOR', () => {
    const q = reconQuality(mk(4, 28, 125));
    expect(q.level).toBe('POOR');
    expect(q.advice).toMatch(/제자리|이동/);
  });

  it('정합률이 낮아도 점이 충분하면 FAIR — 제자리 회전 구간이 비율을 깎을 뿐이다', () => {
    expect(reconQuality(mk(27, 112, 2161)).level).toBe('FAIR');
  });

  it('한 장도 등록 못 하면 POOR', () => {
    expect(reconQuality(mk(0, 30, 0)).level).toBe('POOR');
  });
});

describe('ReconstructionClient', () => {
  afterEach(() => vi.unstubAllGlobals());
  const client = () =>
    new ReconstructionClient({ baseUrl: 'https://recon.example', timeoutMs: 5000 });

  it('프레임이 부족하면 서버를 부르지 않는다', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await client().reconstruct(Array(MIN_RECON_FRAMES - 1).fill('x'));
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('상한을 넘는 프레임은 잘라 보낸다', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', f);
    await client().reconstruct(Array(100).fill('x'));
    const body = JSON.parse(f.mock.calls[0]?.[1]?.body as string);
    expect(body.frames.length).toBeLessThanOrEqual(64);
    // 손 촬영은 인접 프레임 겹침이 들쭉날쭉해 sequential 로는 쌍을 놓친다(실측 4/28 → 27/60).
    expect(body.matcher).toBe('exhaustive');
  });

  it('서버 오류는 단계와 함께 실패로 돌려준다 — 분석을 막지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ stage: 'mapper', log: '매칭 부족' }),
      })),
    );
    const r = await client().reconstruct(Array(20).fill('x'));
    expect(r).toMatchObject({ ok: false, stage: 'mapper' });
  });

  it('네트워크 실패도 예외 대신 실패 객체로 돌려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    const r = await client().reconstruct(Array(20).fill('x'));
    expect(r).toMatchObject({ ok: false, stage: 'network' });
  });
});

describe('scaleDimensions — 사람이 아는 축 이름', () => {
  // COLMAP 축은 중력 방향을 모른다. 사용자가 x·y·z 중 무엇이 높이인지 알 방법이 없으므로
  // "가장 짧은 축 = 층고" 처럼 사람이 아는 말로 기준을 받을 수 있어야 한다.
  const extent = { x: 4, y: 2, z: 8, diagonal: 9.17 };

  it('shortest 는 가장 짧은 축을 기준으로 잡는다', () => {
    // y(2단위) = 2.4m → 1단위 = 1.2m → 축들은 4.8 / 2.4 / 9.6m
    const d = scaleDimensions(extent, { axis: 'shortest', realMeters: 2.4 })!;
    expect(d.metersPerUnit).toBeCloseTo(1.2, 5);
    expect(d.heightM).toBeCloseTo(2.4, 1);
    expect(d.widthM).toBeCloseTo(9.6, 1);
  });

  it('longest 는 가장 긴 축을 기준으로 잡는다', () => {
    // z(8단위) = 16m → 1단위 = 2m
    const d = scaleDimensions(extent, { axis: 'longest', realMeters: 16 })!;
    expect(d.metersPerUnit).toBeCloseTo(2, 5);
    expect(d.heightM).toBeCloseTo(4, 1);
  });

  it('같은 현장을 두 기준으로 재도 비율은 그대로다', () => {
    const a = scaleDimensions(extent, { axis: 'shortest', realMeters: 2.4 })!;
    const b = scaleDimensions(extent, { axis: 'longest', realMeters: 9.6 })!;
    expect(a.volumeM3).toBeCloseTo(b.volumeM3, 0);
  });
});

/**
 * 합성 점군 — 벽면에 점을 흩뿌린다. 실제 COLMAP 결과처럼 벽에 점이 몰리고
 * 바닥·천장은 비는 경우를 재현해, 평면도가 그 윤곽을 되찾는지 본다.
 */
function wallPoints(
  rects: Array<{ x0: number; y0: number; x1: number; y1: number }>,
  opts: { height?: number; perSide?: number } = {},
): number[][] {
  const height = opts.height ?? 2.4;
  const perSide = opts.perSide ?? 500;
  const out: number[][] = [];
  for (const r of rects) {
    for (let i = 0; i < perSide; i += 1) {
      const t = i / (perSide - 1);
      const z = (i % 7) * (height / 7); // 여러 높이에 흩뿌린다
      out.push([r.x0 + (r.x1 - r.x0) * t, r.y0, z]);
      out.push([r.x0 + (r.x1 - r.x0) * t, r.y1, z]);
      out.push([r.x0, r.y0 + (r.y1 - r.y0) * t, z]);
      out.push([r.x1, r.y0 + (r.y1 - r.y0) * t, z]);
    }
  }
  return out;
}

/** 격자 칸 수 → 면적(복원 단위²). 기준 길이가 1단위=1m 인 합성 데이터라 그대로 ㎡ 다. */
function planArea(plan: FloorPlanGrid): number {
  return plan.footprintCells.length * plan.cellSize * plan.cellSize;
}

/**
 * 평면도 면적은 격자 해상도만큼 무디다 — 칸 단위로 끊어 세므로 가장자리에서 반 칸씩
 * 남거나 모자란다. 정확한 일치가 아니라 **쓸 수 있는 오차 안인지**로 본다(±10%).
 * 이보다 조이면 격자 칸 수를 바꿀 때마다 테스트가 깨지면서 정작 정확도는 보지 못한다.
 */
function expectAreaNear(actual: number, truth: number) {
  expect(actual).toBeGreaterThan(truth * 0.9);
  expect(actual).toBeLessThan(truth * 1.1);
}

describe('buildFloorPlan — 점군을 평면도로', () => {
  it('직사각형 방은 가로×세로 면적을 되찾는다', () => {
    // 6m × 4m 방(높이 2.4m). 벽에만 점이 있고 속은 비어 있다.
    const plan = buildFloorPlan(wallPoints([{ x0: 0, y0: 0, x1: 6, y1: 4 }]))!;
    expect(plan).toBeDefined();
    expect(plan.upAxis).toBe('z'); // 높이(2.4)가 가장 짧다
    expectAreaNear(planArea(plan), 24);
  });

  it('L자 공간은 바운딩박스가 삼키는 빈 구역을 빼낸다', () => {
    // 6×4 에서 3×2 를 덜어낸 L자 → 실제 18㎡. 바운딩박스로 재면 24㎡ 로 33% 과대다.
    const plan = buildFloorPlan(
      wallPoints([
        { x0: 0, y0: 0, x1: 6, y1: 2 }, // 아래 가로 바
        { x0: 0, y0: 0, x1: 3, y1: 4 }, // 왼쪽 세로 바
      ]),
    )!;
    const area = planArea(plan);
    expect(area).toBeGreaterThan(15);
    expect(area).toBeLessThan(21); // 바운딩박스(24)보다 확실히 조인다
  });

  it('둘레는 내부 칸의 외곽선 길이로 나온다', () => {
    const plan = buildFloorPlan(wallPoints([{ x0: 0, y0: 0, x1: 6, y1: 4 }]))!;
    // 6×4 방의 둘레는 20m. 칸 단위 외곽선 × 칸 크기로 환산해 비교한다.
    expectAreaNear(plan.perimeterEdges * plan.cellSize, 20);
  });

  it('가장 짧은 축을 높이로 본다 — scaleDimensions 와 같은 규칙', () => {
    // x 를 가장 짧게(2.4) 두면 x 가 높이로 잡혀야 한다.
    const pts = wallPoints([{ x0: 0, y0: 0, x1: 6, y1: 4 }]).map(([x, y, z]) => [z!, x!, y!]);
    expect(buildFloorPlan(pts)!.upAxis).toBe('x');
  });

  it('점이 너무 적으면 도면을 만들지 않는다 — 잡음으로 형상을 지어내지 않는다', () => {
    expect(buildFloorPlan([])).toBeUndefined();
    expect(
      buildFloorPlan(wallPoints([{ x0: 0, y0: 0, x1: 6, y1: 4 }], { perSide: 5 })),
    ).toBeUndefined();
  });

  it('한 점에 뭉친 점군(퍼짐 0)은 도면이 되지 않는다', () => {
    const same = Array.from({ length: 400 }, () => [1, 1, 1]);
    expect(buildFloorPlan(same)).toBeUndefined();
  });

  it('좌표에 NaN 이 섞여도 유효한 점만으로 계산한다', () => {
    const pts = wallPoints([{ x0: 0, y0: 0, x1: 6, y1: 4 }]);
    pts.push([Number.NaN, 2, 1], [3, Number.POSITIVE_INFINITY, 1]);
    expectAreaNear(planArea(buildFloorPlan(pts)!), 24);
  });
});

describe('scaleFloorPlan — 평면도를 미터로', () => {
  const plan = buildFloorPlan(wallPoints([{ x0: 0, y0: 0, x1: 6, y1: 4 }]))!;

  it('1단위=1m 이면 격자 면적이 그대로 ㎡ 다', () => {
    const s = scaleFloorPlan(plan, 1)!;
    expectAreaNear(s.floorAreaM2, 24);
    expectAreaNear(s.perimeterM, 20);
  });

  it('배율이 2배면 면적은 4배다', () => {
    const one = scaleFloorPlan(plan, 1)!;
    const two = scaleFloorPlan(plan, 2)!;
    expect(two.floorAreaM2).toBeCloseTo(one.floorAreaM2 * 4, 0);
    expect(two.perimeterM).toBeCloseTo(one.perimeterM * 2, 0);
  });

  it('기준이 잘못되면 환산하지 않는다', () => {
    expect(scaleFloorPlan(plan, 0)).toBeUndefined();
    expect(scaleFloorPlan(plan, -1)).toBeUndefined();
    expect(scaleFloorPlan(plan, Number.NaN)).toBeUndefined();
  });
});

describe('buildFloorPlan — 성긴 복원에서도 무너지지 않는가', () => {
  /** 실제 촬영에 가까운 점군: 위치 잡음 + 이상점 + 안 찍힌 구간 + 벽별 커버리지 편차. */
  function noisyRoom(opts: { total: number; noiseSd: number; outlierPct: number; gapPct: number }) {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const gauss = (sd: number) => (rnd() + rnd() + rnd() + rnd() + rnd() + rnd() - 3) * sd;
    // 6×4 방. 위 벽은 빨리 지나가 점이 적다 — 손으로 찍으면 벽마다 커버리지가 다르다.
    const walls = [
      { x0: 0, y0: 0, x1: 6, y1: 0, weight: 1.0 },
      { x0: 0, y0: 4, x1: 6, y1: 4, weight: 0.35 },
      { x0: 0, y0: 0, x1: 0, y1: 4, weight: 0.8 },
      { x0: 6, y0: 0, x1: 6, y1: 4, weight: 0.6 },
    ];
    const wsum = walls.reduce((s, w) => s + w.weight, 0);
    const pts: number[][] = [];
    const nOutlier = Math.round(opts.total * opts.outlierPct);
    for (const w of walls) {
      const n = Math.round(((opts.total - nOutlier) * w.weight) / wsum);
      for (let i = 0; i < n; i += 1) {
        const t = rnd();
        if (t > 0.4 && t < 0.4 + opts.gapPct) continue; // 안 찍힌 구간
        pts.push([
          w.x0 + (w.x1 - w.x0) * t + gauss(opts.noiseSd),
          w.y0 + (w.y1 - w.y0) * t + gauss(opts.noiseSd),
          rnd() * 2.4 + gauss(opts.noiseSd),
        ]);
      }
    }
    for (let i = 0; i < nOutlier; i += 1)
      pts.push([-2 + rnd() * 10, -2 + rnd() * 8, -1 + rnd() * 5]);
    return pts;
  }

  const dense = { total: 12000, noiseSd: 0.03, outlierPct: 0.03, gapPct: 0.05 };
  const sparse = { total: 2194, noiseSd: 0.06, outlierPct: 0.08, gapPct: 0.15 };
  const bad = { total: 800, noiseSd: 0.12, outlierPct: 0.15, gapPct: 0.3 };

  it('점이 많으면 격자를 잘게, 적으면 성기게 잡는다 — 칸당 밀도를 지켜야 벽이 안 끊긴다', () => {
    const fine = buildFloorPlan(noisyRoom(dense))!;
    const coarse = buildFloorPlan(noisyRoom(sparse))!;
    expect(fine.cols).toBeGreaterThan(coarse.cols);
    expect(coarse.cellSize).toBeGreaterThan(fine.cellSize);
  });

  it('벽이 안 잡힌 줄이 공간 한복판에 구멍을 내지 않는다', () => {
    // 양쪽 벽의 같은 구간이 안 찍히면 그 줄엔 벽 증거가 없다. 이웃에서 이어 주지 않으면
    // 멀쩡한 방 한가운데가 띠 모양으로 잘려 나간다(고치기 전 실제 증상).
    const plan = buildFloorPlan(noisyRoom(sparse))!;
    const inside = new Set(plan.footprintCells);
    let holes = 0;
    for (let r = 1; r < plan.rows - 1; r += 1) {
      for (let c = 1; c < plan.cols - 1; c += 1) {
        const i = r * plan.cols + c;
        if (inside.has(i)) continue;
        // 위아래·좌우가 모두 내부인데 자기만 비었다면 구멍이다.
        const surrounded =
          inside.has(i - plan.cols) &&
          inside.has(i + plan.cols) &&
          inside.has(i - 1) &&
          inside.has(i + 1);
        if (surrounded) holes += 1;
      }
    }
    expect(holes).toBe(0);
  });

  it('점이 넉넉하면 GOOD — 면적을 견적에 쓸 수 있다', () => {
    const plan = buildFloorPlan(noisyRoom(dense))!;
    expect(plan.reliability).toBe('GOOD');
    expectAreaNear(planArea(plan), 24);
  });

  it('현장 실측 수준(2,194점)은 GOOD 이 아니다 — 견적에 넣지 않는다', () => {
    // 형상은 보이지만 오차가 두 자릿수다(검증: 배율까지 먹이면 -17%). 금액 근거로 쓰면 안 된다.
    expect(buildFloorPlan(noisyRoom(sparse))!.reliability).not.toBe('GOOD');
  });

  it('나쁜 촬영은 POOR', () => {
    expect(buildFloorPlan(noisyRoom(bad))!.reliability).toBe('POOR');
  });

  it('근거율은 추측으로 메운 줄이 많을수록 낮아진다', () => {
    const plan = buildFloorPlan(noisyRoom(sparse))!;
    expect(plan.wallClosure).toBeGreaterThan(0);
    expect(plan.wallClosure).toBeLessThanOrEqual(1);
  });
});
