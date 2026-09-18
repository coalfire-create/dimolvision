import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { SiteAnalysis } from '@dimol/shared';
import {
  MockSiteAnalyzer,
  SiteAnalysisValidationError,
  type AnalyzeSiteInput,
  type SiteAnalyzer,
} from '../site-analysis/analyzer.js';
import { createSiteAnalysisRouter } from './site-analysis.js';

const IMG = 'A'.repeat(200);

/** 지정한 횟수만큼 실패하거나 항상 실패하는 가짜 분석기. */
function analyzer(behavior: 'ok' | 'fail', summary = 'ok'): SiteAnalyzer & { calls: number } {
  const a = {
    calls: 0,
    async analyze(_input: AnalyzeSiteInput): Promise<SiteAnalysis> {
      a.calls += 1;
      if (behavior === 'fail') throw new Error('upstream 503');
      return { summary, materials: [], demolitionSteps: [], hazards: [], method: 'AI_VISION', confidence: 'MEDIUM', disclaimer: 'd', analyzedAt: new Date().toISOString() };
    },
  };
  return a;
}

/** 라우터를 붙인 앱에 analyze 요청을 보내고 응답을 돌려준다. */
async function post(chain: SiteAnalyzer[], body: unknown) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', createSiteAnalysisRouter(chain));
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
});
