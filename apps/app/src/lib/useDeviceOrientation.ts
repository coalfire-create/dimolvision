import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import type { OrientationReading } from '@dimol/shared';

/**
 * 기기 방향(azimuth/pitch) 실시간 추적 훅 — 가이드 촬영의 방향 게이트에 쓴다.
 *
 * 플랫폼별 센서 소스:
 * - 웹: `DeviceOrientationEvent` (iOS 13+ 는 사용자 제스처에서 권한 요청 필요).
 * - 네이티브(Android/iOS): `expo-sensors` 의 DeviceMotion(회전값).
 *
 * 좌표계 정규화(중요):
 * - azimuth 는 **시계방향(나침반) 기준 0~360** 으로 통일한다. 사용자가 "오른쪽으로
 *   90도" 돌면 azimuth 가 +90 되도록 맞춰야, 슬롯의 상대각(+90/+180/+270) 판정과
 *   방향이 일치한다. W3C alpha 는 반시계방향이라 (360 - alpha) 로 뒤집는다.
 *   iOS 는 나침반 헤딩(webkitCompassHeading, 이미 시계방향)을 우선 쓴다.
 * - pitch 는 후면 카메라 축이 수평이면 0, 정면 아래(바닥)면 -90, 정면 위(천장)면
 *   +90 이 되도록 beta 에서 환산한다.
 *
 * 절대 방위 정확도는 요구하지 않는다 — 촬영 세션은 첫 슬롯에서 기준각(0도)을 잡고
 * 상대각으로만 판정하므로, 센서가 북쪽 기준이 아니어도 상대 변화만 안정적이면 된다.
 */

export type OrientationPermission = 'granted' | 'denied' | 'prompt' | 'unavailable';

export interface DeviceOrientationState {
  /** 최근 방향 측정값. 아직 값이 없으면 null. */
  reading: OrientationReading | null;
  /** 이 기기/브라우저에서 방향 센서를 쓸 수 있는지. */
  supported: boolean;
  /** 권한 상태(웹 iOS 만 명시적 요청 필요). */
  permission: OrientationPermission;
  /** iOS 웹 권한 요청(사용자 제스처 안에서 호출). */
  requestPermission: () => Promise<void>;
}

/** W3C beta(도) → 후면 카메라 pitch(-90 아래 ~ +90 위). */
function pitchFromBeta(betaDeg: number): number {
  // 화면이 위를 향해 평평(beta≈0) → 카메라는 바닥(-90).
  // 세로로 세움(beta≈90) → 카메라 수평(0).
  // 화면이 아래를 향해 평평(beta≈±180) → 카메라는 천장(+90).
  let p = betaDeg - 90;
  if (p < -180) p += 360;
  if (p > 180) p -= 360;
  return p;
}

/** 반시계방향 alpha(도) → 시계방향 나침반 azimuth(0~360). */
function azimuthFromAlpha(alphaDeg: number): number {
  return (((360 - alphaDeg) % 360) + 360) % 360;
}

const RAD_TO_DEG = 180 / Math.PI;

export function useDeviceOrientation(active: boolean): DeviceOrientationState {
  const [reading, setReading] = useState<OrientationReading | null>(null);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<OrientationPermission>(
    Platform.OS === 'web' ? 'prompt' : 'granted',
  );
  // 최신 setter 를 클로저에서 안전하게 쓰기 위한 ref (리스너 재등록 최소화).
  const setReadingRef = useRef(setReading);
  setReadingRef.current = setReading;

  const requestPermission = useCallback(async () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const DOE = (window as unknown as { DeviceOrientationEvent?: unknown })
      .DeviceOrientationEvent as
      | (typeof window.DeviceOrientationEvent & { requestPermission?: () => Promise<string> })
      | undefined;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        setPermission(res === 'granted' ? 'granted' : 'denied');
      } catch {
        setPermission('denied');
      }
    } else {
      // 권한 개념이 없는 브라우저 — 바로 사용 가능.
      setPermission('granted');
    }
  }, []);

  // ── 웹: DeviceOrientationEvent ──────────────────────────────────────────────
  useEffect(() => {
    if (!active || Platform.OS !== 'web' || typeof window === 'undefined') return;

    const DOE = (window as unknown as { DeviceOrientationEvent?: unknown })
      .DeviceOrientationEvent as
      | (typeof window.DeviceOrientationEvent & { requestPermission?: () => Promise<string> })
      | undefined;
    if (!DOE) {
      setSupported(false);
      setPermission('unavailable');
      return;
    }
    setSupported(true);
    // iOS 13+ 는 명시적 권한 필요, 그 외 브라우저는 바로 허용으로 본다.
    if (typeof DOE.requestPermission !== 'function') {
      setPermission((p) => (p === 'prompt' ? 'granted' : p));
    }

    function handle(e: DeviceOrientationEvent) {
      const compass = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading;
      const azimuth =
        typeof compass === 'number' && !Number.isNaN(compass)
          ? ((compass % 360) + 360) % 360 // iOS: 이미 시계방향 나침반 헤딩
          : e.alpha != null
            ? azimuthFromAlpha(e.alpha)
            : null;
      const pitch = e.beta != null ? pitchFromBeta(e.beta) : null;
      if (azimuth == null || pitch == null) return;
      setReadingRef.current({ azimuth, pitch });
    }

    // 절대 방위 이벤트가 있으면 우선 사용.
    window.addEventListener('deviceorientationabsolute', handle as EventListener);
    window.addEventListener('deviceorientation', handle as EventListener);
    return () => {
      window.removeEventListener('deviceorientationabsolute', handle as EventListener);
      window.removeEventListener('deviceorientation', handle as EventListener);
    };
  }, [active]);

  // ── 네이티브: expo-sensors DeviceMotion ─────────────────────────────────────
  useEffect(() => {
    if (!active || Platform.OS === 'web') return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;

    DeviceMotion.isAvailableAsync()
      .then((ok: boolean) => {
        if (cancelled) return;
        setSupported(ok);
        if (!ok) {
          setPermission('unavailable');
          return;
        }
        DeviceMotion.setUpdateInterval(200);
        sub = DeviceMotion.addListener((data) => {
          const rotation = data.rotation;
          if (!rotation) return;
          const alphaDeg = rotation.alpha * RAD_TO_DEG;
          const betaDeg = rotation.beta * RAD_TO_DEG;
          setReadingRef.current({
            azimuth: azimuthFromAlpha(((alphaDeg % 360) + 360) % 360),
            pitch: pitchFromBeta(betaDeg),
          });
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSupported(false);
          setPermission('unavailable');
        }
      });

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [active]);

  return { reading, supported, permission, requestPermission };
}
