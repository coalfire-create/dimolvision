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
  /** 메인 — 주요 버튼, 활성 상태. 조금 더 깊이있고 세련된 블루톤 */
  primary: '#2451F5',
  /** 메인 진한 톤 — 눌림/헤더/그라데이션 하단. */
  primaryDark: '#1A3AB5',
  /** 메인 연한 톤 — 선택·강조 배경(연한 브랜드 틴트). 투명감 있는 느낌 */
  primarySoft: '#F0F4FF',
  /** 보조 — 로고 오렌지색. 강조 배지·아이콘 포인트. */
  secondary: '#FF6B3B',
  /** 본문 텍스트 (흰 배경 대비 15.3:1). 완전한 검정보다는 약간의 먹색이 고급스러움 */
  text: '#1C1C1E',
  /** 보조 텍스트 — 대비 4.5:1 이상 유지. 너무 진하지 않게 */
  textMuted: '#8E8E93',
  background: '#FFFFFF',
  /** 카드·섹션 배경 — 아주 옅은 블루그레이(브랜드 톤). iOS 그룹 테이블 배경과 유사 */
  surface: '#F4F5F7',
  /** 경계선 색상 - 아주 연하고 부드럽게 */
  border: '#E8EAED',
  /** 오류/필수 경고 전용. */
  error: '#FF3B30', // iOS Error Red
} as const;
