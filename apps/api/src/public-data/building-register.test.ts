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
    new BuildingRegisterClient({ serviceKey: 'k', timeoutMs: 5000, baseUrl: 'https://x/api' });

  function respond(item: unknown) {
    return vi.fn(async () => ({
      ok: true,
      json: async () => ({ response: { body: { items: { item } } } }),
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
      vi.fn(async () => ({ ok: true, json: async () => ({ response: { body: { items: '' } } }) })),
    );
    expect(await client().lookup({ sigunguCd: '11110', bjdongCd: '10100' })).toBeUndefined();
  });

  it('공공데이터 장애(5xx·네트워크)면 undefined 로 떨어져 분석을 막지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    expect(await client().lookup({ sigunguCd: '11110', bjdongCd: '10100' })).toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    expect(await client().lookup({ sigunguCd: '11110', bjdongCd: '10100' })).toBeUndefined();
  });
});

describe('lookupFloors — 층별개요', () => {
  afterEach(() => vi.unstubAllGlobals());

  const client = () =>
    new BuildingRegisterClient({ serviceKey: 'k', timeoutMs: 1000, baseUrl: 'https://api.test' });
  const q = { sigunguCd: '11110', bjdongCd: '10300', bun: '1', ji: '2' };
  const respond = (item: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ response: { body: { items: { item } } } }),
      })),
    );

  it('층마다 이름·면적·구조·용도를 뽑는다', async () => {
    respond([
      {
        flrGbCdNm: '지하',
        flrNoNm: '지하1층',
        area: '85.5',
        strctCdNm: '철근콘크리트구조',
        mainPurpsCdNm: '주차장',
      },
      {
        flrGbCdNm: '지상',
        flrNoNm: '1층',
        area: '120.3',
        strctCdNm: '철근콘크리트구조',
        mainPurpsCdNm: '근린생활시설',
      },
    ]);
    const floors = await client().lookupFloors(q);
    expect(floors).toHaveLength(2);
    expect(floors[0]).toMatchObject({
      floorName: '지하1층',
      areaM2: 85.5,
      floorGroup: '지하',
      mainUse: '주차장',
    });
    expect(floors[1]!.areaM2).toBe(120.3);
  });

  it('한 층만 있으면 객체로 오는데도 배열로 돌려준다', async () => {
    respond({ flrNoNm: '1층', area: '60' });
    expect(await client().lookupFloors(q)).toHaveLength(1);
  });

  it('면적이 없거나 0인 줄은 버린다 — 쓸 값이 없다', async () => {
    respond([
      { flrNoNm: '1층', area: '60' },
      { flrNoNm: '옥탑1층', area: '0' },
      { flrNoNm: '옥탑2층' },
    ]);
    const floors = await client().lookupFloors(q);
    expect(floors.map((f) => f.floorName)).toEqual(['1층']);
  });

  it('층 이름이 없는 줄도 버린다 — 사용자에게 보여 줄 수 없다', async () => {
    respond([{ area: '60' }, { flrNoNm: '2층', area: '70' }]);
    expect((await client().lookupFloors(q)).map((f) => f.floorName)).toEqual(['2층']);
  });

  it('조회가 실패해도 빈 배열 — 분석을 막지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    expect(await client().lookupFloors(q)).toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    expect(await client().lookupFloors(q)).toEqual([]);
  });

  it('층별개요 엔드포인트를 부른다', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', f);
    await client().lookupFloors(q);
    expect(String(f.mock.calls[0]?.[0])).toContain('getBrFlrOulnInfo');
  });
});
