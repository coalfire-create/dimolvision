import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  BUILDING_STRUCTURE_LABELS,
  MATERIAL_CATEGORY_LABELS,
  pyeongToM2,
  type BuildingStructure,
  type DetectedMaterial,
  type SiteAnalysis,
  type VolumeEstimate,
} from '@dimol/shared';
import { ApiError, analyzeSite, analyzeSiteWasteItems } from '../api/client';
import { AppIcon } from '../components/AppIcon';
import { CameraCaptureModal, type CapturedPhoto } from '../components/CameraCaptureModal';
import { AppButton, Card, ErrorBanner, StickyFooter } from '../components/ui';
import { FadeInUp, PressableScale } from '../components/motion';
import { ScreenHeader } from '../navigation';
import { SAMPLE_SITES, loadSampleBase64, sampleUri, type SampleSite } from '../lib/samples';
import { theme } from '../theme';

import brandmark from '../../assets/brandmark.png';

/**
 * 현장 사진 AI 분석 — 대기업/프리미엄 AI 파이프라인 UX
 * 사진 촬영/선택 → 소재 식별 + 철거 공정 안내 + 위험 경고.
 */

const CONFIDENCE_LABELS: Record<string, string> = { LOW: '참고', MEDIUM: '보통', HIGH: '높음' };

/**
 * 분석은 보통 10~20초 걸린다. 스피너만 돌면 멈춘 것처럼 보이므로,
 * 실제 파이프라인 단계를 순서대로 보여주고 경과 시간을 함께 노출한다.
 * (진행률을 지어내지 않는다 — 모델 응답 시점을 미리 알 수 없다.)
 */
const ANALYSIS_STAGES = [
  { at: 0, label: '현장 사진을 업로드하고 있어요' },
  { at: 3, label: 'AI 가 사진 속 소재를 살펴보는 중이에요' },
  { at: 8, label: '철거 공정과 위험요소를 정리하는 중이에요' },
  { at: 16, label: '거의 다 됐어요. 리포트를 마무리하는 중이에요' },
];

function AnalysisProgress() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const stage = [...ANALYSIS_STAGES].reverse().find((s) => elapsed >= s.at) ?? ANALYSIS_STAGES[0]!;
  return (
    <View style={styles.progressCard} accessibilityRole="progressbar" accessibilityLabel={stage.label}>
      <ActivityIndicator color={theme.colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.progressLabel}>{stage.label}</Text>
        <Text style={styles.progressMeta}>{elapsed}초 경과 · 보통 10~20초 걸려요</Text>
      </View>
    </View>
  );
}

