/**
 * 리뷰·평점 + 노쇼/분쟁 이력 (로드맵 Phase 2 · 신뢰 구축).
 * 매칭 완료(COMPLETED/SETTLED)된 요청에 한해 배출자↔업체가 상호 평가한다.
 */

export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

export interface Review {
  id: string;
  /** 평가 대상 요청 (완료된 건만). */
  requestId: string;
  /** 평가자 (요청 당사자: 배출자 또는 매칭 업체). */
  raterId: string;
  /** 피평가자 (상대 당사자). */
  ratedId: string;
  /** 1~5 정수. */
  rating: number;
  comment?: string;
  createdAt: string;
}

/** 사용자 평점 요약 — 업체 프로필/매칭 추천 정렬에 사용. */
export interface RatingSummary {
  userId: string;
  /** 평균 평점 (리뷰 없으면 null). */
  average: number | null;
  reviewCount: number;
  /** 노쇼 신고 누적 (미해결 + 해결 포함). */
  noShowCount: number;
  /** 분쟁 신고 누적. */
  disputeCount: number;
}

/** 노쇼/분쟁 인시던트. */
export type IncidentType = 'NO_SHOW' | 'DISPUTE';

export type IncidentStatus = 'OPEN' | 'RESOLVED';

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  NO_SHOW: '노쇼',
  DISPUTE: '분쟁',
};

export interface Incident {
  id: string;
  requestId: string;
  /** 신고자 (요청 당사자). */
  reporterId: string;
  /** 피신고자 (상대 당사자). */
  targetId: string;
  type: IncidentType;
  detail?: string;
  status: IncidentStatus;
  /** 관리자 조정 메모 (Phase 5 백오피스에서 기록). */
  resolutionNote?: string;
  createdAt: string;
  resolvedAt?: string;
}
