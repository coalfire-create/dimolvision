import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { theme } from './theme';

/**
 * 단일 화면 앱용 최소 헤더. (디몰링크 본체의 네비게이션 스택에서 분리하며,
 * 디몰비전은 화면이 하나라 뒤로가기 컨텍스트가 필요 없다 — title 만 표시.)
 */
export function ScreenHeader({ title }: { title: string; canGoBack?: boolean }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{title}</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.title - 2,
    fontWeight: '800',
    textAlign: 'center',
  },
});
