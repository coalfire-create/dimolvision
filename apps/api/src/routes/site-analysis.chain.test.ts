import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { SiteAnalysis } from '@dimol/shared';
import {
  MockSiteAnalyzer,
  SiteAnalysisValidationError,
  VisionProviderError,
  type AnalyzeSiteInput,
  type SiteAnalyzer,
} from '../site-analysis/analyzer.js';
import { createSiteAnalysisRouter } from './site-analysis.js';

const IMG = 'A'.repeat(200);

/** 가짜 분석기. failTimes 만큼 실패한 뒤 성공한다('fail' 은 항상 실패). */
function analyzer(
  behavior: 'ok' | 'fail' | number,
  summary = 'ok',
): SiteAnalyzer & { calls: number } {
  const a = {
    calls: 0,
    async analyze(_input: AnalyzeSiteInput): Promise<SiteAnalysis> {
      a.calls += 1;
      if (behavior === 'fail') throw new Error('upstream 503');
      if (typeof behavior === 'number' && a.calls <= behavior) throw new Error('upstream 429');
      return { summary, materials: [], demolitionSteps: [], hazards: [], method: 'AI_VISION', confidence: 'MEDIUM', disclaimer: 'd', analyzedAt: new Date().toISOString() };
    },
  };
  return a;
}

/** 라우터를 붙인 앱에 analyze 요청을 보내고 응답을 돌려준다. */
async function post(chain: SiteAnalyzer[], body: unknown, attemptsPerAnalyzer = 1) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', createSiteAnalysisRouter(chain, undefined, { attemptsPerAnalyzer, retryDelayMs: 1 }));
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/site-analysis/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

describe('분석기 체인 폴백', () => {
  it('첫 번째가 성공하면 뒤는 호출하지 않는다', async () => {
    const first = analyzer('ok', '자체 GPU');
    const second = analyzer('ok', '호스팅');
    const res = await post([first, second, new MockSiteAnalyzer()], { imageBase64: IMG });
    expect(res.body.summary).toBe('자체 GPU');
    expect(second.calls).toBe(0);
  });

  it('GPU 가 실패하면 목이 아니라 다음 호스팅 공급자가 받는다', async () => {
    const gpu = analyzer('fail');
    const hosted = analyzer('ok', '호스팅이 처리');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post([gpu, hosted, new MockSiteAnalyzer()], { imageBase64: IMG });
    expect(gpu.calls).toBe(1);
    expect(res.body.summary).toBe('호스팅이 처리');
    expect(res.body.method).toBe('AI_VISION'); // MOCK 으로 떨어지지 않는다
  });

  it('실제 공급자가 모두 실패하면 마지막 목으로 떨어진다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post([analyzer('fail'), analyzer('fail'), new MockSiteAnalyzer()], {
      imageBase64: IMG,
    });
    expect(res.body.method).toBe('MOCK');
  });

  it('입력 검증 오류는 체인을 타지 않고 400 으로 바로 올린다', async () => {
    const hosted = analyzer('ok');
    const failing: SiteAnalyzer = {
      async analyze() {
        throw new SiteAnalysisValidationError('현장 사진(imageBase64)이 필요합니다.');
      },
    };
    const res = await post([failing, hosted], { imageBase64: 'short' });
    expect(res.status).toBe(400);
    expect(hosted.calls).toBe(0);
  });

  it('빈 체인은 만들 수 없다', () => {
    expect(() => createSiteAnalysisRouter([])).toThrow();
  });

  it('일시적 오류(429/503)는 같은 공급자를 한 번 더 시도해 살려낸다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const flaky = analyzer(1, '재시도로 성공'); // 첫 호출만 실패
    const res = await post([flaky, new MockSiteAnalyzer()], { imageBase64: IMG }, 2);
    expect(flaky.calls).toBe(2);
    expect(res.body.summary).toBe('재시도로 성공');
    expect(res.body.method).toBe('AI_VISION');
  });

  it('재시도해도 계속 실패하면 다음 공급자로 넘어간다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const dead = analyzer('fail');
    const backup = analyzer('ok', '백업이 처리');
    const res = await post([dead, backup, new MockSiteAnalyzer()], { imageBase64: IMG }, 2);
    expect(dead.calls).toBe(2); // 시도 2회 후 포기
    expect(res.body.summary).toBe('백업이 처리');
  });

  it('레이트리밋(429)은 재시도하지 않고 즉시 다음 공급자로 넘긴다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let limitedCalls = 0;
    const limited: SiteAnalyzer = {
      async analyze() {
        limitedCalls += 1;
        throw new VisionProviderError('groq 429', 429);
      },
    };
    const backup = analyzer('ok', '2차가 처리');
    const res = await post([limited, backup, new MockSiteAnalyzer()], { imageBase64: IMG }, 2);
    expect(limitedCalls).toBe(1); // 재시도하지 않는다 — 한도만 더 태우므로
    expect(res.body.summary).toBe('2차가 처리');
  });

  it('서버 오류(5xx)는 같은 공급자를 한 번 더 시도한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const flaky: SiteAnalyzer = {
      async analyze() {
        calls += 1;
        if (calls === 1) throw new VisionProviderError('gemini 503', 503);
        return { summary: '재시도로 성공', materials: [], demolitionSteps: [], hazards: [], method: 'AI_VISION', confidence: 'MEDIUM', disclaimer: 'd', analyzedAt: new Date().toISOString() };
      },
    };
    const res = await post([flaky, new MockSiteAnalyzer()], { imageBase64: IMG }, 2);
    expect(calls).toBe(2);
    expect(res.body.summary).toBe('재시도로 성공');
  });
});
