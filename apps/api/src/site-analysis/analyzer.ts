import {
  SITE_ANALYSIS_DISCLAIMER,
  type ConstructionWasteClass,
  type DetectedMaterial,
  type DemolitionStep,
  type SiteAnalysis,
  type SiteQuoteBasis,
} from '@dimol/shared';

/**
 * 현장 사진 AI 분석 어댑터 (로드맵 Phase 6).
 * 올바로/포트원과 동일하게 "목 ↔ 실제" 를 인터페이스 뒤에 두고, 키 유무로 선택한다.
 * - MockSiteAnalyzer: 키·비용 없이 동작(파일럿 기본). 결정적 샘플.
 * - ClaudeSiteAnalyzer: 사진을 Claude 비전으로 분석(ANTHROPIC_API_KEY 필요).
 * 결과는 항상 참고용이며 안전 고지(disclaimer)를 포함한다.
 */

export class SiteAnalysisValidationError extends Error {}

/**
 * AI 가 석면을 "확정" 표현하지 못하게 한다(shared 의 출력 검증 레이어와 같은 원칙).
 * 석면은 사진만으로 판별할 수 없고 석면안전관리법상 전문기관 조사가 의무라,
 * "석면입니다"/"석면 없음" 모두 사용자를 오도한다. 프롬프트로 막고 여기서 한 번 더 거른다.
 */
const ASBESTOS_DEFINITIVE_PATTERNS: Array<[RegExp, string]> = [
  // 더 구체적인 패턴을 먼저 둔다 — "무석면 확정" 을 일반 패턴이 먼저 물면
  // "무석면 의심" 이라는 엉뚱한 문장이 된다.
  [/(무|비)석면\s*(확정|확인)(되었|됨|됐)?/g, '석면 함유 여부 미확인'],
  [/석면이\s*검출(되었|됐|됨)[^.]*/g, '석면 함유 가능성이 있어 전문 조사가 필요합니다'],
  [/석면이\s*있(습니다|음|다)/g, '석면 함유 가능성이 있습니다'],
  [/석면이\s*없(습니다|음|다)/g, '석면 함유 여부는 조사로 확인해야 합니다'],
  [/석면\s*(임|입니다|이다|확인됨|확정|검출됨|존재함)/g, '석면 의심'],
];

/** 석면 확정 표현을 의심·조사필요 표현으로 바꾼다. */
export function softenAsbestosClaims(text: string): string {
  let out = text;
  for (const [re, replacement] of ASBESTOS_DEFINITIVE_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

/**
 * 비전 공급자 호출 실패. HTTP 상태를 보존해 체인이 대응을 나눌 수 있게 한다.
 * 429(레이트리밋)는 같은 공급자를 다시 두드려봐야 한도만 더 태우므로 즉시 다음으로 넘기고,
 * 5xx(일시적 서버 오류)만 재시도할 가치가 있다 — 실측에서 두 실패의 성격이 달랐다.
 */
export class VisionProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }

  /** 레이트리밋 — 재시도해도 같은 창(window)에서는 풀리지 않는다. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** 잠깐 뒤 풀릴 수 있는 서버측 오류. */
  get isRetryable(): boolean {
    return this.status >= 500;
  }
}

/** 한 장의 현장 사진. */
export interface AnalyzeImage {
  imageBase64: string;
  mimeType?: string;
}

export interface AnalyzeSiteInput {
  /** 현장 사진 base64 (data: 접두사 없는 순수 base64). 단일 촬영 하위호환용. */
  imageBase64?: string;
  /** image/jpeg | image/png 등. 기본 image/jpeg. */
  mimeType?: string;
  /** 여러 각도·거리에서 찍은 현장 사진들(다중 촬영). 있으면 imageBase64 대신 이걸 쓴다. */
  images?: AnalyzeImage[];
  /** 사용자가 덧붙이는 현장 메모(선택) — 분석 힌트. */
  note?: string;
  /** 공공데이터 기반 건축물대장 주구조 정보 (예: 철근콘크리트구조) — 분석 힌트. */
  buildingStructure?: string;
  /** 건축물대장 사용승인 연도. 2009년 석면 사용 전면 금지 이전이면 석면 의심 가중. */
  buildingYear?: number;
  /** 건축물대장 주용도 (예: 단독주택, 제2종근린생활시설) — 자재 추정 힌트. */
  buildingUse?: string;
  /**
   * 건축물대장 연면적(㎡)과 지상 층수.
   * 물량·공기·인원·장비 규모를 사진만으로 잡으면 크게 빗나간다. 실제 크기를 알려주면
   * 모델이 "보이는 것" 을 "이만한 건물의 일부" 로 환산해 답을 맞춰 나간다.
   */
  totalFloorAreaM2?: number;
  floorsAbove?: number;
}

