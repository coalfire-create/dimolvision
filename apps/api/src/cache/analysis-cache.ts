import { createHash } from 'node:crypto';
import type { SiteAnalysis } from '@dimol/shared';
import type { BuildingRegisterInfo } from '../public-data/building-register.js';

/**
 * 분석 결과 캐시.
 *
 * 왜 필요한가: 샘플 사진 3장은 고정 파일이라 누가 눌러도 같은 입력이다. 그런데 지금은
 * 누를 때마다 같은 계산을 다시 하느라 14~17초를 쓰고, 그 호출이 전부 무료 티어 한도를
 * 깎는다. 심사·투표처럼 같은 샘플에 트래픽이 몰리는 상황에서 한도를 치면 목(mock)이
 * 노출되는데, 그게 이 서비스가 맞을 수 있는 가장 나쁜 결과다.
 *
 * 같은 사진 + 같은 조건이면 같은 결과이므로 캐시가 정확도를 해치지 않는다.
 * 사용자가 자기 사진을 올리면 키가 달라져 정상적으로 새로 분석한다.
 */

/** 하루. 프롬프트·모델을 바꾸면 자동으로 갈리도록 무한 보관은 하지 않는다. */
export const ANALYSIS_CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * 캐시 키 재료. 결과를 바꾸는 입력은 전부 들어가야 한다 —
 * 하나라도 빠지면 다른 조건의 결과를 잘못 돌려주게 된다.
 */
export interface AnalysisCacheKeyInput {
  images: { imageBase64: string; mimeType: string }[];
  note?: string;
  buildingStructure?: string;
  buildingYear?: number;
  buildingUse?: string;
  /** 연면적·층수도 결과를 바꾼다 — 같은 사진이라도 규모가 다르면 물량·공기가 달라진다. */
  totalFloorAreaM2?: number;
  floorsAbove?: number;
  /** 프롬프트·스키마가 바뀌면 옛 캐시를 버려야 하므로 버전을 섞는다. */
  version: string;
}

/**
 * 키를 만든다. 이미지는 통째로 해시에 넣지 않고 각 장을 먼저 해시해 길이를 줄인다
 * (base64 수십만 자를 매 요청 해시하면 그 자체가 부담이다).
 */
export function analysisCacheKey(input: AnalysisCacheKeyInput): string {
  const imagePart = input.images
    .map((im) => `${im.mimeType}:${createHash('sha256').update(im.imageBase64).digest('hex')}`)
    .join('|');
  const hintPart = JSON.stringify([
    input.note ?? '',
    input.buildingStructure ?? '',
    input.buildingYear ?? '',
    input.buildingUse ?? '',
    input.totalFloorAreaM2 ?? '',
    input.floorsAbove ?? '',
    input.version,
  ]);
  return createHash('sha256').update(`${imagePart}#${hintPart}`).digest('hex');
}

/** 최소 캐시 인터페이스 — Vercel Runtime Cache 와 메모리 폴백이 같은 모양을 쓴다. */
export interface AnalysisCacheStore {
  get(key: string): Promise<SiteAnalysis | undefined>;
  set(key: string, value: SiteAnalysis, ttlSeconds: number): Promise<void>;
}

/**
 * 로컬·테스트용 메모리 캐시. Vercel 함수는 인스턴스가 갈리면 사라지므로 운영에서는
 * Runtime Cache 를 쓰지만, 없는 환경에서도 코드 경로가 같아야 검증이 된다.
 */
export class MemoryAnalysisCache implements AnalysisCacheStore {
  private readonly entries = new Map<string, { value: SiteAnalysis; expiresAt: number }>();

