import type { BuildingStructure } from '@dimol/shared';

/**
 * 공공데이터포털 건축물대장 조회 (국토교통부 건축물대장정보 서비스).
 *
 * 왜 쓰는가: 사진만으로는 마감재에 가린 주구조를 단정할 수 없고, 연면적도 알 수 없다.
 * 건축물대장은 그 두 가지를 권위 있게 알려준다. 여기서 얻은 주구조·연면적·층수·사용승인일을
 * 분석 힌트와 물량 추정에 넣으면, 같은 사진이라도 결과가 눈에 띄게 정확해진다.
 * 특히 사용승인일은 석면 판단에 결정적이다 — 한국은 2009년부터 석면 사용이 전면 금지라,
 * 그 이전 건축물이면 슬레이트·천장텍스·보온재를 석면 의심으로 다뤄야 한다.
 *
 * 키가 없으면 조용히 비활성(undefined 반환)된다 — 공공데이터 없이도 서비스는 그대로 돈다.
 * 키 발급: https://www.data.go.kr → "건축물대장정보 서비스" 활용신청 → 일반 인증키(Decoding)
 */

/** 건축물대장 표제부에서 뽑아 쓰는 값들. */
export interface BuildingRegisterInfo {
  /** 주구조명 원문 (예: 철근콘크리트구조). */
  structureName?: string;
  /** 추정 물량 계산에 쓰는 구조 코드. */
  structure?: BuildingStructure;
  /** 연면적(㎡). */
  totalFloorAreaM2?: number;
  /** 지상 층수. */
  floorsAbove?: number;
  /** 사용승인 연도. */
  approvedYear?: number;
  /** 주용도 (예: 단독주택). */
  mainUse?: string;
  /** 건물명(있을 때). */
  buildingName?: string;
  /** 건물 전체 높이(m). 층고 계산에 쓴다. */
  heightM?: number;
  /**
   * 층고(m) = 높이 ÷ 지상층수.
   *
   * 3D 복원 좌표계는 단위가 없어 사용자가 기준 길이를 골라야 했다("층고 2.4m" 같은
   * 프리셋). 그런데 대장이 실제 높이와 층수를 알고 있으니 그걸로 자동 결정할 수 있다.
   * 추측한 표준값보다 그 건물의 실제 값이 언제나 낫다.
   */
  floorHeightM?: number;
}

export interface BuildingRegisterQuery {
  /** 시군구 코드 5자리. */
  sigunguCd: string;
  /** 법정동 코드 5자리. */
  bjdongCd: string;
  /** 번(본번) 4자리. 기본 0000. */
  bun?: string;
  /** 지(부번) 4자리. 기본 0000. */
  ji?: string;
  /** 대지 구분 (0: 대지, 1: 산, 2: 블록). 기본 0. */
  platGbCd?: string;
}

/**
 * 대장상 주구조명 → 물량 추정용 구조 코드.
 * 원단위 보정계수는 RC/BRICK/WOOD 세 가지만 있으므로 그쪽으로 모은다.
 * 철골은 RC 와 원단위가 가장 가깝고(중량 구조), 판단이 서지 않으면 undefined 로 두어
 * 추정이 구조 보정 없이(신뢰도 LOW) 돌게 한다 — 틀린 보정보다 낫다.
 */
export function toBuildingStructure(structureName?: string): BuildingStructure | undefined {
  if (!structureName) return undefined;
  const n = structureName.replace(/\s/g, '');
  if (/목구조|통나무|목조/.test(n)) return 'WOOD';
  if (/조적|벽돌|블록|석구조/.test(n)) return 'BRICK';
  if (/철근콘크리트|철골철근콘크리트|라멘|프리캐스트|콘크리트|철골|강구조/.test(n)) return 'RC';
  return undefined;
}

