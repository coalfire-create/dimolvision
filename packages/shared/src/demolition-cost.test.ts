import { describe, expect, it } from 'vitest';
import {
  DIESEL_WON_PER_LITER,
  EQUIPMENT_RATES,
  LABOR_WON_PER_DAY,
  TREATMENT_WON_PER_TON,
  equipmentDailyWon,
  estimateDemolitionCost,
  formatWonShort,
  matchEquipment,
  matchEquipmentAll,
} from './demolition-cost.js';

describe('matchEquipment', () => {
  it('규격 표기가 달라도 같은 등급으로 모은다', () => {
    // 현장에서는 "06W" 와 "0.6㎥" 를 같은 장비로 부른다.
    expect(matchEquipment('굴착기', '0.6㎥')).toBe('EXCAVATOR_06');
    expect(matchEquipment('굴삭기 06W')).toBe('EXCAVATOR_06');
    expect(matchEquipment('포크레인', '02W 소형')).toBe('EXCAVATOR_02');
    expect(matchEquipment('굴착기', '1.0㎥ 대형')).toBe('EXCAVATOR_10');
  });

  it('부착장비가 적히면 그걸 달 굴착기를 먼저 센다', () => {
    // 압쇄기·브레이커는 혼자 움직이지 못한다. 단일 선택은 모기계를 돌려주고,
    // 부착장비까지 필요한 쪽은 matchEquipmentAll 을 쓴다.
    expect(matchEquipment('압쇄기', '굴착기 부착용')).toBe('EXCAVATOR_06');
    expect(matchEquipment('대형브레이커')).toBe('EXCAVATOR_06');
  });

  it('규격이 없으면 소규모 철거의 표준 장비로 본다', () => {
    expect(matchEquipment('굴착기')).toBe('EXCAVATOR_06');
  });

  it('모르는 장비는 undefined — 값을 지어내지 않는다', () => {
    expect(matchEquipment('타워크레인')).toBeUndefined();
    expect(matchEquipment('살수차')).toBeUndefined();
  });
});

describe('equipmentDailyWon', () => {
  it('손료·연료·잡재료·조종원을 모두 더한다', () => {
    const rate = EQUIPMENT_RATES.EXCAVATOR_06!;
    const fuel = 10.2 * DIESEL_WON_PER_LITER;
    const expected = Math.round(
      (23_423 + fuel + fuel * 0.22) * 8 + LABOR_WON_PER_DAY.건설기계운전사,
    );
    expect(equipmentDailyWon(rate)).toBe(expected);
  });

  it('부착장비는 조종원 노임이 붙지 않는다', () => {
    const pulverizer = EQUIPMENT_RATES.PULVERIZER_10!;
    expect(equipmentDailyWon(pulverizer)).toBe(18_857 * 8);
  });
});

