import type { UserType } from './user.js';

/**
 * 업체 단가 (로드맵 Phase 2 — 마이페이지 단가 설정).
 * 업체가 자기 기준 단가를 저장해 두면 견적 제출 시 기본값(예상 금액)으로 쓰고, 시세 표기에도 참고한다.
 * 단가 단위는 유형별로 다르다(철거=원/㎡, 운반·처리=원/톤).
 */
export interface ProviderPricing {
  /** 업체(회원) id. */
  userId: string;
  /** 단가(원, 양의 정수). 단위는 pricingUnitLabel 참고. */
  unitPrice: number;
  updatedAt: string;
}

/** 단가를 설정하는 업체 유형인지(철거/운반/처리장). 소비자·인테리어는 제외. */
export function usesPricing(userType: UserType): boolean {
  return (
    userType === 'DEMOLITION_COMPANY' ||
    userType === 'TRANSPORT_COMPANY' ||
    userType === 'WASTE_TREATMENT_PLANT'
  );
}

/** 유형별 단가 단위 라벨. 철거=원/㎡, 운반·처리=원/톤, 그 외=원. */
export function pricingUnitLabel(userType: UserType): string {
  switch (userType) {
    case 'DEMOLITION_COMPANY':
      return '원/㎡';
    case 'TRANSPORT_COMPANY':
    case 'WASTE_TREATMENT_PLANT':
      return '원/톤';
    default:
      return '원';
  }
}

/**
 * 저장된 단가로 견적 예상 금액(원)을 계산한다.
 * 운반·처리(원/톤)는 단가 × 톤수. 철거(원/㎡)는 연면적 정보가 없으면 단가만 반환.
 */
export function suggestedQuoteAmount(
  userType: UserType,
  unitPrice: number,
  wasteTons: number,
): number {
  if (userType === 'TRANSPORT_COMPANY' || userType === 'WASTE_TREATMENT_PLANT') {
    return Math.round(unitPrice * wasteTons);
  }
  return Math.round(unitPrice);
}
