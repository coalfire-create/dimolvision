/**
 * 건물 외곽선 조회 — 공공데이터포털 GIS건물통합정보(WFS).
 *
 * 왜 쓰는가: 이 서비스에서 **평면 형상을 공공데이터로 얻을 수 있는 유일한 경로**다.
 * 건축물대장의 평면도(건축물현황도)는 「건축물대장의 기재 및 관리 등에 관한 규칙」상
 * 소유자 동의가 있어야 열람할 수 있어 임의 건물에 대해서는 받을 수 없다. 반면 GIS건물
 * 통합정보는 연속지적도 기반의 건물 외곽선을 공개하므로, 건물 전체 철거라면 영상을
 * 찍지 않고도 실제 형상과 건축면적을 근거 있게 얻는다.
 *
 * 좌표계에 대하여: 응답은 경위도(EPSG:4326)로 받고, 면적은 **그 자리에서 국소 평면으로
 * 근사해** 미터로 잰다. 투영 라이브러리를 끌어오지 않는 이유는 검증할 수 없는 좌표변환을
 * 코드에 넣지 않기 위해서다. 건물 한 동은 수십 미터라 그 범위에서 지구 곡률 오차는
 * 0.01% 미만이고, 신발끈 공식으로 바로 ㎡ 가 나온다.
 */

/** 폴리곤 하나의 바깥 고리(닫힌 좌표 목록). [x, y] 순서, 단위는 요청한 좌표계를 따른다. */
export type OutlineRing = Array<[number, number]>;

export interface BuildingOutline {
  /** 건물 외곽선(바깥 고리). */
  ring: OutlineRing;
  /** 외곽선으로 계산한 건축면적(㎡). */
  areaM2: number;
  /** 외곽선 둘레(m). */
  perimeterM: number;
  /** 대장 연계 속성에서 온 건물명(있을 때). */
  buildingName?: string;
}

/**
 * 신발끈(shoelace) 공식으로 폴리곤 면적을 낸다. 좌표가 미터 단위일 때 결과가 ㎡ 다.
 * 고리가 시계/반시계 어느 쪽이든 절댓값을 쓰므로 방향에 무관하다.
 */