describe('estimateDemolitionCost', () => {
  const base = {
    wasteByClass: [
      { wasteClass: 'CONCRETE' as const, estimatedKg: 80_000, separable: true },
      { wasteClass: 'WOOD' as const, estimatedKg: 5_000, separable: true },
      { wasteClass: 'MIXED' as const, estimatedKg: 10_000, separable: false },
    ],
    workDays: 5,
    crewSize: 4,
    equipment: [{ name: '굴착기', spec: '0.6㎥ 압쇄기 장착' }],
  };

  it('처리비·운반비·인건비·장비비와 간접비를 모두 낸다', () => {
    const r = estimateDemolitionCost(base);
    const keys = r.lines.map((l) => l.key);
    expect(keys).toContain('TREATMENT');
    expect(keys).toContain('TRANSPORT');
    expect(keys).toContain('LABOR');
    expect(keys).toContain('EQUIPMENT');
    expect(keys).toContain('SAFETY');
    expect(keys).toContain('PROFIT');
  });

  it('합계는 항상 하한 ≤ 상한이고 부가세가 10% 다', () => {
    const r = estimateDemolitionCost(base);
    expect(r.subtotalMinWon).toBeLessThanOrEqual(r.subtotalMaxWon);
    expect(r.totalMinWon).toBe(r.subtotalMinWon + r.vatMinWon);
    expect(Math.abs(r.vatMaxWon - r.subtotalMaxWon * 0.1)).toBeLessThan(1000);
  });

  it('분리배출에 실패하면 처리비 하한이 혼합 단가까지 올라간다', () => {
    const separable = estimateDemolitionCost({
      wasteByClass: [{ wasteClass: 'CONCRETE', estimatedKg: 100_000, separable: true }],
    });
    const mixed = estimateDemolitionCost({
      wasteByClass: [{ wasteClass: 'CONCRETE', estimatedKg: 100_000, separable: false }],
    });
    const lo = (r: ReturnType<typeof estimateDemolitionCost>) =>
      r.lines.find((l) => l.key === 'TREATMENT')!.minWon;
    // 폐콘크리트 29,396 → 건설폐재류 48,021 으로 뛴다. 분리배출이 돈이라는 게 숫자로 보여야 한다.
    expect(lo(mixed)).toBeGreaterThan(lo(separable));
  });

  it('석면이 있으면 석면 공사비를 합계에 넣지 않고 제외 항목으로 명시한다', () => {
    const r = estimateDemolitionCost({ ...base, hasAsbestos: true });
    expect(r.excluded[0]).toContain('석면조사비');
    const labor = r.lines.find((l) => l.key === 'LABOR')!;
    expect(labor.detail.some((d) => d.includes('석면해체공'))).toBe(true);
  });

  it('지정폐기물은 환경부 고시 단가를 그대로 쓴다', () => {
    const r = estimateDemolitionCost({
      wasteByClass: [{ wasteClass: 'DESIGNATED', estimatedKg: 2_000, separable: true }],
    });
    const treat = r.lines.find((l) => l.key === 'TREATMENT')!;
    // 2톤 × 645,000 = 1,290,000
    expect(treat.minWon).toBe(1_290_000);
    expect(treat.maxWon).toBe(1_290_000);
  });

  it('운반거리가 멀면 운반비가 올라간다', () => {
    const near = estimateDemolitionCost({ ...base, distanceKm: 30 });
    const far = estimateDemolitionCost({ ...base, distanceKm: 80 });
    const t = (r: ReturnType<typeof estimateDemolitionCost>) =>
      r.lines.find((l) => l.key === 'TRANSPORT')!.maxWon;
    expect(t(far)).toBeGreaterThan(t(near));
  });

  it('물량이 없으면 빈 견적 — 0원짜리 줄을 만들지 않는다', () => {
    const r = estimateDemolitionCost({ wasteByClass: [] });
    expect(r.lines).toHaveLength(0);
    expect(r.totalMaxWon).toBe(0);
  });

  it('공기·인원이 없으면 인건비·장비비를 빼고 나머지만 낸다', () => {
    const r = estimateDemolitionCost({ wasteByClass: base.wasteByClass, equipment: base.equipment });
    expect(r.lines.map((l) => l.key)).not.toContain('LABOR');
    expect(r.lines.map((l) => l.key)).not.toContain('EQUIPMENT');
    expect(r.lines.map((l) => l.key)).toContain('TREATMENT');
  });

  it('모든 줄에 검산할 수 있는 산출 근거가 붙는다', () => {
    const r = estimateDemolitionCost(base);
    for (const line of r.lines) {
      expect(line.detail.length).toBeGreaterThan(0);
    }
  });

  it('공표 단가가 없는 분류는 그 사실을 근거에 적는다', () => {
    const r = estimateDemolitionCost({
      wasteByClass: [{ wasteClass: 'WOOD', estimatedKg: 3_000, separable: true }],
    });
    const treat = r.lines.find((l) => l.key === 'TREATMENT')!;
    expect(treat.detail[0]).toContain('공표 단가 없음');
    expect(TREATMENT_WON_PER_TON.WOOD.published).toBe(false);
  });
});

