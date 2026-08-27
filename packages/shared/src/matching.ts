/**
 * 매칭 추천 가중치 (로드맵 Phase 3 · 매칭 알고리즘 고도화).
 * 거리·가격·평점을 조합해 추천 순위를 만든다. 초기값은 거리 우선.
 */

export interface MatchWeights {
  /** 가까울수록 가점. */
  distance: number;
  /** 견적가가 낮을수록 가점. */
  price: number;
  /** 평점이 높을수록 가점. */
  rating: number;
}

/** Phase 3 초기 가중치 — 파일럿 데이터로 튜닝하되 여기서만 수정한다 (하드코딩 금지). */
export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  distance: 0.5,
  price: 0.3,
  rating: 0.2,
};

/**
 * 부분 가중치를 기본값과 합치고 합이 1이 되도록 정규화한다.
 * 음수이거나 합이 0이면 오류.
 */
export function resolveMatchWeights(partial: Partial<MatchWeights> = {}): MatchWeights {
  const merged: MatchWeights = { ...DEFAULT_MATCH_WEIGHTS, ...partial };
  const entries = [merged.distance, merged.price, merged.rating];
  if (entries.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new Error('가중치는 0 이상의 숫자여야 합니다.');
  }
  const sum = entries.reduce((acc, w) => acc + w, 0);
  if (sum === 0) {
    throw new Error('가중치 합은 0보다 커야 합니다.');
  }
  return {
    distance: merged.distance / sum,
    price: merged.price / sum,
    rating: merged.rating / sum,
  };
}
