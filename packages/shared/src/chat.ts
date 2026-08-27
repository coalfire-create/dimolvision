/**
 * 인앱 채팅 (로드맵 Phase 4 · 운영 도구).
 * 매칭 확정된 요청의 당사자(배출자 ↔ 매칭 업체)끼리 요청 건 단위로 대화한다.
 * 파일럿은 폴링(GET ?since=) 기반 — 실시간(웹소켓) 전환 시에도 메시지 모델은 유지.
 */

export const CHAT_MESSAGE_MAX_LENGTH = 1000;

export interface ChatMessage {
  id: string;
  /** 대화가 속한 요청. */
  requestId: string;
  /** 보낸 사람 (요청 당사자). */
  senderId: string;
  content: string;
  createdAt: string;
}
