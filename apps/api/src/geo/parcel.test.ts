import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParcelLookupClient, isValidCoord, toParcel } from './parcel.js';

describe('isValidCoord — 한국 밖 좌표는 호출하지 않는다', () => {
  it('국내 좌표는 통과', () => {
    expect(isValidCoord(37.5866, 126.97)).toBe(true);   // 서울
    expect(isValidCoord(33.4996, 126.5312)).toBe(true); // 제주
  });

  it('국외·비정상 좌표는 거른다 — 건축물대장이 없어 호출이 낭비다', () => {
    expect(isValidCoord(48.85, 2.35)).toBe(false);   // 파리
    expect(isValidCoord(0, 0)).toBe(false);
    expect(isValidCoord(NaN, 126)).toBe(false);
  });
});

describe('toParcel — 두 카카오 응답을 대장 조회 코드로 합친다', () => {
  // 실제 응답 형태다. coord2address 에는 b_code 가 없고, 법정동코드는 coord2regioncode 에만 있다.
  const addr = (address: Record<string, unknown>, road?: string) => ({
    documents: [{ address, ...(road ? { road_address: { address_name: road } } : {}) }],
  });
  const region = (bcode?: string, extra: Array<Record<string, unknown>> = []) => ({
    documents: [
      // 행정동이 먼저 오는 응답도 있으므로 순서에 기대지 않는다.
      { region_type: 'H', code: '1114055000', address_name: '서울특별시 중구 명동' },
      ...(bcode ? [{ region_type: 'B', code: bcode, address_name: '서울특별시 중구 태평로1가' }] : []),
      ...extra,
    ],
  });

  it('법정동코드 10자리를 시군구 5 + 법정동 5 로 가른다', () => {
    const p = toParcel(
      addr({ address_name: '서울 종로구 청운동 1', main_address_no: '1', sub_address_no: '0', mountain_yn: 'N' }),
      region('1111010100'),
    )!;
    expect(p.sigunguCd).toBe('11110');
    expect(p.bjdongCd).toBe('10100');
    expect(p.bun).toBe('0001');
    expect(p.ji).toBe('0000');
    expect(p.platGbCd).toBe('0');
    expect(p.jibunAddress).toBe('서울 종로구 청운동 1');
  });

  it('행정동 코드를 쓰지 않는다 — 대장은 법정동 기준이다', () => {
    // 법정동('B')이 없고 행정동('H')만 오면 포기해야 한다. 행정동 코드로 조회하면 결과가 없다.
    expect(toParcel(addr({ main_address_no: '1' }), region(undefined))).toBeUndefined();
  });

  it('본번·부번을 4자리로 0 채움한다 — 대장 규격', () => {
    const p = toParcel(addr({ main_address_no: '123', sub_address_no: '45' }), region('1111010100'))!;
    expect(p.bun).toBe('0123');
    expect(p.ji).toBe('0045');
  });

  it('산 주소는 platGbCd 1', () => {
    expect(toParcel(addr({ mountain_yn: 'Y' }), region('4111010100'))!.platGbCd).toBe('1');
  });

  it('도로명 주소가 있으면 함께 담는다', () => {
    const p = toParcel(addr({}, '서울 종로구 자하문로36길 16'), region('1111010100'))!;
    expect(p.roadAddress).toBe('서울 종로구 자하문로36길 16');
  });

  it('법정동코드가 10자리가 아니면 포기한다 — 지번을 추측하지 않는다', () => {
    expect(toParcel(addr({}), region('1111'))).toBeUndefined();
    expect(toParcel(addr({}), { documents: [] })).toBeUndefined();
    expect(toParcel(addr({}), {})).toBeUndefined();
  });

  it('지번 정보가 없으면 포기한다 — 도로 한가운데를 찍은 경우', () => {
    expect(toParcel({ documents: [] }, region('1111010100'))).toBeUndefined();
    expect(toParcel({}, region('1111010100'))).toBeUndefined();
  });
});

describe('ParcelLookupClient', () => {
  afterEach(() => vi.unstubAllGlobals());
  const c = () =>
    new ParcelLookupClient({ restApiKey: 'k', timeoutMs: 3000, baseUrl: 'https://kakao.test' });

  /** 엔드포인트별로 다른 응답을 주는 가짜 fetch. 실제로 두 곳을 다 부르는지 본다. */
  const stub = (opts: { addrOk?: boolean; regionOk?: boolean } = {}) =>
    vi.fn(async (url: string) => {
      if (String(url).includes('coord2regioncode')) {
        return {
          ok: opts.regionOk ?? true,
          json: async () => ({ documents: [{ region_type: 'B', code: '1111010100' }] }),
        };
      }
      return {
        ok: opts.addrOk ?? true,
        json: async () => ({ documents: [{ address: { main_address_no: '1', sub_address_no: '0' } }] }),
      };
    });

  it('지번과 법정동코드를 각각 다른 엔드포인트에서 받아 합친다', async () => {
    const f = stub();
    vi.stubGlobal('fetch', f);
    const p = await c().lookup(37.5866, 126.97);
    expect(p?.sigunguCd).toBe('11110');
    expect(p?.bjdongCd).toBe('10100');
    expect(p?.bun).toBe('0001');

    const urls = f.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes('coord2address'))).toBe(true);
    expect(urls.some((u) => u.includes('coord2regioncode'))).toBe(true);
    for (const u of urls) {
      expect(u).toContain('x=126.97');
      expect(u).toContain('y=37.5866');
    }
    expect((f.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe('KakaoAK k');
  });

  it('국외 좌표는 아예 호출하지 않는다', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await c().lookup(48.85, 2.35)).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it('둘 중 하나라도 실패하면 undefined — 반쪽 코드로 대장을 조회하지 않는다', async () => {
    vi.stubGlobal('fetch', stub({ regionOk: false }));
    expect(await c().lookup(37.5, 127)).toBeUndefined();
    vi.stubGlobal('fetch', stub({ addrOk: false }));
    expect(await c().lookup(37.5, 127)).toBeUndefined();
  });

  it('네트워크 실패는 undefined — 분석을 막지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await c().lookup(37.5, 127)).toBeUndefined();
  });
});
