import { Platform } from 'react-native';

/**
 * 로그인 없이 바로 체험하는 데모 샘플 — 실제 철거 현장 사진.
 *
 * 심사·투표자가 현장 사진을 가지고 있지 않아도 핵심 기능(소재 식별·공정·위험 경고)을
 * 그대로 확인할 수 있어야 한다. 사진은 웹 정적 자산(`public/samples`)으로 배포하고,
 * 실제 사용자가 업로드했을 때와 **완전히 동일한 경로**(base64 → POST /site-analysis/analyze)로
 * 분석한다 — 시연용 우회 경로가 아니라 진짜 파이프라인이다.
 *
 * 사진 라이선스: CC BY 2.0 (저작자 표기는 화면 및 public/samples/ATTRIBUTION.md).
 */

export interface SampleSite {
  id: string;
  /** 썸네일/버튼에 보이는 짧은 이름. */
  label: string;
  /** 어떤 현장인지 한 줄 설명. */
  description: string;
  /** 파일명(public/samples 기준). */
  file: string;
  /** CC BY 2.0 저작자 표기. */
  credit: string;
}

export const SAMPLE_SITES: SampleSite[] = [
  {
    id: 'interior-finish',
    label: '내부 마감재 철거',
    description: '석고보드·천장 마감재 해체 중인 건물 내부',
    file: 'site-1.jpg',
    credit: 'Oregon Dept. of Transportation (CC BY 2.0)',
  },
  {
    id: 'structure',
    label: '구조체·조적 현장',
    description: '벽돌 조적과 콘크리트 슬래브가 드러난 내부',
    file: 'site-2.jpg',
    credit: 'John Hoey (CC BY 2.0)',
  },
  {
    id: 'exterior',
    label: '건물 외부 전경',
    description: '중장비가 투입된 철거 진행 중 건물 외관',
    file: 'site-3.jpg',
    credit: 'Andrew Bone (CC BY 2.0)',
  },
];

/**
 * 샘플 사진이 놓인 베이스 URL.
 * - 웹: 같은 오리진의 정적 경로(개발 서버·Vercel 모두 `public/` 을 그대로 서빙).
 * - 네이티브: 웹 배포 오리진을 써야 하므로 EXPO_PUBLIC_WEB_BASE_URL 로 지정한다.
 */
const SAMPLE_BASE_URL =
  Platform.OS === 'web'
    ? '/samples'
    : `${(process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '').replace(/\/$/, '')}/samples`;

export function sampleUri(sample: SampleSite): string {
  return `${SAMPLE_BASE_URL}/${sample.file}`;
}

/** Blob → 순수 base64(data: 접두사 제거). 웹/네이티브 공통으로 FileReader 를 쓴다. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('샘플 사진을 읽지 못했습니다.'));
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0) {
        reject(new Error('샘플 사진을 읽지 못했습니다.'));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** 샘플 사진을 내려받아 업로드와 동일한 형식(base64)으로 돌려준다. */
export async function loadSampleBase64(
  sample: SampleSite,
): Promise<{ base64: string; mimeType: string; uri: string }> {
  const uri = sampleUri(sample);
  const res = await fetch(uri);
  if (!res.ok) throw new Error('샘플 사진을 불러오지 못했습니다.');
  const blob = await res.blob();
  return { base64: await blobToBase64(blob), mimeType: 'image/jpeg', uri };
}
