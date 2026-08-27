import { COLORS, FONT_SIZES, SPACING, TOUCH } from '@dimol/shared';

/**
 * 앱 전역 디자인 테마 — 값의 단일 소스는 @dimol/shared 디자인 토큰.
 * (기본 텍스트 18px+, 제목 24px+, 버튼 48px+, 여백 8px 배수, 메인+보조 2색)
 * 화면/컴포넌트에서 크기·색을 직접 하드코딩하지 않는다.
 */
export const theme = {
  colors: COLORS,
  font: FONT_SIZES,
  spacing: SPACING,
  touch: TOUCH,
  radius: {
    card: 20,
    button: 16,
    badge: 999,
    pill: 999,
  },
  /** 그림자 프리셋 — 하드한 테두리 대신 은은한 입체감(대기업 앱 톤). */
  shadow: {
    /** 카드·시트 기본 그림자. */
    card: {
      shadowColor: '#0B1B3A',
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    /** 주요 버튼 강조 그림자(브랜드 색). */
    primary: {
      shadowColor: COLORS.primary,
      shadowOpacity: 0.3,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    },
  },
} as const;

/** 요청 상태 → 배지 색 (메인/보조/오류/무채색만 사용 — 색 남발 금지). */
export function statusColor(status: string): { background: string; text: string } {
  switch (status) {
    case 'REQUESTED':
      return { background: theme.colors.surface, text: theme.colors.textMuted };
    case 'MATCHED':
    case 'PAID':
    case 'IN_PROGRESS':
      return { background: '#EAF2FE', text: '#1E5FBF' }; // 보조(스카이블루) 계열 — 진행 중
    case 'COMPLETED':
    case 'SETTLED':
      return { background: theme.colors.primarySoft, text: theme.colors.primary }; // 메인 계열 — 완료
    case 'CANCELLED':
      return { background: '#FBEAEA', text: theme.colors.error };
    default:
      return { background: theme.colors.surface, text: theme.colors.textMuted };
  }
}
