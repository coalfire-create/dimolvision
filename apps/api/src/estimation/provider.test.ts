import {
  DEMOLITION_TON_PER_M2,
  ESTIMATE_RANGE_RATIO,
  ESTIMATE_RANGE_RATIO_MEASURED,
  STRUCTURE_FACTORS,
  m2ToPyeong,
  pyeongToM2,
} from '@dimol/shared';
import { describe, expect, it } from 'vitest';
import { EstimationValidationError, HeuristicVolumeEstimator } from './provider.js';

const estimator = new HeuristicVolumeEstimator();

describe('HeuristicVolumeEstimator — 원단위 물량 추정 (AI 연동 전 목)', () => {
  it('연면적 × 원단위 × 구조 보정, 소수 1자리', async () => {
    const result = await estimator.estimate({ floorAreaM2: 100, structure: 'RC' });
    expect(result.estimatedTons).toBe(
      Math.round(100 * DEMOLITION_TON_PER_M2 * STRUCTURE_FACTORS.RC * 10) / 10,
    );
    expect(result.method).toBe('AREA_HEURISTIC');
    expect(result.confidence).toBe('MEDIUM');
    expect(result.disclaimer).toContain('참고 추정치');
  });

  it('구조 미지정이면 보정 없이 신뢰도 LOW', async () => {
    const result = await estimator.estimate({ floorAreaM2: 50 });
    // 구조 미지정 → 보정계수 1.0. 원단위 상수에서 파생(하드코딩 금지).
    expect(result.estimatedTons).toBe(Math.round(50 * DEMOLITION_TON_PER_M2 * 10) / 10);
    expect(result.confidence).toBe('LOW');
  });

  it('목조는 철근콘크리트보다 적게 추정된다', async () => {
    const wood = await estimator.estimate({ floorAreaM2: 100, structure: 'WOOD' });
    const rc = await estimator.estimate({ floorAreaM2: 100, structure: 'RC' });
    expect(wood.estimatedTons).toBeLessThan(rc.estimatedTons);
  });

  it('연면적 누락·0 이하·잘못된 구조 거부', async () => {
    expect(() => estimator.estimate({})).toThrow(EstimationValidationError);
    expect(() => estimator.estimate({ floorAreaM2: 0 })).toThrow(EstimationValidationError);
    expect(() => estimator.estimate({ floorAreaM2: 10, structure: 'STEEL' as never })).toThrow(
      EstimationValidationError,
    );
  });

  describe('층수(floors)', () => {
    it('층수를 주면 바닥면적 × 층수를 연면적으로 쓴다', async () => {
      const oneFloor = await estimator.estimate({ floorAreaM2: 100 });
      const threeFloors = await estimator.estimate({ floorAreaM2: 100, floors: 3 });
      expect(threeFloors.floorAreaM2).toBe(300);
      expect(threeFloors.estimatedTons).toBe(Math.round(oneFloor.estimatedTons * 3 * 10) / 10);
    });

    it('층수 미지정은 1층과 동일(연면적 그대로)', async () => {
      const none = await estimator.estimate({ floorAreaM2: 80, structure: 'RC' });
      const one = await estimator.estimate({ floorAreaM2: 80, floors: 1, structure: 'RC' });
      expect(none.estimatedTons).toBe(one.estimatedTons);
      expect(none.floorAreaM2).toBe(80);
    });

    it('0층·소수 층수·과도한 층수는 거부', async () => {
      expect(() => estimator.estimate({ floorAreaM2: 10, floors: 0 })).toThrow(
        EstimationValidationError,
      );
      expect(() => estimator.estimate({ floorAreaM2: 10, floors: 1.5 })).toThrow(
        EstimationValidationError,
      );
      expect(() => estimator.estimate({ floorAreaM2: 10, floors: 999 })).toThrow(
        EstimationValidationError,
      );
    });

    it('연면적 상한을 넘는 입력(오타 방지)은 거부', async () => {
      expect(() => estimator.estimate({ floorAreaM2: 90_000, floors: 10 })).toThrow(
        EstimationValidationError,
      );
    });
  });

  describe('추정 범위', () => {
    it('중앙값을 감싸고, 구조를 주면 범위가 좁아진다', async () => {
      const loose = await estimator.estimate({ floorAreaM2: 100 });
      const tight = await estimator.estimate({ floorAreaM2: 100, structure: 'RC' });

      expect(loose.rangeMinTons).toBeLessThan(loose.estimatedTons);
      expect(loose.rangeMaxTons).toBeGreaterThan(loose.estimatedTons);

      // RC 보정계수는 1.0 이라 중앙값은 같고 범위 폭만 절반이 된다.
      expect(tight.estimatedTons).toBe(loose.estimatedTons);
      const looseWidth = loose.rangeMaxTons - loose.rangeMinTons;
      const tightWidth = tight.rangeMaxTons - tight.rangeMinTons;
      expect(tightWidth).toBeLessThan(looseWidth);
    });

    it('범위 폭은 설정된 비율을 따른다', async () => {
      const r = await estimator.estimate({ floorAreaM2: 100 });
      expect(r.rangeMinTons).toBeCloseTo(r.estimatedTons * (1 - ESTIMATE_RANGE_RATIO), 1);
      expect(r.rangeMaxTons).toBeCloseTo(r.estimatedTons * (1 + ESTIMATE_RANGE_RATIO), 1);
    });
  });

  describe('방 단위 실측(measured) — 부분 철거', () => {
    it('measured 이면 method 가 ROOM_MEASUREMENT 다', async () => {
      const r = await estimator.estimate({ floorAreaM2: 30, measured: true });
      expect(r.method).toBe('ROOM_MEASUREMENT');
      expect(r.floorAreaM2).toBe(30);
    });

    it('measured 는 floors 를 무시한다 — 실측 합계가 이미 전체 범위다', async () => {
      const r = await estimator.estimate({ floorAreaM2: 30, floors: 3, measured: true });
      expect(r.floorAreaM2).toBe(30);
    });

    it('measured 는 원단위 휴리스틱과 같은 톤수를 내지만 범위는 더 좁다', async () => {
      const heuristic = await estimator.estimate({ floorAreaM2: 30 });
      const measured = await estimator.estimate({ floorAreaM2: 30, measured: true });
      expect(measured.estimatedTons).toBe(heuristic.estimatedTons);
      const heuristicWidth = heuristic.rangeMaxTons - heuristic.rangeMinTons;
      const measuredWidth = measured.rangeMaxTons - measured.rangeMinTons;
      expect(measuredWidth).toBeLessThan(heuristicWidth);
      expect(measured.rangeMinTons).toBeCloseTo(
        measured.estimatedTons * (1 - ESTIMATE_RANGE_RATIO_MEASURED),
        1,
      );
    });

    it('신뢰도: 실측+구조 확정이면 HIGH, 하나만 있으면 MEDIUM, 둘 다 없으면 LOW', async () => {
      const both = await estimator.estimate({ floorAreaM2: 30, structure: 'RC', measured: true });
      const onlyMeasured = await estimator.estimate({ floorAreaM2: 30, measured: true });
      const onlyStructure = await estimator.estimate({ floorAreaM2: 30, structure: 'RC' });
      const neither = await estimator.estimate({ floorAreaM2: 30 });
      expect(both.confidence).toBe('HIGH');
      expect(onlyMeasured.confidence).toBe('MEDIUM');
      expect(onlyStructure.confidence).toBe('MEDIUM');
      expect(neither.confidence).toBe('LOW');
    });

    it('measured 가 아니면 여전히 기존 동작(AREA_HEURISTIC, 기본 범위)', async () => {
      const r = await estimator.estimate({ floorAreaM2: 30, structure: 'RC' });
      expect(r.method).toBe('AREA_HEURISTIC');
      const width = r.rangeMaxTons - r.rangeMinTons;
      expect(width).toBeCloseTo(r.estimatedTons * ESTIMATE_RANGE_RATIO, 1);
    });
  });

  describe('차량 대수 환산', () => {
    it('적재량으로 나눈 올림 대수를 준다', async () => {
      const r = await estimator.estimate({ floorAreaM2: 10 });
      const tons = Math.round(10 * DEMOLITION_TON_PER_M2 * 10) / 10; // 15.8톤
      expect(r.estimatedTons).toBe(tons);
      const five = r.truckLoads.find((t) => t.capacityTons === 5);
      const twentyFive = r.truckLoads.find((t) => t.capacityTons === 25);
      expect(five?.count).toBe(Math.ceil(tons / 5)); // 올림 대수
      expect(twentyFive?.count).toBe(Math.ceil(tons / 25));
    });
  });
});

describe('평 ↔ ㎡ 변환', () => {
  it('30평은 약 99㎡', () => {
    expect(pyeongToM2(30)).toBeCloseTo(99.2, 1);
  });

  it('왕복 변환은 원래 값으로 돌아온다', () => {
    expect(m2ToPyeong(pyeongToM2(25))).toBeCloseTo(25, 1);
  });
});
