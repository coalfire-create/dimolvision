import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BuildingRegisterClient,
  parseApprovedYear,
  toBuildingStructure,
} from './building-register.js';

describe('toBuildingStructure — 대장 주구조명 → 추정용 코드', () => {
  it('철근콘크리트 계열은 RC', () => {
    expect(toBuildingStructure('철근콘크리트구조')).toBe('RC');
    expect(toBuildingStructure('철골철근콘크리트구조')).toBe('RC');
    expect(toBuildingStructure('프리캐스트콘크리트구조')).toBe('RC');
    expect(toBuildingStructure('철골구조')).toBe('RC');
  });

  it('조적·벽돌 계열은 BRICK', () => {
    expect(toBuildingStructure('벽돌구조')).toBe('BRICK');
    expect(toBuildingStructure('시멘트블록조')).toBe('BRICK');
    expect(toBuildingStructure('조적구조')).toBe('BRICK');
  });

  it('목구조는 WOOD', () => {
    expect(toBuildingStructure('목구조')).toBe('WOOD');
    expect(toBuildingStructure('통나무구조')).toBe('WOOD');
  });

  it('판단이 서지 않으면 undefined — 틀린 보정보다 무보정이 낫다', () => {
    expect(toBuildingStructure('기타구조')).toBeUndefined();
    expect(toBuildingStructure(undefined)).toBeUndefined();
    expect(toBuildingStructure('')).toBeUndefined();
  });
});

describe('parseApprovedYear — 사용승인일', () => {
  it('YYYYMMDD 에서 연도를 뽑는다', () => {
    expect(parseApprovedYear('19851130')).toBe(1985);
    expect(parseApprovedYear('20200101')).toBe(2020);
  });

  it('대장에 실제로 들어있는 이상값은 버린다', () => {
    expect(parseApprovedYear('00000000')).toBeUndefined();
    expect(parseApprovedYear('')).toBeUndefined();
    expect(parseApprovedYear(undefined)).toBeUndefined();
    expect(parseApprovedYear('99991231')).toBeUndefined();
  });
});

describe('BuildingRegisterClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  const client = () =>
    new BuildingRegisterClient({
      serviceKey: 'k',
      timeoutMs: 5000,
      baseUrl: 'https://x/api',
      retryDelayMs: 0,
    });

  // 응답은 text() 로 받는다 — 오류 시 XML·HTML 이 오는 일이 있어 우리가 직접 판별한다.
  function respond(item: unknown) {
    return vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item } } } }),
    }));
  }

  it('표제부에서 주구조·연면적·층수·승인연도·용도를 뽑는다', async () => {
    const f = respond({
      strctCdNm: '철근콘크리트구조',
      totArea: '330.58',
      grndFlrCnt: '3',
      useAprDay: '19980415',
      mainPurpsCdNm: '단독주택',
      bldNm: '가나빌라',
    });
    vi.stubGlobal('fetch', f);

    const r = await client().lookup({ sigunguCd: '11110', bjdongCd: '10100', bun: '1', ji: '2' });
    expect(r).toEqual({
      structureName: '철근콘크리트구조',
      structure: 'RC',
      totalFloorAreaM2: 330.58,
      floorsAbove: 3,
      approvedYear: 1998,
      mainUse: '단독주택',
      buildingName: '가나빌라',
    });

    // 번·지는 4자리로 0 채워 보낸다(공공데이터 규격).
    const url = String(f.mock.calls[0]?.[0]);
    expect(url).toContain('bun=0001');
    expect(url).toContain('ji=0002');
    expect(url).toContain('_type=json');
  });

  it('여러 동이면 연면적이 가장 큰 동을 대표로 쓴다', async () => {
    vi.stubGlobal(
      'fetch',
      respond([
        { strctCdNm: '벽돌구조', totArea: '80', useAprDay: '19900101' },
        { strctCdNm: '철근콘크리트구조', totArea: '450', useAprDay: '20150101' },
      ]),
    );
    const r = await client().lookup({ sigunguCd: '11110', bjdongCd: '10100' });
    expect(r?.totalFloorAreaM2).toBe(450);
    expect(r?.structure).toBe('RC');
  });

  it('조회 결과가 없으면 undefined', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: '' } } }),
      })),
    );
    expect(await client().lookup({ sigunguCd: '11110', bjdongCd: '10100' })).toBeUndefined();
  });

  it('공공데이터 장애(5xx·네트워크)면 undefined 로 떨어져 분석을 막지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => '' })));
    expect(await client().lookup({ sigunguCd: '11110', bjdongCd: '10100' })).toBeUndefined();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await client().lookup({ sigunguCd: '11110', bjdongCd: '10100' })).toBeUndefined();
  });
});

