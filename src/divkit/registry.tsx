// Registry for `onec-*` div-custom blocks — the RN counterpart of the Flutter
// client's `OnecCustomHandler` and the web client's `*-bridge.tsx`. The server
// emits 16 custom types but only 7 ever appear in the mobile viewport; register
// each one here. Data-driven widgets (list/form/widget/comments) get the API
// client via the host and are filled in incrementally.

import React from 'react';
import { Text, View } from 'react-native';
import type { CustomRenderer } from './types';

const registry: Record<string, CustomRenderer> = {};

export function registerCustom(type: string, renderer: CustomRenderer): void {
  registry[type] = renderer;
}

export function getCustom(type: string): CustomRenderer | undefined {
  return registry[type];
}

/** Shown for an unimplemented or unknown custom type — never crashes the card. */
export function CustomPlaceholder({ type }: { type: string }) {
  return (
    <View
      style={{
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        backgroundColor: '#F9FAFB',
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ fontSize: 12, color: '#6B7280' }}>⟨{type}⟩</Text>
    </View>
  );
}

// ----- built-in lightweight customs -----

// onec-icon: the Flutter client maps these to Lucide glyphs. RN has no Lucide
// by default, so we render the icon name's first letter in a chip until the
// lucide-react-native dependency is wired up.
registerCustom('onec-icon', ({ customProps }) => {
  const name = String(customProps.name ?? customProps.icon ?? '?');
  const size = Number(customProps.size ?? 18);
  return (
    <View
      style={{
        width: size + 6,
        height: size + 6,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.8, color: '#374151' }}>
        {name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
});

// onec-hint: a small help glyph (tooltip text is desktop-only, omitted here).
registerCustom('onec-hint', () => (
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
));
