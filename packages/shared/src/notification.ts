import type { MatchStatus } from './types.js';

/**
 * 매칭 단계별 알림 (로드맵 Phase 4 · 운영 도구).
 * 요청 상태 전이 시 배출자/업체에게 발송되는 인앱 알림 레코드.
 * 실제 발송 채널(푸시/문자)은 서버의 NotificationProvider 어댑터가 담당한다.
 */

export interface AppNotification {
  id: string;
  /** 수신자 (배출자 또는 매칭 업체). */
  userId: string;
  requestId: string;
  /** 알림을 발생시킨 요청 상태. */
  status: MatchStatus;
  /** UI에 그대로 노출 가능한 한글 메시지. */
  message: string;
  createdAt: string;
}
