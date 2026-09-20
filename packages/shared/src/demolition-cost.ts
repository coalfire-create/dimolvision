/**
 * 철거 공사비 산출 — 공표 단가표만으로 금액을 만든다.
 *
 * 왜 이 파일이 따로 있는가:
 *   "석고보드가 있습니다" 로 끝나는 분석은 견적이 아니다. 철거업자가 현장에서 만드는 건
 *   품목별 금액이 붙은 내역서다. 그런데 금액은 지어내면 안 되는 종류의 숫자라서,
 *   이 파일에는 **출처와 적용일을 댈 수 있는 공표 단가만** 넣는다. 출처가 없는 값은
 *   상수로 만들지 않고, 대신 "업체 견적 필요" 항목으로 빼서 합계에서 제외한다.
 *
 * 범위로 내는 이유:
 *   같은 폐기물이라도 현장에서 분리배출에 성공하면 폐콘크리트 단가로, 실패하면 혼합
 *   단가로 처리된다. 단가 차이가 2~5배라 단일 금액은 거짓 정밀도다. 그래서 모든 금액은
 *   **하한(분리배출 성공) ~ 상한(혼합 처리)** 범위로 낸다. 실무에서 견적의 위험을
 *   잡는 방식이 정확히 이것이다.
 *
 * 단가를 바꾸려면 이 파일만 고친다. 다른 곳에 금액을 적지 않는다.
 */

import type { ConstructionWasteClass } from './site-analysis.js';

/** 단가의 출처. 화면·리포트에 그대로 노출해 심사자·발주자가 검증할 수 있게 한다. */
export interface PriceSource {
  /** 공표 기관. */
  agency: string;
  /** 자료명. */
  title: string;
  /** 적용 시점(그대로 표기). */
  effective: string;
}

export const PRICE_SOURCES = {
  /** 중간처리단가 — 파쇄·선별 등 처리장에서의 처리비(운반비 별도). */
  treatment: {
    agency: '한국건설자원협회',
    title: '건설폐기물 배출지별 중간처리단가',
    effective: '2025. 1. 1. 적용',
  },
  /** 수집·운반비 — 현장에서 처리장까지. 매립지 반입료·중간처리비·부가세 제외. */
  transport: {
    agency: '한국건설자원수집운반협회',
    title: '건설폐기물 수집·운반비 단가',
    effective: '2026년 적용',
  },
  /** 폐석면 — 환경부 고시(방치폐기물 처리이행보증보험금 산출을 위한 종류별 처리단가). */
  asbestos: {
    agency: '환경부 고시',
    title: '방치폐기물 처리이행보증보험금 산출 등을 위한 폐기물의 종류별 처리단가',
    effective: '폐석면 645,000원/톤',
  },
  /** 노임 — 대한건설협회 건설업 임금실태조사(시중노임단가). */
  labor: {
    agency: '대한건설협회',
    title: '건설업 임금실태조사(시중노임단가)',
    effective: '2026년 상반기(2026. 1. 1.) 적용',
  },
  /** 건설기계 — 대한건설협회 건설기계 경비산출표(시간당 손료·주연료·잡재료). */
  equipment: {
    agency: '대한건설협회',
    title: '건설기계 경비산출표',
    effective: '2026년도',
  },
  /** 경유 — 한국석유공사 오피넷 전국 주유소 평균 판매가격. */
  diesel: {
    agency: '한국석유공사 오피넷',
    title: '전국 주유소 평균 판매가격(경유)',
    effective: '2026년 9월 첫째 주',
  },
} as const satisfies Record<string, PriceSource>;

/**
 * 법정 분류별 중간처리단가(원/톤).
 *
 * min 은 그 분류로 깨끗하게 분리배출됐을 때, max 는 분리에 실패해 혼합으로 빠졌을 때다.
 * 폐목재·폐합성수지·폐유리·폐금속류는 공표 중간처리단가표에 없다(분리되면 재활용업체
 * 개별 단가, 분리 실패하면 혼합). 그래서 min 을 0 으로 두고 "업체 단가 필요" 로 표시하되,
 * max 는 혼합 단가를 물려 합계 상한이 현실을 놓치지 않게 한다.
 */
export const TREATMENT_WON_PER_TON: Record<
  ConstructionWasteClass,
  { min: number; max: number; published: boolean }
> = {
  // 이물질 없는 순수 폐콘크리트 29,396 / 가연성 제거된 건설폐재류 48,021
  CONCRETE: { min: 29_396, max: 48_021, published: true },
  ASPHALT: { min: 31_002, max: 48_021, published: true },
  BRICK_BLOCK: { min: 48_021, max: 68_563, published: true },
  // 가연성·재활용 대상 — 공표 중간처리단가 없음. 분리되면 업체 단가, 안 되면 혼합.
  WOOD: { min: 0, max: 68_563, published: false },
  PLASTIC: { min: 0, max: 68_563, published: false },
  METAL: { min: 0, max: 68_563, published: false },
  GLASS: { min: 0, max: 168_424, published: false },
  // 폐보드류·폐판넬에 가연성이 섞인 경우 173,154 — 석고보드가 여기 들어간다.
  BOARD: { min: 68_563, max: 173_154, published: true },
  // 건설폐재류에 가연성 5% 이하 혼합 68,563 / 불연성+가연성 혼합 168,424
  MIXED: { min: 68_563, max: 168_424, published: true },
  // 폐석면 645,000원/톤(환경부 고시). 수집·운반은 거리에 따라 별도 견적.
  DESIGNATED: { min: 645_000, max: 645_000, published: true },
};

