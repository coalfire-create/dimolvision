/**
 * 영상에서 3D 복원용 프레임을 뽑는다.
 *
 * 왜 영상인가: 제대로 된 사진측량은 중첩 60~80% 로 수십 장이 필요하다. 사용자가 손으로
 * 그만큼 찍게 만들 수는 없다. 건물을 한 바퀴 돌며 찍은 영상이면 프레임이 저절로 그만큼
 * 나오고, 인접 프레임이 크게 겹쳐 특징점 매칭에도 유리하다.
 *
 * 왜 브라우저에서 뽑는가: 서버로 영상을 통째로 올리면 수십 MB 를 전송해야 하고 서버에
 * ffmpeg 도 필요하다. 브라우저는 video 엘리먼트로 원하는 시각에 프레임을 그릴 수 있어
 * 추가 의존성 없이 필요한 장수만 뽑아 보낼 수 있다.
 */

export interface ExtractedFrame {
  /** 순수 base64 (data: 접두사 없음). */
  base64: string;
  /** 영상 내 시각(초) — 순서 보존 확인·디버깅용. */
  timeSec: number;
  /** 라플라시안 분산 기반 선명도. 클수록 또렷하다. */
  sharpness: number;
}

export interface ExtractFramesOptions {
  /** 뽑을 후보 프레임 수(선명도로 걸러내기 전). */
  sampleCount?: number;
  /** 최종적으로 남길 장수. COLMAP 은 20~40장이면 충분하고 더 넣으면 느려진다. */
  keepCount?: number;
  /** 긴 변 기준 최대 픽셀. 너무 크면 전송·복원이 모두 느려진다. */
  maxEdge?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * 흐린 프레임을 골라내기 위한 선명도 측정.
 * 라플라시안(2차 미분) 응답의 분산이 초점이 맞은 정도를 잘 대변한다 —
 * 흔들린 프레임은 고주파 성분이 사라져 분산이 급격히 낮아진다.
 */
function sharpnessScore(data: Uint8ClampedArray, w: number, h: number): number {
  // 계산량을 줄이려고 그레이스케일로 한 번만 옮긴다.
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
  }
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      const lap =
        4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** 영상 파일(Blob/File)에서 균등 간격으로 프레임을 뽑아 선명한 것만 남긴다. */
export async function extractFrames(
  video: Blob,
  options: ExtractFramesOptions = {},
): Promise<ExtractedFrame[]> {
  const sampleCount = options.sampleCount ?? 48;
  const keepCount = options.keepCount ?? 28;
  const maxEdge = options.maxEdge ?? 1280;

  const url = URL.createObjectURL(video);
  const el = document.createElement('video');
  el.preload = 'auto';
  el.muted = true;
  // iOS 사파리는 인라인 재생을 명시해야 프레임을 그릴 수 있다.
  el.playsInline = true;
  el.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error('영상을 열지 못했습니다.'));
    });

    const duration = el.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('영상 길이를 확인하지 못했습니다.');
    }

    const vw = el.videoWidth;
    const vh = el.videoHeight;
    const scale = Math.min(1, maxEdge / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');

    const frames: ExtractedFrame[] = [];
    // 처음·끝은 손이 흔들리는 구간이라 살짝 안쪽부터 뽑는다.
    const start = duration * 0.03;
    const end = duration * 0.97;

    for (let i = 0; i < sampleCount; i += 1) {
      const t = start + ((end - start) * i) / Math.max(1, sampleCount - 1);
      await seekTo(el, t);
      ctx.drawImage(el, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const base64 = canvas.toDataURL('image/jpeg', 0.82).split(',')[1] ?? '';
      if (base64) {
        frames.push({ base64, timeSec: t, sharpness: sharpnessScore(img.data, w, h) });
      }
      options.onProgress?.(i + 1, sampleCount);
    }

    return selectSharpest(frames, keepCount);
  } finally {
    URL.revokeObjectURL(url);
    el.removeAttribute('src');
    el.load();
  }
}

/** 지정 시각으로 이동하고 그 프레임이 실제로 그려질 때까지 기다린다. */
function seekTo(el: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      el.removeEventListener('seeked', done);
      resolve();
    };
    const fail = () => {
      el.removeEventListener('error', fail);
      reject(new Error('영상 탐색에 실패했습니다.'));
    };
    el.addEventListener('seeked', done);
    el.addEventListener('error', fail);
    el.currentTime = Math.max(0, t);
  });
}

/**
 * 선명한 프레임만 남기되 **시간 분포를 유지**한다.
 * 단순히 선명도 상위만 고르면 한 구간에 몰려 복원이 실패한다 — 카메라가 움직인 범위를
 * 고르게 덮어야 삼각측량이 된다. 그래서 구간을 keepCount 개로 나누고 각 구간에서
 * 가장 선명한 한 장씩 뽑는다.
 */
export function selectSharpest(frames: ExtractedFrame[], keepCount: number): ExtractedFrame[] {
  if (frames.length <= keepCount) return frames;
  const bucketSize = frames.length / keepCount;
  const picked: ExtractedFrame[] = [];
  for (let b = 0; b < keepCount; b += 1) {
    const from = Math.floor(b * bucketSize);
    const to = Math.min(frames.length, Math.floor((b + 1) * bucketSize));
    let best = frames[from]!;
    for (let i = from + 1; i < to; i += 1) {
      if (frames[i]!.sharpness > best.sharpness) best = frames[i]!;
    }
    picked.push(best);
  }
  return picked;
}