describe('formatWonShort', () => {
  it('만·억 단위로 줄인다', () => {
    expect(formatWonShort(0)).toBe('0원');
    expect(formatWonShort(8_500)).toBe('8,500원');
    expect(formatWonShort(12_340_000)).toBe('1,234만원');
    expect(formatWonShort(250_000_000)).toBe('2.5억원');
  });
});

describe('matchEquipmentAll', () => {
  it('한 줄에 적힌 모기계와 부착장비를 모두 잡는다', () => {
    // 모델은 "중형 굴착기(압쇄기 부착)" 처럼 한 줄에 둘을 쓴다.
    // 압쇄기만 잡으면 그걸 달고 있는 굴착기가 통째로 빠져 장비비가 4분의 1이 된다.
    expect(matchEquipmentAll('중형 굴착기', '06W 급 압쇄기 부착')).toEqual([
      'EXCAVATOR_06',
      'PULVERIZER_10',
    ]);
  });

  it('부착장비만 적혀도 그걸 달 굴착기를 함께 센다', () => {
    expect(matchEquipmentAll('압쇄기')).toEqual(['EXCAVATOR_06', 'PULVERIZER_10']);
    expect(matchEquipmentAll('대형브레이커')).toEqual(['EXCAVATOR_06', 'BREAKER_07']);
  });

  it('규격 숫자가 없으면 크기 낱말로 등급을 잡는다', () => {
    expect(matchEquipmentAll('소형 굴착기 (스키드 로더)')).toEqual(['EXCAVATOR_02']);
    expect(matchEquipmentAll('대형 굴착기')).toEqual(['EXCAVATOR_10']);
  });

  it('철거 장비가 아니면 아무것도 세지 않는다', () => {
    expect(matchEquipmentAll('고소작업대', '15~20m 급 유압식')).toEqual([]);
    expect(matchEquipmentAll('살수차')).toEqual([]);
  });
});

describe('장비비 계상 규칙', () => {
  it('"대형브레이커" 의 크기 낱말을 모기계 등급으로 쓰지 않는다', () => {
    // '대형' 은 브레이커의 크기다. 이걸 굴착기 등급으로 읽으면 1.0㎥ 굴착기(87만원/일)가
    // 붙어 장비비가 크게 부풀었다.
    expect(matchEquipmentAll('대형브레이커', '굴삭기 부착')).toEqual([
      'EXCAVATOR_06',
      'BREAKER_07',
    ]);
  });

  it('굴착기가 여러 대여도 주력 1대만 전 기간으로 잡는다', () => {
    const one = estimateDemolitionCost({
      wasteByClass: [{ wasteClass: 'CONCRETE', estimatedKg: 100_000, separable: true }],
      workDays: 10,
      crewSize: 4,
      equipment: [{ name: '굴착기', spec: '0.6㎥' }],
    });
    const three = estimateDemolitionCost({
      wasteByClass: [{ wasteClass: 'CONCRETE', estimatedKg: 100_000, separable: true }],
      workDays: 10,
      crewSize: 4,
      equipment: [
        { name: '굴착기', spec: '0.6㎥' },
        { name: '굴착기', spec: '0.2㎥' },
        { name: '굴착기', spec: '1.0㎥' },
      ],
    });
    const eq = (r: ReturnType<typeof estimateDemolitionCost>) =>
      r.lines.find((l) => l.key === 'EQUIPMENT')!.maxWon;
    // 세 대여도 두 대는 보조(공기의 30%)로만 붙으므로 세 배가 되지 않는다.
    expect(eq(three)).toBeLessThan(eq(one) * 2);
    expect(eq(three)).toBeGreaterThan(eq(one));
  });

  it('철거 장비가 하나도 안 잡히면 장비비 줄을 만들지 않는다', () => {
    const r = estimateDemolitionCost({
      wasteByClass: [{ wasteClass: 'CONCRETE', estimatedKg: 10_000, separable: true }],
      workDays: 3,
      crewSize: 3,
      equipment: [{ name: '고소작업대', spec: '10m' }],
    });
    expect(r.lines.map((l) => l.key)).not.toContain('EQUIPMENT');
  });
});
