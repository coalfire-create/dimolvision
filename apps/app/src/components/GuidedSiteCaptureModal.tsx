import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  SITE_CAPTURE_COPY,
  SITE_CAPTURE_TOTAL,
  azimuthDelta,
  completedCount,
  createSiteCaptureSession,
  currentSlot,
  isSlotAligned,
  reduceSiteCapture,
  type SiteCaptureSlot,
  type SiteCaptureState,
} from '@dimol/shared';
import { AppIcon } from './AppIcon';
import type { CapturedPhoto } from './CameraCaptureModal';
import { analyzePhotoQuality } from '../lib/photoQuality';
import { useDeviceOrientation, type OrientationPermission } from '../lib/useDeviceOrientation';
import { theme } from '../theme';

export interface GuidedCaptureResult extends CapturedPhoto {
  /** 어떤 슬롯에서 찍혔는지(정면벽/우측벽/…/손상부위). */
  slotId: string;
}

interface GuidedSiteCaptureModalProps {
  visible: boolean;
  onClose: () => void;
  /** 전체 슬롯 완료 시 촬영된 사진들을 넘긴다(견적 분석 API 로 전달). */
  onComplete: (photos: GuidedCaptureResult[]) => void;
}

/**
 * 철거 현장 가이드 촬영 — 정해진 순서·방향으로만 촬영이 진행되도록 강제하는 플로우.
 * 상태·판정 로직은 @dimol/shared 의 순수 함수를, 센서/품질은 플랫폼 훅을 사용한다.
 */
