import { Platform } from 'react-native';
import type {
  BuildingStructure,
  CostEstimate,
  SiteAnalysis,
  VolumeEstimate,
  WasteItem,
} from '@dimol/shared';

/**
 * 디몰비전 API 클라이언트(경량형). 디몰링크 본체 클라이언트에서 현장 분석 호출만 분리했다.
 * 인증·세션 없음. 베이스 URL 은 빌드 시 EXPO_PUBLIC_API_BASE_URL 로 지정한다.
 */
const isWeb = Platform.OS === 'web';

/** 운영 백엔드(디몰비전 API). 배포 시 EXPO_PUBLIC_API_BASE_URL 로 오버라이드. */
const PROD_API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api';

export const API_BASE_URL =
  isWeb && !__DEV__ ? '/api' : PROD_API_BASE_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.', 0);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : '요청 처리에 실패했습니다.';
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export interface AnalyzeImage {
  imageBase64: string;
  mimeType?: string;
}

export const analyzeSite = (input: {
  imageBase64?: string;
  mimeType?: string;
  images?: AnalyzeImage[];
  note?: string;
  buildingStructure?: string;
  /** 건축물대장 사용승인 연도 — 2009년 석면 금지 이전이면 석면 의심을 가중한다. */
  buildingYear?: number;
  buildingUse?: string;
  /**
   * 건축물대장 조회용 주소 코드. 함께 보내면 서버가 대장을 조회해
   * 주구조·연면적·층수·사용승인연도·주용도를 자동으로 힌트에 채운다.
   */
  sigunguCd?: string;
  bjdongCd?: string;
  bun?: string;
  ji?: string;
}) => api<SiteAnalysis>('/site-analysis/analyze', { method: 'POST', body: JSON.stringify(input) });

/** 건축물대장 조회 결과(주소 코드를 보냈을 때만 온다). */
export interface BuildingRegisterInfo {
  structureName?: string;
  totalFloorAreaM2?: number;
  floorsAbove?: number;
  approvedYear?: number;
  mainUse?: string;
  buildingName?: string;
}

export interface PhotoWasteItemsResult {
  analysis: SiteAnalysis;
  buildingRegister?: BuildingRegisterInfo;
  wasteItems: WasteItem[];
  /** 연면적을 함께 보냈을 때만 온다 — 추정 톤수·범위·트럭 대수. */
  estimate?: VolumeEstimate;
  /**
   * 공표 단가 기반 금액 견적. 분류별 물량이 나왔을 때만 온다.
   * 처리비·운반비·인건비·장비비와 간접비를 항목별로, 각각 하한~상한 범위로 준다.
   */
  cost?: CostEstimate;
}

export const analyzeSiteWasteItems = (input: {
  imageBase64?: string;
  mimeType?: string;
  images?: AnalyzeImage[];
  floorAreaM2?: number;
  floors?: number;
  structure?: BuildingStructure;
  buildingStructure?: string;
  buildingYear?: number;
  buildingUse?: string;
  /**
   * 건축물대장 조회용 주소 코드. 함께 보내면 서버가 대장을 조회해
   * 주구조·연면적·층수·사용승인연도·주용도를 자동으로 힌트에 채운다.
   */
  sigunguCd?: string;
  bjdongCd?: string;
  bun?: string;
  ji?: string;
  /** 처리장까지 운반거리(km). 없으면 30km 기준으로 계산한다. */
  distanceKm?: number;
}) =>
  api<PhotoWasteItemsResult>('/site-analysis/waste-items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
