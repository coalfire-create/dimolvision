import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { SiteAnalysisScreen } from './src/screens/SiteAnalysisScreen';

/**
 * 디몰비전(DimolVision) — 철거 현장 사진 AI 분석 단일 화면 앱.
 * 디몰링크 본체에서 현장 분석 기능만 분리한 경량 제품(호스팅 VLM 백엔드).
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider>
        <StatusBar barStyle="dark-content" />
        <SiteAnalysisScreen />
      </PaperProvider>
    </SafeAreaProvider>
  );
}
