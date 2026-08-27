import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  MATERIAL_CATEGORY_LABELS,
  type DetectedMaterial,
  type SiteAnalysis,
} from '@dimol/shared';
import { ApiError, analyzeSite } from '../api/client';
import { AppIcon } from '../components/AppIcon';
import { CameraCaptureModal, type CapturedPhoto } from '../components/CameraCaptureModal';
import { AppButton, Card, ErrorBanner, StickyFooter } from '../components/ui';
import { FadeInUp, PressableScale } from '../components/motion';
import { ScreenHeader } from '../navigation';
import { theme } from '../theme';

import brandmark from '../../assets/brandmark.png';

/**
 * 현장 사진 AI 분석 — 대기업/프리미엄 AI 파이프라인 UX
 * 사진 촬영/선택 → 소재 식별 + 철거 공정 안내 + 위험 경고.
 */

const CONFIDENCE_LABELS: Record<string, string> = { LOW: '참고', MEDIUM: '보통', HIGH: '높음' };

interface PickedImage {
  base64: string;
  mimeType: string;
  uri: string;
}

function mimeFromUri(uri: string): string {
  return uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

export function SiteAnalysisScreen() {
  const [image, setImage] = useState<PickedImage | null>(null);
  const [result, setResult] = useState<SiteAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  function applyAsset(asset: ImagePicker.ImagePickerAsset) {
    if (!asset.base64) {
      setError('사진을 불러오지 못했어요. 다시 시도해 주세요.');
      return;
    }
    setResult(null);
    setError(null);
    setImage({ base64: asset.base64, mimeType: asset.mimeType ?? mimeFromUri(asset.uri), uri: asset.uri });
  }

  // 커스텀 카메라(가이드 오버레이)에서 촬영 완료 시 — 대표로 첫 장을 미리보기로 사용
  function handleCameraCapture(photos: CapturedPhoto[]) {
    const first = photos[0];
    if (!first) return;
    setResult(null);
    setError(null);
    setImage(first);
    setCameraOpen(false);
  }

  async function pickFromLibrary() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.5,
    });
    if (!res.canceled && res.assets[0]) applyAsset(res.assets[0]);
  }

  function takePhoto() {
    setError(null);
    setCameraOpen(true);
  }

  async function analyze() {
    if (!image) return;
    setError(null);
    setLoading(true);
    try {
      setResult(await analyzeSite({ imageBase64: image.base64, mimeType: image.mimeType }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '분석에 실패했어요. 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  const SAMPLE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  function loadSampleAndAnalyze() {
    setImage({
      base64: SAMPLE_BASE64,
      mimeType: 'image/png',
      uri: 'data:image/png;base64,' + SAMPLE_BASE64,
    });
    setResult(null);
    setError(null);
    setLoading(true);
    analyzeSite({ imageBase64: SAMPLE_BASE64, mimeType: 'image/png' })
      .then((res) => setResult(res))
      .catch((err) => setError(err instanceof ApiError ? err.message : '분석에 실패했어요.'))
      .finally(() => setLoading(false));
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="현장 AI 분석 (소재·공정)" canGoBack />
      <ScrollView contentContainerStyle={styles.content}>
        {/* 상단 히어로 AI 카운트다운/엔진 카드 */}
        <FadeInUp delay={40}>
          <View style={styles.heroCard}>
            <View style={styles.heroBadgeRow}>
              <View style={styles.heroCardBadge}>
                <View style={styles.pulseDot} />
                <Text style={styles.heroCardBadgeText}>Vision AI v2.0</Text>
              </View>
              <Text style={styles.heroEngineTag}>딥러닝 공정 엔진</Text>
            </View>
            <Text style={styles.heroCardTitle}>
              현장 사진 한 장으로{'\n'}소재와 철거 공정을 분석해 드려요
            </Text>
            <View style={styles.heroChipsRow}>
              <View style={styles.heroChip}>
                <AppIcon name="alert" size={13} color="#93C5FD" />
                <Text style={styles.heroChipText}>석면·위험물 식별</Text>
              </View>
              <View style={styles.heroChip}>
                <AppIcon name="recycle" size={13} color="#93C5FD" />
                <Text style={styles.heroChipText}>부피·폐기물 분류</Text>
              </View>
              <View style={styles.heroChip}>
                <AppIcon name="document" size={13} color="#93C5FD" />
                <Text style={styles.heroChipText}>공정 주의사항 리포트</Text>
              </View>
            </View>
          </View>
        </FadeInUp>

        {image ? (
          <FadeInUp>
            <View style={styles.previewContainer}>
              <Image source={{ uri: image.uri }} style={styles.preview} resizeMode="cover" />
              <PressableScale style={styles.repickChip} onPress={() => setImage(null)}>
                <AppIcon name="recycle" size={16} color="#FFFFFF" />
                <Text style={styles.repickChipText}>다시 선택</Text>
              </PressableScale>
            </View>
          </FadeInUp>
        ) : (
          /* 모던 AI 드롭존 영역 */
          <FadeInUp delay={80}>
            <View style={styles.dropzone}>
              <View style={styles.iconCircle}>
                <Image source={brandmark} style={styles.dropzoneLogo} resizeMode="contain" />
              </View>
              <Text style={styles.dropzoneTitle}>철거 현장 사진을 업로드해 주세요</Text>
              <Text style={styles.dropzoneSub}>
                건물 내부, 지붕, 자재가 잘 보이게 찍으면{'\n'}소재 인식과 공정 가이드가 더욱 정확해집니다
              </Text>
              <PressableScale style={styles.samplePillBtn} onPress={loadSampleAndAnalyze}>
                <AppIcon name="sparkles" size={18} color="#FFFFFF" />
                <Text style={styles.samplePillBtnText}>샘플 사진으로 AI 즉시 분석 시연</Text>
              </PressableScale>
            </View>
          </FadeInUp>
        )}

        {/* 촬영 & 앨범 버튼 액션 카드로 리디자인 */}
        <FadeInUp delay={120}>
          <View style={styles.pickRow}>
            <PressableScale style={styles.actionCard} onPress={takePhoto} accessibilityRole="button">
              <View style={styles.actionIconCircle}>
                <AppIcon name="camera" size={26} color={theme.colors.primary} />
              </View>
              <Text style={styles.actionCardTitle}>카메라 촬영</Text>
              <Text style={styles.actionCardSub}>현장에서 직접 촬영</Text>
            </PressableScale>
            
            <View style={{ width: theme.spacing.sm }} />

            <PressableScale style={styles.actionCard} onPress={pickFromLibrary} accessibilityRole="button">
              <View style={styles.actionIconCircle}>
                <AppIcon name="document" size={26} color={theme.colors.primary} />
              </View>
              <Text style={styles.actionCardTitle}>앨범에서 선택</Text>
              <Text style={styles.actionCardSub}>저장된 사진 불러오기</Text>
            </PressableScale>
          </View>
        </FadeInUp>

        <ErrorBanner message={error} />

        {result ? <AnalysisResult result={result} /> : null}
      </ScrollView>

      {image && !result ? (
        <StickyFooter>
          <AppButton label="이 사진 분석하기" onPress={analyze} loading={loading} />
        </StickyFooter>
      ) : null}

      <CameraCaptureModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
      />
    </View>
  );
}

function MaterialRow({ m }: { m: DetectedMaterial }) {
  return (
    <View style={[styles.materialRow, m.hazardous && styles.materialRowHazard]}>
      <View style={styles.materialTop}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          {m.hazardous ? <AppIcon name="alert" size={16} color={theme.colors.error} /> : null}
          <Text style={styles.materialName}>{m.name}</Text>
        </View>
        <View style={[styles.tag, m.hazardous ? styles.tagHazard : styles.tagOk]}>
          <Text style={[styles.tagText, m.hazardous ? styles.tagTextHazard : styles.tagTextOk]}>
            {m.hazardous ? '위험물' : m.recyclable ? '재활용 가능' : '일반 처리'}
          </Text>
        </View>
      </View>
      <Text style={styles.materialMeta}>
        {MATERIAL_CATEGORY_LABELS[m.category]} · 신뢰도 {CONFIDENCE_LABELS[m.confidence] ?? m.confidence}
        {m.note ? ` · ${m.note}` : ''}
      </Text>
    </View>
  );
}

function AnalysisResult({ result }: { result: SiteAnalysis }) {
  return (
    <View style={{ marginTop: theme.spacing.md }}>
      <FadeInUp delay={40}>
        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AppIcon name="sparkles" size={20} color={theme.colors.primary} />
              <Text style={styles.summaryLabel}>현장 분석 진단서</Text>
            </View>
            <View style={styles.methodChip}>
              <Text style={styles.methodChipText}>
                {result.method === 'AI_VISION' ? 'AI 실시간 분석' : '시연용 샘플'}
              </Text>
            </View>
          </View>
          <Text style={styles.summaryText}>{result.summary}</Text>
        </View>
      </FadeInUp>

      <Text style={styles.sectionTitle}>구성 소재 ({result.materials.length})</Text>
      <FadeInUp delay={100}>
        <Card>
          {result.materials.map((m, i) => (
            <View key={`${m.name}-${i}`}>
              {i > 0 ? <View style={styles.divider} /> : null}
              <MaterialRow m={m} />
            </View>
          ))}
        </Card>
      </FadeInUp>

      <Text style={styles.sectionTitle}>권장 철거 공정 절차</Text>
      {result.demolitionSteps.map((s, i) => (
        <FadeInUp key={s.order} delay={140 + i * 60}>
          <Card style={styles.stepCard}>
            <View style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{s.order}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepDesc}>{s.description}</Text>
                {s.caution ? (
                  <View style={styles.cautionBox}>
                    <AppIcon name="alert" size={14} color={colors.error} />
                    <Text style={styles.stepCaution}>주의사항: {s.caution}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Card>
        </FadeInUp>
      ))}

      {result.hazards.length > 0 ? (
        <FadeInUp>
          <View style={styles.hazardCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs }}>
              <AppIcon name="alert" size={20} color={colors.error} />
              <Text style={styles.hazardTitle}>현장 안전 위험 요소 경고</Text>
            </View>
            {result.hazards.map((h, i) => (
              <Text key={i} style={styles.hazardItem}>
                • {h}
              </Text>
            ))}
          </View>
        </FadeInUp>
      ) : null}

      <Text style={styles.disclaimer}>{result.disclaimer}</Text>
    </View>
  );
}

const { colors, font, spacing, radius } = theme;

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.lg },
  
  /* 히어로 AI 카드 */
  heroCard: {
    backgroundColor: '#0F172A',
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    shadowColor: '#1E293B',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  heroCardBadge: {
    backgroundColor: 'rgba(37, 99, 235, 0.25)',
    borderWidth: 1,
    borderColor: '#3B82F6',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#60A5FA',
    marginRight: 6,
  },
  heroCardBadgeText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '800',
  },
  heroEngineTag: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  heroCardTitle: {
    color: '#F8FAFC',
    fontSize: font.title - 2,
    fontWeight: '800',
    lineHeight: font.title + 4,
    marginVertical: spacing.xs / 2,
  },
  heroChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.xs,
  },
  heroChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  heroChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },

  /* 업로드 드롭존 */
  dropzone: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  dropzoneLogo: {
    width: 44,
    height: 44,
  },
  dropzoneTitle: {
    color: colors.text,
    fontSize: font.bodyLarge,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4,
  },
  dropzoneSub: {
    color: colors.textMuted,
    fontSize: font.body - 2,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  samplePillBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: 6,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  samplePillBtnText: {
    color: '#FFFFFF',
    fontSize: font.body,
    fontWeight: '800',
  },

  /* 프리뷰 이미지 */
  previewContainer: {
    position: 'relative',
    marginBottom: spacing.md,
  },
  preview: {
    borderRadius: radius.card,
    height: 240,
    width: '100%',
  },
  repickChip: {
    position: 'absolute',
    right: 12,
    top: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
  },
  repickChipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  /* 액션 카드 (촬영/앨범) */
  pickRow: {
    flexDirection: 'row',
  },
  actionCard: {
    flex: 1,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: radius.card,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0B1B3A',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  actionIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  actionCardTitle: {
    color: colors.text,
    fontSize: font.bodyLarge,
    fontWeight: '800',
  },
  actionCardSub: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },

  /* 분석 결과 리포트 UI */
  summaryCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    color: colors.primary,
    fontSize: font.bodyLarge,
    fontWeight: '800',
  },
  methodChip: {
    backgroundColor: colors.background,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  methodChipText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  summaryText: {
    color: colors.text,
    fontSize: font.bodyLarge,
    fontWeight: '600',
    marginTop: spacing.sm,
    lineHeight: 26,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: font.title - 4,
    fontWeight: '800',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  materialRow: {
    paddingVertical: spacing.xs,
  },
  materialRowHazard: {},
  materialTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  materialName: {
    color: colors.text,
    flex: 1,
    fontSize: font.bodyLarge,
    fontWeight: '700',
  },
  materialMeta: {
    color: colors.textMuted,
    fontSize: font.body,
    marginTop: spacing.xs / 2,
  },
  tag: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  tagOk: {
    backgroundColor: colors.primarySoft,
  },
  tagHazard: {
    backgroundColor: '#FBEAEA',
  },
  tagText: {
    fontSize: 13,
    fontWeight: '700',
  },
  tagTextOk: {
    color: colors.primary,
  },
  tagTextHazard: {
    color: colors.error,
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: spacing.xs,
  },
  stepCard: {
    marginBottom: spacing.xs,
  },
  stepRow: {
    flexDirection: 'row',
  },
  stepNum: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 32,
  },
  stepNumText: {
    color: colors.background,
    fontSize: font.body,
    fontWeight: '800',
  },
  stepTitle: {
    color: colors.text,
    fontSize: font.bodyLarge,
    fontWeight: '800',
  },
  stepDesc: {
    color: colors.textMuted,
    fontSize: font.body,
    marginTop: spacing.xs / 2,
    lineHeight: 24,
  },
  cautionBox: {
    backgroundColor: '#FFF5F5',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: spacing.xs,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: '#FED7D7',
  },
  stepCaution: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  hazardCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: radius.card,
    borderColor: '#FECACA',
    borderWidth: 1.5,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  hazardTitle: {
    color: colors.error,
    fontSize: font.bodyLarge,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  hazardItem: {
    color: colors.error,
    fontSize: font.body,
    marginTop: spacing.xs / 2,
    fontWeight: '600',
  },
  disclaimer: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