/**
 * 수집·운반비(원/톤, 30km 기준). 상차비 포함, 매립지 반입료·중간처리비·부가세 제외.
 *
 * 건설폐재류는 비중이 커서 덤프에 많이 실리고(1.6톤/㎥), 혼합건설폐기물은 부피만 크다
 * (0.63톤/㎥). 그래서 같은 1톤이라도 혼합이 3배 넘게 비싸다 — 분리배출이 돈이 되는 이유다.
 */
export const TRANSPORT_WON_PER_TON = {
  /** 폐콘크리트·폐아스콘·폐벽돌·폐블록·폐기와·건설폐토석. 24톤 덤프 ~ 4.5톤 덤프. */
  debris: { min: 20_340, max: 41_320 },
  /** 혼합건설폐기물. 24톤 암롤 ~ 16톤 암롤. */
  mixed: { min: 68_300, max: 81_350 },
} as const;

/** 수집·운반비 기준 거리(km). 이보다 멀면 단가가 올라간다(50km 기준 약 1.4배). */
export const TRANSPORT_BASE_DISTANCE_KM = 30;

/**
 * 직종별 시중노임단가(원/일, 8시간). 2026년 상반기 적용, 도서지역 제외.
 * 철거 현장에서 실제로 계상되는 직종만 담는다.
 */
export const LABOR_WON_PER_DAY = {
  작업반장: 215_907,
  보통인부: 172_068,
  특별인부: 226_122,
  조력공: 179_028,
  비계공: 281_939,
  철근공: 268_187,
  콘크리트공: 273_540,
  건설기계운전사: 283_297,
  석면해체공: 204_181,
} as const;

export type LaborTrade = keyof typeof LABOR_WON_PER_DAY;

/** 경유 단가(원/ℓ). 장비 주연료비 계산의 입력. */
export const DIESEL_WON_PER_LITER = 1_845;

/** 1일 장비 가동시간(시간). 표준품셈의 1일 8시간 기준. */
export const EQUIPMENT_HOURS_PER_DAY = 8;

/**
 * 건설기계 시간당 경비 구성. 경비산출표는 손료·주연료·잡재료를 따로 준다.
 *   1일 경비 = (손료 + 주연료ℓ × 경유단가 + 잡재료) × 8시간 + 조종원 노임
 * 조종원이 붙지 않는 부착장비(압쇄기·브레이커)는 operator: false.
 */
export interface EquipmentRate {
  /** 화면에 쓰는 이름. */
  label: string;
  /** 규격(㎥ 등). */
  spec: string;
  /** 시간당 기계손료(원). */
  hourlyWon: number;
  /** 시간당 주연료(ℓ). 부착장비는 0. */
  fuelLitersPerHour: number;
  /** 잡재료 — 주연료비 대비 비율(%). */
  suppliesPercent: number;
  /** 조종원(건설기계운전사) 1인/일이 붙는지. */
  operator: boolean;
}

/**
 * 철거에 실제로 쓰는 기종만 추렸다. 굴착기는 현장 규모별로 3단,
 * 여기에 압쇄기·브레이커가 부착장비로 얹힌다.
 */
export const EQUIPMENT_RATES: Record<string, EquipmentRate> = {
  EXCAVATOR_02: {
    label: '굴착기(무한궤도)',
    spec: '0.20㎥',
    hourlyWon: 13_873,
    fuelLitersPerHour: 5.0,
    suppliesPercent: 21,
    operator: true,
  },
  EXCAVATOR_04: {
    label: '굴착기(무한궤도)',
    spec: '0.40㎥',
    hourlyWon: 17_514,
    fuelLitersPerHour: 9.9,
    suppliesPercent: 22,
    operator: true,
  },
  EXCAVATOR_06: {
    label: '굴착기(무한궤도)',
    spec: '0.60㎥',
    hourlyWon: 23_423,
    fuelLitersPerHour: 10.2,
    suppliesPercent: 22,
    operator: true,
  },
  EXCAVATOR_10: {
    label: '굴착기(무한궤도)',
    spec: '1.00㎥',
    hourlyWon: 29_621,
    fuelLitersPerHour: 19.5,
    suppliesPercent: 22,
    operator: true,
  },
  PULVERIZER_10: {
    label: '압쇄기(펄버라이저)',
    spec: '1.0㎥',
    hourlyWon: 18_857,
    fuelLitersPerHour: 0,
    suppliesPercent: 0,
    operator: false,
  },
  BREAKER_07: {
    label: '대형브레이커',
    spec: '0.7㎥',
    hourlyWon: 11_412,
    fuelLitersPerHour: 0,
    suppliesPercent: 0,
    operator: false,
  },
};

