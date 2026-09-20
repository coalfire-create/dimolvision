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
    card: 12, // 밤티(둥근) 느낌 제거, 각진 세련미
    button: 8, // 버튼도 둥근 모서리 대신 각지게
    badge: 4,
    pill: 4,
  },
  /** 그림자 프리셋 — 토스 스타일은 그림자를 거의 쓰지 않으나, 팝업 등에 아주 은은하게 사용 */
  shadow: {
    /** 카드·시트 기본 그림자 - 토스는 배경색으로 면을 구분하므로 그림자를 극단적으로 줄임 */
    card: {
      shadowColor: '#000000',
      shadowOpacity: 0.02,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 1, // Android
    },
    /** 주요 버튼 강조 그림자(브랜드 색) - 토스 버튼은 그림자 없는 경우가 많으므로 최소화 */
    primary: {
      shadowColor: COLORS.primary,
      shadowOpacity: 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
    /** 글래스모피즘/모달용 그림자 - 팝업 시에만 명확하게 떨어지도록 */
    floating: {
      shadowColor: '#000000',
      shadowOpacity: 0.08,
      shadowRadius: 40,
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
