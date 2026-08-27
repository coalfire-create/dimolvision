import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeSiteAnalyzer,
  MockSiteAnalyzer,
  SiteAnalysisValidationError,
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