export interface SiteAnalyzer {
  analyze(input: AnalyzeSiteInput): Promise<SiteAnalysis>;
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** 한국에서 석면 사용이 전면 금지된 해. 이전 건축물은 석면 함유 가능성을 가중한다. */
export const ASBESTOS_BAN_YEAR = 2009;

/** 종합 분석에 쓰는 최대 사진 수(과대 페이로드·비용 방지). */
export const MAX_ANALYZE_IMAGES = 6;

/** 공통 입력 검증 — 단일 이미지. */
export function assertValidImage(input: AnalyzeImage): {
  imageBase64: string;
  mimeType: string;
} {
  const imageBase64 = (input.imageBase64 ?? '').replace(/^data:[^,]+,/, '').trim();
  if (imageBase64.length < 100) {
    throw new SiteAnalysisValidationError('현장 사진(imageBase64)이 필요합니다.');
  }
  const mimeType = input.mimeType ?? 'image/jpeg';
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new SiteAnalysisValidationError('지원 형식은 JPEG·PNG·WEBP 입니다.');
  }
  return { imageBase64, mimeType };
}

/**
 * 입력을 검증된 이미지 배열로 정규화한다(1..MAX). images 가 있으면 우선,
 * 없으면 단일 imageBase64 를 1장짜리로 취급(하위호환). 한 장도 없으면 예외.
 */
export function assertValidImages(
  input: AnalyzeSiteInput,
): { imageBase64: string; mimeType: string }[] {
  const raw: AnalyzeImage[] =
    input.images && input.images.length > 0
      ? input.images
      : input.imageBase64
        ? [{ imageBase64: input.imageBase64, mimeType: input.mimeType }]
        : [];
  if (raw.length === 0) {
    throw new SiteAnalysisValidationError('현장 사진(imageBase64)이 필요합니다.');
  }
  return raw.slice(0, MAX_ANALYZE_IMAGES).map((img) => assertValidImage(img));
}

/** 다중 이미지 종합 분석을 안내하는 사용자 지시문 구성. */
export function buildUserInstruction(
  note: string | undefined,
  buildingStructure: string | undefined,
  imageCount: number,
  building?: { year?: number; use?: string; areaM2?: number; floors?: number },
): string {
  const multi =
    imageCount > 1
      ? `다음은 같은 철거 현장을 여러 각도·거리에서 촬영한 ${imageCount}장의 사진입니다. ` +
        '모든 사진을 종합해 하나의 결과로 분석하고, 어느 한 장에서만 보이는 소재·위험요소도 놓치지 마세요.\n'
      : '';
  
  let base = `${multi}${USER_INSTRUCTION}`;
  
  if (buildingStructure) {
    base += `\n[핵심 힌트] 이 건물의 건축물대장상 주구조는 '${buildingStructure}'입니다. 사진 속 구조물이나 뼈대를 식별할 때 이 정보를 우선적으로 참고하여 오인식을 방지하세요.`;
  }
  if (building?.use) {
    base += `\n[건축물대장] 주용도는 '${building.use}' 입니다. 해당 용도에서 흔한 마감재를 우선 고려하세요.`;
  }
  if (building?.year !== undefined) {
    base +=
      building.year < ASBESTOS_BAN_YEAR
        ? `\n[건축물대장] 사용승인 ${building.year}년 — 석면 사용이 전면 금지된 ${ASBESTOS_BAN_YEAR}년 이전 건축물입니다. ` +
          '슬레이트 지붕재·천장 텍스·배관 보온재·뿜칠 내화피복에 석면 함유 가능성이 있으니 해당 부위가 보이면 석면 의심으로 다루세요(확정 표현 금지).'
        : `\n[건축물대장] 사용승인 ${building.year}년 — 석면 사용 금지(${ASBESTOS_BAN_YEAR}년) 이후 건축물이라 석면 자재 가능성은 낮습니다. 다만 증축·리모델링 부위는 예외일 수 있습니다.`;
  }
  if (building?.areaM2 !== undefined && building.areaM2 > 0) {
    // 사진에는 건물의 일부만 담긴다. 전체 규모를 알려주면 모델이 물량·공기·인원을
    // "보이는 만큼" 이 아니라 "이 건물만큼" 으로 잡는다 — 견적 오차가 가장 크게 줄어드는 지점이다.
    const floors = building.floors && building.floors > 0 ? building.floors : undefined;
    base +=
      `\n[건축물대장] 연면적 ${Math.round(building.areaM2).toLocaleString('ko-KR')}㎡` +
      (floors ? ` · 지상 ${floors}층` : '') +
      '. 사진은 이 건물의 일부만 보여 줍니다. wasteByClass 의 총량과 estimatedWorkDays·' +
      'estimatedCrewSize·장비 규모는 사진에 보이는 범위가 아니라 **이 연면적 전체**를 철거하는 기준으로 내세요.';
  }
  if (note) {
    base += `\n[현장 메모] ${note}`;
  }

  return base;
}

