import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BuildingOutlineClient,
  parseOutlineFeatures,
  pickOutline,
  pointInRing,
  ringAreaM2,
  ringPerimeter,
  ringToLocalMeters,
  type OutlineRing,
} from './building-outline.js';

/** 10m × 20m 직사각형 건물(미터 좌표). */
const rect: OutlineRing = [
  [0, 0],
  [10, 0],
  [10, 20],
  [0, 20],
];

describe('ringAreaM2 — 신발끈 공식', () => {
  it('직사각형 넓이를 ㎡ 로 낸다', () => {
    expect(ringAreaM2(rect)).toBe(200);
  });

  it('좌표 방향(시계·반시계)과 무관하다', () => {
    expect(ringAreaM2([...rect].reverse())).toBe(200);
  });

  it('첫 점을 닫아서 보내도 같은 값', () => {
    expect(ringAreaM2([...rect, [0, 0]])).toBe(200);
  });

  it('L자 형상도 실제 넓이로 낸다 — 바운딩박스가 아니다', () => {
    // 20×20 에서 10×10 을 덜어낸 L자 → 300㎡ (바운딩박스로 재면 400㎡)
    const l: OutlineRing = [
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ];
    expect(ringAreaM2(l)).toBe(300);
  });

  it('점이 모자라면 0 — 넓이를 지어내지 않는다', () => {
    expect(ringAreaM2([])).toBe(0);
    expect(ringAreaM2([[0, 0]])).toBe(0);
    expect(
      ringAreaM2([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(0);
  });
});

describe('ringPerimeter', () => {
  it('닫힌 고리의 둘레를 낸다', () => {
    expect(ringPerimeter(rect)).toBe(60); // (10+20) × 2
  });
});

describe('pointInRing', () => {
  it('안쪽 점은 true, 바깥 점은 false', () => {
    expect(pointInRing([5, 10], rect)).toBe(true);
    expect(pointInRing([15, 10], rect)).toBe(false);
    expect(pointInRing([5, 30], rect)).toBe(false);
  });
});

describe('pickOutline — 여러 동 중 고르기', () => {
  const far: OutlineRing = [
    [100, 100],
    [140, 100],
    [140, 140],
    [100, 140],
  ];

  it('찍은 점을 품은 건물을 고른다 — 더 큰 건물이 옆에 있어도', () => {
    expect(pickOutline([far, rect], [5, 10])).toBe(rect);
  });

  it('점을 품은 건물이 없으면 가장 큰 건물로 — 지적도와 실제가 어긋나는 경우', () => {
    expect(pickOutline([rect, far], [500, 500])).toBe(far);
  });

  it('점이 없으면 가장 큰 건물', () => {
    expect(pickOutline([rect, far])).toBe(far);
  });

  it('점이 3개 미만인 조각은 후보에서 뺀다', () => {
    expect(pickOutline([[[0, 0]], rect])).toBe(rect);
    expect(pickOutline([])).toBeUndefined();
  });
});

describe('parseOutlineFeatures — GeoJSON 읽기', () => {
  it('Polygon 의 바깥 고리를 뽑는다(구멍은 버린다)', () => {
    const parsed = parseOutlineFeatures({
      features: [
        {
          geometry: {
            type: 'Polygon',
            coordinates: [
              rect,
              [
                [2, 2],
                [4, 2],
                [4, 4],
                [2, 4],
              ],
            ],
          },
          properties: { bldNm: '디몰빌딩' },
        },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.ring).toHaveLength(4);
    expect(parsed[0]!.name).toBe('디몰빌딩');
  });

  it('MultiPolygon 은 동마다 하나씩 뽑는다', () => {
    const parsed = parseOutlineFeatures({
      features: [{ geometry: { type: 'MultiPolygon', coordinates: [[rect], [rect]] } }],
    });
    expect(parsed).toHaveLength(2);
  });

  it('모양이 달라진 응답은 조용히 건너뛴다 — 기능이 통째로 죽지 않게', () => {
    expect(parseOutlineFeatures(null)).toEqual([]);
    expect(parseOutlineFeatures({})).toEqual([]);
    expect(parseOutlineFeatures({ features: 'nope' })).toEqual([]);
    expect(parseOutlineFeatures({ features: [null, 7, {}] })).toEqual([]);
    expect(
      parseOutlineFeatures({ features: [{ geometry: { type: 'Point', coordinates: [1, 2] } }] }),
    ).toEqual([]);
  });

  it('좌표에 숫자가 아닌 값이 섞이면 그 점만 버린다', () => {
    const parsed = parseOutlineFeatures({
      features: [
        {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                ['x', 1],
                [10, 0],
                [10, 20],
                [0, 20],
              ],
            ],
          },
        },
      ],
    });
    expect(parsed[0]!.ring).toHaveLength(4);
  });
});

describe('BuildingOutlineClient', () => {
  afterEach(() => vi.unstubAllGlobals());
  const client = () =>
    new BuildingOutlineClient({
      serviceKey: 'k',
      timeoutMs: 1000,
      baseUrl: 'https://api.test/wfs',
      typeName: 'lt_c_bldginfo',
    });

  // 서울시청 부근 위경도에 실제 10m × 20m 건물을 놓는다.
  const lat0 = 37.5665;
  const lng0 = 126.978;
  const mLat = 1 / 110_574;
  const mLng = 1 / (111_320 * Math.cos((lat0 * Math.PI) / 180));
  const geoRect: OutlineRing = [
    [lng0 - 5 * mLng, lat0 - 10 * mLat],
    [lng0 + 5 * mLng, lat0 - 10 * mLat],
    [lng0 + 5 * mLng, lat0 + 10 * mLat],
    [lng0 - 5 * mLng, lat0 + 10 * mLat],
  ];

  it('경위도 응답을 미터로 환산해 면적·둘레를 낸다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          features: [
            {
              geometry: { type: 'Polygon', coordinates: [geoRect] },
              properties: { bldNm: '디몰빌딩' },
            },
          ],
        }),
      })),
    );
    const out = await client().lookup(lat0, lng0);
    expect(out!.buildingName).toBe('디몰빌딩');
    expect(out!.areaM2).toBeGreaterThan(195); // 실제 200㎡
    expect(out!.areaM2).toBeLessThan(205);
    expect(out!.perimeterM).toBeGreaterThan(58); // 실제 60m
    expect(out!.perimeterM).toBeLessThan(62);
  });

  it('건물 한 동 크기로만 좁게 훑는다 — 넓히면 옆 건물이 딸려 온다', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) }));
    vi.stubGlobal('fetch', f);
    await client().lookup(lat0, lng0);
    const url = String(f.mock.calls[0]?.[0]);
    expect(url).toContain('request=GetFeature');
    const bbox = new URL(url).searchParams.get('bbox')!;
    const [minx, miny, maxx, maxy] = bbox.split(',').map(Number);
    // 위경도 폭을 미터로 되돌려 120m 안쪽인지 본다.
    expect((maxy! - miny!) * 110_574).toBeLessThan(130);
    expect((maxx! - minx!) * 111_320 * Math.cos((lat0 * Math.PI) / 180)).toBeLessThan(130);
  });

  it('결과가 없거나 조회가 실패해도 undefined — 분석을 막지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) })),
    );
    expect(await client().lookup(lat0, lng0)).toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    expect(await client().lookup(lat0, lng0)).toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    expect(await client().lookup(lat0, lng0)).toBeUndefined();
  });

  it('좌표가 숫자가 아니거나 범위를 벗어나면 서버를 부르지 않는다', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await client().lookup(Number.NaN, 127)).toBeUndefined();
    expect(await client().lookup(95, 127)).toBeUndefined();
    expect(await client().lookup(37, 200)).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('ringToLocalMeters — 경위도를 국소 미터로', () => {
  it('기준점에서의 거리를 미터로 옮긴다', () => {
    const lat0 = 37.5665;
    const lng0 = 126.978;
    // 위로 정확히 100m 떨어진 점
    const north: OutlineRing = [[lng0, lat0 + 100 / 110_574]];
    const [p] = ringToLocalMeters(north, [lng0, lat0]);
    expect(p![0]).toBeCloseTo(0, 6);
    expect(p![1]).toBeCloseTo(100, 3);
  });

  it('경도 방향은 위도에 따라 줄어든다 — 위도 37도에서 1도는 약 88km', () => {
    const lat0 = 37;
    const [p] = ringToLocalMeters([[128, lat0]], [127, lat0]);
    expect(p![0]).toBeGreaterThan(87_000);
    expect(p![0]).toBeLessThan(90_000);
  });
});