export function GuidedSiteCaptureModal({
  visible,
  onClose,
  onComplete,
}: GuidedSiteCaptureModalProps) {
  const [permission, requestCameraPermission] = useCameraPermissions();
  const [session, dispatch] = useReducer(reduceSiteCapture, undefined, createSiteCaptureSession);
  const [capturing, setCapturing] = useState(false);
  const [qualityError, setQualityError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView | null>(null);

  const slot = currentSlot(session);
  const orientation = useDeviceOrientation(visible && !session.done);
  const { reading, supported: sensorSupported, permission: sensorPermission } = orientation;

  // 모달을 새로 열 때마다 세션 초기화.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      dispatch({ type: 'RESET' });
      setQualityError(null);
    }
    wasVisible.current = visible;
  }, [visible]);

  // 방향이 목표 범위에 들어왔는지. 기준 슬롯(첫 촬영)·센서 미수신 시엔 막지 않는다.
  const aligned = useMemo(() => {
    if (!slot) return false;
    if (!reading) return true; // 센서 데이터 없으면 게이트 우회(촬영 허용)
    if (slot.relativeAzimuth === 0 && session.baseAzimuth === null) return true; // 0도 기준 슬롯
    return isSlotAligned(slot, session.baseAzimuth, reading);
  }, [slot, reading, session.baseAzimuth]);

  // 방향 게이트가 실제로 작동하는지(센서 지원 + 판정 대상 슬롯).
  const gateActive =
    sensorSupported &&
    !!reading &&
    !!slot &&
    !(slot.relativeAzimuth === 0 && session.baseAzimuth === null) &&
    !(slot.relativeAzimuth === null && slot.pitchRange === null); // 손상부위 제외

  function handleClose() {
    onClose();
  }

  async function handleShutter() {
    if (!cameraRef.current || capturing || !slot || !aligned) return;
    setCapturing(true);
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 0.6, base64: true });
      if (!shot) return;
      let base64 = shot.base64 ?? '';
      if (!base64 && shot.uri.startsWith('data:')) base64 = shot.uri.split(',')[1] ?? '';
      if (!base64) return;

      // 촬영 즉시 품질 검증(암전/렌즈 가림/흐림) → 미달이면 같은 슬롯 재촬영.
      const uriForCheck = shot.uri.startsWith('data:')
        ? shot.uri
        : `data:image/jpeg;base64,${base64}`;
      const quality = await analyzePhotoQuality({
        base64,
        uri: uriForCheck,
        mimeType: 'image/jpeg',
      });
      if (quality.supported && !quality.ok) {
        setQualityError(SITE_CAPTURE_COPY.qualityFail);
        return;
      }

      setQualityError(null);
      dispatch({
        type: 'CAPTURE',
        photo: { base64, mimeType: 'image/jpeg', uri: shot.uri },
        atAzimuth: reading?.azimuth ?? null,
      });
    } finally {
      setCapturing(false);
    }
  }

  function handleFinish() {
    onComplete(
      session.photos.map((p) => ({
        base64: p.base64,
        mimeType: p.mimeType,
        uri: p.uri,
        slotId: p.slotId,
      })),
    );
  }

  const progress = completedCount(session);
  const permissionPending = !permission;
  const permissionDenied = permission && !permission.granted;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.screen}>
        {permissionPending ? (
          <View style={styles.centerFill}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        ) : permissionDenied ? (
          <CameraPermissionGate onAllow={requestCameraPermission} onClose={handleClose} />
        ) : session.done ? (
          <CaptureCompleteView count={session.photos.length} onNext={handleFinish} />
        ) : (
          <>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

            <View style={styles.overlay} pointerEvents="box-none">
              {/* 상단: 진행률 + 현재 슬롯 안내 */}
              <View style={styles.topBar} pointerEvents="box-none">
                <View style={styles.topRow}>
                  <Text style={styles.progressText}>{SITE_CAPTURE_COPY.progress(progress)}</Text>
                  <Pressable
                    style={styles.closeBtn}
                    onPress={handleClose}
                    accessibilityRole="button"
                    accessibilityLabel="촬영 닫기"
                  >
                    <Text style={styles.closeBtnText}>✕</Text>
                  </Pressable>
                </View>
                <ProgressDots total={SITE_CAPTURE_TOTAL} done={progress} />
                {slot ? (
                  <View style={styles.instructionCard}>
                    <Text style={styles.instructionText}>{slot.instruction}</Text>
                  </View>
                ) : null}

                {/* iOS 웹 방향센서 권한 요청 배너 */}
                <SensorPermissionBanner
                  platformWeb={Platform.OS === 'web'}
                  permission={sensorPermission}
                  onRequest={orientation.requestPermission}
                />
              </View>

              {/* 중앙 프레이밍 + 방향 상태 */}
              <View style={styles.frameWrap} pointerEvents="none">
                <View style={[styles.frameBox, aligned ? styles.frameBoxOk : styles.frameBoxWarn]}>
                  <View
                    style={[
                      styles.corner,
                      styles.cornerTL,
                      aligned ? styles.cornerOk : styles.cornerWarn,
                    ]}
                  />
                  <View
                    style={[
                      styles.corner,
                      styles.cornerTR,
                      aligned ? styles.cornerOk : styles.cornerWarn,
                    ]}
                  />
                  <View
                    style={[
                      styles.corner,
                      styles.cornerBL,
                      aligned ? styles.cornerOk : styles.cornerWarn,
                    ]}
                  />
                  <View
                    style={[
                      styles.corner,
                      styles.cornerBR,
                      aligned ? styles.cornerOk : styles.cornerWarn,
                    ]}
                  />
                </View>
              </View>

              {/* 하단: 방향/품질 상태 + 컨트롤 */}
              <View style={styles.bottomArea} pointerEvents="box-none">
                {qualityError ? (
                  <View style={styles.qualityBanner}>
                    <AppIcon name="alert" size={18} color="#FFFFFF" />
                    <Text style={styles.qualityBannerText}>{qualityError}</Text>
                  </View>
                ) : gateActive ? (
                  <View style={[styles.statusPill, aligned ? styles.statusOk : styles.statusWarn]}>
                    <Text style={styles.statusText}>
                      {aligned ? SITE_CAPTURE_COPY.aligned : SITE_CAPTURE_COPY.misaligned}
                    </Text>
                    {!aligned && slot ? (
                      <Text style={styles.turnHint}>{turnHint(slot, session, reading)}</Text>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.bottomBar}>
                  {/* 왼쪽: 선택 슬롯일 때 건너뛰기 */}
                  <View style={styles.sideSlot}>
                    {slot?.optional ? (
                      <Pressable
                        style={styles.textBtn}
                        onPress={() => dispatch({ type: 'SKIP' })}
                        accessibilityRole="button"
                      >
                        <Text style={styles.textBtnLabel}>건너뛰기</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  {/* 가운데: 셔터 */}
                  <Pressable
                    style={[styles.shutterOuter, !aligned && styles.shutterDisabled]}
                    onPress={handleShutter}
                    disabled={capturing || !aligned}
                    accessibilityRole="button"
                    accessibilityLabel="사진 촬영"
                    accessibilityState={{ disabled: capturing || !aligned }}
                  >
                    {capturing ? (
                      <ActivityIndicator color={theme.colors.primary} />
                    ) : (
                      <View style={styles.shutterInner} />
                    )}
                  </Pressable>

                  {/* 오른쪽: 다중 슬롯일 때 "완료" */}
                  <View style={styles.sideSlot}>
                    {slot?.allowMultiple ? (
                      <Pressable
                        style={[
                          styles.doneBtn,
                          session.photos.filter((p) => p.slotId === slot.id).length === 0 &&
                            styles.doneBtnGhost,
                        ]}
                        onPress={() => dispatch({ type: 'FINISH_MULTIPLE' })}
                        accessibilityRole="button"
                      >
                        <Text style={styles.doneBtnText}>완료</Text>
                        <Text style={styles.doneBtnCount}>
                          {session.photos.filter((p) => p.slotId === slot.id).length}장
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

/** 목표 방향으로 얼마나 돌려야/기울여야 하는지 짧은 안내. */
function turnHint(
  slot: SiteCaptureSlot,
  session: SiteCaptureState,
  reading: { azimuth: number; pitch: number } | null,
): string {
  if (!reading) return '';
  if (slot.relativeAzimuth !== null && session.baseAzimuth !== null) {
    const target = (session.baseAzimuth + slot.relativeAzimuth) % 360;
    // 시계방향 부호 차이: 양수면 오른쪽으로 더 돌아야 함.
    const signed = (((target - reading.azimuth + 540) % 360) - 180) * -1;
    const deg = Math.round(azimuthDelta(reading.azimuth, target));
    return signed >= 0 ? `오른쪽으로 약 ${deg}도` : `왼쪽으로 약 ${deg}도`;
  }
  if (slot.pitchRange !== null) {
    const [min, max] = slot.pitchRange;
    if (reading.pitch < min) return '폰을 조금 더 아래로';
    if (reading.pitch > max) return '폰을 조금 더 위로';
  }
  return '';
}

function ProgressDots({ total, done }: { total: number; done: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.dot, i < done ? styles.dotDone : styles.dotPending]} />
      ))}
    </View>
  );
}

function SensorPermissionBanner({
  platformWeb,
  permission,
  onRequest,
}: {
  platformWeb: boolean;
  permission: OrientationPermission;
  onRequest: () => void;
}) {
  if (!platformWeb || permission !== 'prompt') return null;
  return (
    <Pressable style={styles.sensorBanner} onPress={onRequest} accessibilityRole="button">
      <AppIcon name="alert" size={16} color="#FFFFFF" />
      <Text style={styles.sensorBannerText}>
        방향 안내를 켜려면 눌러서 센서 사용을 허용해주세요
      </Text>
    </Pressable>
  );
}

function CameraPermissionGate({ onAllow, onClose }: { onAllow: () => void; onClose: () => void }) {
  return (
    <View style={styles.centerFill}>
      <AppIcon name="camera" size={40} color="#FFFFFF" />
      <Text style={styles.permTitle}>카메라 권한이 필요해요</Text>
      <Text style={styles.permSub}>현장 사진을 촬영하려면 카메라 사용을 허용해 주세요.</Text>
      <Pressable style={styles.permBtn} onPress={onAllow} accessibilityRole="button">
        <Text style={styles.permBtnText}>카메라 허용하기</Text>
      </Pressable>
      <Pressable style={styles.permClose} onPress={onClose} accessibilityRole="button">
        <Text style={styles.permCloseText}>닫기</Text>
      </Pressable>
    </View>
  );
}

function CaptureCompleteView({ count, onNext }: { count: number; onNext: () => void }) {
  return (
    <View style={styles.centerFill}>
      <View style={styles.completeCircle}>
        <AppIcon name="sparkles" size={40} color="#FFFFFF" />
      </View>
      <Text style={styles.completeTitle}>{SITE_CAPTURE_COPY.complete}</Text>
      <Text style={styles.completeSub}>현장 사진 {count}장을 정리했어요.</Text>
      <Pressable style={styles.permBtn} onPress={onNext} accessibilityRole="button">
        <Text style={styles.permBtnText}>다음 단계로</Text>
      </Pressable>
    </View>
  );
}

const { colors, font, spacing, radius } = theme;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: '#0F172A',
  },

  /* 권한 */
  permTitle: {
    color: '#FFFFFF',
    fontSize: font.title - 4,
    fontWeight: '800',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  permSub: {
    color: '#CBD5E1',
    fontSize: font.body,
    marginTop: spacing.xs,
    textAlign: 'center',
    lineHeight: 24,
  },
  permBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    minHeight: 52,
    justifyContent: 'center',
  },
  permBtnText: { color: '#FFFFFF', fontSize: font.bodyLarge, fontWeight: '800' },
  permClose: { marginTop: spacing.md, padding: spacing.sm },
  permCloseText: { color: '#94A3B8', fontSize: font.body, fontWeight: '600' },

  /* 완료 */
  completeCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  completeTitle: {
    color: '#FFFFFF',
    fontSize: font.title - 2,
    fontWeight: '800',
    textAlign: 'center',
  },
  completeSub: {
    color: '#CBD5E1',
    fontSize: font.body,
    marginTop: spacing.xs,
    textAlign: 'center',
  },

  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },

  /* 상단 */
  topBar: {
    paddingTop: Platform.OS === 'web' ? spacing.md : 48,
    paddingHorizontal: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  progressText: {
    color: '#FFFFFF',
    fontSize: font.body,
    fontWeight: '800',
    flex: 1,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  dotsRow: { flexDirection: 'row', gap: 6, marginTop: spacing.xs },
  dot: { flex: 1, height: 5, borderRadius: 999 },
  dotDone: { backgroundColor: colors.primary },
  dotPending: { backgroundColor: 'rgba(255,255,255,0.3)' },
  instructionCard: {
    backgroundColor: 'rgba(15,23,42,0.72)',
    borderRadius: radius.card,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  instructionText: {
    color: '#FFFFFF',
    fontSize: font.bodyLarge,
    fontWeight: '700',
    lineHeight: 28,
  },
  sensorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(37,99,235,0.9)',
    borderRadius: radius.card,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  sensorBannerText: { color: '#FFFFFF', fontSize: font.body, fontWeight: '700', flex: 1 },

  /* 중앙 프레이밍 */
  frameWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frameBox: {
    width: '82%',
    aspectRatio: 4 / 3,
    maxHeight: '100%',
  },
  frameBoxOk: {},
  frameBoxWarn: {},
  corner: { position: 'absolute', width: 36, height: 36 },
  cornerOk: { borderColor: '#4ADE80' },
  cornerWarn: { borderColor: '#FBBF24' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 8 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 8 },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 8,
  },

  /* 하단 */
  bottomArea: { paddingBottom: Platform.OS === 'web' ? spacing.md : 32 },
  qualityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(198,40,40,0.95)',
    borderRadius: radius.card,
    padding: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  qualityBannerText: { color: '#FFFFFF', fontSize: font.body, fontWeight: '700', flex: 1 },
  statusPill: {
    alignSelf: 'center',
    flexDirection: 'column',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  statusOk: { backgroundColor: 'rgba(22,163,74,0.92)' },
  statusWarn: { backgroundColor: 'rgba(202,138,4,0.92)' },
  statusText: { color: '#FFFFFF', fontSize: font.body, fontWeight: '800' },
  turnHint: { color: '#FEF3C7', fontSize: font.caption - 2, fontWeight: '700', marginTop: 2 },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  sideSlot: { width: 72, alignItems: 'center', justifyContent: 'center' },
  textBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  textBtnLabel: { color: '#FFFFFF', fontSize: font.body, fontWeight: '700' },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisabled: { opacity: 0.4 },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF' },
  doneBtn: {
    minWidth: 64,
    height: 56,
    borderRadius: 28,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnGhost: { backgroundColor: 'rgba(0,0,0,0.45)' },
  doneBtnText: { color: '#FFFFFF', fontSize: font.body, fontWeight: '800' },
  doneBtnCount: { color: '#DBEAFE', fontSize: font.caption - 4, fontWeight: '700' },
});
