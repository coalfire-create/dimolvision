import type { GeoPoint } from './geo.js';

/**
 * 회원 가입 유형(계정 계층)은 `UserType`(user.ts)로 정의한다.
 * 매칭/정산의 지급 대상 역할은 아래 `ProviderRole`·`PayoutParty`가 담당한다.
 */

/** 폐기물 카테고리. 파일럿은 건설폐기물(CONSTRUCTION)로 한정. */
export type WasteCategory = 'CONSTRUCTION';

/** 매칭 대상(셀러) 유형 — 배출자에게 매칭되는 운반업체/처리장. */
export type ProviderRole = 'TRANSPORT' | 'DISPOSAL';

/**
 * 매칭 후보(운반업체/처리장).
 * 거리 기반 기본 매칭의 입력 단위. 실제로는 DB의 업체 레코드에서 조회한다.
 */
export interface MatchCandidate {
  id: string;
  role: ProviderRole;
  name?: string;
  /** 소재 지역. 파일럿에서는 양평만 매칭한다. */
  region: string;
  /** 업체 위치 좌표. */
  location: GeoPoint;
  /** 취급 폐기물 카테고리. */
  wasteCategories: WasteCategory[];
  /** 비활성(정지/미승인) 업체는 매칭 제외. 미지정 시 활성으로 간주. */
  active?: boolean;
  /**
   * [처리장 전용] 이 처리장이 운반요청까지 함께 받는지 여부.
   * true = 운반요청 가능(원스톱), false/미지정 = 운반은 별도 업체 필요.
   */
  offersTransport?: boolean;
}

/** 거리 계산이 붙은 매칭 후보(거리순 정렬 결과). */
export interface RankedCandidate extends MatchCandidate {
  /** 배출 현장으로부터의 직선거리(km, 소수 3자리 반올림). */
  distanceKm: number;
}

/** 매칭 요청 상태. */
export type MatchStatus =
  | 'REQUESTED' // 매칭 신청
  | 'MATCHED' // 매칭 확정 (선결제 대상)
  | 'PAID' // 배출자 선결제 완료
  | 'IN_PROGRESS' // 운반/처리 진행
  | 'COMPLETED' // 처리 완료
  | 'SETTLED' // 정산 완료 (D+1)
  | 'CANCELLED';

/** 올바로 회원 구분. 검증 결과로 회원 유형을 함께 확인해 역할 매칭에 활용. */
export type AllbaroMemberType =
  | 'DISCHARGER' // 배출자
  | 'TRANSPORT' // 운반자
  | 'DISPOSAL' // 처리자
  | 'UNKNOWN'; // 올바로가 유형을 반환하지 않은 경우

/**
 * 올바로 회원 검증(사업자등록번호 기준) 결과.
 * 외부(정부) API 응답을 우리 도메인 형태로 정규화한 값이며, 원본 응답이나
 * PII(사업자등록번호 평문)를 그대로 보관/로깅하지 않는다.
 */
export interface AllbaroMemberVerification {
  /** 정규화된 사업자등록번호(10자리 숫자). */
  businessNumber: string;
  /** 올바로에 등록된 유효 회원인지 여부. */
  verified: boolean;
  /** 상호명(올바로 제공 시). */
  memberName?: string;
  /** 회원 유형. */
  memberType: AllbaroMemberType;
  /** 검증에 사용한 환경 — 운영 전환 전까지 항상 sandbox 여야 한다. */
  environment: 'sandbox' | 'production';
  /** 검증 시각(ISO 8601). */
  checkedAt: string;
}

/** 올바로 전자인계서 처리 경로. */
export type AllbaroRoute =
  | 'ALLBARO_API' // 올바로 API 자동 발행
  | 'SIMPLE_CONFIRM' // 자체 간이 확인서 (비대상 또는 API 장애 폴백)
  | 'RETRY_QUEUED'; // API 장애로 재시도 큐 적재됨

/** 전자인계서 당사자(배출/운반/처리). 사업자등록번호는 PII이므로 로그 평문 금지. */
export interface ManifestParty {
  businessNumber: string;
  name?: string;
}

/**
 * 올바로 전자인계서 발행 요청.
 * `allbaroRequested`(매칭 신청 화면 체크박스)가 ON이면 올바로 API 자동 발행,
 * OFF면 자체 간이확인서 발급 경로로 처리한다.
 */