/** 결정적 목 — 건설폐기물(철거) 파일럿 범위의 대표 결과. */
export class MockSiteAnalyzer implements SiteAnalyzer {
  async analyze(input: AnalyzeSiteInput): Promise<SiteAnalysis> {
    assertValidImages(input);
    const materials: DetectedMaterial[] = [
      { category: 'CONCRETE', name: '철근콘크리트 벽체·슬래브', confidence: 'MEDIUM', recyclable: true, hazardous: false, note: '순환골재로 재활용 가능', estimatedKg: 15000 },
      { category: 'STEEL', name: '철근·형강', confidence: 'MEDIUM', recyclable: true, hazardous: false, note: '고철로 분리 매각', estimatedKg: 2000 },
      { category: 'BRICK', name: '벽돌·조적 마감', confidence: 'LOW', recyclable: true, hazardous: false, estimatedKg: 3000 },
      { category: 'TILE', name: '욕실 화장실 타일', confidence: 'HIGH', recyclable: false, hazardous: false, estimatedKg: 500 },
      { category: 'HAZARD', name: '슬레이트 지붕(석면 의심)', confidence: 'LOW', recyclable: false, hazardous: true, note: '석면 조사 전 임의 철거 금지 — 전문 업체 위탁', estimatedKg: 800 },
    ];
    const demolitionSteps: DemolitionStep[] = [
      { order: 1, title: '사전 조사·신고', description: '구조안전 검토와 석면 조사 후 해체계획서·신고를 완료합니다.', caution: '석면 확인 시 지정 업체가 우선 제거' },
      { order: 2, title: '내부 마감재 철거', description: '창호·석고보드·단열재 등 비구조 마감재를 먼저 분리합니다.' },
      { order: 3, title: '지붕·비구조체 해체', description: '지붕재와 비내력벽을 상부에서 하부 순으로 해체합니다.', caution: '석면 슬레이트는 습식·밀봉 후 특별관리' },
      { order: 4, title: '구조체 해체', description: '철근콘크리트 골조를 층별로 해체하며 살수로 분진을 억제합니다.' },
      { order: 5, title: '분리·반출', description: '콘크리트·철근·목재를 종류별로 분리해 반출하고 인계서로 처리합니다.' },
    ];
    return {
      summary: '철근콘크리트 주구조에 조적 마감, 석면 의심 지붕재가 관찰됩니다.',
      materials,
      demolitionSteps,
      hazards: ['석면 의심 지붕재 — 조사 전 철거 금지', '해체 중 구조 붕괴·낙하물 주의', '분진 발생 — 살수·보호구 필수'],
      method: 'MOCK',
      confidence: 'LOW',
      disclaimer: SITE_ANALYSIS_DISCLAIMER,
      analyzedAt: new Date().toISOString(),
    };
  }
}

export interface ClaudeAnalyzerConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseUrl?: string;
}

