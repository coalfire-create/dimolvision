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
  /** 층별개요(조회됐을 때). 부분 철거에서 대상 층을 고르는 근거가 된다. */
  floors?: BuildingFloor[];
}

/**
 * 층별개요 한 줄 — 층 하나의 바닥면적·구조·용도.
 *
 * 왜 필요한가: 표제부의 연면적은 **건물 전체**다. "3층만 철거" 처럼 대상이 건물의 일부면
 * 연면적을 쓰는 순간 물량이 통째로 틀린다. 층별개요는 그 층의 면적을 대장 등재값으로
 * 알려 주므로, 사진 눈대중이나 영상 복원보다 확실한 근거가 된다.
 */
export interface BuildingFloor {
  /** 동 이름(한 지번에 여러 동이 있을 때 구분용). */
  dongName?: string;
  /** 지상/지하 구분. */
  floorGroup?: string;
  /** 층 이름(예: 1층, 지하1층). 대장 표기 그대로 쓴다. */
  floorName: string;
  /** 그 층의 바닥면적(㎡). */
  areaM2: number;
  /** 층 주구조명. */
  structureName?: string;
  /** 층 주용도(예: 사무소, 근린생활시설). */
  mainUse?: string;
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
}

const DEFAULT_BASE_URL = 'https://apis.data.go.kr/1613000/BldRgstHubService';

/**
 * 표제부(getBrTitleInfo)를 조회해 분석에 쓸 값만 추린다.
 * 여러 동이 잡히면 연면적이 가장 큰 동을 대표로 쓴다(주 건물일 가능성이 높다).
 */
export class BuildingRegisterClient {
  constructor(private readonly config: BuildingRegisterConfig) {}

  /**
   * 대장 서비스의 한 엔드포인트를 조회해 항목 배열로 돌려준다.
   * 표제부·층별개요가 같은 파라미터·같은 응답 봉투를 쓰므로 여기서 한 번만 만든다.
   */
  private async fetchItems<T>(
    endpoint: string,
    q: BuildingRegisterQuery,
    numOfRows: number,
  ): Promise<T[]> {
    const base = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const params = new URLSearchParams({
      serviceKey: this.config.serviceKey,
      sigunguCd: q.sigunguCd,
      bjdongCd: q.bjdongCd,
      platGbCd: q.platGbCd ?? '0',
      bun: (q.bun ?? '0').padStart(4, '0'),
      ji: (q.ji ?? '0').padStart(4, '0'),
      _type: 'json',
      numOfRows: String(numOfRows),
      pageNo: '1',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${base}/${endpoint}?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) return [];
      return normalizeItems((await res.json()) as PublicDataResponse<T>);
    } catch {
      // 공공데이터는 장애·쿼터가 잦다. 없으면 없는 대로 분석을 진행한다.
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 층별개요 조회. 층이 많은 건물도 한 번에 받도록 넉넉히 요청한다.
   * 면적이 0 이하인 줄(옥탑·승강기탑 등 면적 미기재)은 버린다 — 고르게 해도 쓸 값이 없다.
   */
  async lookupFloors(q: BuildingRegisterQuery): Promise<BuildingFloor[]> {
    const items = await this.fetchItems<BrFloorItem>('getBrFlrOulnInfo', q, 200);
    return items
      .map((it) => ({
        dongName: it.dongNm?.trim() || undefined,
        floorGroup: it.flrGbCdNm?.trim() || undefined,
        floorName: it.flrNoNm?.trim() || '',
        areaM2: num(it.area),
        structureName: it.strctCdNm?.trim() || undefined,
        mainUse: it.mainPurpsCdNm?.trim() || undefined,
      }))
      .filter((f) => f.floorName !== '' && f.areaM2 > 0);
  }

  async lookup(q: BuildingRegisterQuery): Promise<BuildingRegisterInfo | undefined> {
    const items = await this.fetchItems<BrTitleItem>('getBrTitleInfo', q, 20);
    if (items.length === 0) return undefined;

    const best = items.reduce((a, b) => (num(b.totArea) > num(a.totArea) ? b : a));
    const structureName = best.strctCdNm?.trim() || undefined;
    return {
      structureName,
      structure: toBuildingStructure(structureName),
      totalFloorAreaM2: num(best.totArea) || undefined,
      floorsAbove: num(best.grndFlrCnt) || undefined,
      approvedYear: parseApprovedYear(best.useAprDay),
      mainUse: best.mainPurpsCdNm?.trim() || undefined,
      buildingName: best.bldNm?.trim() || undefined,
    };
  }
}

/** 표제부 응답에서 쓰는 필드만. 공공데이터는 값이 문자열로 온다. */
interface BrTitleItem {
  strctCdNm?: string;
  totArea?: string | number;
  grndFlrCnt?: string | number;
  useAprDay?: string;
  mainPurpsCdNm?: string;
  bldNm?: string;
}

/** 층별개요 응답에서 쓰는 필드만. */
interface BrFloorItem {
  dongNm?: string;
  flrGbCdNm?: string;
  flrNoNm?: string;
  area?: string | number;
  strctCdNm?: string;
  mainPurpsCdNm?: string;
}

interface PublicDataResponse<T> {
  response?: { body?: { items?: { item?: T | T[] } | '' } };
}

/** item 은 0건이면 빈 문자열, 1건이면 객체, 여러 건이면 배열로 온다. */
function normalizeItems<T>(body: PublicDataResponse<T>): T[] {
  const items = body.response?.body?.items;
  if (!items || typeof items !== 'object' || !items.item) return [];
  return Array.isArray(items.item) ? items.item : [items.item];
}

function num(v: string | number | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
