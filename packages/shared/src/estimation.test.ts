import { describe, expect, it } from 'vitest';
import { MAX_ROOM_AREA_M2, sumRoomAreaM2 } from './estimation.js';

describe('sumRoomAreaM2 — 방 단위 실측 합계', () => {
  it('길이×폭을 더해 소수 1자리로 준다', () => {
    const total = sumRoomAreaM2([
      { name: '거실', lengthM: 5, widthM: 4 },
      { name: '방1', lengthM: 3, widthM: 3 },
    ]);
    expect(total).toBe(29); // 20 + 9
  });

  it('빈 목록은 0', () => {
    expect(sumRoomAreaM2([])).toBe(0);
  });

  it('길이·폭이 0 이하이거나 숫자가 아니면 그 방은 건너뛴다', () => {
    const total = sumRoomAreaM2([
      { name: '정상', lengthM: 4, widthM: 5 },
      { name: '0값', lengthM: 0, widthM: 5 },
      { name: '음수', lengthM: 3, widthM: -2 },
      { name: 'NaN', lengthM: Number.NaN, widthM: 3 },
    ]);
    expect(total).toBe(20);
  });

  it('한 방이 상한을 넘으면 오타로 보고 그 방만 건너뛴다', () => {
    const total = sumRoomAreaM2([
      { name: '정상', lengthM: 4, widthM: 5 },
      { name: '오타(cm를 m로)', lengthM: 500, widthM: 400 }, // 200,000㎡ — MAX_ROOM_AREA_M2 초과
    ]);
    expect(total).toBe(20);
    expect(500 * 400).toBeGreaterThan(MAX_ROOM_AREA_M2);
  });
});
