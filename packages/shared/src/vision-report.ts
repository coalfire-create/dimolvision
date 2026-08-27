/**
 * 디몰비전 분석 리포트 출력 스키마 v1 (기획서 §2.2 · Phase V0 산출물).
 *
 * 모델 출력은 화면 렌더링과 디몰링크 연동을 위해 구조화된 JSON 으로 고정한다
 * (자유 서술형 텍스트 금지). 이 파일이 그 계약(contract)의 단일 원천이며,
 * AI 서버(Python/FastAPI)·Supabase Edge Function·프론트엔드(vision-web)가 공유한다.
 *
 * 필드명은 모델/서버 와이어 포맷에 맞춰 snake_case 로 고정한다
 * (Python 서빙 코드와 JSON 키가 1:1 로 일치해야 하므로 TS 관례보다 계약을 우선).
 */

import { ALLBARO_MANDATORY_CONSTRUCTION_WASTE_TON } from './constants.js';
import {
  isVisionMaterialCode,
  isAsbestosSuspectMaterial,
  type VisionMaterialCode,
} from './vision-taxonomy.js';

/** 물량·배출량 단위. 부피(㎥) 또는 무게(톤). */
export type VisionQuantityUnit = 'm3' | 'ton';

/** 건물 구조 유형(site_summary.structure). */
export type VisionStructureType = 'RC' | 'MASONRY' | 'WOOD' | 'STEEL' | 'UNKNOWN';

/** 위험 요소 유형(hazards[].type). */
export type VisionHazardType =
  | 'ASBESTOS_SUSPECT' // 석면 의심(슬레이트·뿜칠재 등)
  | 'STRUCTURAL_INSTABILITY' // 구조 불안정
  | 'ELECTRICAL_GAS' // 전기/가스 배관
  | 'OBSTRUCTION'; // 지장물

/** 물량 추정. 확정 수치가 아닌 범위로만 표기한다(기획서 §2.2, 리스크 대응 ±40%). */
export interface VisionQuantityEstimate {
  value_min: number;
  value_max: number;
  unit: VisionQuantityUnit;
}

/** 현장 개요. */
export interface VisionSiteSummary {
  building_type: string;
  structure: VisionStructureType;
  scale_estimate: string;
  /** 사진 품질 경고(흐림·어두움·각도 부족 등). 없으면 빈 배열. */
  photo_quality_warnings: string[];
}

/** 인식 자재 1건. */
export interface VisionMaterialItem {
  category: VisionMaterialCode;
  /** 신뢰도 0~1. */
  confidence: number;
  location_note: string;
  quantity_estimate: VisionQuantityEstimate;
}

/** 위험 요소 1건. */
export interface VisionHazardItem {
  type: VisionHazardType;
  description: string;
  /**
   * 안내 문구. ASBESTOS_SUSPECT 은 반드시 전문 조사 안내를 포함한다(기획서 §7.1).
   * AI 는 석면 유무를 확정하는 표현을 출력하지 않는다.
   */
  guidance: string;
}

/** 공정 단계별 안전 지침(반드시 RAG 근거 인용). */
export interface VisionSafetyGuideline {
  text: string;
  /** 근거 문서명(예: 'KOSHA 해체공사 안전보건작업 지침'). */
  source_document: string;
  /** 근거 조항(선택). */
  source_clause?: string;
}

/** 세부 공정 1단계. */
export interface VisionProcessStep {
  order: number;
  task_name: string;
  sub_tasks: string[];
  required_equipment: string[];
  required_workforce: string;
  estimated_duration: string;
  safety_guidelines: VisionSafetyGuideline[];
}

/** 폐기물 처리 계획 항목. */
export interface VisionWasteItem {
  category: VisionMaterialCode;
  estimated_amount: VisionQuantityEstimate;
  disposal_method: string;
}

/** 폐기물 처리 계획(디몰링크 매칭 신청 프리필 소스). */
export interface VisionWastePlan {
  items: VisionWasteItem[];
  /** 올바로 전자인계서 의무 대상 여부(건설폐기물 5톤 이상 등). */
  allbaro_manifest_required: boolean;
  /** 의무 대상 판정 근거 설명. */
  allbaro_reason: string;
}

/** 디몰비전 분석 리포트(최상위). */
export interface VisionReport {
  site_summary: VisionSiteSummary;
  materials: VisionMaterialItem[];
  hazards: VisionHazardItem[];
  process_steps: VisionProcessStep[];
  waste_plan: VisionWastePlan;
  /** 법적 고지(고정 문구, 항상 포함). */
  disclaimer: string;
  /** 베이스 모델 + LoRA 어댑터 해시(기획서 §5.1 — 품질 추적·A/B). */
  model_version?: string;
  analyzed_at?: string;
}

