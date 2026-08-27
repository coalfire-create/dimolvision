/**
 * 현장 사진 업로드 공통 규칙 (철거요청 / 처리장예약 UI · 로드맵 Phase 1 §4.2).
 * 백엔드(presign 검증)와 모바일(업로드 전 사전 검증)에서 공유한다.
 *
 * 업로드 흐름: 앱이 presign 요청 → 서버가 스토리지(S3 호환) presigned PUT URL 발급 →
 * 앱이 스토리지에 직접 업로드 → 발급받은 오브젝트 키를 매칭요청에 연결.
 */

/** 업로드 목적 — 어떤 화면에서 올라온 사진인지. 오브젝트 키 경로에 반영된다. */
export type SitePhotoPurpose =
  | 'DEMOLITION_REQUEST' // 철거요청 UI
  | 'DISPOSAL_RESERVATION'; // 처리장 예약 UI

export const SITE_PHOTO_PURPOSES: readonly SitePhotoPurpose[] = [
  'DEMOLITION_REQUEST',
  'DISPOSAL_RESERVATION',
];

/** 허용 이미지 형식. 현장 촬영 기준 — iOS 기본 포맷(HEIC) 포함. */
export const SITE_PHOTO_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

export type SitePhotoContentType = (typeof SITE_PHOTO_ALLOWED_CONTENT_TYPES)[number];

/** 사진 1장 최대 크기(10MB). presign 시 Content-Length 를 서명에 포함해 강제한다. */
export const SITE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/** 매칭요청 1건당 첨부 가능한 현장 사진 수. */
export const SITE_PHOTOS_MAX_PER_REQUEST = 10;

/**
 * 오브젝트 키 공통 prefix.
 * 키에는 PII(사업자등록번호, 업체명 등)를 절대 넣지 않는다 — 무작위 UUID 만 사용.
 */
export const SITE_PHOTO_KEY_PREFIX = 'site-photos/';

/** purpose → 키 경로 세그먼트. */
export const SITE_PHOTO_PURPOSE_PATH: Record<SitePhotoPurpose, string> = {
  DEMOLITION_REQUEST: 'demolition-request',
  DISPOSAL_RESERVATION: 'disposal-reservation',
};

const CONTENT_TYPE_EXTENSION: Record<SitePhotoContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export function isAllowedSitePhotoContentType(value: string): value is SitePhotoContentType {
  return (SITE_PHOTO_ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

/** contentType 에 대응하는 파일 확장자 (키 생성용). */
export function sitePhotoExtension(contentType: SitePhotoContentType): string {
  return CONTENT_TYPE_EXTENSION[contentType];
}

/**
 * 서버가 발급한 현장 사진 키 형식인지 검증.
 * `site-photos/<purpose>/<uuid>.<ext>` 형식만 매칭요청에 연결을 허용해,
 * 외부 URL 이나 임의 경로가 매칭요청 데이터에 끼어드는 것을 막는다.
 */
const SITE_PHOTO_KEY_PATTERN =
  /^site-photos\/(demolition-request|disposal-reservation)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic)$/;

export function isValidSitePhotoKey(key: string): boolean {
  return SITE_PHOTO_KEY_PATTERN.test(key);
}