  async get(key: string): Promise<SiteAnalysis | undefined> {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  async set(key: string, value: SiteAnalysis, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

/**
 * Vercel Runtime Cache 어댑터. 리전 단위로 공유되므로 함수 인스턴스가 바뀌어도 히트한다.
 * 캐시는 부가 기능이라 어떤 실패도 분석을 막아서는 안 된다 — 오류는 미스로 취급한다.
 */
export class VercelRuntimeAnalysisCache implements AnalysisCacheStore {
  constructor(private readonly cache: { get(k: string): Promise<unknown>; set(k: string, v: unknown, o: { ttl: number; tags?: string[] }): Promise<void> }) {}

  async get(key: string): Promise<SiteAnalysis | undefined> {
    try {
      const v = await this.cache.get(key);
      return (v as SiteAnalysis | undefined) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: SiteAnalysis, ttlSeconds: number): Promise<void> {
    try {
      await this.cache.set(key, value, { ttl: ttlSeconds, tags: ['site-analysis'] });
    } catch {
      // 저장 실패는 다음 요청이 다시 계산하면 그만이다.
    }
  }
}

/**
 * 환경에 맞는 캐시를 고른다.
 * Vercel 위에서는 Runtime Cache, 그 밖에서는 메모리. 불러오기 실패도 메모리로 떨어진다.
 */
export async function createAnalysisCache(): Promise<AnalysisCacheStore> {
  if (!process.env.VERCEL) return new MemoryAnalysisCache();
  try {
    const mod = (await import('@vercel/functions')) as {
      getCache?: (o?: { namespace?: string }) => {
        get(k: string): Promise<unknown>;
        set(k: string, v: unknown, o: { ttl: number; tags?: string[] }): Promise<void>;
      };
    };
    if (typeof mod.getCache !== 'function') return new MemoryAnalysisCache();
    return new VercelRuntimeAnalysisCache(mod.getCache({ namespace: 'site-analysis' }));
  } catch {
    return new MemoryAnalysisCache();
  }
}

/**
 * 건축물대장 조회 캐시. 분석 캐시와 같은 저장소를 쓰되 네임스페이스만 다르다.
 *
 * 왜 필요한가: 공공데이터포털은 간헐적으로 응답이 깨진다(실측에서 정상 응답 사이에
 * 파싱 불가 응답이 섞였다). 한 번 성공한 지번을 굳혀 두면 그 뒤로는 외부 호출 자체가
 * 사라져 실패할 수가 없다. 건물은 하루 사이에 바뀌지 않으므로 오래 잡아도 안전하다.
 */
export async function createRegisterCache(): Promise<{
  get(key: string): Promise<BuildingRegisterInfo | undefined>;
  set(key: string, value: BuildingRegisterInfo, ttlSeconds: number): Promise<void>;
}> {
  const memory = new Map<string, { value: BuildingRegisterInfo; expiresAt: number }>();
  const fallback = {
    async get(key: string) {
      const hit = memory.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= Date.now()) {
        memory.delete(key);
        return undefined;
      }
      return hit.value;
    },
    async set(key: string, value: BuildingRegisterInfo, ttl: number) {
      memory.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    },
  };

  if (!process.env.VERCEL) return fallback;
  try {
    const mod = (await import('@vercel/functions')) as {
      getCache?: (o?: { namespace?: string }) => {
        get(k: string): Promise<unknown>;
        set(k: string, v: unknown, o: { ttl: number; tags?: string[] }): Promise<void>;
      };
    };
    if (typeof mod.getCache !== 'function') return fallback;
    const c = mod.getCache({ namespace: 'building-register' });
    return {
      async get(key) {
        try {
          return ((await c.get(key)) as BuildingRegisterInfo | undefined) ?? undefined;
        } catch {
          return fallback.get(key);
        }
      },
      async set(key, value, ttl) {
        try {
          await c.set(key, value, { ttl, tags: ['building-register'] });
        } catch {
          await fallback.set(key, value, ttl);
        }
      },
    };
  } catch {
    return fallback;
  }
}

/**
 * 캐시에 넣어도 되는 결과인지.
 *
 * 두 가지를 거른다.
 * 1) 목(MOCK) — 공급자가 잠깐 막혀 목으로 떨어진 응답을 24시간 굳히면 그 사진은
 *    하루 종일 목만 나온다. 실패를 캐시하는 건 캐시로 장애를 연장하는 짓이다.
 * 2) 견적 자료가 부실한 결과 — 스키마를 강제하지 못한 공급자가 응답하면 체크리스트·
 *    단가요인이 빈 채로 온다. 그걸 굳히면 "장비·현장확인이 안 나오는 사진" 이 생긴다.
 *    캐시는 좋은 결과를 오래 쓰라고 두는 것이지 나쁜 결과를 고정하라고 두는 게 아니다.
 */
export function isCacheable(analysis: SiteAnalysis): boolean {
  if (analysis.method !== 'AI_VISION') return false;
  if (analysis.materials.length === 0) return false;
  const q = analysis.quoteBasis;
  // quoteBasis 자체가 없는 건 구형 계약일 수 있으니 막지 않는다.
  // 있는데 핵심 항목이 비어 있으면 스키마가 안 먹은 응답이므로 굳히지 않는다.
  if (q && (q.siteChecklist.length === 0 || q.wasteByClass.length === 0)) return false;
  return true;
}
