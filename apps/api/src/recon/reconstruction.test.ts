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

describe('buildFloorPlan — 점군을 평면도로', () => {
  it('직사각형 방은 가로×세로 면적을 되찾는다', () => {
    // 6m × 4m 방(높이 2.4m). 벽에만 점이 있고 속은 비어 있다.
    const plan = buildFloorPlan(wallPoints([{ x0: 0, y0: 0, x1: 6, y1: 4 }]))!;
    expect(plan).toBeDefined();
    expect(plan.upAxis).toBe('z'); // 높이(2.4)가 가장 짧다
    expect(planArea(plan)).toBeCloseTo(24, 0);
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
    expect(plan.perimeterEdges * plan.cellSize).toBeCloseTo(20, 0);
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
    expect(planArea(buildFloorPlan(pts)!)).toBeCloseTo(24, 0);
  });
});

describe('scaleFloorPlan — 평면도를 미터로', () => {
  const plan = buildFloorPlan(wallPoints([{ x0: 0, y0: 0, x1: 6, y1: 4 }]))!;

  it('1단위=1m 이면 격자 면적이 그대로 ㎡ 다', () => {
    const s = scaleFloorPlan(plan, 1)!;
    expect(s.floorAreaM2).toBeCloseTo(24, 0);
    expect(s.perimeterM).toBeCloseTo(20, 0);
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
