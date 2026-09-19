import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * env.ts 는 모듈 로드 시점에 process.env 를 읽어 굳힌다.
 * 순서 전환이 환경변수로 동작하는지 보려면 모듈 캐시를 비우고 다시 읽어야 한다.
 */
async function providerWith(vars: Record<string, string | undefined>) {
  vi.resetModules();
  const keys = [
    'GROQ_API_KEY',
    'GEMINI_API_KEYS',
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    'VLM_BASE_URL',
    'VLM_PRIORITY',
  ];
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  const { activeVisionProvider } = await import('./config/env.js');
  return activeVisionProvider();
}

describe('분석기 체인 순서 (VLM_PRIORITY)', () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
  });
  afterEach(() => {
    process.env = saved;
    vi.resetModules();
  });

  it('primary 면 자체 VLM 이 호스팅보다 앞에 온다', async () => {
    expect(
      await providerWith({
        VLM_BASE_URL: 'https://vlm.example/v1',
        GEMINI_API_KEYS: 'k1',
        VLM_PRIORITY: 'primary',
      }),
    ).toBe('self-hosted-vlm');
  });

  it('fallback 이면 호스팅이 먼저 잡힌다', async () => {
    expect(
      await providerWith({
        VLM_BASE_URL: 'https://vlm.example/v1',
        GEMINI_API_KEYS: 'k1',
        VLM_PRIORITY: 'fallback',
      }),
    ).toBe('gemini');
  });

  it('fallback 이어도 호스팅 키가 없으면 자체 VLM 이 잡힌다(목보다 앞)', async () => {
    expect(
      await providerWith({ VLM_BASE_URL: 'https://vlm.example/v1', VLM_PRIORITY: 'fallback' }),
    ).toBe('self-hosted-vlm');
  });

  it('아무 공급자도 없으면 목', async () => {
    expect(await providerWith({})).toBe('mock');
  });
});
