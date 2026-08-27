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
}

export interface SiteAnalyzer {
  analyze(input: AnalyzeSiteInput): Promise<SiteAnalysis>;
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

const SYSTEM_PROMPT =
  '당신은 한국의 건설폐기물 철거 현장 분석 보조자입니다. 제공된 현장 사진을 보고 ' +
  '구성 소재와 권장 철거 공정, 위험 요소를 분석합니다. 반드시 지정된 JSON 스키마로만 ' +
  '응답하고, 불확실하면 confidence 를 낮추세요. 석면 등 위험 소재는 hazardous=true 로 표시하고 ' +
  '임의 제거를 권하지 마세요. 타일(TILE)과 목재(WOOD)를 명확히 구분하세요. ' +
  '타일은 매끄러운 광택 표면이나 욕실, 주방, 베란다 등에 주로 쓰이며, 목재는 나무 무늬나 합판 형태이므로 절대 혼동하지 마세요. ' +
  '모든 텍스트는 한국어로 작성합니다.';

const USER_INSTRUCTION =
  '이 철거 현장 사진을 분석해 아래 JSON 스키마로만 답하세요(코드블록·설명 없이 JSON 객체 하나):\n' +
  '{"summary": string, "materials": [{"category": "CONCRETE|STEEL|BRICK|WOOD|GLASS|GYPSUM|INSULATION|ROOFING|TILE|HAZARD|OTHER", "name": string, "estimatedKg": number, "confidence": "LOW|MEDIUM|HIGH", "recyclable": boolean, "hazardous": boolean, "note"?: string}], "demolitionSteps": [{"order": number, "title": string, "description": string, "caution"?: string}], "hazards": string[], "confidence": "LOW|MEDIUM|HIGH"}\n' +
  '주의: 각 소재별로 사진에 보이는 면적과 부피를 바탕으로 예상되는 현실적인 철거 폐기물 중량(kg)을 estimatedKg 에 정수로 꼭 작성하세요.';

/** 모델 텍스트 응답에서 JSON 을 추출·검증해 SiteAnalysis 로 정규화(공급자 공용). */
export function parseVisionJson(text: string): SiteAnalysis {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 응답 파싱 실패');
  const raw = JSON.parse(text.slice(start, end + 1)) as Partial<SiteAnalysis>;
  const rawMaterials = Array.isArray(raw.materials) ? raw.materials : [];
  
  return {
    summary: typeof raw.summary === 'string' ? raw.summary : '현장 분석 결과',
    materials: rawMaterials.map((m: any) => ({
      category: m.category,
      name: m.name,
      estimatedKg: typeof m.estimatedKg === 'number' ? m.estimatedKg : undefined,
      confidence: m.confidence,
      recyclable: !!m.recyclable,
      hazardous: !!m.hazardous,
      note: m.note
    })) as DetectedMaterial[],
    demolitionSteps: Array.isArray(raw.demolitionSteps)
      ? (raw.demolitionSteps as DemolitionStep[])
      : [],
    hazards: Array.isArray(raw.hazards) ? raw.hazards.filter((h): h is string => typeof h === 'string') : [],
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
                  { text: buildUserInstruction(input.note, input.buildingStructure, images.length) },
                ],
              },
            ],
            generationConfig: { maxOutputTokens: 1500, responseMimeType: 'application/json' },
          }),
        },
      );
      if (!res.ok) throw new Error(`gemini ${res.status}`);
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
}

/**
 * Groq 비전 분석 — 무료 티어(카드 불필요). OpenAI 호환 chat/completions.
 * qwen3 계열은 추론(<think>) 모델이라 reasoning_effort:'none' + JSON 강제로 깨끗한 결과를 받는다.
 */
export class GroqSiteAnalyzer implements SiteAnalyzer {
  constructor(private readonly config: GroqAnalyzerConfig) {}

  async analyze(input: AnalyzeSiteInput): Promise<SiteAnalysis> {
    const images = assertValidImages(input);
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
                { type: 'text', text: buildUserInstruction(input.note, input.buildingStructure, images.length) },
                ...images.map((im) => ({
                  type: 'image_url' as const,
                  image_url: { url: `data:${im.mimeType};base64,${im.imageBase64}` },
                })),
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`groq ${res.status}`);
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
                { type: 'text', text: buildUserInstruction(input.note, input.buildingStructure, images.length) },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      text = body.content?.find((c) => c.type === 'text')?.text ?? '';
    } finally {
      clearTimeout(timer);
    }
    return parseVisionJson(text);
  }
}
