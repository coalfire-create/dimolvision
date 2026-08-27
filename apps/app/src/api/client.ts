import { Platform } from 'react-native';
import type { SiteAnalysis, WasteItem } from '@dimol/shared';

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
}) => api<SiteAnalysis>('/site-analysis/analyze', { method: 'POST', body: JSON.stringify(input) });

export interface PhotoWasteItemsResult {
  analysis: SiteAnalysis;
  wasteItems: WasteItem[];
}

export const analyzeSiteWasteItems = (input: {
  imageBase64?: string;
  mimeType?: string;
  images?: AnalyzeImage[];
  floorAreaM2?: number;
  buildingStructure?: string;
}) =>
  api<PhotoWasteItemsResult>('/site-analysis/waste-items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
