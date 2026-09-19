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

describe('toParcel — 카카오 응답을 대장 조회 코드로', () => {
  const doc = (address: Record<string, unknown>, road?: string) => ({
    documents: [{ address, ...(road ? { road_address: { address_name: road } } : {}) }],
  });

  it('b_code 10자리를 시군구 5 + 법정동 5 로 가른다', () => {
    const p = toParcel(doc({
      b_code: '1111010100', address_name: '서울 종로구 청운동 1',
      main_address_no: '1', sub_address_no: '0', mountain_yn: 'N',
    }))!;
    expect(p.sigunguCd).toBe('11110');
    expect(p.bjdongCd).toBe('10100');
    expect(p.bun).toBe('0001');
    expect(p.ji).toBe('0000');
    expect(p.platGbCd).toBe('0');
    expect(p.jibunAddress).toBe('서울 종로구 청운동 1');
  });

  it('본번·부번을 4자리로 0 채움한다 — 대장 규격', () => {
    const p = toParcel(doc({ b_code: '1111010100', main_address_no: '123', sub_address_no: '45' }))!;
    expect(p.bun).toBe('0123');
    expect(p.ji).toBe('0045');
  });

  it('산 주소는 platGbCd 1', () => {
    expect(toParcel(doc({ b_code: '4111010100', mountain_yn: 'Y' }))!.platGbCd).toBe('1');
  });

  it('도로명 주소가 있으면 함께 담는다', () => {
    const p = toParcel(doc({ b_code: '1111010100' }, '서울 종로구 자하문로36길 16'))!;
    expect(p.roadAddress).toBe('서울 종로구 자하문로36길 16');
  });

  it('b_code 가 10자리가 아니면 포기한다 — 지번을 추측하지 않는다', () => {
    expect(toParcel(doc({ b_code: '1111' }))).toBeUndefined();
    expect(toParcel(doc({}))).toBeUndefined();
    expect(toParcel({ documents: [] })).toBeUndefined();
    expect(toParcel({})).toBeUndefined();
  });
});

describe('ParcelLookupClient', () => {
  afterEach(() => vi.unstubAllGlobals());
  const c = () => new ParcelLookupClient({ restApiKey: 'k', timeoutMs: 3000, baseUrl: 'https://kakao.test' });

  it('좌표를 쿼리로 보내고 인증 헤더를 붙인다', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ documents: [{ address: { b_code: '1111010100', main_address_no: '1' } }] }),
    }));
    vi.stubGlobal('fetch', f);
    const p = await c().lookup(37.5866, 126.97);
    expect(p?.sigunguCd).toBe('11110');
    const url = String(f.mock.calls[0]?.[0]);
    expect(url).toContain('x=126.97');
    expect(url).toContain('y=37.5866');
    expect((f.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe('KakaoAK k');
  });

  it('국외 좌표는 아예 호출하지 않는다', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await c().lookup(48.85, 2.35)).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it('오류·네트워크 실패는 undefined — 분석을 막지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    expect(await c().lookup(37.5, 127)).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await c().lookup(37.5, 127)).toBeUndefined();
  });
});
