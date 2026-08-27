import { ALLBARO_MANDATORY_CONSTRUCTION_WASTE_TON } from './constants.js';
import type { WasteCategory } from './types.js';

/**
 * 올바로 전자인계서 의무신고 대상 여부.
 * 건설폐기물이면서 기준 중량(5톤) 이상이면 의무 대상 → 안내 팝업 표시 대상.
 *
 * ⚠️ 실제 발행/연동 로직(ALLBARO_API 경로)은 CLAUDE.md「사람이 반드시 직접 diff를
 * 검토해야 하는 영역」에 해당하므로 자동 커밋/머지하지 않는다.
 */
export function isAllbaroManifestMandatory(
  wasteCategory: WasteCategory,
  wasteTons: number,
): boolean {
  return wasteCategory === 'CONSTRUCTION' && wasteTons >= ALLBARO_MANDATORY_CONSTRUCTION_WASTE_TON;
}

export type AllbaroRoleType = 'DISCHARGER' | 'TRANSPORT' | 'DISPOSAL';

export interface TransportInfoRequest {
  manifestNo: string;
  vehicleNo: string;
  transportedTons: number;
  pickupAt: string;
}

export interface DisposalInfoRequest {
  manifestNo: string;
  weighedTons: number;
  receivedAt: string;
}

export interface TreatmentCompletionRequest {
  manifestNo: string;
  completedAt: string;
  treatmentMethodCode?: string;
}

export interface AllbaroNoticeItem {
  id: string;
  title: string;
  createdAt: string;
  content?: string;
}

export interface AllbaroManifestStatus {
  manifestNo: string;
  status: string;
  dischargerName?: string;
  transportName?: string;
  disposalName?: string;
  wasteTons?: number;
  issuedAt?: string;
  updatedAt?: string;
}

