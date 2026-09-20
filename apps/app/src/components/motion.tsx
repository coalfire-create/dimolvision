import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * 가벼운 모션 프리미티브 — 대기업 앱처럼 절제된 등장·터치 반응만 제공한다.
 * 과한 효과 대신 짧은 페이드/이동/스케일로 "부드럽다"는 느낌만 준다.
 * useNativeDriver 는 웹(react-native-web)에서 미지원이라 플랫폼으로 분기한다.
 */
const useNativeDriver = Platform.OS !== 'web';

/** 마운트 시 아래에서 살짝 올라오며 페이드 인. delay 로 순차 등장(stagger). */
export function FadeInUp({
  children,
  delay = 0,
  offset = 24, // 조금 더 많이 내려갔다가 부드럽게 올라오도록
  duration = 500, // 살짝 더 여유있는 듀레이션
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  offset?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(p, {
      toValue: 1,
      duration,
      delay,
      // 조금 더 탄력있는 이징 함수 (Apple 스프링 느낌과 유사하게)
      easing: Easing.bezier(0.25, 1, 0.5, 1),
      useNativeDriver,
    });
    anim.start();
    return () => anim.stop();
  }, [p, delay, duration]);
  return (
    <Animated.View
      style={[
        {
          opacity: p,
          transform: [
            { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** 누르면 살짝 작아졌다 튕겨 돌아오는 스케일 값 + 핸들러. */
export function usePressScale(to = 0.95) { // 0.97에서 0.95로 눌림 효과 증대
  const scale = useRef(new Animated.Value(1)).current;
  const spring = (toValue: number, bounciness: number) =>
    Animated.spring(scale, { toValue, speed: 20, bounciness, useNativeDriver }).start(); // 스피드를 낮추고 바운시니스 조절
  return {
    scale,
    onPressIn: () => spring(to, 2),
    onPressOut: () => spring(1, 10), // 손을 뗐을 때 조금 더 기분좋게 튕기도록
  };
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** 터치 스케일 애니메이션이 내장된 Pressable. */
export function PressableScale({
  children,
  style,
  scaleTo = 0.97,
  ...rest
}: PressableProps & { children: React.ReactNode; scaleTo?: number; style?: StyleProp<ViewStyle> }) {
  const { scale, onPressIn, onPressOut } = usePressScale(scaleTo);
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        onPressIn();
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        onPressOut();
        rest.onPressOut?.(e);
      }}
      style={[{ transform: [{ scale }] }, style as StyleProp<ViewStyle>]}
    >
      {children}
    </AnimatedPressable>
  );
}