const SYSTEM_PROMPT = [
  '당신은 한국의 건설폐기물 철거 현장을 분석하는 전문 보조자입니다.',
  '현장 사진을 보고 구성 소재, 권장 철거 공정, 안전 위험요소를 분석해 지정된 JSON 스키마로만 응답합니다.',
  '',
  '[법령·표현 규칙 — 반드시 지킬 것]',
  '1. 석면은 사진만으로 확정할 수 없습니다. "석면임/석면 검출/석면 없음" 같은 확정 표현을 절대 쓰지 마세요.',
  '   "석면 의심", "석면 함유 가능성", "전문 조사 필요" 까지만 표현합니다.',
  '   석면안전관리법상 해체 전 전문기관 조사가 의무이며, 임의 제거를 권해서는 안 됩니다.',
  '2. 한국은 2009년부터 석면 사용이 전면 금지되었습니다. 건축 시기가 그 이전이면',
  '   슬레이트 지붕재, 천장 텍스, 배관 보온재, 뿜칠 내화피복에 석면 함유 가능성이 있습니다.',
  '3. 건설폐기물은 종류별 분리 배출이 원칙입니다(건설폐기물의 재활용촉진에 관한 법률).',
  '   혼합배출은 처리 단가를 크게 올리므로 공정에 분리 단계를 포함하세요.',
  '',
  '[소재 판별 주의]',
  '- TILE(위생도기·타일)과 WOOD(목재)를 혼동하지 마세요. 타일은 매끄러운 광택 표면으로 욕실·주방·현관에,',
  '  목재는 나뭇결이나 합판 층이 보입니다.',
  '- GYPSUM(석고보드)은 흰 석고층에 종이가 붙은 단면이 특징이며, 철거 시 대량으로 부서져 쌓입니다.',
  '- ROOFING(지붕재) 중 회색 골형 슬레이트는 석면 의심 대상입니다.',
  '- 마감재에 가려 보이지 않는 구조체를 추측으로 단정하지 말고 confidence 를 낮추세요.',
  '',
  '[중량 추정 기준] estimatedKg 는 사진에 보이는 면적·두께·부피로 현실적으로 산정합니다.',
  '참고 밀도: 철근콘크리트 2,400kg/㎥, 시멘트 몰탈 2,100, 벽돌 조적 1,900, 타일 2,000,',
  '석고보드 약 9kg/㎡(9.5T), 목재 500, 철강 7,850.',
  '보이지 않는 부분까지 상상해서 부풀리지 마세요.',
  '',
  '[분류가 곧 돈이다 — wasteClass 와 separable 을 신중히 고르세요]',
  '아래는 실제 공표 처리단가(원/톤)입니다. 같은 물량이라도 어느 분류로 나가느냐에 따라 견적이 5배 달라집니다.',
  '- 폐콘크리트(순수) 29,396 / 건설폐재류(가연성 제거) 48,021',
  '- 혼합건설폐기물(가연성 5% 이하) 68,563 / 불연성+가연성 혼합 168,424',
  '- 폐보드류·폐판넬 혼합 173,154 / 폐석면(지정폐기물) 645,000',
  '그러므로 분리 배출이 현실적으로 가능한 물량을 MIXED 로 뭉뚱그리지 마세요.',
  '반대로 마감재가 콘크리트에 붙은 채 뜯겨 나올 부위를 CONCRETE 로 잡지도 마세요 — 그건 실제로 혼합으로 나갑니다.',
  'separable 은 "현장에서 사람이 분리해 따로 쌓을 수 있는가" 입니다. 해체 순서상 먼저 뜯어내는 마감재는 true,',
  '구조체와 함께 부서져 섞이는 것은 false 입니다.',
  '',
  '[장비 표기] equipment 의 spec 에는 규격을 숫자로 쓰세요(예: "0.6㎥", "1.0㎥").',
  '규격이 있어야 시간당 기계경비를 계산할 수 있습니다. 굴착기는 0.2 / 0.4 / 0.6 / 1.0㎥ 중에서 고르고,',
  '부착장비는 "압쇄기", "대형브레이커" 처럼 이름을 그대로 쓰세요.',
  '',
  '[신뢰도] HIGH 는 소재가 명확히 식별될 때만. 가려지거나 흐릿하면 LOW 를 쓰세요.',
  '모든 텍스트는 한국어로 작성합니다.',
].join('\n');

const USER_INSTRUCTION = [
  '이 철거 현장 사진을 분석해 아래 JSON 스키마로만 답하세요(코드블록·설명 없이 JSON 객체 하나):',
  '{"summary": string, "materials": [{"category": "CONCRETE|STEEL|BRICK|WOOD|GLASS|GYPSUM|INSULATION|ROOFING|TILE|HAZARD|OTHER", "name": string, "estimatedKg": number, "confidence": "LOW|MEDIUM|HIGH", "recyclable": boolean, "hazardous": boolean, "note"?: string}], "demolitionSteps": [{"order": number, "title": string, "description": string, "caution"?: string}], "hazards": string[], "confidence": "LOW|MEDIUM|HIGH", "quoteBasis": {"wasteByClass": [{"wasteClass": "CONCRETE|ASPHALT|BRICK_BLOCK|WOOD|PLASTIC|METAL|GLASS|BOARD|MIXED|DESIGNATED", "estimatedKg": number, "separable": boolean, "note"?: string}], "equipment": [{"name": string, "spec"?: string, "reason": string}], "estimatedWorkDays": number, "estimatedCrewSize": number, "siteChecklist": string[], "costDrivers": string[]}}',
  '',
  '작성 지침:',
  '- summary: 어떤 건물의 어떤 상태인지, 철거 난이도를 좌우하는 요소가 무엇인지 2~3문장.',
  '- materials: 사진에서 실제로 보이는 것만. estimatedKg 는 정수로 반드시 채우세요.',
  '  석면 의심 자재는 category 를 HAZARD, hazardous 를 true 로 하고 name 에 "(석면 의심)" 을 붙이세요.',
  '- demolitionSteps: 실제 시공 순서대로. 사전 조사·신고 → 내부 마감재 → 설비·배관 → 지붕/비구조체',
  '  → 구조체 → 분리 반출 흐름을 현장 상황에 맞게 조정하세요.',
  '  caution 에는 그 단계에서 실제로 사고가 나는 지점을 적으세요(일반론 금지).',
  '- hazards: 이 현장에 실제로 보이는 위험만. 보이지 않는 위험을 나열하지 마세요.',
  '',
  '[quoteBasis — 철거업자가 견적과 시공계획을 잡는 데 쓰는 자료]',
  '- wasteByClass: 소재를 건설폐기물 법정 분류로 묶어 분류별 kg 을 내세요. materials 의 합과 크게',
  '  어긋나지 않아야 합니다. 분리 배출이 어려워 혼합으로 나갈 물량은 MIXED 로, 석면 의심은',
  '  DESIGNATED 로 잡으세요. 혼합·지정은 처리 단가가 크게 높아 견적을 좌우합니다.',
  '  separable 은 현장에서 실제로 분리해 배출할 수 있는지를 뜻합니다.',
  '- equipment: 이 현장 규모·구조에 맞는 장비를 제안하세요(예: 굴착기 06W 압쇄기, 고소작업대).',
  '  reason 에는 왜 그 장비가 필요한지 현장 근거를 쓰세요.',
  '- estimatedWorkDays / estimatedCrewSize: 순수 철거 작업 기준의 현실적인 값.',
  '  이 두 값이 인건비·장비비를 통째로 좌우하므로 사진의 인상이 아니라 건물 규모로 잡으세요.',
  '  통상 범위(기계 철거, 장비 진입 가능한 현장 기준):',
  '   · 연면적 100㎡ 이하 — 2~4일, 3~4명',
  '   · 연면적 100~300㎡ — 3~7일, 3~5명',
  '   · 연면적 300~1,000㎡ — 7~15일, 5~8명',
  '   · 연면적 1,000㎡ 초과 — 15일 이상, 8명 이상',
  '  분리해체(가연성 선별)나 수작업 구간이 많으면 위 범위의 상단을, 장비로 밀어내는 단순',
  '  철거면 하단을 쓰세요. 석면 해체는 별도 공정·별도 업체라 여기에 포함하지 마세요.',
  '- siteChecklist: **사진으로는 확인할 수 없어 현장 실사에서 반드시 봐야 할 항목**을 쓰세요.',
  '  (예: 내력벽 여부, 지하층·지중 구조물, 도로 접근성과 장비 진입 폭, 인접 건물 이격거리,',
  '  전기·가스·상하수 차단 여부, 석면 시료 채취 위치). 이게 견적의 오차를 만드는 지점입니다.',
  '- costDrivers: 단가를 올리거나 내리는 요인을 쓰세요(석면 별도 처리, 양중 곤란, 야간작업 등).',
].join('\n');