export type EquipmentCode = keyof typeof EQUIPMENT_RATES;

/** 장비 1대의 1일 경비(원). 손료·연료·잡재료에 조종원 노임을 더한다. */
export function equipmentDailyWon(rate: EquipmentRate): number {
  const fuelWon = rate.fuelLitersPerHour * DIESEL_WON_PER_LITER;
  const suppliesWon = fuelWon * (rate.suppliesPercent / 100);
  const runningWon = (rate.hourlyWon + fuelWon + suppliesWon) * EQUIPMENT_HOURS_PER_DAY;
  const operatorWon = rate.operator ? LABOR_WON_PER_DAY.건설기계운전사 : 0;
  return Math.round(runningWon + operatorWon);
}

/**
 * AI 가 낸 장비 이름·규격 문자열을 단가표의 기종으로 옮긴다.
 * 모델은 "굴착기", "06W 압쇄기 장착" 처럼 현장 말투로 쓰므로 규격 숫자를 먼저 본다.
 * 어디에도 걸리지 않으면 undefined — 값을 지어내느니 금액에서 빼는 편이 낫다.
 */
export function matchEquipment(name: string, spec?: string): EquipmentCode | undefined {
  return matchEquipmentAll(name, spec)[0];
}

/**
 * 한 줄에 여러 장비가 적힌 경우를 모두 잡는다.
 *
 * 모델은 "중형 굴착기(압쇄기 부착)" 처럼 **모기계와 부착장비를 한 줄에** 쓴다. 이걸
 * 하나만 고르면 압쇄기만 잡고 그걸 달고 있는 굴착기를 통째로 빠뜨려 장비비가 실제의
 * 4분의 1이 된다(압쇄기 15만/일, 굴착기 65만/일). 부착장비는 혼자 움직이지 못한다.
 */
export function matchEquipmentAll(name: string, spec?: string): EquipmentCode[] {
  const text = `${name} ${spec ?? ''}`.toLowerCase();
  const out: EquipmentCode[] = [];

  const pulverizer = /압쇄|펄버|크러셔|crusher/.test(text);
  const breaker = /브레이커|breaker|함마|햄머/.test(text);
  // "대형브레이커" 의 '대형' 은 브레이커의 크기지 그걸 단 굴착기의 크기가 아니다.
  // 부착장비가 함께 적힌 줄에서는 크기 낱말로 모기계 등급을 추정하지 않는다.
  const carrier = matchExcavator(text, { ignoreSizeWords: pulverizer || breaker });
  if (carrier) out.push(carrier);
  if (pulverizer) out.push('PULVERIZER_10');
  if (breaker) out.push('BREAKER_07');

  // 부착장비만 적혀 있어도 그걸 달 굴착기가 반드시 있어야 한다.
  if (out.length > 0 && !out.some((c) => c.startsWith('EXCAVATOR'))) out.unshift('EXCAVATOR_06');
  return out;
}

/** 굴착기 등급 판정. 규격 숫자가 없으면 크기 낱말(소형·중형·대형)로 본다. */
function matchExcavator(
  text: string,
  opts: { ignoreSizeWords?: boolean } = {},
): EquipmentCode | undefined {
  if (!/굴착기|굴삭기|포크레인|excavator|백호/.test(text)) return undefined;

  // 규격 표기가 여러 갈래다: 0.6㎥ / 06W / 6W. 숫자를 먼저 본다.
  const m3 = text.match(/(\d+(?:\.\d+)?)\s*(?:㎥|m3|루베)/);
  const wClass = text.match(/\b0?(\d)\s*w\b/);
  const bucket = m3 ? Number(m3[1]) : wClass ? Number(wClass[1]) / 10 : undefined;
  if (bucket !== undefined) {
    if (bucket <= 0.25) return 'EXCAVATOR_02';
    if (bucket <= 0.45) return 'EXCAVATOR_04';
    if (bucket <= 0.75) return 'EXCAVATOR_06';
    return 'EXCAVATOR_10';
  }
  if (!opts.ignoreSizeWords) {
    if (/미니|소형|스키드|skid|mini/.test(text)) return 'EXCAVATOR_02';
    if (/대형|large/.test(text)) return 'EXCAVATOR_10';
  }
  return 'EXCAVATOR_06'; // 소규모 철거의 표준 장비
}

/**
 * 간접비 요율. 공사원가계산의 관례적 계상 순서를 따른다.
 * 요율은 공사 규모·종류로 달라지므로 소규모 철거 기준의 보수적인 값을 쓰고,
 * 근거를 함께 노출해 발주자가 자기 기준으로 조정할 수 있게 한다.
 */
export const OVERHEAD_RATES = {
  /** 산업안전보건관리비 — 직접노무비+재료비 대비. 소규모 건축공사 기준. */
  safety: 0.0293,
  /** 일반관리비 — 순공사원가 대비. */
  general: 0.06,
  /** 이윤 — 노무비+경비+일반관리비 대비. */
  profit: 0.15,
  /** 부가가치세. */
  vat: 0.1,
} as const;

