import { describe, expect, it } from 'vitest';
import { MAX_ROOM_AREA_M2, roomAreaM2, sumRoomAreaM2 } from './estimation.js';

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

describe('평면도 윤곽 면적(areaM2) 우선', () => {
  it('면적이 있으면 가로×세로 대신 그 값을 쓴다 — 꺾인 공간은 곱셈이 과대하다', () => {
    // L자 공간: 바운딩 6×4=24㎡ 지만 평면도로 잰 실제 윤곽은 18.4㎡.
    const room = { name: '거실', lengthM: 6, widthM: 4, areaM2: 18.4 };
    expect(roomAreaM2(room)).toBe(18.4);
    expect(sumRoomAreaM2([room])).toBe(18.4);
  });

  it('면적이 없으면 가로×세로로 돌아간다', () => {
    expect(roomAreaM2({ name: '방', lengthM: 5, widthM: 4 })).toBe(20);
  });

  it('면적과 가로×세로가 섞여 있어도 합계가 맞는다', () => {
    const total = sumRoomAreaM2([
      { name: '거실', lengthM: 6, widthM: 4, areaM2: 18.4 },
      { name: '주방', lengthM: 3, widthM: 2 },
    ]);
    expect(total).toBe(24.4); // 18.4 + 6
  });

  it('면적이 0 이하·숫자가 아니면 그 방을 버린다 — 가로×세로로 몰래 대체하지 않는다', () => {
    expect(roomAreaM2({ name: '방', lengthM: 5, widthM: 4, areaM2: 0 })).toBeUndefined();
    expect(roomAreaM2({ name: '방', lengthM: 5, widthM: 4, areaM2: Number.NaN })).toBeUndefined();
    expect(sumRoomAreaM2([{ name: '방', lengthM: 5, widthM: 4, areaM2: -3 }])).toBe(0);
  });

  it('가로·세로가 없어도 면적만으로 인정한다', () => {
    expect(sumRoomAreaM2([{ name: '거실', lengthM: 0, widthM: 0, areaM2: 12.5 }])).toBe(12.5);
  });

  it('면적도 상한을 넘으면 오타로 보고 건너뛴다', () => {
    expect(
      sumRoomAreaM2([{ name: '방', lengthM: 4, widthM: 5, areaM2: MAX_ROOM_AREA_M2 + 1 }]),
    ).toBe(0);
  });
});