const WASTE_CLASSES = new Set<ConstructionWasteClass>([
  'CONCRETE','ASPHALT','BRICK_BLOCK','WOOD','PLASTIC','METAL','GLASS','BOARD','MIXED','DESIGNATED',
]);

/**
 * 견적 기초자료 정규화. 구형 응답이나 모델이 빠뜨린 경우 undefined 를 돌려
 * 화면이 해당 섹션을 통째로 감추게 한다(빈 껍데기를 보여주지 않는다).
 */
export function parseQuoteBasis(raw: unknown): SiteQuoteBasis | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const q = raw as Record<string, unknown>;
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

  const wasteByClass = (Array.isArray(q.wasteByClass) ? q.wasteByClass : [])
    .map((w) => w as Record<string, unknown>)
    .filter((w) => WASTE_CLASSES.has(w.wasteClass as ConstructionWasteClass))
    .map((w) => ({
      wasteClass: w.wasteClass as ConstructionWasteClass,
      estimatedKg: typeof w.estimatedKg === 'number' ? Math.max(0, Math.round(w.estimatedKg)) : 0,
      separable: w.separable !== false,
      note: typeof w.note === 'string' ? softenAsbestosClaims(w.note) : undefined,
    }))
    .filter((w) => w.estimatedKg > 0);

  const equipment = (Array.isArray(q.equipment) ? q.equipment : [])
    .map((e) => e as Record<string, unknown>)
    .filter((e) => typeof e.name === 'string' && e.name.trim() !== '')
    .map((e) => ({
      name: e.name as string,
      spec: typeof e.spec === 'string' ? e.spec : undefined,
      reason: typeof e.reason === 'string' ? e.reason : '',
    }));

  const siteChecklist = strList(q.siteChecklist).map(softenAsbestosClaims);
  const costDrivers = strList(q.costDrivers).map(softenAsbestosClaims);

  // 하나도 못 채웠으면 섹션 자체를 내지 않는다.
  if (
    wasteByClass.length === 0 &&
    equipment.length === 0 &&
    siteChecklist.length === 0 &&
    costDrivers.length === 0
  ) {
    return undefined;
  }

  const posInt = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;

  return {
    wasteByClass,
    equipment,
    estimatedWorkDays: posInt(q.estimatedWorkDays),
    estimatedCrewSize: posInt(q.estimatedCrewSize),
    siteChecklist,
    costDrivers,
  };
}