/**
 * 현장 조건에 따른 할증.
 *
 * 특이사항을 글로만 적어 두면 견적에 반영되지 않는다. 석면이 있으면 인력이 바뀌고,
 * 야간에 하면 노임이 오르고, 장비가 못 들어가면 사람 손이 더 든다 — 실제 견적서는
 * 이걸 금액으로 적는다.
 *
 * 다만 여기서도 규칙은 같다: **공표된 근거가 있는 것만 금액으로 만든다.**
 * 근거가 없는 것(석면 조사비, 인허가 수수료)은 금액 대신 제외 항목으로 남긴다.
 */
export interface RiskInput {
  /** 석면 의심이 있는가. */
  asbestos?: boolean;
  /** 야간·휴일 작업인가. */
  nightWork?: boolean;
  /** 장비 진입이 어려운가(좁은 골목·지하·상층부). */
  hardAccess?: boolean;
  /** 마감재가 뒤섞여 수작업 분리 비중이 큰가. */
  handSorting?: boolean;
}

/**
 * 특이사항 문장에서 현장 조건을 읽는다.
 *
 * AI 가 내는 문장은 자유 형식이라 구조화된 값이 없다. 그렇다고 사람이 매번 체크박스를
 * 누르게 할 수도 없다. 견적을 바꾸는 조건은 종류가 정해져 있으므로 낱말로 잡아낸다.
 * 놓치면 할증이 빠질 뿐 잘못된 금액이 나오지는 않는다 — 한쪽으로만 틀리게 설계했다.
 */
export function detectRisks(texts: readonly string[]): RiskInput {
  const all = texts.join(' ');
  return {
    asbestos: /석면|슬레이트|텍스|뿜칠|내화피복/.test(all),
    nightWork: /야간|심야|주말|휴일|야간작업/.test(all),
    hardAccess: /진입|접근|골목|협소|좁은|양중|크레인|고소|지하층|이면도로/.test(all),
    handSorting: /수작업|분리\s*해체|혼재|뒤섞|선별/.test(all),
  };
}

/** 금액 한 줄. min/max 는 분리배출 성패·차종 차이에서 오는 실제 폭이다. */
export interface CostLine {
  key:
    | 'TREATMENT' | 'TRANSPORT' | 'LABOR' | 'EQUIPMENT'
    | 'NIGHT' | 'ACCESS' | 'HANDWORK'
    | 'SAFETY' | 'GENERAL' | 'PROFIT';
  label: string;
  minWon: number;
  maxWon: number;
  /** 어떻게 이 금액이 나왔는지 — 한 줄씩. 검산할 수 있게 수식과 수치를 그대로 쓴다. */
  detail: string[];
  /** 단가 출처(간접비는 요율 근거). */
  source?: PriceSource;
}

export interface CostEstimate {
  /** 직접비 + 간접비 항목. */
  lines: CostLine[];
  /** 부가세 전 합계. */
  subtotalMinWon: number;
  subtotalMaxWon: number;
  vatMinWon: number;
  vatMaxWon: number;
  totalMinWon: number;
  totalMaxWon: number;
  /** 이 견적에 포함되지 않은 비용 — 빠진 걸 모르고 계약하는 게 가장 큰 사고다. */
  excluded: string[];
  /** 계산에 쓴 가정. 하나라도 틀리면 금액이 달라진다는 걸 명시한다. */
  assumptions: string[];
  pricedAt: string;
}

export interface CostEstimateInput {
  /** 법정 분류별 배출량(kg). 분석의 quoteBasis.wasteByClass 를 그대로 넣는다. */
  wasteByClass: Array<{ wasteClass: ConstructionWasteClass; estimatedKg: number; separable: boolean }>;
  /** 예상 공기(일). */
  workDays?: number;
  /** 투입 인원(명/일). */
  crewSize?: number;
  /** 투입 장비 — AI 가 제안한 이름·규격 그대로. */
  equipment?: Array<{ name: string; spec?: string }>;
  /** 석면 의심이 있으면 석면해체공 노임과 격리 비용 안내를 붙인다. */
  hasAsbestos?: boolean;
  /** 처리장까지 거리(km). 기본 30km. */
  distanceKm?: number;
  /** 현장 조건 할증. 특이사항에서 읽어 넣는다. */
  risks?: RiskInput;
}

/**
 * 분류별 배출량을 총 물량에 맞춘다.
 *
 * 왜 필요한가: 비전 모델이 내는 소재별 kg 은 사진에서 눈대중한 값이라 총합이 들쭉날쭉하다.
 * 반면 총 물량은 연면적 × 발생 원단위 × 구조 보정으로 나와 훨씬 안정적이다.
 * 그래서 **총량은 원단위에서, 구성비는 사진에서** 가져와 둘의 장점만 쓴다.
 * 분류가 하나도 없거나 총량을 모르면 원본을 그대로 돌려준다(없는 값을 만들지 않는다).
 */
