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

  async lookup(q: BuildingRegisterQuery): Promise<BuildingRegisterInfo | undefined> {
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
      const res = await fetch(`${base}/getBrTitleInfo?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as PublicDataResponse;
      const items = normalizeItems(body);
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
    } catch {
      // 공공데이터는 장애·쿼터가 잦다. 없으면 없는 대로 분석을 진행한다.
      return undefined;
    } finally {
      clearTimeout(timer);
    }
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

interface PublicDataResponse {
  response?: { body?: { items?: { item?: BrTitleItem | BrTitleItem[] } | '' } };
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