/** 모델 텍스트 응답에서 JSON 을 추출·검증해 SiteAnalysis 로 정규화(공급자 공용). */
export function parseVisionJson(text: string): SiteAnalysis {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 응답 파싱 실패');
  const raw = JSON.parse(text.slice(start, end + 1)) as Partial<SiteAnalysis>;
  const rawMaterials = Array.isArray(raw.materials) ? raw.materials : [];
  
  return {
    summary: softenAsbestosClaims(typeof raw.summary === 'string' ? raw.summary : '현장 분석 결과'),
    materials: rawMaterials.map((m: any) => ({
      category: m.category,
      name: typeof m.name === 'string' ? softenAsbestosClaims(m.name) : m.name,
      estimatedKg: typeof m.estimatedKg === 'number' ? m.estimatedKg : undefined,
      confidence: m.confidence,
      recyclable: !!m.recyclable,
      hazardous: !!m.hazardous,
      note: typeof m.note === 'string' ? softenAsbestosClaims(m.note) : m.note,
    })) as DetectedMaterial[],
    demolitionSteps: Array.isArray(raw.demolitionSteps)
      ? (raw.demolitionSteps as DemolitionStep[])
      : [],
    hazards: Array.isArray(raw.hazards)
      ? raw.hazards.filter((h): h is string => typeof h === 'string').map(softenAsbestosClaims)
      : [],
    quoteBasis: parseQuoteBasis((raw as { quoteBasis?: unknown }).quoteBasis),
    method: 'AI_VISION',
    confidence: raw.confidence === 'HIGH' || raw.confidence === 'MEDIUM' ? raw.confidence : 'LOW',
    disclaimer: SITE_ANALYSIS_DISCLAIMER,
    analyzedAt: new Date().toISOString(),
  };
}

export interface GeminiAnalyzerConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseUrl?: string;
}

/**
 * Google Gemini 비전 분석 — 무료 티어 제공(초기 운영 권장). 실패 시 예외(라우터가 목 폴백).
 * generateContent 에 이미지(inline_data)+지시문을 보내고 JSON 응답을 파싱한다.
 */
export class GeminiSiteAnalyzer implements SiteAnalyzer {
  constructor(private readonly config: GeminiAnalyzerConfig) {}