export function reconcileWasteByClass<T extends { estimatedKg: number }>(
  items: readonly T[],
  totalKg: number | undefined,
): T[] {
  const list = items.filter((w) => w.estimatedKg > 0);
  if (list.length === 0 || !totalKg || totalKg <= 0) return [...items];
  const sum = list.reduce((s, w) => s + w.estimatedKg, 0);
  if (sum <= 0) return [...items];
  const k = totalKg / sum;
  return list.map((w) => ({ ...w, estimatedKg: Math.round(w.estimatedKg * k) }));
}

const round1000 = (n: number) => Math.round(n / 1000) * 1000;
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const ton1 = (kg: number) => Math.round((kg / 1000) * 10) / 10;

/** 거리 보정 — 30km 를 1.0 으로 두고 공표표의 50km/30km 비율(약 1.37)을 선형 적용. */
function distanceFactor(km: number): number {
  if (!Number.isFinite(km) || km <= TRANSPORT_BASE_DISTANCE_KM) return 1;
  const capped = Math.min(km, 200);
  return 1 + ((capped - TRANSPORT_BASE_DISTANCE_KM) / 20) * 0.185;
}

/**
 * 분류별 배출량 → 금액.
 *
 * 합계를 억지로 채우지 않는다. 공표 단가가 없는 분류(폐목재 등)는 하한을 0 으로 두고
 * "분리배출 시 업체 단가" 로 남긴다 — 그 자리에 시세를 적어 넣으면 검증할 수 없는 숫자가
 * 견적서에 들어간다.
 */