/** 사용승인일(YYYYMMDD 문자열) → 연도. 형식이 어긋나면 undefined. */
export function parseApprovedYear(useAprDay?: string): number | undefined {
  if (!useAprDay) return undefined;
  const m = /^(\d{4})/.exec(useAprDay.trim());
  if (!m) return undefined;
  const year = Number(m[1]);
  // 대장에 0000 이나 미래 연도가 들어있는 경우가 실제로 있다.
  if (year < 1900 || year > new Date().getFullYear() + 1) return undefined;
  return year;
}

export interface BuildingRegisterConfig {
  serviceKey: string;
  timeoutMs: number;
  baseUrl?: string;
  /** 한 엔드포인트당 시도 횟수. 공공데이터는 간헐적으로 응답이 깨진다. 기본 3. */
  attempts?: number;
  /** 재시도 간격(ms). 기본 400. */
  retryDelayMs?: number;
  /** 조회 결과 캐시(선택). 같은 지번은 건물이 바뀌지 않으므로 오래 써도 된다. */
  cache?: RegisterCacheStore;
}

/** 지번 → 대장 정보 캐시. 성공만 저장한다(실패를 굳히면 장애가 연장된다). */
export interface RegisterCacheStore {
  get(key: string): Promise<BuildingRegisterInfo | undefined>;
  set(key: string, value: BuildingRegisterInfo, ttlSeconds: number): Promise<void>;
}

/** 건물은 하루 사이에 바뀌지 않는다. 길게 잡아도 위험이 없다. */
export const REGISTER_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * 한 번의 호출 결과.
 *   ok    — 값이 있다
 *   empty — 정상 응답인데 그 지번에 대장이 없다(나대지·무허가). 재시도해도 같다
 *   error — 호출·파싱이 깨졌다. 재시도할 가치가 있다
 * 이 셋을 구분하지 않으면 "건물이 없는 것" 과 "조회가 실패한 것" 이 똑같이 보여
 * 재시도해야 할 때 포기하고, 포기해야 할 때 재시도하게 된다.
 */
type Outcome =
  | { kind: 'ok'; info: BuildingRegisterInfo }
  | { kind: 'empty' }
  | { kind: 'error' };

/** 표제부를 먼저 보고, 없으면 총괄표제부를 본다. 단지형·집합건물은 총괄에만 있다. */
const ENDPOINTS = ['getBrTitleInfo', 'getBrRecapTitleInfo'] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 캐시 키 — 지번을 특정하는 다섯 값. */
export function registerCacheKey(q: BuildingRegisterQuery): string {
  return [
    q.sigunguCd,
    q.bjdongCd,
    q.platGbCd ?? '0',
    (q.bun ?? '0').padStart(4, '0'),
    (q.ji ?? '0').padStart(4, '0'),
  ].join('-');
}

const DEFAULT_BASE_URL = 'https://apis.data.go.kr/1613000/BldRgstHubService';

/**
 * 표제부(getBrTitleInfo)를 조회해 분석에 쓸 값만 추린다.
 * 여러 동이 잡히면 연면적이 가장 큰 동을 대표로 쓴다(주 건물일 가능성이 높다).
 */
export class BuildingRegisterClient {
  constructor(private readonly config: BuildingRegisterConfig) {}

