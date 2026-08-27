/**
 * 디몰비전 리포트 → 디몰링크 매칭 신청 프리필 (기획서 §2.2 waste_plan, §V4 연동).
 *
 * 순수 변환 함수다 — 올바로 API·결제에 관여하지 않고, 매칭 신청서(ServiceRequest)의
 * 사전 채움 값만 계산한다. 실제 신청 생성·올바로 발행은 본체 로직의 몫이며,
 * §10에 따라 본체 매칭·올바로 연동이 완성된 Phase 이후에만 이 프리필을 활성화한다.
 */

import { PILOT } from './constants.js';
import type { WasteCategory } from './types.js';
import type { VisionMaterialCode } from './vision-taxonomy.js';
import type { VisionQuantityEstimate, VisionReport } from './vision-report.js';

export interface WasteBreakdownItem {
  category: VisionMaterialCode;
  /** 예상 배출량(톤, 범위 중앙값). 확정 아닌 참고값. */
  tons: number;
}

/** 매칭 신청서에 미리 채울 값. ServiceRequestBase 의 관련 필드에 대응한다. */
export interface MatchRequestPrefill {
  wasteCategory: WasteCategory;
  /** 예상 폐기물 총 중량(톤) — 올바로 의무신고(5톤) 안내 기준과 동일 단위. */
  wasteTons: number;
  /** waste_plan 의 올바로 의무 대상 판정을 그대로 신청서 체크박스 기본값으로. */
  allbaroRequested: boolean;
  /** 폐기물 종류별 예상량(표시·검토용). */
  wasteBreakdown: WasteBreakdownItem[];
  /** 프리필 출처 표기(사용자에게 "AI 분석 기반 사전 입력" 안내). */
  source: 'DIMOLVISION';
  /** 근거가 된 모델 버전(추적용). */
  modelVersion?: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function midpointTons(q: VisionQuantityEstimate): number {
  return q.unit === 'ton' ? (q.value_min + q.value_max) / 2 : 0;
}

/**
 * 분석 리포트의 waste_plan 을 매칭 신청 프리필로 변환한다.
 * 톤 단위 항목만 중량 합산에 반영한다(㎥ 항목은 breakdown 에서 제외).
 */
export function toMatchRequestPrefill(report: VisionReport): MatchRequestPrefill {
  const wasteBreakdown: WasteBreakdownItem[] = report.waste_plan.items
    .filter((i) => i.estimated_amount.unit === 'ton')
    .map((i) => ({ category: i.category, tons: round1(midpointTons(i.estimated_amount)) }));

  const wasteTons = round1(wasteBreakdown.reduce((sum, i) => sum + i.tons, 0));

  return {
    wasteCategory: PILOT.wasteCategory,
    wasteTons,
    allbaroRequested: report.waste_plan.allbaro_manifest_required,
    wasteBreakdown,
    source: 'DIMOLVISION',
    modelVersion: report.model_version,
  };
}
