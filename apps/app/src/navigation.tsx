import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { CONTENT_MAX_WIDTH, theme } from './theme';
import brandmark from '../assets/brandmark.png';

/**
 * 단일 화면 앱용 최소 헤더. (디몰링크 본체의 네비게이션 스택에서 분리하며,
 * 디몰비전은 화면이 하나라 뒤로가기 컨텍스트가 필요 없다 — title 만 표시.)
 */
export function ScreenHeader({ title }: { title: string; canGoBack?: boolean }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerInner}>
        <Image source={brandmark} style={styles.headerLogo} resizeMode="contain" />
        <View>
          <Text style={styles.headerBrand}>디몰비전</Text>
          <Text style={styles.headerSub}>{title}</Text>
        </View>
      </View>
    </View>
  );
}

const { colors, font, spacing } = theme;

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingTop: Platform.OS === 'web' ? spacing.sm : 52,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  headerInner: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerLogo: { width: 30, height: 30 },
  headerBrand: {
    color: colors.text,
    fontSize: font.bodyLarge,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  headerSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
});
