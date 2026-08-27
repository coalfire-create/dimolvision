import type { SocialProvider, UserProfile } from './user.js';

/**
 * 인증(휴대폰 OTP 로그인) 공통 타입.
 * 파일럿 인증 흐름:
 *  1) 휴대폰번호로 인증코드 요청(OTP 발송)
 *  2) 코드 입력 → 검증 → 로그인/회원가입
 *  3) 발급된 세션 토큰을 단말에 저장해 자동 로그인
 *
 * 인증코드·토큰은 PII/보안 값이므로 로그에 평문으로 남기지 않는다.
 */

/** OTP 발송 요청 결과. */
export interface OtpRequestResult {
  sent: boolean;
  /** 코드 유효시간(초). 만료 후 재요청 필요. */
  expiresInSec: number;
}

/**
 * OTP 검증 결과.
 * - 기존 회원: session(토큰+프로필) 반환 → 즉시 로그인.
 * - 미가입 번호: session 없음 + phoneVerified=true → 회원가입 진행(번호 인증 완료 상태).
 */
export interface OtpVerifyResult {
  phoneVerified: boolean;
  session: AuthSession | null;
}

/** 로그인 세션 — 토큰과 회원 프로필. 토큰은 자동 로그인 복원에 사용. */
export interface AuthSession {
  token: string;
  user: UserProfile;
}

/**
 * 소셜 로그인 시작 결과. authorizeUrl 을 브라우저(외부/인앱)로 열어 공급자 인증을 진행한다.
 * state 는 CSRF 방지용 서명값(콜백에서 검증).
 */
export interface OAuthStartResult {
  authorizeUrl: string;
  state: string;
}

/** 소셜 신원으로 회원가입 화면을 채울 프리필(신원은 검증됐지만 아직 미가입). */
export interface SocialSignupPrefill {
  provider: SocialProvider;
  name?: string;
  email?: string;
}

/**
 * 소셜 로그인 콜백 결과.
 * - 이미 연결된 계정: 즉시 로그인(session).
 * - 미가입 신원: 단기 가입 티켓(ticket) + 프리필 → 회원가입(전화 인증 포함) 후 계정 생성·연결.
 */
export type OAuthCallbackResult =
  | { status: 'login'; session: AuthSession }
  | { status: 'signup'; ticket: string; prefill: SocialSignupPrefill };
