import {
  SITE_ANALYSIS_DISCLAIMER,
  type DetectedMaterial,
  type DemolitionStep,
  type SiteAnalysis,
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
  building?: { year?: number; use?: string },
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
  '[신뢰도] HIGH 는 소재가 명확히 식별될 때만. 가려지거나 흐릿하면 LOW 를 쓰세요.',
  '모든 텍스트는 한국어로 작성합니다.',
].join('\n');

const USER_INSTRUCTION = [
  '이 철거 현장 사진을 분석해 아래 JSON 스키마로만 답하세요(코드블록·설명 없이 JSON 객체 하나):',
  '{"summary": string, "materials": [{"category": "CONCRETE|STEEL|BRICK|WOOD|GLASS|GYPSUM|INSULATION|ROOFING|TILE|HAZARD|OTHER", "name": string, "estimatedKg": number, "confidence": "LOW|MEDIUM|HIGH", "recyclable": boolean, "hazardous": boolean, "note"?: string}], "demolitionSteps": [{"order": number, "title": string, "description": string, "caution"?: string}], "hazards": string[], "confidence": "LOW|MEDIUM|HIGH"}',
  '',
  '작성 지침:',
  '- summary: 어떤 건물의 어떤 상태인지, 철거 난이도를 좌우하는 요소가 무엇인지 2~3문장.',
  '- materials: 사진에서 실제로 보이는 것만. estimatedKg 는 정수로 반드시 채우세요.',
  '  석면 의심 자재는 category 를 HAZARD, hazardous 를 true 로 하고 name 에 "(석면 의심)" 을 붙이세요.',
  '- demolitionSteps: 실제 시공 순서대로. 사전 조사·신고 → 내부 마감재 → 설비·배관 → 지붕/비구조체',
  '  → 구조체 → 분리 반출 흐름을 현장 상황에 맞게 조정하세요.',
  '  caution 에는 그 단계에서 실제로 사고가 나는 지점을 적으세요(일반론 금지).',
  '- hazards: 이 현장에 실제로 보이는 위험만. 보이지 않는 위험을 나열하지 마세요.',
].join('\n');

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
                  { text: buildUserInstruction(input.note, input.buildingStructure, images.length, { year: input.buildingYear, use: input.buildingUse }) },
                ],
              },
            ],
            generationConfig: {
              maxOutputTokens: 8000,
              responseMimeType: 'application/json',
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
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.config.model,
          reasoning_effort: 'none',
          response_format: { type: 'json_object' },
          max_tokens: 1500,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: buildUserInstruction(input.note, input.buildingStructure, images.length, { year: input.buildingYear, use: input.buildingUse }) },
                ...images.map((im) => ({
                  type: 'image_url' as const,
                  image_url: { url: `data:${im.mimeType};base64,${im.imageBase64}` },
                })),
              ],
            },
          ],
        }),
      });
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
const VLM_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    materials: {
      type: 'array',
      minItems: 5,
      maxItems: 10,
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
      maxItems: 7,
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
  },
  required: ['summary', 'materials', 'demolitionSteps', 'hazards', 'confidence'],
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
            json_schema: { name: 'site_analysis', schema: VLM_JSON_SCHEMA },
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
                { type: 'text', text: buildUserInstruction(input.note, input.buildingStructure, images.length, { year: input.buildingYear, use: input.buildingUse }) },
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
