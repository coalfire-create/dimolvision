/**
 * 플랫폼 핵심 비즈니스 상수.
 *
 * ⚠️ CLAUDE.md「핵심 비즈니스 규칙」에 따라 이 값들은 임의로 바꾸지 않는다.
 * 수수료율 등은 반드시 이 파일에서만 관리하고 코드 곳곳에 하드코딩하지 않는다.
 */

/** 플랫폼 수수료율 7% (Phase 0에서 확정한 초기값). */
export const PLATFORM_FEE_RATE = 0.07;

/**
 * 취소 위약금율 10%.
 * 배차 후 ~ 작업 시작 전 취소 시 선결제액에서 이 비율을 공제하고 환불한다.
 * (배차 전 취소는 전액 환불, 작업 시작 후에는 원칙적으로 취소 불가.)
 */
export const CANCELLATION_PENALTY_RATE = 0.1;

/** 정산 주기: 익영업일(D+1). 수수료 제외 금액을 운반업체/처리장에 지급. */
export const SETTLEMENT_DELAY_BUSINESS_DAYS = 1;

/** 올바로 전자인계서 의무신고 기준: 건설폐기물 5톤 이상. */
export const ALLBARO_MANDATORY_CONSTRUCTION_WASTE_TON = 5;

/**
 * 운반업체 콜 매칭 반경 30km.
 * 배출 현장(상차지) 기준 이 반경 이내의 운반업체만 후보로 노출하고, 신규 운반요청 "콜" 알림도
 * 이 반경 안에서만 발송한다. (반경 조정 시 이 상수만 수정하고 하드코딩하지 않는다.)
 */
export const TRANSPORT_MATCH_RADIUS_KM = 30;

/** 고객센터 대표 전화번호(표시용). 문의 화면·고객센터 버튼에서 노출한다. */
export const SUPPORT_PHONE = '070-4577-7960';

/** 고객센터 전화 연결용 tel: URL(숫자만). Linking.openURL 에 사용. */
export const SUPPORT_PHONE_TEL_URL = 'tel:07045777960';

/** 파일럿 범위 (이 범위를 벗어난 기능은 로드맵의 지정 Phase 전까지 만들지 않는다). */
export const PILOT = {
  region: '양평',
  wasteCategory: 'CONSTRUCTION',
} as const;
