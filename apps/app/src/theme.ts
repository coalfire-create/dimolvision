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
    card: 24,
    button: 18,
    badge: 999,
    pill: 999,
  },
  /** 그림자 프리셋 — 현대적인 앱(Apple, Toss 등) 스타일의 은은하고 깊은 그림자 */
  shadow: {
    /** 카드·시트 기본 그림자. 투명도를 대폭 낮추고 퍼짐(Radius)을 키움 */
    card: {
      shadowColor: '#000000',
      shadowOpacity: 0.04,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3, // Android
    },
    /** 주요 버튼 강조 그림자(브랜드 색). */
    primary: {
      shadowColor: COLORS.primary,
      shadowOpacity: 0.25,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8,
    },
    /** 글래스모피즘용 가벼운 팝업/플로팅 그림자 */
    floating: {
      shadowColor: '#000000',
      shadowOpacity: 0.08,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 12 },
      elevation: 5,
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
