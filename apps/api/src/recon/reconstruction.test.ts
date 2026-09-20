import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_RECON_FRAMES,
  ReconstructionClient,
  findMissingSegments,
  reconQuality,
  scaleDimensions,
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
    expect(scaleDimensions({ x: 0, y: 0, z: 0, diagonal: 0 }, { axis: 'x', realMeters: 10 })).toBeUndefined();
  });
});

describe('reconQuality — 결과를 믿어도 되는지', () => {
  const mk = (registered: number, total: number, points: number): ReconstructionResult => ({
    ok: true, registeredImages: registered, totalImages: total, pointCount: points,
    extent, cameraPathLength: 5, points: [], cameras: [], elapsedSec: 10,
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
    // 이 사례의 1차 원인은 장수다(28장). 촬영 방식을 지적하기 전에 그걸 먼저 말해야
    // 사용자가 실제로 고칠 수 있다.
    expect(q.advice).toMatch(/28장|계속 걸으며/);
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
  const client = () => new ReconstructionClient({ baseUrl: 'https://recon.example', timeoutMs: 5000 });

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
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, json: async () => ({ stage: 'mapper', log: '매칭 부족' }),
    })));
    const r = await client().reconstruct(Array(20).fill('x'));
    expect(r).toMatchObject({ ok: false, stage: 'mapper' });
  });

  it('네트워크 실패도 예외 대신 실패 객체로 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
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

describe('reconQuality — 실패 원인을 숫자로 가른다', () => {
  const base = {
    ok: true as const, extent: { x: 1, y: 1, z: 1, diagonal: 1.7 },
    cameraPathLength: 1, points: [], cameras: [], elapsedSec: 10,
  };

  it('프레임이 적으면 장수를 먼저 지적한다', () => {
    const q = reconQuality({ ...base, registeredImages: 4, totalImages: 28, pointCount: 125 });
    expect(q.level).toBe('POOR');
    expect(q.advice).toContain('28장');
    expect(q.advice).toContain('계속 걸으며');
  });

  it('정합은 됐는데 점이 없으면 무늬 문제로 안내한다', () => {
    // 제대로 걸었는데 민무늬 벽만 담은 경우. 여기서 "제자리에서 돌렸다" 고 하면 틀린 지적이다.
    const q = reconQuality({ ...base, registeredImages: 45, totalImages: 60, pointCount: 300 });
    expect(q.advice).toContain('무늬');
    expect(q.advice).not.toContain('제자리에서 돌기만');
  });

  it('정합 자체가 안 되면 겹침·시차를 지적한다', () => {
    const q = reconQuality({ ...base, registeredImages: 8, totalImages: 60, pointCount: 200 });
    expect(q.advice).toContain('8장만 이어졌습니다');
    expect(q.advice).toContain('옆으로 이동');
  });
});

describe('findMissingSegments — 어느 구간을 다시 찍어야 하는가', () => {
  const times = Array.from({ length: 12 }, (_, i) => i * 0.5); // 0.0 ~ 5.5초

  it('연속으로 빠진 구간을 시각으로 돌려준다', () => {
    // 0~3 은 이어졌고 4·5·6 이 빠졌고 7~11 은 이어졌다.
    const names = ['0000.jpg', '0001.jpg', '0002.jpg', '0003.jpg',
                   '0007.jpg', '0008.jpg', '0009.jpg', '0010.jpg', '0011.jpg'];
    const segs = findMissingSegments(names, times);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ fromSec: 2, toSec: 3, frames: 3 });
  });

  it('한두 장 빠진 건 알리지 않는다 — 경고가 흔해지면 묻힌다', () => {
    const names = times.map((_, i) => `${String(i).padStart(4, '0')}.jpg`).filter((_, i) => i !== 5);
    expect(findMissingSegments(names, times)).toHaveLength(0);
  });

  it('여러 구간이 끊기면 모두 낸다', () => {
    const names = ['0000.jpg', '0001.jpg', '0005.jpg', '0006.jpg', '0011.jpg'];
    const segs = findMissingSegments(names, times);
    expect(segs).toHaveLength(2);
    expect(segs[0].frames).toBe(3);   // 2,3,4
    expect(segs[1].frames).toBe(4);   // 7,8,9,10
  });

  it('등록 정보가 없으면 아무 말도 하지 않는다 — 추측하지 않는다', () => {
    expect(findMissingSegments(undefined, times)).toEqual([]);
    expect(findMissingSegments([], times)).toEqual([]);
  });
});
