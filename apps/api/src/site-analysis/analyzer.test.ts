import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeSiteAnalyzer,
  MockSiteAnalyzer,
  GeminiSiteAnalyzer,
  GROQ_MAX_IMAGES,
  GroqSiteAnalyzer,
  SelfHostedVlmAnalyzer,
  SiteAnalysisValidationError,
  buildUserInstruction,
  parseVisionJson,
  softenAsbestosClaims,
} from './analyzer.js';

const IMG = 'A'.repeat(200); // 유효 길이 통과용 더미 base64

describe('MockSiteAnalyzer', () => {
  it('소재·공정·위험·안전고지를 담은 결과를 낸다', async () => {
    const r = await new MockSiteAnalyzer().analyze({ imageBase64: IMG });
    expect(r.method).toBe('MOCK');
    expect(r.materials.length).toBeGreaterThan(0);
    expect(r.demolitionSteps[0]?.order).toBe(1);
    expect(r.materials.some((m) => m.hazardous)).toBe(true); // 석면 의심
    expect(r.disclaimer).toMatch(/참고/);
  });

  it('사진이 없으면 검증 오류', async () => {
    await expect(new MockSiteAnalyzer().analyze({})).rejects.toBeInstanceOf(
      SiteAnalysisValidationError,
    );
  });

  it('지원하지 않는 형식이면 검증 오류', async () => {
    await expect(
      new MockSiteAnalyzer().analyze({ imageBase64: IMG, mimeType: 'image/gif' }),
    ).rejects.toBeInstanceOf(SiteAnalysisValidationError);
  });

  it('data URL 접두사를 허용(제거)한다', async () => {
    const r = await new MockSiteAnalyzer().analyze({ imageBase64: `data:image/jpeg;base64,${IMG}` });
    expect(r.materials.length).toBeGreaterThan(0);
  });
});

describe('ClaudeSiteAnalyzer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('이미지 블록을 전송하고 JSON 응답을 파싱한다', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: '설명 텍스트 {"summary":"철근콘크리트 현장","materials":[{"category":"CONCRETE","name":"벽체","confidence":"HIGH","recyclable":true,"hazardous":false}],"demolitionSteps":[{"order":1,"title":"조사","description":"사전 조사"}],"hazards":["분진"],"confidence":"MEDIUM"} 끝',
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const analyzer = new ClaudeSiteAnalyzer({ apiKey: 'k', model: 'claude-sonnet-4-6', timeoutMs: 5000 });
    const r = await analyzer.analyze({ imageBase64: IMG, mimeType: 'image/png' });

    expect(r.method).toBe('AI_VISION');
    expect(r.summary).toBe('철근콘크리트 현장');
    expect(r.materials[0]?.category).toBe('CONCRETE');
    expect(r.confidence).toBe('MEDIUM');
    // 이미지 소스가 실제로 전송됐는지
    const sentBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    const img = sentBody.messages[0].content[0];
    expect(img.type).toBe('image');
    expect(img.source.media_type).toBe('image/png');
    expect(img.source.data).toBe(IMG);
  });

  it('API 오류면 예외를 던진다(라우터가 폴백)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const analyzer = new ClaudeSiteAnalyzer({ apiKey: 'k', model: 'm', timeoutMs: 5000 });
    await expect(analyzer.analyze({ imageBase64: IMG })).rejects.toBeTruthy();
  });

  it('사진 검증은 API 호출 전에 수행된다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const analyzer = new ClaudeSiteAnalyzer({ apiKey: 'k', model: 'm', timeoutMs: 5000 });
    await expect(analyzer.analyze({ imageBase64: 'short' })).rejects.toBeInstanceOf(
      SiteAnalysisValidationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('여러 장(images)이면 모든 이미지 블록을 전송하고 종합 분석을 지시한다', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"summary":"현장","materials":[],"demolitionSteps":[],"hazards":[],"confidence":"LOW"}' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const analyzer = new ClaudeSiteAnalyzer({ apiKey: 'k', model: 'm', timeoutMs: 5000 });
    await analyzer.analyze({
      images: [
        { imageBase64: IMG, mimeType: 'image/jpeg' },
        { imageBase64: `${IMG}B`, mimeType: 'image/png' },
      ],
    });

    const sentBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    const content = sentBody.messages[0].content;
    const imageBlocks = content.filter((c: { type: string }) => c.type === 'image');
    const textBlock = content.find((c: { type: string }) => c.type === 'text');
    expect(imageBlocks).toHaveLength(2);
    expect(imageBlocks[1].source.media_type).toBe('image/png');
    expect(textBlock.text).toContain('2장');
  });
});

