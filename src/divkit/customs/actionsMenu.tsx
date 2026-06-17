// onec-actions-menu — the detail/list action bar. custom_props.items:
// [{ label, icon, url, tone: accent|normal|danger, placement: primary|menu }].
// Primary items render as inline buttons; menu items collapse under a "⋯" toggle.
// Tapping fires the item's url (navigation, delete, action run) via the host.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CustomRenderer } from '../types';
import { LucideIcon } from './lucide';

interface Item {
  label: string;
  icon?: string;
  url: string;
  tone?: string;
  placement?: string;
}

const TONE: Record<string, { bg: string; fg: string; border?: string }> = {
  accent: { bg: '#111827', fg: '#FFFFFF' },
  danger: { bg: '#FEF2F2', fg: '#B91C1C', border: '#FECACA' },
  normal: { bg: '#FFFFFF', fg: '#0A0A0A', border: '#E5E7EB' },
};

function Btn({ item, onPress }: { item: Item; onPress: () => void }) {
  const tone = TONE[item.tone ?? 'normal'] ?? TONE.normal;
  return (
    <Pressable
      onPress={onPress}
      style={[s.btn, { backgroundColor: tone.bg, borderColor: tone.border ?? tone.bg, borderWidth: 1 }]}
    >
      {item.icon ? <LucideIcon name={item.icon} size={16} color={tone.fg} /> : null}
      <Text style={[s.btnText, { color: tone.fg }]}>{item.label}</Text>
    </Pressable>
  );
}

export const onecActionsMenu: CustomRenderer = ({ block, host }) => {
  const items: Item[] = Array.isArray(block.custom_props?.items) ? (block.custom_props!.items as Item[]) : [];
  const [open, setOpen] = useState(false);
  const primary = items.filter((i) => i.placement !== 'menu');
  const menu = items.filter((i) => i.placement === 'menu');

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        {primary.map((it, i) => (
          <Btn key={i} item={it} onPress={() => host.fire(it.url)} />
        ))}
        {menu.length > 0 && (
          <Pressable onPress={() => setOpen((o) => !o)} style={[s.btn, s.more]}>
            <LucideIcon name="ellipsis" size={18} color="#0A0A0A" />
          </Pressable>
        )}
      </View>
      {open && menu.length > 0 && (
        <View style={s.menu}>
          {menu.map((it, i) => (
            <Pressable
              key={i}
              style={s.menuItem}
              onPress={() => {
                setOpen(false);
                host.fire(it.url);
              }}
            >
              {it.icon ? <LucideIcon name={it.icon} size={16} color={it.tone === 'danger' ? '#B91C1C' : '#0A0A0A'} /> : null}
              <Text style={{ fontSize: 14, color: it.tone === 'danger' ? '#B91C1C' : '#0A0A0A' }}>{it.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  btnText: { fontSize: 13, fontWeight: '600' },
  more: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', paddingHorizontal: 10 },
  menu: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
});
