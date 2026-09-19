import { describe, expect, it } from 'vitest';
import { selectSharpest, type ExtractedFrame } from './videoFrames';

const f = (timeSec: number, sharpness: number): ExtractedFrame => ({
  base64: 'x', timeSec, sharpness,
});

describe('selectSharpest — 선명도와 시간 분포를 함께 본다', () => {
  it('요청 장수보다 적으면 그대로 돌려준다', () => {
    const fr = [f(0, 1), f(1, 2)];
    expect(selectSharpest(fr, 5)).toEqual(fr);
  });

  it('요청한 장수만큼 남긴다', () => {
    const fr = Array.from({ length: 40 }, (_, i) => f(i, i % 7));
    expect(selectSharpest(fr, 10)).toHaveLength(10);
  });

  it('구간별로 가장 선명한 프레임을 고른다', () => {
    // 4장을 2구간으로 → 각 구간 최댓값(2, 9)이 뽑혀야 한다.
    const fr = [f(0, 1), f(1, 2), f(2, 9), f(3, 3)];
    expect(selectSharpest(fr, 2).map((x) => x.sharpness)).toEqual([2, 9]);
  });

  it('선명도가 한쪽에 몰려도 시간 분포를 유지한다 — 한 구간에 몰리면 복원이 실패한다', () => {
    // 앞쪽 10장만 아주 선명하다. 상위만 고르면 전부 앞에서 뽑혀 삼각측량이 안 된다.
    const fr = Array.from({ length: 40 }, (_, i) => f(i, i < 10 ? 100 : 1));
    const picked = selectSharpest(fr, 8);
    const times = picked.map((x) => x.timeSec);
    expect(Math.max(...times)).toBeGreaterThan(25);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('시간 순서가 유지된다 — COLMAP sequential 매칭이 순서를 전제한다', () => {
    const fr = Array.from({ length: 30 }, (_, i) => f(i, Math.random()));
    const times = selectSharpest(fr, 10).map((x) => x.timeSec);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