describe('SelfHostedVlmAnalyzer', () => {
  afterEach(() => vi.unstubAllGlobals());

  const okResponse = () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              '{"summary":"자체 GPU 분석","materials":[{"category":"HAZARD","name":"슬레이트","confidence":"MEDIUM","recyclable":false,"hazardous":true}],"demolitionSteps":[{"order":1,"title":"조사","description":"사전 조사"}],"hazards":["석면 의심"],"confidence":"MEDIUM"}',
          },
        },
      ],
    }),
  });

  it('OpenAI 호환 엔드포인트로 이미지를 보내고 결과를 파싱한다', async () => {
    const fetchMock = vi.fn(okResponse);
    vi.stubGlobal('fetch', fetchMock);

    const analyzer = new SelfHostedVlmAnalyzer({
      baseUrl: 'https://vlm.example.run.app/v1',
      model: 'Qwen/Qwen2.5-VL-7B-Instruct',
      timeoutMs: 5000,
    });
    const r = await analyzer.analyze({ imageBase64: IMG, mimeType: 'image/jpeg' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://vlm.example.run.app/v1/chat/completions');
    expect(r.method).toBe('AI_VISION');
    expect(r.materials[0]?.hazardous).toBe(true);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    const content = body.messages[1].content;
    expect(body.model).toBe('Qwen/Qwen2.5-VL-7B-Instruct');
    expect(content.filter((c: { type: string }) => c.type === 'image_url')).toHaveLength(1);
    expect(content[0].text).toContain('JSON');
    // 공급자 전용 필드는 vLLM 이 거부할 수 있으므로 보내지 않는다.
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('baseUrl 끝의 슬래시를 중복 없이 처리한다', async () => {
    const fetchMock = vi.fn(okResponse);
    vi.stubGlobal('fetch', fetchMock);
    const analyzer = new SelfHostedVlmAnalyzer({
      baseUrl: 'https://vlm.example.run.app/v1/',
      model: 'm',
      timeoutMs: 5000,
    });
    await analyzer.analyze({ imageBase64: IMG });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://vlm.example.run.app/v1/chat/completions');
  });

  it('apiKey 가 있으면 Authorization 헤더를 붙이고, 없으면 붙이지 않는다', async () => {
    const withKey = vi.fn(okResponse);
    vi.stubGlobal('fetch', withKey);
    await new SelfHostedVlmAnalyzer({
      baseUrl: 'https://vlm.example.run.app/v1',
      model: 'm',
      timeoutMs: 5000,
      apiKey: 'secret',
    }).analyze({ imageBase64: IMG });
    expect((withKey.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe(
      'Bearer secret',
    );

    const noKey = vi.fn(okResponse);
    vi.stubGlobal('fetch', noKey);
    await new SelfHostedVlmAnalyzer({
      baseUrl: 'https://vlm.example.run.app/v1',
      model: 'm',
      timeoutMs: 5000,
    }).analyze({ imageBase64: IMG });
    expect((noKey.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('서버 오류면 예외를 던진다(라우터가 목으로 폴백)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const analyzer = new SelfHostedVlmAnalyzer({
      baseUrl: 'https://vlm.example.run.app/v1',
      model: 'm',
      timeoutMs: 5000,
    });
    await expect(analyzer.analyze({ imageBase64: IMG })).rejects.toBeTruthy();
  });

  it('사진 검증은 GPU 호출 전에 수행된다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const analyzer = new SelfHostedVlmAnalyzer({
      baseUrl: 'https://vlm.example.run.app/v1',
      model: 'm',
      timeoutMs: 5000,
    });
    await expect(analyzer.analyze({ imageBase64: 'short' })).rejects.toBeInstanceOf(
      SiteAnalysisValidationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GroqSiteAnalyzer 이미지 한도', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Groq 한도(3장)를 넘는 요청은 잘라서 보낸다', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"summary":"현장","materials":[],"demolitionSteps":[],"hazards":[],"confidence":"LOW"}',
            },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const analyzer = new GroqSiteAnalyzer({ apiKey: 'k', model: 'qwen/qwen3.8-27b', timeoutMs: 5000 });
    await analyzer.analyze({
      images: Array.from({ length: 6 }, (_, i) => ({ imageBase64: `${IMG}${i}`, mimeType: 'image/jpeg' })),
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    const imageBlocks = body.messages[1].content.filter(
      (c: { type: string }) => c.type === 'image_url',
    );
    expect(imageBlocks).toHaveLength(GROQ_MAX_IMAGES);
  });
});

describe('GeminiSiteAnalyzer 생성 설정', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('사고(thinking)를 끄고 잘림 없는 토큰 예산을 보낸다', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"summary":"현장","materials":[],"demolitionSteps":[],"hazards":[],"confidence":"LOW"}',
                },
              ],
            },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const analyzer = new GeminiSiteAnalyzer({ apiKey: 'k', model: 'gemini-2.5-flash', timeoutMs: 5000 });
    const r = await analyzer.analyze({ imageBase64: IMG, mimeType: 'image/jpeg' });
    expect(r.method).toBe('AI_VISION');

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(8000);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });
});