export function estimateDemolitionCost(input: CostEstimateInput): CostEstimate {
  const lines: CostLine[] = [];
  const distKm = input.distanceKm ?? TRANSPORT_BASE_DISTANCE_KM;
  const factor = distanceFactor(distKm);

  // ── 1. 처리비 ────────────────────────────────────────────────────────────
  let treatMin = 0;
  let treatMax = 0;
  const treatDetail: string[] = [];
  for (const w of input.wasteByClass) {
    const tons = w.estimatedKg / 1000;
    if (tons <= 0) continue;
    const rate = TREATMENT_WON_PER_TON[w.wasteClass];
    if (!rate) continue;
    // 분리배출이 안 된다고 이미 판정된 분류는 하한도 혼합 단가로 올린다.
    // 단, 혼합·지정폐기물은 애초에 분리 대상이 아니므로 공표 범위를 그대로 쓴다
    // (여기서 상한으로 올리면 이미 혼합인 물량에 불연성 혼합 단가를 덧씌우게 된다).
    const alreadyMixed = w.wasteClass === 'MIXED' || w.wasteClass === 'DESIGNATED';
    const lo = w.separable || alreadyMixed ? rate.min : rate.max;
    treatMin += tons * lo;
    treatMax += tons * rate.max;
    const escalated = lo === rate.max && rate.min < rate.max;
    treatDetail.push(
      `${WASTE_CLASS_SHORT[w.wasteClass]} ${ton1(w.estimatedKg)}톤 × ` +
        (lo === rate.max ? won(rate.max) : `${won(lo)}~${won(rate.max)}`) +
        '/톤' +
        (rate.published ? '' : ' (공표 단가 없음 — 분리 시 업체 단가)') +
        // 분리하면 얼마가 줄어드는지 숫자로 보여 준다 — 현장에서 실제로 바꿀 수 있는 항목이다.
        (escalated
          ? ` (혼합 배출 기준. 분리하면 ${won(rate.min)}/톤 — ` +
            `${won((rate.max - rate.min) * tons)} 절감)`
          : ''),
    );
  }
  if (treatMax > 0) {
    lines.push({
      key: 'TREATMENT',
      label: '폐기물 중간처리비',
      minWon: round1000(treatMin),
      maxWon: round1000(treatMax),
      detail: treatDetail,
      source: PRICE_SOURCES.treatment,
    });
  }

  // ── 2. 수집·운반비 ──────────────────────────────────────────────────────
  let transMin = 0;
  let transMax = 0;
  let debrisKg = 0;
  let mixedKg = 0;
  let asbestosKg = 0;
  for (const w of input.wasteByClass) {
    if (w.estimatedKg <= 0) continue;
    // 지정폐기물(석면)의 수집·운반은 현장과 최종처리업체 거리에 따라 달라서
    // 환경부 고시도 "수집·운반업체 견적에 의할 것" 을 권한다. 여기서 값을 만들지 않는다.
    if (w.wasteClass === 'DESIGNATED') {
      asbestosKg += w.estimatedKg;
      continue;
    }
    // 덤프냐 암롤이냐는 **적재 비중**이 가른다(건설폐재류 1.6톤/㎥, 혼합 0.63톤/㎥).
    // 분리배출 여부와는 무관하다 — 오염된 폐콘크리트도 콘크리트 무게로 실린다.
    // 여기서 separable 을 보면 같은 물량의 운반비가 3배로 튄다.
    const isDebris =
      w.wasteClass === 'CONCRETE' || w.wasteClass === 'ASPHALT' || w.wasteClass === 'BRICK_BLOCK';
    if (isDebris) debrisKg += w.estimatedKg;
    else mixedKg += w.estimatedKg;
  }
  const transDetail: string[] = [];
  if (debrisKg > 0) {
    transMin += (debrisKg / 1000) * TRANSPORT_WON_PER_TON.debris.min * factor;
    transMax += (debrisKg / 1000) * TRANSPORT_WON_PER_TON.debris.max * factor;
    transDetail.push(
      `건설폐재류 ${ton1(debrisKg)}톤 × ${won(TRANSPORT_WON_PER_TON.debris.min)}~` +
        `${won(TRANSPORT_WON_PER_TON.debris.max)}/톤 (24톤 덤프~4.5톤 덤프)`,
    );
  }
  if (mixedKg > 0) {
    transMin += (mixedKg / 1000) * TRANSPORT_WON_PER_TON.mixed.min * factor;
    transMax += (mixedKg / 1000) * TRANSPORT_WON_PER_TON.mixed.max * factor;
    transDetail.push(
      `혼합·기타 ${ton1(mixedKg)}톤 × ${won(TRANSPORT_WON_PER_TON.mixed.min)}~` +
        `${won(TRANSPORT_WON_PER_TON.mixed.max)}/톤 (24톤~16톤 암롤)`,
    );
  }
  if (transMax > 0) {
    if (factor > 1) transDetail.push(`운반거리 ${distKm}km 보정 ×${factor.toFixed(2)}`);
    if (asbestosKg > 0) {
      transDetail.push(
        `석면 ${ton1(asbestosKg)}톤의 수집·운반비는 제외 — 최종처리업체까지 거리에 따라 달라 ` +
          '수집·운반업체 견적으로 정해야 합니다(환경부 고시 권고).',
      );
    }
    lines.push({
      key: 'TRANSPORT',
      label: '수집·운반비',
      minWon: round1000(transMin),
      maxWon: round1000(transMax),
      detail: transDetail,
      source: PRICE_SOURCES.transport,
    });
  }

  // ── 3. 인건비 ───────────────────────────────────────────────────────────
  const days = input.workDays && input.workDays > 0 ? input.workDays : 0;
  const crew = input.crewSize && input.crewSize > 0 ? input.crewSize : 0;
  let laborMin = 0;
  let laborMax = 0;
  if (days > 0 && crew > 0) {
    // 구성은 작업반장 1 + 나머지 보통인부를 하한, 전원 특별인부를 상한으로 본다.
    // 실제 현장은 그 사이 어딘가다(숙련도·작업 난이도에 따라).
    const helpers = Math.max(0, crew - 1);
    laborMin = (LABOR_WON_PER_DAY.작업반장 + helpers * LABOR_WON_PER_DAY.보통인부) * days;
    laborMax = (LABOR_WON_PER_DAY.작업반장 + helpers * LABOR_WON_PER_DAY.특별인부) * days;
    const detail = [
      `작업반장 1명 × ${won(LABOR_WON_PER_DAY.작업반장)}/일 × ${days}일`,
      `인부 ${helpers}명 × ${won(LABOR_WON_PER_DAY.보통인부)}~${won(LABOR_WON_PER_DAY.특별인부)}/일 × ${days}일`,
    ];
    if (input.hasAsbestos) {
      // 석면 해체는 등록업체·전문 인력이 별도로 붙는다. 일반 인부로 대체할 수 없다.
      detail.push(
        `석면해체공 ${won(LABOR_WON_PER_DAY.석면해체공)}/일 — 석면 조사 결과에 따라 별도 계상`,
      );
    }
    lines.push({
      key: 'LABOR',
      label: '인건비(직접노무비)',
      minWon: round1000(laborMin),
      maxWon: round1000(laborMax),
      detail,
      source: PRICE_SOURCES.labor,
    });
  }

  // ── 4. 장비비 ───────────────────────────────────────────────────────────
  const codes = new Set<EquipmentCode>();
  for (const e of input.equipment ?? []) {
    for (const code of matchEquipmentAll(e.name, e.spec)) codes.add(code);
  }
  // 굴착기가 여러 대 제안돼도 소규모 현장에 세 대가 공기 내내 서 있지는 않는다.
  // 주력 1대(가장 큰 것)와 그 부착장비는 전 기간, 나머지 굴착기는 보조로 들어왔다 나가므로
  // 공기의 일부만 계상한다. 전부 전 기간으로 잡으면 장비비가 두세 배로 부풀어 견적이 무너진다.
  const SUPPORT_SHARE = 0.3;
  const excavators = [...codes]
    .filter((c) => c.startsWith('EXCAVATOR'))
    .sort((a, b) => equipmentDailyWon(EQUIPMENT_RATES[b]!) - equipmentDailyWon(EQUIPMENT_RATES[a]!));
  const attachments = [...codes].filter((c) => !c.startsWith('EXCAVATOR'));

  let fullDaily = 0;
  let supportDaily = 0;
  const equipDetail: string[] = [];
  const describe = (code: EquipmentCode, share: string) => {
    const rate = EQUIPMENT_RATES[code]!;
    equipDetail.push(
      `${rate.label} ${rate.spec} ${won(equipmentDailyWon(rate))}/일 ${share}` +
        (rate.operator ? ' · 손료+연료+잡재료+조종원' : ' · 부착장비 손료'),
    );
  };
  excavators.forEach((code, i) => {
    const daily = equipmentDailyWon(EQUIPMENT_RATES[code]!);
    if (i === 0) {
      fullDaily += daily;
      describe(code, '(주력, 전 기간)');
    } else {
      supportDaily += daily;
      describe(code, `(보조, 공기의 ${Math.round(SUPPORT_SHARE * 100)}%)`);
    }
  });
  for (const code of attachments) {
    fullDaily += equipmentDailyWon(EQUIPMENT_RATES[code]!);
    describe(code, '(주력에 부착, 전 기간)');
  }

  if (fullDaily > 0 && days > 0) {
    // 주력 장비도 공기 내내 돌지는 않는다(해체 전 조사·마감재 뜯기 구간). 하한은 60%.
    const minDays = Math.max(1, Math.round(days * 0.6));
    const supportDays = Math.max(1, Math.round(days * SUPPORT_SHARE));
    equipDetail.push(
      `주력 가동 ${minDays}~${days}일 (경유 ${won(DIESEL_WON_PER_LITER)}/ℓ 기준, 1일 8시간)`,
    );
    lines.push({
      key: 'EQUIPMENT',
      label: '장비비',
      minWon: round1000(fullDaily * minDays + supportDaily * supportDays),
      maxWon: round1000(fullDaily * days + supportDaily * supportDays),
      detail: equipDetail,
      source: PRICE_SOURCES.equipment,
    });
  }

  // ── 5. 현장 조건 할증 ───────────────────────────────────────────────────
  // 특이사항을 글로만 적으면 견적에 반영되지 않는다. 금액으로 옮기되,
  // 공표 근거가 있는 것만 더한다.
  const risk = input.risks ?? {};
  const laborLine = lines.find((l) => l.key === 'LABOR');
  const equipLine = lines.find((l) => l.key === 'EQUIPMENT');

  if (risk.nightWork && laborLine) {
    // 근로기준법 제56조 — 야간(22시~06시)·휴일 근로는 통상임금의 50% 이상 가산.
    // 법으로 정해진 비율이라 추정이 아니다.
    lines.push({
      key: 'NIGHT',
      label: '야간·휴일 근로 가산',
      minWon: round1000(laborLine.minWon * 0.5),
      maxWon: round1000(laborLine.maxWon * 0.5),
      detail: [
        `직접노무비 × 50%`,
        '근로기준법 제56조 — 야간(22~06시)·휴일 근로는 통상임금의 50% 이상 가산',
      ],
      source: PRICE_SOURCES.labor,
    });
  }

  if (risk.hardAccess && equipLine) {
    // 장비가 못 들어가면 소형 장비로 바꾸고 가동일이 늘어난다. 실무에서 흔한 30% 를
    // 쓰되 근거를 함께 적어 발주자가 자기 현장 기준으로 고칠 수 있게 한다.
    lines.push({
      key: 'ACCESS',
      label: '장비 진입 곤란 할증',
      minWon: round1000(equipLine.minWon * 0.3),
      maxWon: round1000(equipLine.maxWon * 0.3),
      detail: [
        '장비비 × 30%',
        '진입로가 좁아 소형 장비로 대체하거나 양중이 필요한 경우의 가동일 증가분',
        '실제 폭은 현장 실사로 확정해야 한다',
      ],
      source: PRICE_SOURCES.equipment,
    });
  }

  if (risk.handSorting && laborLine) {
    // 마감재가 뒤섞이면 사람이 골라내야 한다. 인건비가 늘고, 대신 분리배출이 되어
    // 처리비는 내려간다 — 그래서 처리비 하한이 이미 그 이득을 반영하고 있다.
    lines.push({
      key: 'HANDWORK',
      label: '수작업 분리 할증',
      minWon: round1000(laborLine.minWon * 0.2),
      maxWon: round1000(laborLine.maxWon * 0.35),
      detail: [
        '직접노무비 × 20~35%',
        '마감재가 뒤섞여 기계로 밀지 못하고 사람이 골라내야 하는 구간',
        '대신 분리배출이 되어 처리비는 내려간다(처리비 하한에 이미 반영)',
      ],
      source: PRICE_SOURCES.labor,
    });
  }

  // ── 6. 간접비 ───────────────────────────────────────────────────────────
  const directMin = lines.reduce((s, l) => s + l.minWon, 0);
  const directMax = lines.reduce((s, l) => s + l.maxWon, 0);

  if (directMax > 0) {
    const safetyMin = directMin * OVERHEAD_RATES.safety;
    const safetyMax = directMax * OVERHEAD_RATES.safety;
    lines.push({
      key: 'SAFETY',
      label: '산업안전보건관리비',
      minWon: round1000(safetyMin),
      maxWon: round1000(safetyMax),
      detail: [
        `직접공사비 × ${(OVERHEAD_RATES.safety * 100).toFixed(2)}%`,
        '법정 계상 항목 — 보호구·안전시설·안전관리자 인건비에 쓴다',
      ],
    });

    const netMin = directMin + safetyMin;
    const netMax = directMax + safetyMax;
    const genMin = netMin * OVERHEAD_RATES.general;
    const genMax = netMax * OVERHEAD_RATES.general;
    lines.push({
      key: 'GENERAL',
      label: '일반관리비',
      minWon: round1000(genMin),
      maxWon: round1000(genMax),
      detail: [`순공사원가 × ${(OVERHEAD_RATES.general * 100).toFixed(0)}%`],
    });

    const profitMin = (netMin + genMin) * OVERHEAD_RATES.profit;
    const profitMax = (netMax + genMax) * OVERHEAD_RATES.profit;
    lines.push({
      key: 'PROFIT',
      label: '이윤',
      minWon: round1000(profitMin),
      maxWon: round1000(profitMax),
      detail: [`(순공사원가+일반관리비) × ${(OVERHEAD_RATES.profit * 100).toFixed(0)}%`],
    });
  }

  const subtotalMinWon = round1000(lines.reduce((s, l) => s + l.minWon, 0));
  const subtotalMaxWon = round1000(lines.reduce((s, l) => s + l.maxWon, 0));
  const vatMinWon = round1000(subtotalMinWon * OVERHEAD_RATES.vat);
  const vatMaxWon = round1000(subtotalMaxWon * OVERHEAD_RATES.vat);

  const excluded = [
    '건축물 멸실신고·해체계획서 작성 및 인허가 수수료',
    '해체감리비(해체계획서 승인 대상 현장)',
    '가설울타리·방진막·살수시설 등 가설공사비',
    '전기·통신·가스·상하수도 인입선 철거 및 이설비',
    '지장물·지중구조물·정화조 처리비',
    '폐기물처분부담금 및 최종처분(매립) 반입료',
  ];
  if (input.hasAsbestos || risk.asbestos) {
    // 석면은 등록업체가 별도 계약으로 한다. 금액을 합계에 넣으면 이 견적으로
    // 계약할 수 있다는 오해를 준다. 대신 **규모를 숫자로** 적어 발주자가 예산을
    // 잡을 수 있게 한다 — "별도" 라고만 쓰면 얼마인지 몰라 준비를 못 한다.
    const dayRate = LABOR_WON_PER_DAY.석면해체공;
    const lo = dayRate * 2 * 2; // 2명 × 2일
    const hi = dayRate * 4 * 5; // 4명 × 5일
    excluded.unshift(
      `석면조사비(석면안전관리법상 해체 전 의무 — 기관 견적) 및 석면해체·제거 공사비 ` +
        `— 석면해체공 ${won(dayRate)}/일 기준 ${won(lo)}~${won(hi)} 규모(2~4명 × 2~5일). ` +
        `폐석면 처리비 ${won(TREATMENT_WON_PER_TON.DESIGNATED.min)}/톤은 위 처리비에 포함됨`,
    );
  }

  const assumptions = [
    ...(risk.nightWork ? [] : ['주간작업 기준 — 야간·휴일 작업이면 노무비가 50% 가산된다']),
    ...(risk.hardAccess ? [] : ['장비가 현장까지 진입 가능한 것으로 본다']),
    `운반거리 ${distKm}km, 처리장 반입 기준`,
    '1일 8시간 기준',
    '폐기물 물량은 사진·연면적 기반 추정치 — 실제 계량 중량으로 정산해야 한다',
  ];

  return {
    lines,
    subtotalMinWon,
    subtotalMaxWon,
    vatMinWon,
    vatMaxWon,
    totalMinWon: subtotalMinWon + vatMinWon,
    totalMaxWon: subtotalMaxWon + vatMaxWon,
    excluded,
    assumptions,
    pricedAt: new Date().toISOString(),
  };
}

/** 내역 한 줄에 쓰는 짧은 분류명. WASTE_CLASS_LABELS 는 길어서 표가 흐트러진다. */
const WASTE_CLASS_SHORT: Record<ConstructionWasteClass, string> = {
  CONCRETE: '폐콘크리트',
  ASPHALT: '폐아스콘',
  BRICK_BLOCK: '폐벽돌·블록',
  WOOD: '폐목재',
  PLASTIC: '폐합성수지',
  METAL: '폐금속류',
  GLASS: '폐유리',
  BOARD: '폐보드류',
  MIXED: '혼합건설폐기물',
  DESIGNATED: '지정폐기물(석면)',
};

/** 금액을 "1,234만원" 처럼 읽기 쉽게. 견적 총액은 원 단위 정밀도가 의미 없다. */
export function formatWonShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0원';
  if (n >= 100_000_000) {
    const eok = n / 100_000_000;
    return `${Math.round(eok * 100) / 100}억원`;
  }
  if (n >= 10_000) {
    return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만원`;
  }
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}
