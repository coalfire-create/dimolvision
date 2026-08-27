/**
 * 디몰비전 평가 루브릭 v1 초안 (기획서 §4.4 · Phase V0 산출물).
 *
 * 평가셋 없이는 파인튜닝 효과를 판단할 수 없으므로, 학습 데이터와 분리된
 * 평가셋(현장 30곳, 전 자재 라벨 + 전문가 작성 공정표)의 채점 기준을 상수로 고정한다.
 * Phase V3 완료 기준(주요 5종 재현율 85%, 석면 의심 재현율 95%)이 이 값과 연동된다.
 */

/** 자재 인식: 주요 5종 재현율 목표(85% 이상). */
export const MATERIAL_RECALL_TARGET = 0.85;

/**
 * 위험 인식 최우선 지표: 석면 의심 재현율 목표(95% 이상).
 * 놓치면 안 되므로 재현율을 최우선하고 과탐지는 허용한다(기획서 §4.4).
 */
export const ASBESTOS_SUSPECT_RECALL_TARGET = 0.95;

/** 물량 추정 오차 허용치: 전문가 추정 대비 ±40% (v1 목표, 단계적 상향). */
export const QUANTITY_ERROR_TOLERANCE_V1 = 0.4;

/** 응답 시간 p95 목표(초). 기획서 §V1 완료 기준(2분 이내). */
export const RESPONSE_P95_TARGET_SECONDS = 120;

/**
 * 평가셋 규모 목표(기획서 §4.4, §V2).
 * 평가셋은 학습셋과 분리해 먼저 구축한다.
 */
export const EVAL_SET_SITE_COUNT = 30;

/** 공정표 품질 루브릭 채점 항목(각 5점 척도). 기획서 §4.4. */
export type ProcessPlanRubricCriterion =
  | 'ORDER_VALIDITY' // 순서 타당성
  | 'MISSING_STEPS' // 누락 공정
  | 'SAFETY_ACCURACY' // 안전지침 정확성·근거 인용 유무
  | 'EQUIPMENT_ADEQUACY'; // 장비 적정성

export interface ProcessPlanRubricItem {
  criterion: ProcessPlanRubricCriterion;
  label: string;
  /** 채점 척도 최대점(5점). */
  maxScore: 5;
}

export const PROCESS_PLAN_RUBRIC: readonly ProcessPlanRubricItem[] = [
  { criterion: 'ORDER_VALIDITY', label: '순서 타당성', maxScore: 5 },
  { criterion: 'MISSING_STEPS', label: '누락 공정', maxScore: 5 },
  { criterion: 'SAFETY_ACCURACY', label: '안전지침 정확성·근거 인용', maxScore: 5 },
  { criterion: 'EQUIPMENT_ADEQUACY', label: '장비 적정성', maxScore: 5 },
] as const;

/** 공정표 루브릭 만점(항목 수 × 5). */
export const PROCESS_PLAN_RUBRIC_MAX_SCORE = PROCESS_PLAN_RUBRIC.length * 5;

/**
 * 운영 지표(기획서 §4.4): 사용자 수정률(리포트를 수정 없이 매칭 신청에 사용한 비율),
 * 응답 시간 p95. 프로덕션(V4~V5)에서 상시 추적한다.
 */
export type VisionOperationalMetric = 'USER_EDIT_RATE' | 'RESPONSE_P95';
