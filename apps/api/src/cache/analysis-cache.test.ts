import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { SiteAnalysis } from '@dimol/shared';
import {
  MemoryAnalysisCache,
  analysisCacheKey,
  isCacheable,
} from './analysis-cache.js';
import { MockSiteAnalyzer, type AnalyzeSiteInput, type SiteAnalyzer } from '../site-analysis/analyzer.js';
import { createSiteAnalysisRouter } from '../routes/site-analysis.js';

const IMG = 'A'.repeat(200);
const base = { images: [{ imageBase64: IMG, mimeType: 'image/jpeg' }], version: 'v1' };

describe('analysisCacheKey', () => {
  it('같은 입력이면 같은 키', () => {
    expect(analysisCacheKey(base)).toBe(analysisCacheKey({ ...base }));
  });

  it('결과를 바꾸는 입력이 다르면 키가 달라진다', () => {
    const k = analysisCacheKey(base);
    expect(analysisCacheKey({ ...base, buildingYear: 1985 })).not.toBe(k);
    expect(analysisCacheKey({ ...base, buildingStructure: 'RC' })).not.toBe(k);
    expect(analysisCacheKey({ ...base, buildingUse: '단독주택' })).not.toBe(k);
    expect(analysisCacheKey({ ...base, note: '지하 있음' })).not.toBe(k);
    // 계약 버전이 바뀌면 옛 캐시를 써서는 안 된다.
    expect(analysisCacheKey({ ...base, version: 'v2' })).not.toBe(k);
  });

  it('사진이 다르거나 장수가 다르면 키가 달라진다', () => {
    const k = analysisCacheKey(base);
    expect(analysisCacheKey({ ...base, images: [{ imageBase64: `${IMG}B`, mimeType: 'image/jpeg' }] })).not.toBe(k);
    expect(
      analysisCacheKey({ ...base, images: [...base.images, { imageBase64: `${IMG}C`, mimeType: 'image/jpeg' }] }),
    ).not.toBe(k);
  });

  it('사진 순서가 다르면 다른 요청으로 본다 — 종합 분석은 순서에 영향을 받는다', () => {
    const a = [{ imageBase64: IMG, mimeType: 'image/jpeg' }, { imageBase64: `${IMG}B`, mimeType: 'image/jpeg' }];
    expect(analysisCacheKey({ ...base, images: a })).not.toBe(
      analysisCacheKey({ ...base, images: [...a].reverse() }),
    );
  });
});

describe('isCacheable', () => {
  const mk = (method: SiteAnalysis['method']): SiteAnalysis => ({
    summary: 's', materials: [], demolitionSteps: [], hazards: [],
    method, confidence: 'LOW', disclaimer: 'd', analyzedAt: new Date().toISOString(),
  });

  it('실제 AI 결과만 캐시한다', () => {
    expect(isCacheable(mk('AI_VISION'))).toBe(true);
  });

  it('목은 캐시하지 않는다 — 장애를 24시간 굳히게 된다', () => {
    expect(isCacheable(mk('MOCK'))).toBe(false);
  });
});

describe('MemoryAnalysisCache', () => {
  const val: SiteAnalysis = {
    summary: 'x', materials: [], demolitionSteps: [], hazards: [],
    method: 'AI_VISION', confidence: 'LOW', disclaimer: 'd', analyzedAt: '',
  };

  it('저장한 값을 돌려준다', async () => {
    const c = new MemoryAnalysisCache();
    await c.set('k', val, 60);
    expect(await c.get('k')).toEqual(val);
  });

  it('TTL 이 지나면 미스', async () => {
    vi.useFakeTimers();
    const c = new MemoryAnalysisCache();
    await c.set('k', val, 10);
    vi.advanceTimersByTime(11_000);
    expect(await c.get('k')).toBeUndefined();
    vi.useRealTimers();
  });
});

describe('라우터 캐시 연동', () => {
  function countingAnalyzer() {
    const a = {
      calls: 0,
      async analyze(_i: AnalyzeSiteInput): Promise<SiteAnalysis> {
        a.calls += 1;
        return {
          summary: `호출 ${a.calls}`, materials: [], demolitionSteps: [], hazards: [],
          method: 'AI_VISION', confidence: 'MEDIUM', disclaimer: 'd', analyzedAt: new Date().toISOString(),
        };
      },
    };
    return a;
  }

  async function post(chain: SiteAnalyzer[], body: unknown, cache?: MemoryAnalysisCache) {
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api', createSiteAnalysisRouter(chain, undefined, cache ? { cache } : {}));
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/site-analysis/analyze`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      return (await res.json()) as Record<string, unknown>;
    } finally {
      server.close();
    }
  }

  it('같은 사진을 두 번 보내면 공급자는 한 번만 호출된다', async () => {
    const a = countingAnalyzer();
    const cache = new MemoryAnalysisCache();
    const r1 = await post([a], { imageBase64: IMG }, cache);
    const r2 = await post([a], { imageBase64: IMG }, cache);
    expect(a.calls).toBe(1);
    expect(r2.summary).toBe(r1.summary);
  });

  it('조건이 다르면 새로 분석한다', async () => {
    const a = countingAnalyzer();
    const cache = new MemoryAnalysisCache();
    await post([a], { imageBase64: IMG }, cache);
    await post([a], { imageBase64: IMG, buildingYear: 1985 }, cache);
    expect(a.calls).toBe(2);
  });

  it('data URL 접두사가 붙어도 같은 사진으로 본다', async () => {
    const a = countingAnalyzer();
    const cache = new MemoryAnalysisCache();
    await post([a], { imageBase64: IMG }, cache);
    await post([a], { imageBase64: `data:image/jpeg;base64,${IMG}` }, cache);
    expect(a.calls).toBe(1);
  });

  it('목으로 떨어진 응답은 캐시하지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: SiteAnalyzer = { async analyze() { throw new Error('down'); } };
    const cache = new MemoryAnalysisCache();
    const r1 = await post([failing, new MockSiteAnalyzer()], { imageBase64: IMG }, cache);
    expect(r1.method).toBe('MOCK');

    // 공급자가 살아나면 곧바로 실제 분석이 나와야 한다(목이 굳어 있으면 안 된다).
    const good = countingAnalyzer();
    const r2 = await post([good], { imageBase64: IMG }, cache);
    expect(r2.method).toBe('AI_VISION');
  });

  it('캐시를 주지 않으면 매번 분석한다(기존 동작 유지)', async () => {
    const a = countingAnalyzer();
    await post([a], { imageBase64: IMG });
    await post([a], { imageBase64: IMG });
    expect(a.calls).toBe(2);
  });
});