describe('석면 확정 표현 차단', () => {
  it('확정 표현을 의심·조사필요 표현으로 바꾼다', () => {
    expect(softenAsbestosClaims('지붕재는 석면입니다.')).toContain('석면 의심');
    expect(softenAsbestosClaims('석면이 검출되었습니다')).toContain('전문 조사가 필요');
    expect(softenAsbestosClaims('석면이 있습니다')).toContain('가능성');
    expect(softenAsbestosClaims('석면이 없습니다')).toContain('조사로 확인');
    expect(softenAsbestosClaims('무석면 확정')).toContain('미확인');
  });

  it('의심 표현은 그대로 둔다', () => {
    const ok = '슬레이트 지붕재로 석면 의심 부위입니다. 전문 조사가 필요합니다.';
    expect(softenAsbestosClaims(ok)).toBe(ok);
  });

  it('AI 응답 파싱에서 요약·소재명·위험요소 모두 걸러진다', () => {
    const r = parseVisionJson(
      '{"summary":"지붕은 석면입니다","materials":[{"category":"HAZARD","name":"석면이 검출되었습니다","confidence":"HIGH","recyclable":false,"hazardous":true}],"demolitionSteps":[],"hazards":["석면이 있습니다"],"confidence":"HIGH"}',
    );
    expect(r.summary).not.toMatch(/석면입니다/);
    expect(r.materials[0]?.name).not.toMatch(/검출되었습니다/);
    expect(r.hazards[0]).not.toMatch(/석면이 있습니다/);
  });
});

describe('건축물대장 힌트가 지시문에 반영된다', () => {
  it('2009년 이전 건축물이면 석면 의심을 가중한다', () => {
    const t = buildUserInstruction(undefined, undefined, 1, { year: 1995 });
    expect(t).toContain('1995년');
    expect(t).toContain('석면');
    expect(t).toMatch(/슬레이트|보온재|내화피복/);
  });

  it('2009년 이후 건축물이면 가능성이 낮다고 알린다', () => {
    const t = buildUserInstruction(undefined, undefined, 1, { year: 2018 });
    expect(t).toContain('2018년');
    expect(t).toMatch(/가능성은 낮/);
  });

  it('주용도도 힌트로 넣는다', () => {
    expect(buildUserInstruction(undefined, undefined, 1, { use: '단독주택' })).toContain('단독주택');
  });

  it('대장 정보가 없으면 힌트를 붙이지 않는다', () => {
    const t = buildUserInstruction(undefined, undefined, 1);
    expect(t).not.toContain('건축물대장');
  });
});

describe('SelfHostedVlmAnalyzer 출력 품질 설정', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('스키마를 강제하고 구체적 소재명을 지시한다', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"summary":"현장","materials":[],"demolitionSteps":[],"hazards":[],"confidence":"LOW"}',
            },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await new SelfHostedVlmAnalyzer({
      baseUrl: 'https://vlm.example/v1',
      model: 'Qwen/Qwen2.5-VL-7B-Instruct-AWQ',
      timeoutMs: 5000,
    }).analyze({ imageBase64: IMG });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    // json_object 로는 소형 모델이 스키마를 못 채운다 — 스키마 강제여야 한다.
    expect(body.response_format.type).toBe('json_schema');
    const schema = body.response_format.json_schema.schema;
    expect(schema.properties.materials.minItems).toBeGreaterThanOrEqual(5);
    expect(schema.properties.demolitionSteps.minItems).toBeGreaterThanOrEqual(4);
    expect(schema.properties.hazards.minItems).toBeGreaterThanOrEqual(3);
    expect(schema.required).toContain('materials');
    // 스키마를 채우려면 1500 토큰으로는 부족하다(실측 603~645 + 여유).
    expect(body.max_tokens).toBeGreaterThanOrEqual(3000);
    // 부위+자재 지시가 붙어야 "콘크리트" 대신 "바닥 콘크리트 슬래브" 가 나온다.
    expect(body.messages[1].content[0].text).toContain('부위 + 자재');
  });
});
