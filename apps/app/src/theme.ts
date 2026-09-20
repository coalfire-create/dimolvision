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
    card: 16, // 모던하고 우아한 네이티브 곡률
    button: 12,
    badge: 6,
    pill: 999, // 완전한 원형이 필요한 경우를 위해
  },
  /** 그림자 프리셋 — 하이엔드 앱 스타일의 깊고 넓게 퍼지는 아주 옅은 그림자 */
  shadow: {
    /** 카드·시트 기본 그림자. 어둡지 않고 공간감만 부여 */
    card: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.03,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 4, // Android
    },
    /** 주요 버튼/강조 요소 그림자 */
    primary: {
      shadowColor: COLORS.primary,
      shadowOpacity: 0.15,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    /** 팝업, 플로팅 등 깊이가 깊은 그림자 */
    floating: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.06,
      shadowRadius: 32,
      shadowOffset: { width: 0, height: 16 },
      elevation: 8,
    }
  },
} as const;

/**
 * 본문 최대 폭(px). 데스크톱에서 카드가 화면 끝까지 늘어나면 읽기 힘들고
 * 완성도가 떨어져 보인다. 모바일 우선 레이아웃을 넓은 화면에서도 단정하게 유지한다.
 */
export const CONTENT_MAX_WIDTH = 720;

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