  async analyze(input: AnalyzeSiteInput): Promise<SiteAnalysis> {
    const images = assertValidImages(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const base = this.config.baseUrl ?? 'https://generativelanguage.googleapis.com';
    try {
      const res = await fetch(
        `${base}/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [
              {
                role: 'user',
                parts: [
                  ...images.map((im) => ({
                    inline_data: { mime_type: im.mimeType, data: im.imageBase64 },
                  })),
                  { text: buildUserInstruction(input.note, input.buildingStructure, images.length, {
                    year: input.buildingYear,
                    use: input.buildingUse,
                    areaM2: input.totalFloorAreaM2,
                    floors: input.floorsAbove,
                  }) },
                ],
              },
            ],
            generationConfig: {
              maxOutputTokens: 8000,
              responseMimeType: 'application/json',
              // 스키마를 강제하지 않으면 견적 자료가 들쭉날쭉하게 빠진다(실측 확인).
              responseSchema: ANALYSIS_JSON_SCHEMA,
              // gemini-2.5 계열은 기본적으로 사고(thinking) 토큰을 먼저 쓴다. 그대로 두면
              // 예산을 사고에 소진해 JSON 이 중간에 잘리고(파싱 실패) 응답도 느려진다.
              // 우리는 정해진 스키마를 채우는 작업이라 사고가 필요 없어 꺼둔다.
              // (2.5 미만 모델에는 없는 옵션 — GEMINI_MODEL 을 내릴 때 함께 확인할 것)
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        },
      );
      if (!res.ok) throw new VisionProviderError(`gemini ${res.status}`, res.status);
      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      return parseVisionJson(text);
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface GroqAnalyzerConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseUrl?: string;
  /** 요청당 이미지 상한. Groq 의 qwen3.8-27b 는 3장까지만 받는다. */
  maxImages?: number;
}

/** Groq 비전 모델의 요청당 이미지 한도(qwen3.8-27b 기준). 초과하면 400 이 난다. */
export const GROQ_MAX_IMAGES = 3;

/**
 * Groq 비전 분석 — 무료 티어(카드 불필요). OpenAI 호환 chat/completions.
 * qwen3 계열은 추론(<think>) 모델이라 reasoning_effort:'none' + JSON 강제로 깨끗한 결과를 받는다.
 *
 * 우리 API 는 6장까지 받지만(MAX_ANALYZE_IMAGES) Groq 는 3장이 한도라, 여기서 잘라 보낸다.
 * 다중 촬영에서 전체 요청이 실패하는 것보다 앞의 몇 장으로라도 분석하는 편이 낫다.
 */
export class GroqSiteAnalyzer implements SiteAnalyzer {
  constructor(private readonly config: GroqAnalyzerConfig) {}

  async analyze(input: AnalyzeSiteInput): Promise<SiteAnalysis> {
    const images = assertValidImages(input).slice(0, this.config.maxImages ?? GROQ_MAX_IMAGES);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const base = this.config.baseUrl ?? 'https://api.groq.com/openai/v1';
    try {
      const call = (useSchema: boolean) =>
        fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.config.model,
          reasoning_effort: 'none',
          // 스키마를 강제해야 견적 항목이 빠지지 않는다. 모델이 구조화 출력을 지원하지
          // 않으면 400 이 오므로 그때만 자유 형식으로 되돌린다(분석 자체는 살린다).
          response_format: useSchema
            ? { type: 'json_schema', json_schema: { name: 'site_analysis', schema: ANALYSIS_JSON_SCHEMA } }
            : { type: 'json_object' },
          max_tokens: 1500,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: buildUserInstruction(input.note, input.buildingStructure, images.length, {
                    year: input.buildingYear,
                    use: input.buildingUse,
                    areaM2: input.totalFloorAreaM2,
                    floors: input.floorsAbove,
                  }) },
                ...images.map((im) => ({
                  type: 'image_url' as const,
                  image_url: { url: `data:${im.mimeType};base64,${im.imageBase64}` },
                })),
              ],
            },
          ],
        }),
      });

      let res = await call(true);
      // 400 은 "이 모델은 그 스키마를 못 받는다" 는 뜻이라 자유 형식으로 한 번만 되돌린다.
      // 그 밖의 오류(429·5xx)는 체인이 다루도록 그대로 올린다.
      if (res.status === 400) res = await call(false);
      if (!res.ok) throw new VisionProviderError(`groq ${res.status}`, res.status);
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return parseVisionJson(body.choices?.[0]?.message?.content ?? '');
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 자체 VLM(7B)용 출력 스키마. vLLM 의 guided decoding 에 넘겨 스키마를 강제한다.
 *
 * 왜 필요한가: 같은 프롬프트라도 7B 모델은 JSON 을 끝까지 채우지 못하고 중간에 멈춘다.
 * 실측에서 response_format:json_object 로는 159토큰에서 끊겨 materials 가 0개였는데,
 * 스키마를 강제하자 603토큰으로 5개를 채웠다. 호스팅 대형 모델은 이 문제가 없어
 * 자체 VLM 경로에만 적용한다.
 */
/**
 * 분석 응답 스키마 — Gemini(responseSchema)와 자체 VLM(guided json_schema)이 함께 쓴다.
 *
 * 왜 강제하는가: 자유 형식 JSON 으로 두면 모델이 스키마를 끝까지 채우지 않는다.
 * 실측에서 같은 요청을 두 번 보냈는데 한 번은 분류 6·장비 3·체크리스트 7 이 다 나오고
 * 다른 한 번은 분류 3·장비 0·체크리스트 0 으로 잘렸다. 견적 자료가 들쭉날쭉하면
 * 실무에서 못 쓴다. 스키마를 강제하면 3회 연속 전 항목이 채워지는 것을 확인했다.
 *
 * minItems 는 "최소한 이만큼은 보라"는 지시로 작동한다. 과하게 잡으면 모델이 억지로
 * 지어내므로, 철거 현장이라면 현실적으로 그 정도는 관찰되는 수준으로만 뒀다.
 *
 * maxItems 는 쓰지 않는다. Gemini 는 스키마를 제약 상태기계로 컴파일하는데,
 * 중첩 배열마다 상한이 붙으면 상태 수가 폭발해 400 을 낸다
 * ("The specified schema produces a constraint that has too many states for serving").
 * 실측: maxItems 를 빼면 같은 스키마가 200 으로 통과한다.
 */
const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    materials: {
      type: 'array',
      minItems: 4,
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['CONCRETE','STEEL','BRICK','WOOD','GLASS','GYPSUM','INSULATION','ROOFING','TILE','HAZARD','OTHER'],
          },
          name: { type: 'string' },
          estimatedKg: { type: 'integer' },
          confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          recyclable: { type: 'boolean' },
          hazardous: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['category', 'name', 'estimatedKg', 'confidence', 'recyclable', 'hazardous'],
      },
    },
    demolitionSteps: {
      type: 'array',
      minItems: 4,
      items: {
        type: 'object',
        properties: {
          order: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string' },
          caution: { type: 'string' },
        },
        required: ['order', 'title', 'description'],
      },
    },
    hazards: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'string' } },
    confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    quoteBasis: {
      type: 'object',
      properties: {
        wasteByClass: {
          type: 'array',
          minItems: 3,
          items: {
            type: 'object',
            properties: {
              wasteClass: {
                type: 'string',
                enum: ['CONCRETE','ASPHALT','BRICK_BLOCK','WOOD','PLASTIC','METAL','GLASS','BOARD','MIXED','DESIGNATED'],
              },
              estimatedKg: { type: 'integer' },
              separable: { type: 'boolean' },
              note: { type: 'string' },
            },
            required: ['wasteClass', 'estimatedKg', 'separable'],
          },
        },
        equipment: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, spec: { type: 'string' }, reason: { type: 'string' } },
            required: ['name', 'reason'],
          },
        },
        estimatedWorkDays: { type: 'integer' },
        estimatedCrewSize: { type: 'integer' },
        siteChecklist: { type: 'array', minItems: 4, maxItems: 10, items: { type: 'string' } },
        costDrivers: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'string' } },
      },
      required: ['wasteByClass','equipment','estimatedWorkDays','estimatedCrewSize','siteChecklist','costDrivers'],
    },
  },
  required: ['summary', 'materials', 'demolitionSteps', 'hazards', 'confidence', 'quoteBasis'],
} as const;

/**
 * 소형 모델은 "구체적으로 쓰라"는 말만으로는 안 되고 좋은 예·나쁜 예를 보여줘야 따라온다.
 * 실측: 이 지시 없이는 "콘크리트, 철, 목재", 있으면 "바닥 콘크리트 슬래브, 천장 텍스(석면 의심)".
 */
const VLM_SPECIFICITY_HINT = [
  '',
  '소재 이름은 반드시 "부위 + 자재" 형태로 구체적으로 쓰세요.',
  '좋은 예: "천장 석고보드", "바닥 콘크리트 슬래브", "벽체 조적 벽돌", "천장 텍스(석면 의심)", "창호 유리"',
  '나쁜 예: "콘크리트", "철", "목재" (부위가 없어 견적에 쓸 수 없습니다)',
  '사진에서 천장·벽·바닥·창호·설비를 각각 따로 살펴 빠뜨리지 마세요.',
].join('\n');

export interface SelfHostedVlmConfig {
  /** vLLM OpenAI 호환 엔드포인트 (예: https://dimolvision-vlm-xxxx.run.app/v1). */
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** Cloud Run 을 공개로 두지 않을 때 쓰는 공유 토큰(Authorization: Bearer). */
  apiKey?: string;
}

/**
 * 자체 호스팅 VLM 분석(본격형) — Google Cloud Run GPU(NVIDIA L4) 위의 vLLM 서버를 호출한다.
 * vLLM 이 OpenAI 호환 API 를 제공하므로 Groq 와 같은 요청 형태를 쓰되, 공급자 전용 필드
 * (reasoning_effort 등)는 보내지 않는다. 키가 설정되면 호스팅 API 보다 우선한다 —
 * 호출당 외부 과금이 없어 상용 운영의 단가·데이터 주권 문제를 해결하는 경로이기 때문이다.
 */
export class SelfHostedVlmAnalyzer implements SiteAnalyzer {
  constructor(private readonly config: SelfHostedVlmConfig) {}

  async analyze(input: AnalyzeSiteInput): Promise<SiteAnalysis> {
    const images = assertValidImages(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const base = this.config.baseUrl.replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          // 스키마 강제 — 소형 모델이 JSON 을 끝까지 채우게 한다.
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'site_analysis', schema: ANALYSIS_JSON_SCHEMA },
          },
          max_tokens: 3000,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    buildUserInstruction(input.note, input.buildingStructure, images.length, {
                      year: input.buildingYear,
                      use: input.buildingUse,
                      areaM2: input.totalFloorAreaM2,
                      floors: input.floorsAbove,
                    }) + VLM_SPECIFICITY_HINT,
                },
                ...images.map((im) => ({
                  type: 'image_url' as const,
                  image_url: { url: `data:${im.mimeType};base64,${im.imageBase64}` },
                })),
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new VisionProviderError(`vlm ${res.status}`, res.status);
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return parseVisionJson(body.choices?.[0]?.message?.content ?? '');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 실제 Claude 비전 분석 — 실패 시 예외를 던진다(라우터가 목으로 폴백). */
export class ClaudeSiteAnalyzer implements SiteAnalyzer {
  constructor(private readonly config: ClaudeAnalyzerConfig) {}

  async analyze(input: AnalyzeSiteInput): Promise<SiteAnalysis> {
    const images = assertValidImages(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let text: string;
    try {
      const res = await fetch(`${this.config.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                ...images.map((im) => ({
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: im.mimeType, data: im.imageBase64 },
                })),
                { type: 'text', text: buildUserInstruction(input.note, input.buildingStructure, images.length, {
                    year: input.buildingYear,
                    use: input.buildingUse,
                    areaM2: input.totalFloorAreaM2,
                    floors: input.floorsAbove,
                  }) },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new VisionProviderError(`anthropic ${res.status}`, res.status);
      const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      text = body.content?.find((c) => c.type === 'text')?.text ?? '';
    } finally {
      clearTimeout(timer);
    }
    return parseVisionJson(text);
  }
}
