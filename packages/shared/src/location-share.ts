import type { GeoPoint } from './geo.js';

/**
 * 실시간 위치 공유 (로드맵 Phase 4 · 운영 도구).
 * 작업 진행중(IN_PROGRESS)인 요청에 한해 매칭 업체(운반 차량)가 위치를 올리고
 * 배출자가 조회한다. 작업이 끝나면 공유도 종료된다 (위치는 저장·이력화하지 않는다).
 */
export interface LocationShare {
  requestId: string;
  /** 위치를 공유하는 매칭 업체. */
  providerId: string;
  location: GeoPoint;
  updatedAt: string;
}
