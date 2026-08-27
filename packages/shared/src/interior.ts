import type { GeoPoint } from './geo.js';
import type { MatchStatus } from './types.js';

/**
 * 소비자 ↔ 인테리어 업체 매칭 (밀봉 역경매).
 *
 * ⚠️ 파일럿 범위 밖: CLAUDE.md 상 파일럿은 양평·건설폐기물(철거)로 한정된다.
 * 인테리어는 로드맵에 명시된 Phase 전까지 기본 흐름에 노출하지 않으며, 반드시
 * FEATURE_INTERIOR 플래그 뒤에서만 활성화한다. (기능 완성 후 로드맵 Phase 편입 시 on)
 *
 * 흐름: 소비자가 요청(InteriorRequest) 등록 → 인테리어 업체들이 각자 입찰(InteriorBid)
 * → 업체끼리는 서로의 입찰가를 볼 수 없고(밀봉), 요청자(소비자)만 전체 입찰을 본다
 * → 소비자가 하나를 낙찰(accept)하면 그 업체로 매칭 확정. 결제·정산은 철거 흐름
 * (선결제 → agreedFee → 포트원 지급대행)을 그대로 재사용한다.
 */

/**
 * 인테리어 기능 활성화 플래그.
 * 기본 false — API 계층에서 환경변수(FEATURE_INTERIOR)로 켠다. 파일럿(양평/철거)
 * 기본 흐름은 이 값이 false인 동안 아무 영향도 받지 않는다.
 */
export const FEATURE_INTERIOR_DEFAULT = false;

/** 인테리어 공사 카테고리 (확장 대비 최소 세트). */
export type InteriorCategory = 'RESIDENTIAL' | 'COMMERCIAL';

export const INTERIOR_CATEGORY_LABELS: Record<InteriorCategory, string> = {
  RESIDENTIAL: '주거',
  COMMERCIAL: '상가·상업',
};

/**
 * 인테리어 시공 요청 (소비자 발주).
 * 폐기물 요청(ServiceRequest)과 달리 톤수·올바로 전자인계서 개념이 없으므로
 * 폐기물 중심 ServiceRequestBase를 상속하지 않고 독립 타입으로 둔다. 상태머신
 * (MatchStatus)과 선결제/정산 파이프만 공유한다.
 */
export interface InteriorRequest {
  id: string;
  kind: 'INTERIOR';
  /** 발주 소비자(CONSUMER) id. */
  requesterId: string;
  /** 현장 지역. 파일럿 확장 시에도 지역 제한은 상위 정책에서 적용. */
  region: string;
  category: InteriorCategory;
  /** 요청 제목(예: "30평 아파트 전체 리모델링"). */
  title: string;
  /** 상세 요구사항. */
  description: string;
  /** 현장 주소. */
  siteAddress: string;
  /** 현장 좌표(거리 기반 업체 노출용, 선택). */
  location?: GeoPoint;
  /** 희망 예산(원, 선택). 업체 입찰 참고용이며 강제되지 않는다. */
  budget?: number;
  /** 현장 사진 오브젝트 키 목록. */
  photoKeys: string[];
  status: MatchStatus;
  /** 낙찰된 업체 id (MATCHED 전이 시 기록). */
  matchedProviderId?: string;
  /** 낙찰된 입찰 id. */
  matchedBidId?: string;
  /** 낙찰가(원) — 선결제 청구 기준. 낙찰된 입찰 금액이 기록된다. */
  agreedFee?: number;
  /** 선결제 완료 시 기록되는 결제 id. */
  paymentId?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** 입찰 상태 — 낙찰(ACCEPTED)은 요청당 1건. */
export type InteriorBidStatus =
  | 'SUBMITTED' // 제출됨 (심사 대기)
  | 'ACCEPTED' // 소비자가 낙찰
  | 'REJECTED'; // 다른 입찰 낙찰로 자동 탈락

export const INTERIOR_BID_STATUS_LABELS: Record<InteriorBidStatus, string> = {
  SUBMITTED: '제출됨',
  ACCEPTED: '낙찰',
  REJECTED: '미선정',
};

/** 인테리어 업체가 요청 건에 제시한 밀봉 입찰. */
export interface InteriorBid {
  id: string;
  requestId: string;
  /** 입찰 업체(인테리어 업체) id. */
  providerId: string;
  /** 입찰가(원, 양의 정수). */
  amount: number;
  memo?: string;
  status: InteriorBidStatus;
  createdAt: string;
}

/**
 * 밀봉 입찰 가시성 규칙 — 이 프로젝트에서 "업체끼리 서로 입찰가를 못 본다"의 단일 진실원.
 * 라우트/스토어는 입찰 목록을 외부로 반환하기 전에 반드시 이 함수를 통과시킨다.
 *
 * - 요청자(소비자)는 자기 요청의 모든 입찰을 본다.
 * - 입찰 업체는 자기 입찰만 본다 (경쟁사 금액 비공개).
 * - 그 외 제3자는 아무 것도 보지 못한다.
 *
 * 시세 평균/최저가 등 집계값도 업체에게 노출하지 않는다(간접적으로 경쟁가가 새기 때문).
 */
export function visibleInteriorBids(
  bids: readonly InteriorBid[],
  viewerId: string,
  requesterId: string,
): InteriorBid[] {
  if (viewerId === requesterId) return [...bids];
  return bids.filter((b) => b.providerId === viewerId);
}