export interface ManifestIssueRequest {
  matchRequestId: string;
  wasteCategory: WasteCategory;
  /** 폐기물 중량(톤). 의무신고 판단 및 인계서 기재. */
  wasteTons: number;
  /** "올바로 전자인계서 신고 필요" 체크박스 값. */
  allbaroRequested: boolean;
  discharger: ManifestParty;
  transport: ManifestParty;
  disposal: ManifestParty;
}

/**
 * 전자인계서 발행 결과.
 * - ALLBARO_API: 올바로 자동 발행 성공(manifestNo).
 * - SIMPLE_CONFIRM: 비대상(OFF) → 자체 간이확인서(simpleConfirmNo).
 * - RETRY_QUEUED: 올바로 API 장애 → 간이확인서로 폴백 발급 + 재시도 큐 적재.
 */
export interface ManifestResult {
  matchRequestId: string;
  route: AllbaroRoute;
  /** 올바로 전자인계서 관리번호 (ALLBARO_API 성공 시). */
  manifestNo?: string;
  /** 자체 간이확인서 번호 (SIMPLE_CONFIRM / 폴백 시). */
  simpleConfirmNo?: string;
  /** 폴백으로 재시도 큐에 적재되었는지 여부. */
  retryQueued: boolean;
  /** 올바로 호출에 사용한 환경(호출한 경우). */
  environment?: 'sandbox' | 'production';
  issuedAt: string;
}

/** 정산 계산 결과 (금액 단위: 원, 정수). */
export interface SettlementBreakdown {
  transportFee: number;
  disposalFee: number;
  /** 배출자 선결제 총액 (운반비 + 처리비). */
  grossAmount: number;
  /** 플랫폼 수수료 (PLATFORM_FEE_RATE 적용). */
  platformFee: number;
  /** 운반업체 지급액 (수수료 차감 후). */
  payoutToTransport: number;
  /** 처리장 지급액 (수수료 차감 후). */
  payoutToDisposal: number;
  /** 정산 지급 총액 (grossAmount - platformFee). */
  totalPayout: number;
}

/**
 * 취소 시점(생명주기 단계). 환불 정책의 기준.
 * - BEFORE_DISPATCH: 배차 전 → 전액 환불
 * - AFTER_DISPATCH: 배차 후 ~ 작업 시작 전 → 위약금 10% 공제 후 환불
 * - AFTER_WORK_START: 반출/상차 등 작업 시작 후 → 원칙적으로 취소 불가
 */
export type CancellationStage = 'BEFORE_DISPATCH' | 'AFTER_DISPATCH' | 'AFTER_WORK_START';

/** 환불 계산 결과 (금액 단위: 원, 정수). */
export interface RefundBreakdown {
  stage: CancellationStage;
  /** 취소 가능 여부 (작업 시작 후 false). */
  cancellable: boolean;
  /** 선결제 원금. */
  paidAmount: number;
  /** 위약금(공제액). */
  penaltyAmount: number;
  /** 실제 환불액 (paidAmount - penaltyAmount). 취소 불가 시 0. */
  refundAmount: number;
}

/** 정산 지급 대상(셀러). 포트원 지급대행은 셀러별로 개별 지급한다. */
export type PayoutParty = 'TRANSPORT' | 'DISPOSAL';

/** 셀러별 지급 지시 (포트원 지급대행 요청 단위). */
export interface PayoutInstruction {
  party: PayoutParty;
  /** 지급액(원, 수수료 차감 후). */
  amount: number;
  /** 지급 대상 사업자등록번호(PII). 로그 평문 금지. */
  businessNumber?: string;
}

/**
 * 정산 플랜 — 금액 분해 + 지급일 + 셀러별 지급 지시를 한데 묶은 값.
 * 포트원 지급대행 실행에 필요한 모든 정보를 담는다.
 */
export interface SettlementPlan {
  breakdown: SettlementBreakdown;
  /** 배출자 선결제 금액. */
  prepaymentAmount: number;
  /** 정산 기준일(처리완료일, YYYY-MM-DD, KST). */
  completedDate: string;
  /** 실제 지급일(D+1 영업일, 공휴일·주말 순연 적용). */
  settlementDate: string;
  payouts: PayoutInstruction[];
}
