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
  /** 메인 — 신뢰감 있고 세련된 프리미엄 블루 */
  primary: '#2563EB',
  /** 메인 진한 톤 */
  primaryDark: '#1D4ED8',
  /** 메인 연한 톤 — 틴트 배경용 */
  primarySoft: '#EFF6FF',
  /** 보조 — 경고/포인트용 오렌지 */
  secondary: '#F97316',
  /** 본문 텍스트 — 우아하고 깊은 슬레이트 다크 */
  text: '#0F172A',
  /** 보조 텍스트 — 부드러운 슬레이트 그레이 */
  textMuted: '#64748B',
  /** 앱 전체 배경 — 아주 옅은 쿨 톤의 오프화이트 (공간감 부여) */
  background: '#F8FAFC',
  /** 카드·섹션 배경 — 순백색 (배경과 대비를 이루어 카드를 부각) */
  surface: '#FFFFFF',
  /** 경계선 색상 - 아주 얇고 섬세한 실선용 */
  border: '#E2E8F0',
  /** 오류/필수 경고 전용 */
  error: '#EF4444',
} as const;