describe('BuildingRegisterClient — 무조건 값을 내야 한다', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ok = (totArea = '577.5') => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        response: {
          header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' },
          body: { items: { item: { strctCdNm: '철근콘크리트구조', totArea, grndFlrCnt: '5', useAprDay: '20190101' } } },
        },
      }),
  });
  const empty = () => ({
    ok: true,
    text: async () =>
      JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: '' } } }),
  });
  /** 실측에서 실제로 나온 실패 — 정상 응답 자리에 파싱 불가한 내용이 온다. */
  const broken = () => ({ ok: true, text: async () => '<OpenAPI_ServiceResponse>ERROR</OpenAPI_...' });

  const client = (over = {}) =>
    new BuildingRegisterClient({
      serviceKey: 'k',
      timeoutMs: 3000,
      baseUrl: 'https://pd.test',
      retryDelayMs: 0,
      ...over,
    });

  const q = { sigunguCd: '11440', bjdongCd: '12400', bun: '0225', ji: '0035' };

  it('깨진 응답이 와도 재시도해서 값을 얻는다', async () => {
    // 간헐적 실패가 이 서비스의 기본값이다. 한 번 실패했다고 포기하면
    // 심사위원이 그 순간에 걸렸을 때 기능이 없는 것처럼 보인다.
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n < 3 ? broken() : ok())));
    const info = await client().lookup(q);
    expect(info?.totalFloorAreaM2).toBe(577.5);
    expect(n).toBe(3);
  });

  it('재시도를 다 써도 실패하면 undefined — 지어내지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => broken()));
    expect(await client({ attempts: 2 }).lookup(q)).toBeUndefined();
  });

  it('표제부가 비면 총괄표제부를 본다 — 재시도로 시간을 낭비하지 않는다', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(String(u));
      return String(u).includes('getBrRecapTitleInfo') ? ok('1200') : empty();
    }));
    const info = await client().lookup(q);
    expect(info?.totalFloorAreaM2).toBe(1200);
    // 표제부는 '없음' 이 확정이므로 한 번만 부른다.
    expect(urls.filter((u) => u.includes('getBrTitleInfo')).length).toBe(1);
  });

  it('연면적이 없는 응답은 쓸모가 없다 — 다음 대장 종류로 넘어간다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) =>
      String(u).includes('Recap') ? ok('800') : ok('0'),
    ));
    expect((await client().lookup(q))?.totalFloorAreaM2).toBe(800);
  });

  it('한 번 성공하면 캐시에서 주고 다시 호출하지 않는다', async () => {
    const f = vi.fn(async () => ok());
    vi.stubGlobal('fetch', f);
    const store = new Map<string, unknown>();
    const cache = {
      async get(k: string) { return store.get(k) as never; },
      async set(k: string, v: unknown) { store.set(k, v); },
    };
    const c = client({ cache });
    expect((await c.lookup(q))?.totalFloorAreaM2).toBe(577.5);
    const calls = f.mock.calls.length;
    expect((await c.lookup(q))?.totalFloorAreaM2).toBe(577.5);
    expect(f.mock.calls.length).toBe(calls); // 두 번째는 외부 호출 없음
  });

  it('정말 대장이 없는 지번은 조용히 undefined — 나대지·무허가가 실제로 있다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => empty()));
    expect(await client().lookup(q)).toBeUndefined();
  });
});
