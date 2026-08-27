import type { GeoPoint } from './geo.js';

/**
 * 회원 프로필 (소비자 / 철거·운반·처리 업체 · 로드맵 Phase 1 §4.1).
 * phone·businessNumber 는 PII — 로그에 평문으로 남기지 않는다 (CLAUDE.md 절대 규칙).
 */

/**
 * 회원 가입 유형 — 회원가입 화면에서 하나 선택. users 테이블 user_type 컬럼에 대응.
 * - DEMOLITION_COMPANY: 철거업체 — 사업자등록번호 필수, 올바로 회원 검증 대상
 * - TRANSPORT_COMPANY: 운반업체 — 사업자등록번호 필수, 올바로 회원 검증 대상. 콜대기(online/offline) 흐름 사용
 * - WASTE_TREATMENT_PLANT: 철거폐기물 처리장 — 사업자등록번호 필수, 올바로 회원 검증 대상
 * - CONSUMER: 소비자(일반 배출자) — 사업자등록번호 없이 가입, 올바로 검증 생략
 * - INTERIOR_COMPANY: 인테리어 업체 — 소비자 시공 요청에 밀봉 입찰(파일럿 밖 · FEATURE_INTERIOR).
 *   폐기물 회원이 아니므로 올바로 검증·사업자번호 필수 대상이 아니다(COMPANY_USER_TYPES 제외).
 *
 * 매칭/정산에서의 지급 대상 역할(운반/처리)은 ProviderRole·PayoutParty 로 별도 관리한다.
 */
export type UserType =
  | 'DEMOLITION_COMPANY'
  | 'TRANSPORT_COMPANY'
  | 'WASTE_TREATMENT_PLANT'
  | 'INTERIOR_COMPANY'
  | 'CONSUMER';

/** 가입 유형 목록(회원가입 화면 렌더링·서버 검증용). CONSUMER를 첫 화면 기본값으로 둔다. */
export const USER_TYPES: readonly UserType[] = [
  'CONSUMER',
  'DEMOLITION_COMPANY',
  'TRANSPORT_COMPANY',
  'WASTE_TREATMENT_PLANT',
  'INTERIOR_COMPANY',
];

/** 가입 유형 한글 라벨(화면 표기용). */
export const USER_TYPE_LABELS: Record<UserType, string> = {
  DEMOLITION_COMPANY: '철거업체',
  TRANSPORT_COMPANY: '운반업체',
  WASTE_TREATMENT_PLANT: '철거폐기물 처리장',
  INTERIOR_COMPANY: '인테리어 업체',
  CONSUMER: '소비자',
};

/** 사업자 회원 유형 — 사업자등록번호 필수 + 올바로 회원 검증 대상(소비자 제외). */
export const COMPANY_USER_TYPES: readonly UserType[] = [
  'DEMOLITION_COMPANY',
  'TRANSPORT_COMPANY',
  'WASTE_TREATMENT_PLANT',
];

export function isCompanyType(type: UserType): boolean {
  return COMPANY_USER_TYPES.includes(type);
}

/** 콜대기 흐름을 쓰는 유형인지(현재는 운반업체만). availability 필드 유효성의 기준. */
export function usesCallAvailability(type: UserType): boolean {
  return type === 'TRANSPORT_COMPANY';
}

/** 운반요청 제공 여부(offersTransport) 를 설정할 수 있는 유형인지(처리장만). */
export function usesOffersTransport(type: UserType): boolean {
  return type === 'WASTE_TREATMENT_PLANT';
}

/** 처리장 운반요청 제공 여부 → 배지 문구. */
export function offersTransportLabel(offers: boolean | undefined): string {
  return offers ? '운반요청 가능' : '운반요청 별도 필요';
}

/** 업체 승인 상태. 소비자는 가입 즉시 APPROVED, 업체는 관리자 승인(Phase 5) 대상. */
export type UserApprovalStatus = 'PENDING' | 'APPROVED' | 'SUSPENDED';

export const USER_APPROVAL_LABELS: Record<UserApprovalStatus, string> = {
  PENDING: '승인 대기',
  APPROVED: '승인됨',
  SUSPENDED: '이용 정지',
};

/**
 * 운반업체 콜대기 상태. ONLINE(대기)이면 매칭 요청을 받고, OFFLINE(비대기)이면 제외.
 * 운반업체 외 유형에는 설정되지 않는다.
 */
export type CallAvailability = 'ONLINE' | 'OFFLINE';

export const CALL_AVAILABILITY_LABELS: Record<CallAvailability, string> = {
  ONLINE: '콜대기 중',
  OFFLINE: '대기 종료',
};

/** 소셜 로그인 공급자(파일럿: 카카오·구글·네이버). */
export const SOCIAL_PROVIDERS = ['kakao', 'google', 'naver'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

export const SOCIAL_PROVIDER_LABELS: Record<SocialProvider, string> = {
  kakao: '카카오',
  google: '구글',
  naver: '네이버',
};

/**
 * 계정에 연결된 소셜 로그인 신원.
 * providerUserId 는 공급자의 안정적 고유 id(로그인 매칭 키). email 은 참고용(식별 키로 쓰지 않는다).
 */
export interface SocialIdentity {
  provider: SocialProvider;
  providerUserId: string;
  email?: string;
  linkedAt: string;
}

export interface UserProfile {
  id: string;
  userType: UserType;
  /** 업체 상호 또는 소비자 이름. */
  name: string;
  /** 활동 지역. 파일럿에서는 양평. */
  region: string;
  /**
   * 업체 기준 좌표(사무실/차고지 등). 거리 기반 일감 추천의 origin 으로 쓰인다.
   * 미입력이면 거리 정렬 없이 최신순으로 노출한다.
   */
  location?: GeoPoint;
  /** 연락처 (PII — 로그 평문 금지). */
  phone?: string;
  /** 사업자등록번호, 정규화 10자리 (PII — 로그 평문 금지). 업체 필수. */
  businessNumber?: string;
  approvalStatus: UserApprovalStatus;
  /**
   * 운반업체 콜대기 상태(온라인/오프라인). 운반업체(TRANSPORT_COMPANY)만 값을 가지며,
   * 가입 시 OFFLINE 로 시작한다. 다른 유형은 undefined.
   */
  availability?: CallAvailability;
  /**
   * [올바로 인증 업체] 배지 (우대사항 · 선택 입력).
   * 올바로 회원 검증 API 성공 시 true — 검증 연동 자체는 민감 영역(사람 검토 대상).
   */
  allbaroCertified: boolean;
  /** 올바로 검증 시각(ISO 8601, 인증 시). */
  allbaroCheckedAt?: string;
  /** 보험 가입 확인 (Phase 2 인증 고도화). */
  insuranceRegistered: boolean;
  /** 폐기물처리업 허가증 등록 확인 (Phase 2 인증 고도화). */
  permitRegistered: boolean;
  /**
   * [처리장 전용] 운반요청까지 함께 처리하는지 여부. WASTE_TREATMENT_PLANT 만 의미가 있고,
   * 미설정이면 운반 별도(false)로 본다. 예약 화면에서 "운반요청 가능/별도 필요" 배지로 노출한다.
   */
  offersTransport?: boolean;
  /** 연결된 소셜 로그인(카카오/구글/네이버). 공급자당 최대 1개. 미연결이면 undefined. */
  socialIdentities?: SocialIdentity[];
  createdAt: string;
  updatedAt: string;
}
