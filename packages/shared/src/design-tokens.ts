/**
 * 접근성 디자인 토큰 (로드맵 Phase 6 · CLAUDE.md 디자인 기준).
 * 고령 사용자 기준: 큰 글씨, 넉넉한 터치 영역, 8px 배수 여백, 절제된 색.
 * UI(React Native)는 크기·색을 하드코딩하지 말고 반드시 이 토큰을 쓴다.
 */

/** 글자 크기(px). 기본 텍스트 18 이상, 제목 24 이상 — 이보다 작게 쓰지 않는다. */
export const FONT_SIZES = {
  /** 보조 정보(캡션)도 최소 기준을 지킨다. */
  caption: 18,
  body: 18,
  bodyLarge: 20,
  title: 24,
  titleLarge: 28,
} as const;

/** 터치 영역(px). 버튼 높이 최소 48. */
export const TOUCH = {
  minButtonHeight: 48,
  /** 큰 주요 버튼 (결제/매칭 확정 등 핵심 동작). */
  primaryButtonHeight: 56,
  /** 터치 대상 사이 최소 간격. */
  minGap: 8,
} as const;

/** 여백(px) — 8px 배수만 사용한다. */
export const SPACING = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
} as const;

/** 여백 값이 8px 배수 규칙을 지키는지 검사 (스타일 린트/테스트용). */
export function isValidSpacing(px: number): boolean {
  return Number.isInteger(px) && px >= 0 && px % 8 === 0;
}

/**
 * 색상 — 브랜드(비움) 로고 팔레트. 메인 1개(블루) + 보조 1개(스카이블루)로 제한.
 * 그 외는 무채색과 상태색(오류)만 허용한다. 텍스트/배경은 고대비 유지.
 * 메인 블루(#2F6BD8)는 흰 텍스트 대비 4.98:1 로 WCAG AA(4.5:1)를 만족한다.
 */
export const COLORS = {
  /** 메인 — 주요 버튼, 활성 상태. 토스 고유의 쨍하고 선명한 블루 */
  primary: '#3182F6',
  /** 메인 진한 톤 — 거의 쓰지 않으나 필요시. */
  primaryDark: '#1B64DA',
  /** 메인 연한 톤 — 토스의 옅은 파란 배경 칩/버튼용 */
  primarySoft: '#E8F3FF',
  /** 보조 — 토스의 경고/포인트 컬러. */
  secondary: '#FF8A3D',
  /** 본문 텍스트 — 완전한 검정 대신 진한 먹색(토스 191F28) */
  text: '#191F28',
  /** 보조 텍스트 — 설명, 부가정보용 쿨그레이(토스 8B95A1) */
  textMuted: '#8B95A1',
  background: '#FFFFFF',
  /** 카드·섹션 배경 — 경계선 없이 면을 나누는 아주 옅고 따뜻한 쿨그레이(토스 F2F4F6) */
  surface: '#F2F4F6',
  /** 경계선 색상 - 토스에서는 거의 안 쓰지만 디바이더용으로 아주 연하게 */
  border: '#E5E8EB',
  /** 오류/필수 경고 전용 (토스 레드 F04452) */
  error: '#F04452',
} as const;