  async lookup(q: BuildingRegisterQuery): Promise<BuildingRegisterInfo | undefined> {
    const key = registerCacheKey(q);
    const cache = this.config.cache;

    const hit = await cache?.get(key).catch(() => undefined);
    if (hit) return hit;

    const attempts = Math.max(1, this.config.attempts ?? 3);
    const delay = this.config.retryDelayMs ?? 400;

    for (const endpoint of ENDPOINTS) {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const out = await this.callOnce(endpoint, q);
        if (out.kind === 'ok') {
          await cache?.set(key, out.info, REGISTER_CACHE_TTL_SECONDS).catch(() => {});
          return out.info;
        }
        // 그 지번에 대장이 없는 것은 재시도로 바뀌지 않는다 — 다음 대장 종류로 넘어간다.
        if (out.kind === 'empty') break;
        if (attempt < attempts) await sleep(delay * attempt);
      }
    }
    return undefined;
  }

  /** 한 번 호출하고 결과를 세 갈래로 분류한다. */
  private async callOnce(endpoint: string, q: BuildingRegisterQuery): Promise<Outcome> {
    const base = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const params = new URLSearchParams({
      serviceKey: this.config.serviceKey,
      sigunguCd: q.sigunguCd,
      bjdongCd: q.bjdongCd,
      platGbCd: q.platGbCd ?? '0',
      bun: (q.bun ?? '0').padStart(4, '0'),
      ji: (q.ji ?? '0').padStart(4, '0'),
      _type: 'json',
      numOfRows: '20',
      pageNo: '1',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${base}/${endpoint}?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) return { kind: 'error' };

      // 오류일 때 XML 이나 HTML 이 오기도 한다. text 로 받아 우리가 판단한다.
      const text = await res.text();
      let body: PublicDataResponse;
      try {
        body = JSON.parse(text) as PublicDataResponse;
      } catch {
        return { kind: 'error' };
      }

      // resultCode 가 없거나 '00' 이 아니면 정상 응답이 아니다(쿼터 초과·키 오류·일시 장애).
      const code = body.response?.header?.resultCode;
      if (code !== '00') return { kind: 'error' };

      const items = normalizeItems(body);
      if (items.length === 0) return { kind: 'empty' };

      const best = items.reduce((a, b) => (num(b.totArea) > num(a.totArea) ? b : a));
      const structureName = best.strctCdNm?.trim() || undefined;
      const info: BuildingRegisterInfo = {
        structureName,
        structure: toBuildingStructure(structureName),
        totalFloorAreaM2: num(best.totArea) || undefined,
        floorsAbove: num(best.grndFlrCnt) || undefined,
        approvedYear: parseApprovedYear(best.useAprDay),
        mainUse: best.mainPurpsCdNm?.trim() || undefined,
        buildingName: best.bldNm?.trim() || undefined,
        ...buildHeights(num(best.heit), num(best.grndFlrCnt)),
      };
      // 연면적이 없으면 물량·견적에 쓸 수 없다 — 다른 대장 종류를 더 본다.
      if (!info.totalFloorAreaM2) return { kind: 'empty' };
      return { kind: 'ok', info };
    } catch {
      return { kind: 'error' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 높이·층수 → 층고. 값이 터무니없으면 버린다.
 * 실내 층고는 아무리 낮아도 2m, 아무리 높아도 공장 기준 8m 를 넘지 않는다.
 * 대장에 0 이나 오기가 들어 있는 경우가 실제로 있어 그대로 쓰면 치수가 통째로 어긋난다.
 */
function buildHeights(heit: number, floors: number): {
  heightM?: number;
  floorHeightM?: number;
} {
  if (!(heit > 0)) return {};
  const out: { heightM?: number; floorHeightM?: number } = { heightM: heit };
  if (floors > 0) {
    const fh = heit / floors;
    if (fh >= 2 && fh <= 8) out.floorHeightM = Math.round(fh * 100) / 100;
  }
  return out;
}

/** 표제부 응답에서 쓰는 필드만. 공공데이터는 값이 문자열로 온다. */
interface BrTitleItem {
  strctCdNm?: string;
  /** 건물 높이(m). 대장에 없을 수도 있다. */
  heit?: string | number;
  totArea?: string | number;
  grndFlrCnt?: string | number;
  useAprDay?: string;
  mainPurpsCdNm?: string;
  bldNm?: string;
}

interface PublicDataResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: { item?: BrTitleItem | BrTitleItem[] } | '' };
  };
}

/** item 은 0건이면 빈 문자열, 1건이면 객체, 여러 건이면 배열로 온다. */
function normalizeItems(body: PublicDataResponse): BrTitleItem[] {
  const items = body.response?.body?.items;
  if (!items || typeof items !== 'object' || !items.item) return [];
  return Array.isArray(items.item) ? items.item : [items.item];
}

function num(v: string | number | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
