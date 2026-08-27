import type { ProviderRole } from './types.js';

/**
 * 견적 히스토리·평균 시세 (로드맵 Phase 3 · 매칭 알고리즘 고도화).
 * 업체(운반/처리)가 요청 건에 제시한 견적을 기록하고, 배출자에게 평균 시세를 보여준다.
 */

export interface Quote {
  id: string;
  /** 견적 대상 요청. */
  requestId: string;
  /** 견적 제시 업체. */
  providerId: string;
  /** 운반 견적인지 처리 견적인지. */
  party: ProviderRole;
  /** 견적가(원, 양의 정수). */
  amount: number;
  memo?: string;
  /** 배출자가 이 견적을 수락했는지. 정산 금액(선결제)은 수락된 견적에서만 산출한다. */
  accepted?: boolean;
  createdAt: string;
}

/**
 * 견적 밀봉 가시성 규칙 — `visibleInteriorBids` 와 같은 원칙(하이딜러식 밀봉)의 단일 진실원.
 * 라우트는 견적 목록을 외부로 반환하기 전에 반드시 이 함수를 통과시킨다.
 *
 * - 요청자(배출자: 철거업체 또는 직접요청 소비자)는 자기 요청의 모든 견적을 본다.
 * - 소비자(요청자가 아닌 제3자)는 견적 금액을 전혀 볼 수 없다(요청 상태·매칭결과만 별도 노출).
 * - 업체(운반/처리)는 자기가 제출한 견적만 본다(경쟁사 금액 비공개).
 */
export function visibleQuotes(
  quotes: readonly Quote[],
  viewerId: string,
  viewerIsConsumer: boolean,
  requesterId: string,
): Quote[] {
  if (viewerId === requesterId) return [...quotes];
  if (viewerIsConsumer) return [];
  return quotes.filter((q) => q.providerId === viewerId);
}

/** 평균 시세 요약 — 요청 화면에서 "이 정도가 적정가" 안내에 사용. */
export interface MarketRate {
  party: ProviderRole;
  /** 집계에 포함된 견적 수. */
  quoteCount: number;
  /** 평균 견적가(원, 반올림). 견적 없으면 null. */
  averageAmount: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  /** 톤당 평균 단가(원/톤, 반올림). 톤수 있는 요청의 견적만 반영. */
  averagePerTon: number | null;
}