/** kg 을 읽기 쉬운 단위로. 1톤 이상은 톤으로 끊는다(현장에서 쓰는 단위). */
function formatWeight(kg: number): string {
  if (kg >= 1000) {
    const t = kg / 1000;
    return `${t >= 10 ? Math.round(t) : Math.round(t * 10) / 10}톤`;
  }
  return `${Math.round(kg).toLocaleString('ko-KR')}kg`;
}


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
  /** 분석 중인 샘플 id(썸네일에 스피너 표시용). */
  const [sampleId, setSampleId] = useState<string | null>(null);
  /** 선택 입력 — 연면적(평)과 주구조. 넣으면 물량 추정이 붙는다. */
  const [pyeong, setPyeong] = useState('');
  const [structure, setStructure] = useState<BuildingStructure | null>(null);
  const [estimate, setEstimate] = useState<VolumeEstimate | null>(null);

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

  /** 입력된 평수를 ㎡ 로. 비었거나 숫자가 아니면 undefined(물량 추정 생략). */
  function floorAreaM2(): number | undefined {
    const v = Number(pyeong);
    return Number.isFinite(v) && v > 0 ? pyeongToM2(v) : undefined;
  }

  /**
   * 사진만 있으면 소재·공정만, 연면적까지 있으면 물량 추정(톤·트럭 대수)까지 한 번에.
   * 면적은 선택 입력이라 없어도 체험이 막히지 않는다.
   */
  async function runAnalysis(img: PickedImage) {
    const area = floorAreaM2();
    if (area === undefined) {
      setEstimate(null);
      setResult(await analyzeSite({ imageBase64: img.base64, mimeType: img.mimeType }));
      return;
    }
    const r = await analyzeSiteWasteItems({
      imageBase64: img.base64,
      mimeType: img.mimeType,
      floorAreaM2: area,
      ...(structure ? { structure } : {}),
    });
    setEstimate(r.estimate ?? null);
    setResult(r.analysis);
  }

  async function analyze() {
    if (!image) return;
    setError(null);
    setLoading(true);
    try {
      await runAnalysis(image);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '분석에 실패했어요. 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  /**
   * 샘플 현장 사진을 바로 분석한다 — 로그인·회원가입·사진 준비 없이 핵심 기능을 체험하는 경로.
   * 실제 업로드와 같은 API(analyzeSite)를 타므로 결과도 실제 AI 분석 결과다.
   */
  async function runSample(sample: SampleSite) {
    setError(null);
    setResult(null);
    setSampleId(sample.id);
    setLoading(true);
    try {
      const picked = await loadSampleBase64(sample);
      setImage(picked);
      await runAnalysis(picked);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : '샘플 분석에 실패했어요. 다시 시도해 주세요.',
      );
    } finally {
      setLoading(false);
      setSampleId(null);
    }
  }

  function openLegal(page: 'privacy' | 'terms') {
    void Linking.openURL(`/${page}.html`);
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
                <Text style={styles.heroCardBadgeText}>비전 AI 실시간 분석</Text>
              </View>
              <Text style={styles.heroEngineTag}>다중 모델 폴백 구조</Text>
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
            <View style={styles.noLoginRow}>
              <AppIcon name="sparkles" size={14} color="#34D399" />
              <Text style={styles.noLoginText}>
                회원가입·로그인 없이 모든 기능을 바로 쓸 수 있어요
              </Text>
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
            </View>
          </FadeInUp>
        )}

        {/* 현장 사진이 없어도 바로 체험 — 실제 철거 현장 샘플을 같은 AI 파이프라인으로 분석 */}
        {!image ? (
          <FadeInUp delay={100}>
            <View style={styles.sampleSection}>
              <View style={styles.sampleHeadRow}>
                <AppIcon name="sparkles" size={18} color={theme.colors.primary} />
                <Text style={styles.sampleHeadTitle}>사진이 없으신가요? 바로 체험해 보세요</Text>
              </View>
              <Text style={styles.sampleHeadSub}>
                실제 철거 현장 사진입니다. 누르면 즉시 AI 분석이 실행됩니다.
              </Text>
              <View style={styles.sampleRow}>
                {SAMPLE_SITES.map((s) => (
                  <PressableScale
                    key={s.id}
                    style={styles.sampleCard}
                    onPress={() => void runSample(s)}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.label} 샘플 사진으로 AI 분석 실행`}
                  >
                    <View style={styles.sampleThumbWrap}>
                      <Image
                        source={{ uri: sampleUri(s) }}
                        style={styles.sampleThumb}
                        resizeMode="cover"
                      />
                      {sampleId === s.id ? (
                        <View style={styles.sampleThumbOverlay}>
                          <Text style={styles.sampleThumbOverlayText}>분석 중…</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.sampleCardTitle} numberOfLines={1}>
                      {s.label}
                    </Text>
                    <Text style={styles.sampleCardSub} numberOfLines={2}>
                      {s.description}
                    </Text>
                  </PressableScale>
                ))}
              </View>
              <Text style={styles.sampleCredit}>
                샘플 사진 © {SAMPLE_SITES.map((s) => s.credit).join(' · ')}
              </Text>
            </View>
          </FadeInUp>
        ) : null}

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

        {image && !loading ? (
          <FadeInUp delay={60}>
            <View style={styles.areaCard}>
              <Text style={styles.areaTitle}>연면적을 알면 물량까지 추정해 드려요</Text>
              <Text style={styles.areaSub}>
                {result
                  ? '연면적을 넣고 다시 분석하면 예상 톤수와 트럭 대수까지 나옵니다.'
                  : '선택 입력이에요. 비워두면 소재·공정 분석만 진행합니다.'}
              </Text>
              <View style={styles.areaInputRow}>
                <TextInput
                  style={styles.areaInput}
                  value={pyeong}
                  onChangeText={setPyeong}
                  keyboardType="numeric"
                  inputMode="numeric"
                  placeholder="예: 40"
                  placeholderTextColor={theme.colors.textMuted}
                  accessibilityLabel="연면적(평) 입력"
                />
                <Text style={styles.areaUnit}>평</Text>
              </View>
              <Text style={styles.areaStructLabel}>주구조 (선택하면 추정이 정밀해져요)</Text>
              <View style={styles.structRow}>
                {(['RC', 'BRICK', 'WOOD'] as BuildingStructure[]).map((k) => {
                  const on = structure === k;
                  return (
                    <PressableScale
                      key={k}
                      style={[styles.structChip, on && styles.structChipOn]}
                      onPress={() => setStructure(on ? null : k)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.structChipText, on && styles.structChipTextOn]}>
                        {BUILDING_STRUCTURE_LABELS[k]}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            </View>
          </FadeInUp>
        ) : null}

        <ErrorBanner message={error} />

        {loading ? <AnalysisProgress /> : null}

        {result ? <AnalysisResult result={result} estimate={estimate} /> : null}

        {/* 로그인이 없어도 수집·이용 고지는 제공한다(사진은 분석 즉시 폐기, 저장하지 않음). */}
        <View style={styles.legalFooter}>
          <Text style={styles.legalNotice}>
            업로드한 사진은 분석에만 사용하고 서버에 저장하지 않습니다. 회원가입·로그인 없이
            이용할 수 있습니다.
          </Text>
          <View style={styles.legalLinks}>
            <Text style={styles.legalLink} onPress={() => openLegal('privacy')}>
              개인정보처리방침
            </Text>
            <Text style={styles.legalDot}>·</Text>
            <Text style={styles.legalLink} onPress={() => openLegal('terms')}>
              이용약관
            </Text>
          </View>
        </View>
      </ScrollView>

      {image ? (
        <StickyFooter>
          <AppButton
            label={result ? '면적 반영해 다시 분석' : '이 사진 분석하기'}
            onPress={analyze}
            loading={loading}
          />
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

function MaterialRow({ m, maxKg }: { m: DetectedMaterial; maxKg: number }) {
  // 비중 막대는 가장 무거운 소재를 100% 로 둔 상대 크기. 색은 위험물만 구분하고,
  // 오른쪽 태그 텍스트가 같은 정보를 글로도 주므로 색만으로 판단하게 두지 않는다.
  const share = maxKg > 0 && m.estimatedKg ? Math.max(0.04, m.estimatedKg / maxKg) : 0;
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
      {m.estimatedKg ? (
        <View style={styles.weightRow}>
          <View style={styles.weightTrack}>
            <View
              style={[
                styles.weightFill,
                { width: `${share * 100}%` },
                m.hazardous && styles.weightFillHazard,
              ]}
            />
          </View>
          <Text style={[styles.weightValue, m.hazardous && styles.weightValueHazard]}>
            {formatWeight(m.estimatedKg)}
          </Text>
        </View>
      ) : null}
      <Text style={styles.materialMeta}>
        {MATERIAL_CATEGORY_LABELS[m.category]} · 신뢰도 {CONFIDENCE_LABELS[m.confidence] ?? m.confidence}
        {m.note ? ` · ${m.note}` : ''}
      </Text>
    </View>
  );
}

/** 연면적 기반 물량 추정 — 현장에서 실제로 필요한 "몇 톤, 트럭 몇 대"를 보여준다. */
function VolumeEstimateCard({ estimate }: { estimate: VolumeEstimate }) {
  return (
    <View style={styles.estimateCard}>
      <View style={styles.estimateHead}>
        <AppIcon name="recycle" size={18} color={theme.colors.primary} />
        <Text style={styles.estimateTitle}>연면적 기반 물량 추정</Text>
        <View style={styles.estimateConfChip}>
          <Text style={styles.estimateConfText}>
            신뢰도 {CONFIDENCE_LABELS[estimate.confidence] ?? estimate.confidence}
          </Text>
        </View>
      </View>

      <Text style={styles.estimateHero}>{estimate.estimatedTons}톤</Text>
      <Text style={styles.estimateRange}>
        예상 범위 {estimate.rangeMinTons}~{estimate.rangeMaxTons}톤 · 연면적{' '}
        {Math.round(estimate.floorAreaM2).toLocaleString('ko-KR')}㎡
      </Text>

      <View style={styles.truckRow}>
        {estimate.truckLoads.map((t) => (
          <View key={t.capacityTons} style={styles.truckTile}>
            <Text style={styles.truckLabel}>{t.capacityTons}톤 트럭</Text>
            <Text style={styles.truckCount}>{t.count}대</Text>
          </View>
        ))}
      </View>

      <Text style={styles.estimateNote}>{estimate.disclaimer}</Text>
    </View>
  );
}

/** 결과 상단 요약 지표 — 차트가 아니라 수치 타일이 맞는 자리(값 3개, 비교 아님). */
function ResultStats({ materials }: { materials: DetectedMaterial[] }) {
  const totalKg = materials.reduce((sum, m) => sum + (m.estimatedKg ?? 0), 0);
  const recyclableKg = materials
    .filter((m) => m.recyclable && !m.hazardous)
    .reduce((sum, m) => sum + (m.estimatedKg ?? 0), 0);
  const hazardCount = materials.filter((m) => m.hazardous).length;
  if (totalKg <= 0) return null;
  return (
    <View style={styles.statRow}>
      <View style={styles.statTile}>
        <Text style={styles.statLabel}>예상 폐기물 총량</Text>
        <Text style={styles.statValue}>{formatWeight(totalKg)}</Text>
      </View>
      <View style={styles.statTile}>
        <Text style={styles.statLabel}>재활용 가능</Text>
        <Text style={styles.statValue}>{Math.round((recyclableKg / totalKg) * 100)}%</Text>
      </View>
      <View style={styles.statTile}>
        <Text style={styles.statLabel}>위험물 항목</Text>
        <Text style={[styles.statValue, hazardCount > 0 && styles.statValueHazard]}>
          {hazardCount}건
        </Text>
      </View>
    </View>
  );
}

function AnalysisResult({ result, estimate }: { result: SiteAnalysis; estimate: VolumeEstimate | null }) {
  const maxKg = Math.max(0, ...result.materials.map((m) => m.estimatedKg ?? 0));
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

      <FadeInUp delay={70}>
        <ResultStats materials={result.materials} />
      </FadeInUp>

      {estimate ? (
        <FadeInUp delay={90}>
          <VolumeEstimateCard estimate={estimate} />
        </FadeInUp>
      ) : null}

      <Text style={styles.sectionTitle}>구성 소재 ({result.materials.length})</Text>
      <FadeInUp delay={100}>
        <Card>
          {result.materials.map((m, i) => (
            <View key={`${m.name}-${i}`}>
              {i > 0 ? <View style={styles.divider} /> : null}
              <MaterialRow m={m} maxKg={maxKg} />
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
  /* 로그인 없이 체험 고지 */
  noLoginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    borderTopColor: 'rgba(255,255,255,0.12)',
    borderTopWidth: 1,
    paddingTop: spacing.sm,
  },
  noLoginText: {
    color: '#A7F3D0',
    fontSize: 12,
    fontWeight: '700',
  },

  /* 샘플 체험 섹션 */
  sampleSection: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sampleHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sampleHeadTitle: {
    color: colors.text,
    fontSize: font.bodyLarge,
    fontWeight: '800',
    flexShrink: 1,
  },
  sampleHeadSub: {
    color: colors.textMuted,
    fontSize: font.body - 2,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  sampleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sampleCard: {
    flex: 1,
  },
  sampleThumbWrap: {
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sampleThumb: {
    width: '100%',
    height: 78,
  },
  sampleThumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sampleThumbOverlayText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  sampleCardTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 6,
  },
  sampleCardSub: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  sampleCredit: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: spacing.sm,
  },

  /* 연면적 입력 카드 */
  areaCard: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  areaTitle: { color: colors.text, fontSize: font.bodyLarge, fontWeight: '800' },
  areaSub: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  areaInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  areaInput: {
    flex: 1,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: radius.button,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    fontSize: font.bodyLarge,
    color: colors.text,
    backgroundColor: colors.background,
  },
  areaUnit: { color: colors.text, fontSize: font.bodyLarge, fontWeight: '700' },
  areaStructLabel: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
  structRow: { flexDirection: 'row', gap: spacing.xs, marginTop: 6 },
  structChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  structChipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  structChipText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  structChipTextOn: { color: colors.primary },

  /* 물량 추정 결과 카드 */
  estimateCard: {
    backgroundColor: '#0F172A',
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  estimateHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  estimateTitle: { color: '#F8FAFC', fontSize: font.body, fontWeight: '800', flex: 1 },
  estimateConfChip: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  estimateConfText: { color: '#93C5FD', fontSize: 11, fontWeight: '700' },
  estimateHero: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '800',
    marginTop: spacing.sm,
    letterSpacing: -0.5,
  },
  estimateRange: { color: '#94A3B8', fontSize: 13, marginTop: 2 },
  truckRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  truckTile: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  truckLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  truckCount: { color: '#F8FAFC', fontSize: 20, fontWeight: '800', marginTop: 2 },
  estimateNote: {
    color: '#64748B',
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
  },

  /* 분석 진행 안내 */
  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  progressLabel: {
    color: colors.text,
    fontSize: font.body,
    fontWeight: '700',
  },
  progressMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },

  /* 소재별 추정 중량 */
  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 6,
  },
  weightTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  weightFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  weightFillHazard: {
    backgroundColor: colors.error,
  },
  weightValue: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    minWidth: 56,
    textAlign: 'right',
  },
  weightValueHazard: {
    color: colors.error,
  },

  /* 결과 요약 수치 타일 */
  statRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  statTile: {
    flex: 1,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  statValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  statValueHazard: {
    color: colors.error,
  },

  /* 법적 고지 푸터 */
  legalFooter: {
    marginTop: spacing.lg,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.md,
    alignItems: 'center',
  },
  legalNotice: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  legalLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.sm,
  },
  legalLink: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  legalDot: {
    color: colors.textMuted,
    fontSize: 12,
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
