import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
import { CONTENT_MAX_WIDTH, theme } from '../theme';

import brandmark from '../../assets/brandmark.png';

/**
 * 현장 사진 AI 분석 — 대기업/프리미엄 AI 파이프라인 UX
 * 사진 촬영/선택 → 소재 식별 + 철거 공정 안내 + 위험 경고.
 */

const CONFIDENCE_LABELS: Record<string, string> = { LOW: '참고', MEDIUM: '보통', HIGH: '높음' };

/** 한 번에 종합 분석할 수 있는 최대 장수(서버 MAX_ANALYZE_IMAGES 와 맞춘다). */
const MAX_PHOTOS = 6;

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

/**
 * 분석 결과를 그대로 옮겨 쓸 수 있는 텍스트로 만든다.
 * 현장에서는 이 내용을 철거 업체나 담당자에게 메시지로 보내는 일이 실제 업무라,
 * 화면에서 눈으로 읽는 것만으로는 끝나지 않는다.
 */
function buildReportText(result: SiteAnalysis, estimate: VolumeEstimate | null): string {
  const lines: string[] = ['[디몰비전 현장 분석 리포트]', '', result.summary, ''];

  if (estimate) {
    lines.push(
      '■ 물량 추정',
      `- 예상 폐기물: ${estimate.estimatedTons}톤 (범위 ${estimate.rangeMinTons}~${estimate.rangeMaxTons}톤)`,
      `- 연면적: ${Math.round(estimate.floorAreaM2).toLocaleString('ko-KR')}㎡`,
      `- 운반 차량: ${estimate.truckLoads.map((t) => `${t.capacityTons}톤 ${t.count}대`).join(' / ')}`,
      '',
    );
  }

  lines.push('■ 구성 소재');
  for (const m of result.materials) {
    const tag = m.hazardous ? '위험물' : m.recyclable ? '재활용 가능' : '일반 처리';
    const kg = m.estimatedKg ? ` · 약 ${formatWeight(m.estimatedKg)}` : '';
    lines.push(`- ${m.name} (${tag}${kg})${m.note ? ` — ${m.note}` : ''}`);
  }

  lines.push('', '■ 권장 철거 공정');
  for (const step of result.demolitionSteps) {
    lines.push(`${step.order}. ${step.title} — ${step.description}`);
    if (step.caution) lines.push(`   ※ 주의: ${step.caution}`);
  }

  if (result.hazards.length > 0) {
    lines.push('', '■ 안전 위험요소');
    for (const h of result.hazards) lines.push(`- ${h}`);
  }

  lines.push(
    '',
    result.disclaimer,
    '',
    `분석: 디몰비전 (${result.method === 'AI_VISION' ? 'AI 실시간 분석' : '시연용 샘플'}) · https://dimolvision.vercel.app`,
  );
  return lines.join('\n');
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
  /**
   * 현장 사진들. 가이드 촬영은 전경·근접·지붕·위험부위를 순서대로 모으고,
   * API 는 여러 장을 한 번에 종합 분석한다(한 장에서만 보이는 소재도 놓치지 않도록).
   */
  const [images, setImages] = useState<PickedImage[]>([]);
  const [result, setResult] = useState<SiteAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  /** 분석 중인 샘플 id(썸네일에 스피너 표시용). */
  const [sampleId, setSampleId] = useState<string | null>(null);
  /** 선택 입력 — 연면적(평)과 주구조. 넣으면 물량 추정이 붙는다. */
  const [pyeong, setPyeong] = useState('');
  const [structure, setStructure] = useState<BuildingStructure | null>(null);
  /** 건축년도(사용승인). 2009년 석면 사용 금지 이전이면 AI 가 석면 의심을 가중한다. */
  const [buildYear, setBuildYear] = useState('');
  const [estimate, setEstimate] = useState<VolumeEstimate | null>(null);

  function applyAssets(assets: ImagePicker.ImagePickerAsset[]) {
    const picked = assets
      .filter((a) => a.base64)
      .map((a) => ({
        base64: a.base64!,
        mimeType: a.mimeType ?? mimeFromUri(a.uri),
        uri: a.uri,
      }));
    if (picked.length === 0) {
      setError('사진을 불러오지 못했어요. 다시 시도해 주세요.');
      return;
    }
    setResult(null);
    setError(null);
    setImages((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
  }

  // 가이드 촬영으로 모은 사진을 전부 받는다 — 순서(전경·근접·지붕·위험부위)가 분석 품질을 만든다.
  function handleCameraCapture(photos: CapturedPhoto[]) {
    if (photos.length === 0) return;
    setResult(null);
    setError(null);
    setImages((prev) => [...prev, ...photos].slice(0, MAX_PHOTOS));
    setCameraOpen(false);
  }

  async function pickFromLibrary() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.5,
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS,
    });
    if (!res.canceled && res.assets.length > 0) applyAssets(res.assets);
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
  /** 입력된 건축년도. 1900~올해 범위만 힌트로 쓴다. */
  function buildingYear(): number | undefined {
    const y = Number(buildYear);
    const now = new Date().getFullYear();
    return Number.isInteger(y) && y >= 1900 && y <= now ? y : undefined;
  }

  async function runAnalysis(shots: PickedImage[]) {
    const payload = shots.map((i) => ({ imageBase64: i.base64, mimeType: i.mimeType }));
    const area = floorAreaM2();
    const year = buildingYear();
    if (area === undefined) {
      setEstimate(null);
      setResult(await analyzeSite({ images: payload, ...(year ? { buildingYear: year } : {}) }));
      return;
    }
    const r = await analyzeSiteWasteItems({
      images: payload,
      floorAreaM2: area,
      ...(structure ? { structure } : {}),
      ...(year ? { buildingYear: year } : {}),
    });
    setEstimate(r.estimate ?? null);
    setResult(r.analysis);
  }

  async function analyze() {
    if (images.length === 0) return;
    setError(null);
    setLoading(true);
    try {
      await runAnalysis(images);
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
      setImages([picked]);
      await runAnalysis([picked]);
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
              현장 사진을 올리면{'\n'}소재·공정·물량을 한 번에 분석해요
            </Text>
            <View style={styles.heroChipsRow}>
              <View style={styles.heroChip}>
                <AppIcon name="alert" size={13} color="#93C5FD" />
                <Text style={styles.heroChipText}>석면·위험물 식별</Text>
              </View>
              <View style={styles.heroChip}>
                <AppIcon name="recycle" size={13} color="#93C5FD" />
                <Text style={styles.heroChipText}>물량·트럭 대수 추정</Text>
              </View>
              <View style={styles.heroChip}>
                <AppIcon name="document" size={13} color="#93C5FD" />
                <Text style={styles.heroChipText}>여러 장 종합 분석</Text>
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

        {/* 현장 사진이 없어도 바로 체험 — 실제 철거 현장 샘플을 같은 AI 파이프라인으로 분석 */}
        {images.length === 0 ? (
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

        {images.length > 0 ? (
          <FadeInUp>
            <View style={styles.previewContainer}>
              <Image source={{ uri: images[0]!.uri }} style={styles.preview} resizeMode="cover" />
              {images.length > 1 ? (
                <View style={styles.multiBadge}>
                  <AppIcon name="sparkles" size={13} color="#FFFFFF" />
                  <Text style={styles.multiBadgeText}>{images.length}장 종합 분석</Text>
                </View>
              ) : null}
              <PressableScale style={styles.repickChip} onPress={() => setImages([])}>
                <AppIcon name="recycle" size={16} color="#FFFFFF" />
                <Text style={styles.repickChipText}>다시 선택</Text>
              </PressableScale>
            </View>

            {images.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.thumbStrip}
              >
                {images.map((img, i) => (
                  <View key={`${img.uri}-${i}`} style={styles.thumbWrap}>
                    <Image source={{ uri: img.uri }} style={styles.thumb} resizeMode="cover" />
                    <PressableScale
                      style={styles.thumbRemove}
                      onPress={() => setImages((prev) => prev.filter((_, k) => k !== i))}
                      accessibilityRole="button"
                      accessibilityLabel={`${i + 1}번째 사진 빼기`}
                    >
                      <Text style={styles.thumbRemoveText}>✕</Text>
                    </PressableScale>
                  </View>
                ))}
              </ScrollView>
            ) : null}

            {images.length < MAX_PHOTOS ? (
              <Text style={styles.addMoreHint}>
                각도를 바꿔 더 찍으면 정확도가 올라가요 — 전경 · 벽/바닥 근접 · 지붕 · 위험 부위
                (최대 {MAX_PHOTOS}장)
              </Text>
            ) : null}
          </FadeInUp>
        ) : (
          /* 모던 AI 드롭존 영역 */
          <FadeInUp delay={80}>
            <View style={styles.dropzone}>
              <View style={styles.iconCircle}>
                <Image source={brandmark} style={styles.dropzoneLogo} resizeMode="contain" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dropzoneTitle}>직접 찍은 현장 사진도 분석해요</Text>
                <Text style={styles.dropzoneSub}>
                  건물 내부·지붕·자재가 잘 보이게 찍을수록 정확해집니다
                </Text>
              </View>
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
              <Text style={styles.actionCardTitle}>
                {images.length > 0 ? '사진 추가 촬영' : '카메라 촬영'}
              </Text>
              <Text style={styles.actionCardSub}>가이드 따라 여러 장</Text>
            </PressableScale>
            
            <View style={{ width: theme.spacing.sm }} />

            <PressableScale style={styles.actionCard} onPress={pickFromLibrary} accessibilityRole="button">
              <View style={styles.actionIconCircle}>
                <AppIcon name="document" size={26} color={theme.colors.primary} />
              </View>
              <Text style={styles.actionCardTitle}>앨범에서 선택</Text>
              <Text style={styles.actionCardSub}>여러 장 선택 가능</Text>
            </PressableScale>
          </View>
        </FadeInUp>

        {images.length > 0 && !loading ? (
          <FadeInUp delay={60}>
            <View style={styles.areaCard}>
              <Text style={styles.areaTitle}>건물 정보를 알면 더 정확해져요</Text>
              <Text style={styles.areaSub}>
                {result
                  ? '연면적·건축년도를 넣고 다시 분석하면 물량과 석면 위험까지 정밀해집니다.'
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
              <View style={styles.areaInputRow}>
                <TextInput
                  style={styles.areaInput}
                  value={buildYear}
                  onChangeText={setBuildYear}
                  keyboardType="numeric"
                  inputMode="numeric"
                  placeholder="예: 1995"
                  placeholderTextColor={theme.colors.textMuted}
                  accessibilityLabel="건축년도(사용승인) 입력"
                />
                <Text style={styles.areaUnit}>년</Text>
              </View>
              {buildingYear() !== undefined && buildingYear()! < 2009 ? (
                <Text style={styles.yearHint}>
                  2009년 석면 사용 금지 이전 건축물이라 석면 의심 자재를 중점 확인합니다
                </Text>
              ) : null}

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

      {images.length > 0 ? (
        <StickyFooter>
          <AppButton
            label={
              result
                ? '면적 반영해 다시 분석'
                : images.length > 1
                  ? `${images.length}장 종합 분석하기`
                  : '이 사진 분석하기'
            }
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

/** HTML 특수문자 이스케이프 — 분석 결과에 <, & 가 섞여도 문서가 깨지지 않게. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 인쇄용 문서를 새 창에 그린다.
 * 화면을 그대로 인쇄하면 앱 UI(버튼·스크롤 영역)가 섞여 서류로 못 쓴다.
 * 철거 현장에서는 이 리포트를 출력해 보관하거나 PDF 로 저장해 발주처에 내므로,
 * 인쇄 전용 레이아웃을 따로 만든다.
 */
function buildPrintableHtml(result: SiteAnalysis, estimate: VolumeEstimate | null): string {
  const e = escapeHtml;
  const rows = result.materials
    .map((m) => {
      const tag = m.hazardous ? '위험물' : m.recyclable ? '재활용 가능' : '일반 처리';
      return `<tr${m.hazardous ? ' class="hz"' : ''}>
        <td>${e(m.name)}</td>
        <td>${e(MATERIAL_CATEGORY_LABELS[m.category] ?? m.category)}</td>
        <td>${tag}</td>
        <td class="num">${m.estimatedKg ? e(formatWeight(m.estimatedKg)) : '-'}</td>
        <td>${e(CONFIDENCE_LABELS[m.confidence] ?? m.confidence)}</td>
      </tr>`;
    })
    .join('');

  const steps = result.demolitionSteps
    .map(
      (st) =>
        `<li><b>${e(st.title)}</b><br>${e(st.description)}${
          st.caution ? `<br><span class="cau">주의: ${e(st.caution)}</span>` : ''
        }</li>`,
    )
    .join('');

  const estBlock = estimate
    ? `<div class="box">
        <h2>물량 추정</h2>
        <p class="hero">${estimate.estimatedTons}톤
          <span class="sub">(범위 ${estimate.rangeMinTons}~${estimate.rangeMaxTons}톤 · 연면적 ${Math.round(
            estimate.floorAreaM2,
          ).toLocaleString('ko-KR')}㎡)</span></p>
        <p>운반 차량: ${estimate.truckLoads.map((t) => `${t.capacityTons}톤 ${t.count}대`).join(' / ')}</p>
      </div>`
    : '';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>디몰비전 현장 분석 리포트</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;
       color:#1A1A1A;line-height:1.6;margin:0;padding:32px;max-width:900px}
  h1{font-size:22px;margin:0 0 4px}
  .meta{color:#595959;font-size:12px;margin:0 0 20px}
  h2{font-size:15px;margin:22px 0 8px;padding-bottom:6px;border-bottom:2px solid #2C55E9}
  .box{background:#F6F7F9;border:1px solid #DCE3F0;border-radius:8px;padding:14px 16px;margin:16px 0}
  .box h2{margin-top:0;border:0;padding:0}
  .hero{font-size:26px;font-weight:800;margin:4px 0}
  .hero .sub{font-size:12px;font-weight:400;color:#595959}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{border:1px solid #DCE3F0;padding:7px 9px;text-align:left}
  th{background:#F6F7F9}
  td.num{text-align:right}
  tr.hz td{background:#FDF2F2;color:#C62828;font-weight:600}
  ol{padding-left:20px}
  li{margin-bottom:9px}
  .cau{color:#C62828;font-size:12px}
  .hazards li{color:#C62828}
  .note{margin-top:22px;padding-top:12px;border-top:1px solid #DCE3F0;color:#595959;font-size:11px}
  @media print{body{padding:0}@page{margin:14mm}}
</style></head><body>
<h1>철거 현장 분석 리포트</h1>
<p class="meta">디몰비전(DimolVision) · ${new Date(result.analyzedAt).toLocaleString('ko-KR')} ·
  ${result.method === 'AI_VISION' ? 'AI 실시간 분석' : '시연용 샘플'}</p>
<div class="box"><h2>현장 요약</h2><p>${e(result.summary)}</p></div>
${estBlock}
<h2>구성 소재 (${result.materials.length})</h2>
<table><thead><tr><th>소재</th><th>분류</th><th>처리</th><th>추정 중량</th><th>신뢰도</th></tr></thead>
<tbody>${rows}</tbody></table>
<h2>권장 철거 공정</h2><ol>${steps}</ol>
${result.hazards.length ? `<h2>안전 위험요소</h2><ul class="hazards">${result.hazards.map((h) => `<li>${e(h)}</li>`).join('')}</ul>` : ''}
<p class="note">${e(result.disclaimer)}<br>https://dimolvision.vercel.app</p>
</body></html>`;
}

/**
 * 리포트 내보내기. 웹은 클립보드, 네이티브는 기본 공유 시트 — 새 의존성 없이
 * 각 플랫폼이 이미 가진 수단만 쓴다.
 */
function ShareReportButton({
  result,
  estimate,
}: {
  result: SiteAnalysis;
  estimate: VolumeEstimate | null;
}) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const text = buildReportText(result, estimate);
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2400);
      } else {
        await Share.share({ message: text });
      }
    } catch {
      // 클립보드 권한 거부 등 — 조용히 무시한다(결과 화면은 그대로 남아 있다).
    }
  }

  function handlePrint() {
    const w = window.open('', '_blank');
    if (!w) return; // 팝업 차단 — 복사 버튼이 대안으로 남아 있다.
    w.document.write(buildPrintableHtml(result, estimate));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  return (
    <View style={styles.exportRow}>
      <PressableScale
        style={styles.shareBtn}
        onPress={() => void handleShare()}
        accessibilityRole="button"
        accessibilityLabel="분석 리포트 내보내기"
      >
        <AppIcon name="document" size={16} color={theme.colors.primary} />
        <Text style={styles.shareBtnText}>
          {copied ? '복사했어요' : Platform.OS === 'web' ? '리포트 복사' : '리포트 공유'}
        </Text>
      </PressableScale>

      {Platform.OS === 'web' ? (
        <PressableScale
          style={styles.shareBtn}
          onPress={handlePrint}
          accessibilityRole="button"
          accessibilityLabel="분석 리포트 인쇄 또는 PDF 저장"
        >
          <AppIcon name="document" size={16} color={theme.colors.primary} />
          <Text style={styles.shareBtnText}>인쇄 · PDF</Text>
        </PressableScale>
      ) : null}
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

      <ShareReportButton result={result} estimate={estimate} />

      <Text style={styles.disclaimer}>{result.disclaimer}</Text>
    </View>
  );
}

const { colors, font, spacing, radius } = theme;

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
    // 넓은 화면에서 카드가 끝까지 늘어나지 않게 — 모바일 레이아웃을 그대로 가운데 정렬한다.
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F8FAFC',
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  dropzoneLogo: {
    width: 30,
    height: 30,
  },
  dropzoneTitle: {
    color: colors.text,
    fontSize: font.body,
    fontWeight: '800',
    marginBottom: 2,
  },
  dropzoneSub: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
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
    aspectRatio: 4 / 3,
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

  exportRow: { flexDirection: 'row', gap: spacing.xs },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  shareBtnText: { color: colors.primary, fontSize: font.body, fontWeight: '800' },

  multiBadge: {
    position: 'absolute',
    left: 12,
    top: 12,
    backgroundColor: 'rgba(37,99,235,0.92)',
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  multiBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  thumbStrip: { gap: spacing.xs, paddingBottom: spacing.xs },
  thumbWrap: { position: 'relative' },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumbRemove: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(15,23,42,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  addMoreHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.md,
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
  yearHint: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginTop: 6,
  },
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
