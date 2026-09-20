import { Platform } from 'react-native';
import type {
  BuildingStructure,
  CostEstimate,
  RoomMeasurement,
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
const PROD_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api';

export const API_BASE_URL = isWeb && !__DEV__ ? '/api' : PROD_API_BASE_URL;

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
  /** 방 단위 실측(부분 철거). 있으면 연면적 힌트보다 우선한다. */
  rooms?: RoomMeasurement[];
}) => api<SiteAnalysis>('/site-analysis/analyze', { method: 'POST', body: JSON.stringify(input) });

/** 층별개요 한 줄 — 그 층의 바닥면적을 대장 등재값으로 알려 준다. */
export interface BuildingFloor {
  dongName?: string;
  floorGroup?: string;
  floorName: string;
  areaM2: number;
  structureName?: string;
  mainUse?: string;
}

/** 건축물대장 조회 결과(주소 코드를 보냈을 때만 온다). */
export interface BuildingRegisterInfo {
  structureName?: string;
  totalFloorAreaM2?: number;
  floorsAbove?: number;
  approvedYear?: number;
  mainUse?: string;
  buildingName?: string;
  /** 층별개요. 건물 일부만 철거할 때 대상 층을 고르는 근거. */
  floors?: BuildingFloor[];
}

/**
 * 지번으로 건축물대장을 미리 조회한다(주소를 찍은 직후).
 * 층 목록을 먼저 보여 줘야 사용자가 "어느 층을 철거하는지" 를 고르고 분석할 수 있다.
 */
export const lookupBuildingRegister = (q: {
  sigunguCd: string;
  bjdongCd: string;
  bun?: string;
  ji?: string;
}) =>
  api<BuildingRegisterInfo>(
    `/building-register?${new URLSearchParams({
      sigunguCd: q.sigunguCd,
      bjdongCd: q.bjdongCd,
      ...(q.bun ? { bun: q.bun } : {}),
      ...(q.ji ? { ji: q.ji } : {}),
    }).toString()}`,
  );

/** 공공데이터 건물 외곽선 — 평면 형상과 건축면적. */
export interface BuildingOutline {
  /** 외곽선 좌표(경위도). 도면을 그리는 데 쓴다. */
  ring: Array<[number, number]>;
  /** 외곽선으로 계산한 건축면적(㎡). */
  areaM2: number;
  perimeterM: number;
  buildingName?: string;
}

/**
 * 지도에서 찍은 좌표의 건물 외곽선을 공공데이터에서 가져온다.
 * 건물 전체 철거라면 영상을 찍지 않아도 여기서 실제 형상과 건축면적이 나온다.
 */
export const lookupBuildingOutline = (lat: number, lng: number) =>
  api<BuildingOutline>(`/building-outline?lat=${lat}&lng=${lng}`);

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
  /** rooms 를 보냈을 때만 온다 — 서버가 실제로 계산에 쓴 방 목록·합계 면적(검산용). */
  rooms?: RoomMeasurement[];
  roomsAreaM2?: number;
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
  /**
   * 방 단위 실측(부분 철거용). 있으면 floorAreaM2/floors·건축물대장 연면적보다
   * 우선해서 물량 산정에 쓴다 — 건물 일부만 철거할 때 건물 전체 연면적은 틀린 값이다.
   */
  rooms?: RoomMeasurement[];
}) =>
  api<PhotoWasteItemsResult>('/site-analysis/waste-items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
