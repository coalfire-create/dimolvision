/**
 * 좌표·거리 계산 유틸 (거리 기반 매칭에 사용).
 * 순수 함수만 모아 프론트(거리 표시)와 백엔드(매칭 랭킹)에서 공유한다.
 */

export interface GeoPoint {
  /** 위도 -90 ~ 90. */
  lat: number;
  /** 경도 -180 ~ 180. */
  lng: number;
}

/** 지구 평균 반지름(km). */
const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function isValidGeoPoint(p: GeoPoint): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

/**
 * 두 좌표 사이의 대권거리(하버사인 공식, km).
 * 도로거리가 아닌 직선거리이며, 기본 매칭 정렬 기준으로 충분하다.
 * (도로거리/ETA 기반 고도화는 로드맵 Phase 3 이후.)
 */
export function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  if (!isValidGeoPoint(a) || !isValidGeoPoint(b)) {
    throw new Error('유효한 좌표(lat -90~90, lng -180~180)가 필요합니다.');
  }
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  // asin 인자를 1로 클램프해 부동소수 오차로 인한 NaN 방지.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