export function ringAreaM2(ring: OutlineRing): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** 고리의 둘레(좌표계 단위). */
export function ringPerimeter(ring: OutlineRing): number {
  if (ring.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

/**
 * 점이 폴리곤 안에 있는지(ray casting).
 * 한 지번에 건물이 여러 동이면 지도에서 찍은 그 점을 품은 동을 골라야 한다.
 */
export function pointInRing(point: [number, number], ring: OutlineRing): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const crosses = yi > py !== yj > py;
    if (crosses && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 후보 중 하나를 고른다. 찍은 점을 품은 건물이 있으면 그것을, 없으면 가장 큰 건물을 쓴다.
 * (지적도와 실제 건물 위치가 조금 어긋나 점이 밖으로 떨어지는 경우가 실제로 있다.)
 */
export function pickOutline(
  rings: OutlineRing[],
  point?: [number, number],
): OutlineRing | undefined {
  const usable = rings.filter((r) => r.length >= 3);
  if (usable.length === 0) return undefined;
  if (point) {
    const hit = usable.find((r) => pointInRing(point, r));
    if (hit) return hit;
  }
  return usable.reduce((a, b) => (ringAreaM2(b) > ringAreaM2(a) ? b : a));
}

/**
 * GeoJSON FeatureCollection 에서 바깥 고리들을 뽑는다.
 *
 * 응답을 느슨하게 읽는 이유: 이 서비스는 Polygon 과 MultiPolygon 이 섞여 오고, 속성
 * 필드명도 갱신 시점마다 달라진다. 모양이 조금 달라졌다고 기능이 통째로 죽는 것보다,
 * 읽을 수 있는 것만 읽고 나머지는 건너뛰는 편이 낫다 — 없으면 없는 대로 분석은 돌아간다.
 */
export function parseOutlineFeatures(body: unknown): Array<{ ring: OutlineRing; name?: string }> {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: Array<{ ring: OutlineRing; name?: string }> = [];
  for (const f of features) {
    if (typeof f !== 'object' || f === null) continue;
    const geometry = (f as { geometry?: unknown }).geometry as
      { type?: unknown; coordinates?: unknown } | undefined;
    const props = (f as { properties?: unknown }).properties as Record<string, unknown> | undefined;
    const name =
      typeof props?.bldNm === 'string' && props.bldNm.trim() ? props.bldNm.trim() : undefined;
    if (!geometry || typeof geometry.type !== 'string') continue;

    // Polygon: [ring, hole...] / MultiPolygon: [[ring, hole...], ...] — 바깥 고리만 쓴다.
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)
          ? geometry.coordinates
          : [];
    for (const poly of polygons) {
      const outer = Array.isArray(poly) ? poly[0] : undefined;
      const ring = toRing(outer);
      if (ring.length >= 3) out.push({ ring, ...(name ? { name } : {}) });
    }
  }
  return out;
}

function toRing(raw: unknown): OutlineRing {
  if (!Array.isArray(raw)) return [];
  const ring: OutlineRing = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    ring.push([x, y]);
  }
  return ring;
}

/** 위도 1도의 길이(m). 위도에 따라 조금 달라지지만 건물 한 동 범위에서는 상수로 충분하다. */
const METERS_PER_DEG_LAT = 110_574;
/** 적도에서 경도 1도의 길이(m). 실제 길이는 여기에 cos(위도)를 곱한다. */
const METERS_PER_DEG_LNG_EQUATOR = 111_320;

/**
 * 경위도 고리를 기준점 중심의 국소 미터 좌표로 옮긴다.
 * 기준점 위도에서의 평면으로 근사하므로 수백 미터 범위에서만 쓴다.
 */
export function ringToLocalMeters(ring: OutlineRing, origin: [number, number]): OutlineRing {
  const [lng0, lat0] = origin;
  const mPerLng = METERS_PER_DEG_LNG_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  return ring.map(([lng, lat]) => [(lng - lng0) * mPerLng, (lat - lat0) * METERS_PER_DEG_LAT]);
}

export interface BuildingOutlineConfig {
  serviceKey: string;
  timeoutMs: number;
  /** WFS 엔드포인트. 서비스 이관(건축HUB 등)으로 바뀔 수 있어 환경변수로 뺀다. */
  baseUrl: string;
  /** 레이어(typename). 데이터 갱신 주기마다 이름이 바뀌므로 설정값으로 둔다. */
  typeName: string;
}

/** 좌표 주변 몇 미터까지 훑을지. 건물 한 동을 덮을 만큼만 — 넓히면 옆 건물이 딸려 온다. */
const SEARCH_HALF_SIDE_M = 60;

export class BuildingOutlineClient {
  constructor(private readonly config: BuildingOutlineConfig) {}

  /** 지도에서 찍은 위경도 주변의 건물 외곽선을 찾는다. */
  async lookup(lat: number, lng: number): Promise<BuildingOutline | undefined> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;

    const dLat = SEARCH_HALF_SIDE_M / METERS_PER_DEG_LAT;
    const dLng =
      SEARCH_HALF_SIDE_M / (METERS_PER_DEG_LNG_EQUATOR * Math.cos((lat * Math.PI) / 180));
    const params = new URLSearchParams({
      serviceKey: this.config.serviceKey,
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typename: this.config.typeName,
      srsName: 'EPSG:4326',
      outputFormat: 'application/json',
      bbox: [lng - dLng, lat - dLat, lng + dLng, lat + dLat, 'EPSG:4326'].join(','),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl}?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) return undefined;
      const features = parseOutlineFeatures(await res.json());
      if (features.length === 0) return undefined;
      const ring = pickOutline(
        features.map((f) => f.ring),
        [lng, lat],
      );
      if (!ring) return undefined;

      const picked = features.find((f) => f.ring === ring);
      const metric = ringToLocalMeters(ring, [lng, lat]);
      const r1 = (n: number) => Math.round(n * 10) / 10;
      return {
        ring,
        areaM2: r1(ringAreaM2(metric)),
        perimeterM: r1(ringPerimeter(metric)),
        ...(picked?.name ? { buildingName: picked.name } : {}),
      };
    } catch {
      // 공간정보 서비스도 장애·쿼터가 잦다. 없으면 없는 대로 진행한다.
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}
