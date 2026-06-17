// onec-icon / onec-hint — the lightweight chrome customs.
import React from 'react';
import { Text, View } from 'react-native';
import { color } from '../style';
import type { CustomRenderer } from '../types';
import { LucideIcon } from './lucide';

// onec-icon: a lucide glyph by name. Highlights with `activeColor` when the
// card's `active_path` variable matches this icon's `activePath` (nav bar).
export const onecIcon: CustomRenderer = ({ customProps, host }) => {
  const name = customProps.name as string | undefined;
  const size = Number(customProps.size ?? 16);
  const activePath = customProps.activePath as string | undefined;
  const activeColor = color(customProps.activeColor as string | undefined);
  const baseColor = color(customProps.color as string | undefined);
  const current = host.getVar('active_path');
  const isActive = !!activeColor && activePath != null && current === activePath;
  return <LucideIcon name={name} size={size} color={(isActive ? activeColor : baseColor) ?? '#374151'} />;
};

// onec-hint: a small help glyph (tooltip body is desktop-only).
export const onecHint: CustomRenderer = () => (
  <View
    style={{
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: '#E5E7EB',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <Text style={{ fontSize: 11, color: '#6B7280' }}>?</Text>
  </View>
);
