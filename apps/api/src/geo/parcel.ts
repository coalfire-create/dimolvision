/**
 * 좌표 → 지번(법정동코드·본번·부번) 변환.
 *
 * 건축물대장 API 는 주소 문자열을 받지 않는다. 시군구코드(5) + 법정동코드(5) +
 * 번(4) + 지(4) 를 요구한다. 그래서 지도에서 찍은 좌표를 이 형식으로 옮겨야 한다.
 *
 * 카카오 로컬 API 를 쓰는데, **두 엔드포인트를 합쳐야** 한다. 실제로 확인해 보면
 * 필요한 네 값이 한쪽에 다 있지 않다:
 *   coord2address     → 본번(main_address_no)·부번(sub_address_no)·산 여부·지번 주소
 *                       (b_code 는 응답에 없다)
 *   coord2regioncode  → region_type 'B' 항목의 code 가 10자리 법정동코드
 *                       (본번·부번은 없다)
 * 그래서 두 번 호출해 합친다. 둘은 서로 독립이라 병렬로 부른다.
 *
 * 키가 없으면 비활성된다 — 지도 없이 코드를 직접 입력하는 경로는 그대로 남는다.
 */

export interface ParcelAddress {
  /** 시군구코드 5자리. */
  sigunguCd: string;
  /** 법정동코드 5자리. */
  bjdongCd: string;
  /** 본번 4자리(0 채움). */
  bun: string;
  /** 부번 4자리(0 채움). */
  ji: string;
  /** 산 여부 — 대장 조회의 platGbCd('0' 대지, '1' 산). */
  platGbCd: '0' | '1';
  /** 사람이 읽는 지번 주소. */
  jibunAddress: string;
  /** 도로명 주소(있을 때). */
  roadAddress?: string;
}

export interface ParcelLookupConfig {
  restApiKey: string;
  timeoutMs: number;
  baseUrl?: string;
}

const DEFAULT_BASE = 'https://dapi.kakao.com';

/** 좌표를 지번 코드로 옮긴다. 실패는 예외 대신 undefined — 분석을 막지 않는다. */
export class ParcelLookupClient {
  constructor(private readonly config: ParcelLookupConfig) {}

  async lookup(lat: number, lng: number): Promise<ParcelAddress | undefined> {
    if (!isValidCoord(lat, lng)) return undefined;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const base = this.config.baseUrl ?? DEFAULT_BASE;
      const init = {
        signal: controller.signal,
        headers: { Authorization: `KakaoAK ${this.config.restApiKey}` },
      };
      // 지번(본번·부번)과 법정동코드는 서로 다른 엔드포인트에 있다. 순서 의존이 없으니 함께 부른다.
      const [addrRes, regionRes] = await Promise.all([
        fetch(`${base}/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`, init),
        fetch(`${base}/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`, init),
      ]);
      if (!addrRes.ok || !regionRes.ok) return undefined;
      const [addr, region] = (await Promise.all([addrRes.json(), regionRes.json()])) as [
        KakaoCoord2Address,
        KakaoCoord2RegionCode,
      ];
      return toParcel(addr, region);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 한국 영역을 벗어난 좌표는 건축물대장이 없으므로 미리 걸러 호출을 아낀다. */
export function isValidCoord(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // 대한민국 본토·제주·울릉을 넉넉히 감싸는 범위.
  return lat >= 33 && lat <= 39.5 && lng >= 124 && lng <= 132;
}

interface KakaoAddress {
  address_name?: string;
  mountain_yn?: string;
  main_address_no?: string;
  sub_address_no?: string;
}

interface KakaoCoord2Address {
  documents?: Array<{
    address?: KakaoAddress;
    road_address?: { address_name?: string } | null;
  }>;
}

/** region_type: 'B' 는 법정동, 'H' 는 행정동. 건축물대장은 **법정동** 코드를 쓴다. */
interface KakaoCoord2RegionCode {
  documents?: Array<{
    region_type?: string;
    code?: string;
    address_name?: string;
  }>;
}

/**
 * 카카오 응답 → 대장 조회용 코드.
 * b_code 가 10자리가 아니면 지번을 특정할 수 없으므로 포기한다(추측하지 않는다).
 */
export function toParcel(
  body: KakaoCoord2Address,
  region: KakaoCoord2RegionCode,
): ParcelAddress | undefined {
  const doc = body.documents?.[0];
  const a = doc?.address;
  // 행정동('H')을 쓰면 건축물대장이 조회되지 않는다. 반드시 법정동('B')이어야 한다.
  const bcode = (region.documents?.find((d) => d.region_type === 'B')?.code ?? '').trim();
  if (bcode.length !== 10) return undefined;
  // 지번이 없으면 대장을 특정할 수 없다(도로 한가운데를 찍은 경우 등).
  if (!a) return undefined;

  return {
    sigunguCd: bcode.slice(0, 5),
    bjdongCd: bcode.slice(5),
    bun: pad4(a.main_address_no),
    ji: pad4(a.sub_address_no),
    platGbCd: a.mountain_yn === 'Y' ? '1' : '0',
    jibunAddress: (a.address_name ?? '').trim(),
    ...(doc?.road_address?.address_name
      ? { roadAddress: doc.road_address.address_name.trim() }
      : {}),
  };
}

/** 번·지는 4자리 0 채움이 규격이다. 비었으면 '0000'. */
function pad4(v: string | undefined): string {
  const n = Number((v ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return '0000';
  return String(Math.trunc(n)).padStart(4, '0');
}
