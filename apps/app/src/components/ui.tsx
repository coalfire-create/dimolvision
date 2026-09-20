import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SUPPORT_PHONE, SUPPORT_PHONE_TEL_URL } from '@dimol/shared';
import { CONTENT_MAX_WIDTH, statusColor, theme } from '../theme';
import { PressableScale, usePressScale } from './motion';
import brandmark from '../../assets/brandmark.png';
import { AppIcon, type IconName } from './AppIcon';

/**
 * 우하단 고객센터 플로팅 버튼 — 주요 화면 위에 떠 있는 원형 문의 버튼.
 * 기본 동작은 고객센터 전화 연결(tel:). onPress 를 주면 문의 폼·채팅 등으로 교체할 수 있다.
 */
export function FloatingSupportButton({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`고객센터 문의 ${SUPPORT_PHONE}`}
      onPress={onPress ?? (() => Linking.openURL(SUPPORT_PHONE_TEL_URL))}
      style={styles.fab}
    >
      <AppIcon name="chat" size={24} color="#FFFFFF" />
    </Pressable>
  );
}

/**
 * 빈 이미지 자리 placeholder — 이미지가 없을 때 회색 빈칸 대신 비움 로고를 노출한다.
 * 사진 업로드 전 미리보기 자리 등 "빈 이미지 자리"의 기본값으로 재사용한다.
 */
export function ImagePlaceholder({
  height = 220,
  label,
  children,
}: {
  height?: number;
  label?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.imagePlaceholder, { height }]}>
      <Image source={brandmark} style={styles.imagePlaceholderLogo} resizeMode="contain" />
      {label ? <Text style={styles.imagePlaceholderLabel}>{label}</Text> : null}
      {children}
    </View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * 공용 UI 컴포넌트 — 고령 사용자 접근성 기준을 컴포넌트 차원에서 강제한다.
 * (글자 18px+, 버튼 48px+, 여백 8px 배수, 메인+보조 2색)
 * 화면에서는 RN 기본 Button/TextInput 을 직접 쓰지 않고 이것만 쓴다.
 */

const { colors, font, spacing, touch, radius } = theme;

// ── 버튼
export interface AppButtonProps {
  label: string;
  onPress: () => void;
  /** primary: 핵심 동작(큰 버튼) / outline: 보조 동작 / danger: 취소·삭제 */
  variant?: 'primary' | 'outline' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: AppButtonProps) {
  const isPrimary = variant === 'primary';
  const { scale, onPressIn, onPressOut } = usePressScale();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[
        styles.button,
        isPrimary && styles.buttonPrimary,
        isPrimary && theme.shadow.primary,
        variant === 'outline' && styles.buttonOutline,
        variant === 'danger' && styles.buttonDanger,
        (disabled || loading) && styles.buttonDisabled,
        { transform: [{ scale }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.background : colors.primary} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            isPrimary && { color: colors.background },
            variant === 'outline' && { color: colors.primary },
            variant === 'danger' && { color: colors.error },
          ]}
        >
          {label}
        </Text>
      )}
    </AnimatedPressable>
  );
}

// ── 카드
export function Card({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <PressableScale accessibilityRole="button" onPress={onPress} style={[styles.card, style]}>
      {children}
    </PressableScale>
  );
}

