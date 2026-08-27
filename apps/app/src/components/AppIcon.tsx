import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';

export type IconName =
  | 'home'
  | 'requests'
  | 'notifications'
  | 'mypage'
  | 'camera'
  | 'document'
  | 'truck'
  | 'tools'
  | 'building'
  | 'check'
  | 'lock'
  | 'star'
  | 'settings'
  | 'phone'
  | 'sparkles'
  | 'location'
  | 'chat'
  | 'alert'
  | 'recycle'
  | 'hammer';

const ICON_MAP: Record<IconName, { outline: keyof typeof Ionicons.glyphMap; filled: keyof typeof Ionicons.glyphMap }> = {
  home: { outline: 'home-outline', filled: 'home' },
  requests: { outline: 'document-text-outline', filled: 'document-text' },
  notifications: { outline: 'notifications-outline', filled: 'notifications' },
  mypage: { outline: 'person-outline', filled: 'person' },
  camera: { outline: 'camera-outline', filled: 'camera' },
  document: { outline: 'clipboard-outline', filled: 'clipboard' },
  truck: { outline: 'bus-outline', filled: 'bus' },
  tools: { outline: 'construct-outline', filled: 'construct' },
  building: { outline: 'business-outline', filled: 'business' },
  check: { outline: 'checkmark-circle-outline', filled: 'checkmark-circle' },
  lock: { outline: 'lock-closed-outline', filled: 'lock-closed' },
  star: { outline: 'star-outline', filled: 'star' },
  settings: { outline: 'settings-outline', filled: 'settings' },
  phone: { outline: 'call-outline', filled: 'call' },
  sparkles: { outline: 'sparkles-outline', filled: 'sparkles' },
  location: { outline: 'location-outline', filled: 'location' },
  chat: { outline: 'chatbubble-ellipses-outline', filled: 'chatbubble-ellipses' },
  alert: { outline: 'alert-circle-outline', filled: 'alert-circle' },
  recycle: { outline: 'refresh-circle-outline', filled: 'refresh-circle' },
  hammer: { outline: 'hammer-outline', filled: 'hammer' },
};

export function AppIcon({
  name,
  size = 22,
  color = theme.colors.text,
  filled = false,
}: {
  name: IconName;
  size?: number;
  color?: string;
  filled?: boolean;
}) {
  const iconConfig = ICON_MAP[name] || ICON_MAP.home;
  const iconName = filled ? iconConfig.filled : iconConfig.outline;
  return <Ionicons name={iconName} size={size} color={color} />;
}
