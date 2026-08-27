/**
 * 자동매칭 제안(오퍼) — 타임아웃/재매칭 (로드맵 Phase 3 · 매칭 알고리즘 고도화).
 *
 * 추천 순위 상위 업체에 순서대로 매칭을 제안하고, 제한 시간 내 무응답이면 만료(EXPIRED)
 * 처리 후 다음 후보에게 다시 제안한다. 서버 타이머 없이 접근 시점의 지연 스윕으로 만료를
 * 판정한다 (파일럿 규모에 충분, 크론 전환 시에도 같은 스윕 로직 재사용).
 */

export type MatchOfferStatus =
  | 'OFFERED' // 제안됨 (응답 대기)
  | 'ACCEPTED' // 업체 수락 → 요청 MATCHED
  | 'DECLINED' // 업체 거절 → 다음 후보 재매칭
  | 'EXPIRED'; // 시간 내 무응답 → 다음 후보 재매칭

export const MATCH_OFFER_STATUS_LABELS: Record<MatchOfferStatus, string> = {
  OFFERED: '응답 대기중',
  ACCEPTED: '수락됨',
  DECLINED: '거절됨',
  EXPIRED: '응답 시간 초과',
};

/** 오퍼 응답 제한 시간(분) — Phase 3 초기값, 파일럿 운영 데이터로 튜닝. */
export const MATCH_OFFER_TTL_MINUTES = 30;

export interface MatchOffer {
  id: string;
  requestId: string;
  /** 제안받은 업체. */
  providerId: string;
  status: MatchOfferStatus;
  offeredAt: string;
  /** 이 시각 이후 무응답이면 만료. */
  expiresAt: string;
  respondedAt?: string;
}