/**
 * 법적 고지 고정 문구(기획서 §7.1 · 가장 중요).
 * 모든 리포트에 항상 포함하며 임의로 바꾸지 않는다.
 */
export const VISION_REPORT_DISCLAIMER =
  '본 자료는 참고용 분석이며, 관계 법령에 따른 해체계획서 및 전문가 검토를 대체하지 않습니다.';

/**
 * 석면 의심 항목 안내 고정 문구(기획서 §7.1).
 * ASBESTOS_SUSPECT hazard 의 guidance 는 반드시 이 안내를 포함해야 한다.
 */
export const ASBESTOS_SUSPECT_GUIDANCE =
  '석면안전관리법에 따른 전문 조사기관 조사 필요';

/**
 * AI 가 절대 출력해선 안 되는 석면 "확정" 표현 패턴(기획서 §7.1 출력 검증 레이어).
 * AI 는 석면 유무를 확정할 수 없고 "의심/필요"까지만 표현한다.
 */
const FORBIDDEN_ASBESTOS_CONFIRMATION = [
  /석면\s*(임|입니다|이다|확인|확정|검출됨|존재함|없음|아님)/,
  /석면이\s*(있|없)/,
  /(무|비)석면\s*(확정|확인)/,
];

/** 건설폐기물 예상 총 배출량(톤)으로 올바로 의무신고 대상 여부 판정(5톤 이상). */
export function isAllbaroManifestRequired(estimatedWasteTon: number): boolean {
  return estimatedWasteTon >= ALLBARO_MANDATORY_CONSTRUCTION_WASTE_TON;
}

/**
 * 출력 검증 레이어(기획서 §7.1) — 리포트가 계약·안전 규칙을 지키는지 검사.
 * 위반 메시지 배열을 반환하며, 비어 있으면 통과다.
 * AI 서버(Python)에도 동일 규칙을 구현하되, 프론트/Edge 측 2차 방어선으로 공유한다.
 */
export function validateVisionReport(report: VisionReport): string[] {
  const issues: string[] = [];

  // 1) 고지 고정 문구 필수
  if (report.disclaimer !== VISION_REPORT_DISCLAIMER) {
    issues.push('disclaimer 가 고정 고지 문구와 일치하지 않습니다.');
  }

  // 2) 자재 코드·신뢰도 검증
  for (const [i, m] of report.materials.entries()) {
    if (!isVisionMaterialCode(m.category)) {
      issues.push(`materials[${i}].category 가 분류 체계 v1 코드가 아닙니다: ${m.category}`);
    }
    if (m.confidence < 0 || m.confidence > 1) {
      issues.push(`materials[${i}].confidence 는 0~1 범위여야 합니다: ${m.confidence}`);
    }
  }

  // 3) 석면 의심 자재가 인식되면 hazards 에 ASBESTOS_SUSPECT 가 있어야 함
  const hasAsbestosMaterial = report.materials.some((m) =>
    isVisionMaterialCode(m.category) ? isAsbestosSuspectMaterial(m.category) : false,
  );
  const asbestosHazards = report.hazards.filter((h) => h.type === 'ASBESTOS_SUSPECT');
  if (hasAsbestosMaterial && asbestosHazards.length === 0) {
    issues.push('석면 의심 자재(슬레이트 등) 인식 시 hazards 에 ASBESTOS_SUSPECT 를 포함해야 합니다.');
  }

  // 4) 석면 의심 hazard 는 전문 조사 안내 문구를 포함해야 함
  for (const [i, h] of asbestosHazards.entries()) {
    if (!h.guidance.includes(ASBESTOS_SUSPECT_GUIDANCE)) {
      issues.push(`hazards ASBESTOS_SUSPECT[${i}] 는 전문 조사 안내를 포함해야 합니다.`);
    }
  }

  // 5) 석면 유무 "확정" 표현 금지 — 리포트 전체 텍스트 스캔
  const scanned = [
    report.site_summary.scale_estimate,
    ...report.materials.map((m) => m.location_note),
    ...report.hazards.flatMap((h) => [h.description, h.guidance]),
    ...report.process_steps.flatMap((s) =>
      s.safety_guidelines.map((g) => g.text),
    ),
  ].join('\n');
  for (const pattern of FORBIDDEN_ASBESTOS_CONFIRMATION) {
    if (pattern.test(scanned)) {
      issues.push('석면 유무를 확정하는 표현이 감지되었습니다(§7.1 위반). "의심/조사 필요"로만 표기해야 합니다.');
      break;
    }
  }

  return issues;
}