// ── 상태 배지
export function StatusBadge({ status, label }: { status: string; label: string }) {
  const palette = statusColor(status);
  return (
    <View style={[styles.badge, { backgroundColor: palette.background }]}>
      <Text style={[styles.badgeText, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

// ── 입력 필드 (라벨 + 인풋)
export interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
}

export function Field({ label, hint, style, onFocus, onBlur, ...inputProps }: FieldProps) {
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.fieldInput, focused && styles.fieldInputFocused, style]}
        {...inputProps}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// ── 섹션 제목 (작고 절제된 라벨 톤)
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// ── 하단 고정 CTA 바 (결제/접수 등 핵심 동작을 화면 하단에 고정)
export function StickyFooter({ children }: { children: React.ReactNode }) {
  // 넓은 화면에서 버튼이 화면 끝까지 늘어나지 않도록 본문과 같은 폭으로 묶는다.
  return (
    <View style={styles.stickyFooter}>
      <View style={styles.stickyFooterInner}>{children}</View>
    </View>
  );
}

// ── 라벨-값 행 (상세 화면용)
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ── 오류 배너 (서버 한글 메시지 그대로 노출)
export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

// ── 로딩 / 빈 목록
export function LoadingView() {
  return (
    <View style={styles.centerFill}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: IconName | string;
}) {
  const isIconName =
    icon &&
    (['notifications', 'document', 'truck', 'building', 'home', 'requests', 'mypage', 'tools', 'check', 'star', 'settings', 'phone', 'sparkles', 'camera', 'chat', 'alert', 'recycle', 'hammer', 'lock'].includes(icon) ||
      icon.length > 2);
  return (
    <View style={styles.centerFill}>
      {icon ? (
        <View style={styles.emptyIconCircle}>
          {isIconName ? (
            <AppIcon name={(icon as IconName) || 'document'} size={28} color={colors.primary} />
          ) : (
            <Text style={styles.emptyIcon}>{icon}</Text>
          )}
        </View>
      ) : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      {description ? <Text style={styles.emptyDescription}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.md,
    bottom: 96, // 하단 탭바 위로 띄운다.
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    ...theme.shadow.floating, // primary 대신 floating 그림자 사용
  },
  fabIcon: {
    fontSize: 26,
  },
  imagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    width: '100%',
  },
  imagePlaceholderLogo: {
    width: 120,
    height: 96,
    opacity: 0.9,
    marginBottom: spacing.sm,
  },
  imagePlaceholderLabel: {
    color: colors.textMuted,
    fontSize: font.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    borderRadius: radius.button,
    height: touch.minButtonHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    // 보조 버튼에도 옅은 입체감 추가
    ...theme.shadow.card,
    shadowOpacity: 0.02,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
    height: touch.primaryButtonHeight,
  },
  buttonOutline: {
    backgroundColor: colors.background,
    borderColor: colors.primary,
    borderWidth: 2,
  },
  buttonDanger: {
    backgroundColor: colors.background,
    borderColor: colors.error,
    borderWidth: 2,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    fontSize: font.bodyLarge,
    fontWeight: '800', // 토스처럼 훨씬 굵게
  },
  card: {
    backgroundColor: colors.background, // 카드 배경은 흰색 (또는 서페이스에 따라)
    borderRadius: radius.card,
    borderWidth: 0, // 보더 완전 제거
    marginBottom: spacing.md, // 카드 간격 더 넓게
    padding: spacing.lg,
    // 그림자 제거, 플랫한 디자인
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.badge,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  badgeText: {
    fontSize: font.body,
    fontWeight: '700',
  },
  fieldLabel: {
    color: colors.text,
    fontSize: font.body,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  fieldInput: {
    backgroundColor: colors.surface, // 토스 스타일의 옅은 회색 배경
    borderRadius: radius.button,
    borderWidth: 0, // 보더 완전 제거
    color: colors.text,
    fontSize: font.bodyLarge,
    minHeight: touch.primaryButtonHeight,
    paddingHorizontal: spacing.md,
  },
  fieldInputFocused: {
    backgroundColor: colors.surface, // 포커스 시 배경색 유지 (경우에 따라 약간 어둡게 하기도 함)
    borderWidth: 0,
    // 토스는 포커스 상태를 굳이 강하게 주지 않거나 보더만 살짝 줌. 여기서는 심플하게 유지.
  },
  fieldHint: {
    color: colors.textMuted,
    fontSize: font.caption,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: font.bodyLarge,
    fontWeight: '800',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  stickyFooter: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stickyFooterInner: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  infoRow: {
    borderBottomWidth: 0, // 경계선 제거
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  infoLabel: {
    color: colors.textMuted,
    fontSize: font.body,
  },
  infoValue: {
    color: colors.text,
    flexShrink: 1,
    fontSize: font.body,
    fontWeight: '600',
    marginLeft: spacing.sm,
    textAlign: 'right',
  },
  errorBanner: {
    backgroundColor: '#FBEAEA',
    borderRadius: radius.button,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  errorText: {
    color: colors.error,
    fontSize: font.body,
    fontWeight: '600',
  },
  centerFill: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  emptyIconCircle: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 999,
    height: 88,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 88,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: font.title,
    fontWeight: '800',
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptyDescription: {
    color: colors.textMuted,
    fontSize: font.body,
    textAlign: 'center',
  },
});
