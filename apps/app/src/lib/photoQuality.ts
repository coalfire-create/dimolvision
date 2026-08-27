import { Platform } from 'react-native';
import { decode as decodeJpeg } from 'jpeg-js';
import { computeLumaStats, isPhotoQualityOk, subsampleRgba, type LumaStats } from '@dimol/shared';

/**
 * 촬영 즉시 품질(암전/렌즈 가림/흐림) 검증.
 * 사진의 평균 밝기·명암 분산을 계산한다(AI 호출 없이 순수 클라이언트 연산).
 *
 * 플랫폼별 픽셀 추출:
 * - 웹(react-native-web): 작은 캔버스에 그려 `getImageData` 로 RGBA 픽셀을 얻는다.
 * - 네이티브(Android/iOS): 캔버스가 없으므로 JPEG(base64)를 순수 JS 디코더(jpeg-js)로
 *   풀어 RGBA 를 얻는다 — 네이티브 재빌드 없이 동작한다.
 *
 * 어느 경로든 실패하면 촬영을 막지 않는다(사용자 흐름 우선, supported:false).
 */

export interface QualityResult {
  /** 이 플랫폼에서 품질 검증을 실제 수행했는지. */
  supported: boolean;
  /** 품질 기준 통과 여부(미지원이면 통과로 둔다). */
  ok: boolean;
  /** 계산된 밝기 통계(지원 시). */
  stats?: LumaStats;
}

export interface QualityInput {
  /** JPEG base64(접두어 없음). 네이티브 디코딩에 사용. */
  base64: string;
  /** 이미지 URI(웹 캔버스 로딩에 사용). data URL 또는 blob URL. */
  uri: string;
  mimeType: string;
}

/** 통계를 뽑을 다운샘플 해상도(작을수록 빠름, 밝기·분산엔 충분). */
const SAMPLE_SIZE = 64;

const PASS: QualityResult = { supported: false, ok: true };

// ── 웹: 캔버스 ────────────────────────────────────────────────────────────────
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

async function analyzeWeb(uri: string): Promise<QualityResult> {
  if (typeof document === 'undefined') return PASS;
  const img = await loadImage(uri);
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return PASS;
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const stats = computeLumaStats(data);
  return { supported: true, ok: isPhotoQualityOk(stats), stats };
}

// ── 네이티브: jpeg-js 디코딩 ─────────────────────────────────────────────────
function base64ToBytes(b64: string): Uint8Array | null {
  const g = globalThis as { atob?: (s: string) => string };
  if (typeof g.atob !== 'function') return null;
  const bin = g.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function analyzeNative(base64: string): QualityResult {
  const bytes = base64ToBytes(base64);
  if (!bytes) return PASS;
  // useTArray 로 복사 최소화, 순수 JS 디코딩(네이티브 모듈 불필요).
  const decoded = decodeJpeg(bytes, { useTArray: true, maxMemoryUsageInMB: 256 });
  if (!decoded?.data || !decoded.width || !decoded.height) return PASS;
  const pixels = subsampleRgba(decoded.data, decoded.width, decoded.height, SAMPLE_SIZE);
  const stats = computeLumaStats(pixels);
  return { supported: true, ok: isPhotoQualityOk(stats), stats };
}

export async function analyzePhotoQuality(input: QualityInput): Promise<QualityResult> {
  try {
    if (Platform.OS === 'web') return await analyzeWeb(input.uri);
    // 네이티브는 JPEG 만 디코딩(카메라 산출물은 JPEG). 그 외 포맷은 통과.
    if (input.mimeType !== 'image/jpeg' || !input.base64) return PASS;
    return analyzeNative(input.base64);
  } catch {
    return PASS;
  }
}
