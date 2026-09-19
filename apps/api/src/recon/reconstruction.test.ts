import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_RECON_FRAMES,
  ReconstructionClient,
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
