// A long-press context menu for the RN client — the native stand-in for the web
// SPA's right-click menu on a link, built to feel like an iOS haptic-touch menu:
// press and hold, the menu lifts in, slide a finger onto an option and release to
// fire it (or release in place and tap). The gesture lives on the trigger (see
// ../divkit/longPress); this module is the presentational overlay it drives,
// plus the store the gesture writes to (open → move → commit/close).
//
// It is deliberately NOT a <Modal>: on iOS a Modal is a separate window, so the
// trigger's gesture would stop receiving finger-move events the moment the finger
// crossed into it. A same-window absolute overlay keeps the whole press-drag-
// release a single continuous gesture. Selection is computed from the finger
// position against the menu's (fixed-height) row geometry — no per-row hit-testing.

import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, BackHandler, Dimensions, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, isDark, type ThemeColors } from '../divkit/theme';
import { LucideIcon } from '../divkit/customs/lucide';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  /** `danger` paints the row red (delete/irreversible). */
  tone?: 'default' | 'danger';
  onPress: () => void;
}

export interface ContextMenuAnchor {
  /** Window coordinates of the long-press (gesture absoluteX/absoluteY). */
  x: number;
  y: number;
}

const MENU_WIDTH = 250;
const ROW_HEIGHT = 44; // fixed, so the finger→row mapping is exact (no measuring)
const V_PAD = 5; // menu's own top/bottom padding
const GAP = 10; // gap between the finger and the menu
const EXIT_MS = 130;

interface MenuState {
  id: string;
  items: ContextMenuItem[];
  left: number;
  top: number;
  up: boolean;
  /** Row under the finger (-1 = none). Drives the live highlight. */
  highlight: number;
  closing?: boolean;
  onClose?: () => void;
}

// ----- geometry -----

// Pin the menu to the finger, clamped on-screen; flip above the touch point when
// there isn't room below (a long-press near the bottom of the screen).
function place(anchor: ContextMenuAnchor, rows: number): { left: number; top: number; up: boolean } {
  const screen = Dimensions.get('window');
  const menuH = rows * ROW_HEIGHT + V_PAD * 2;
  const left = Math.max(8, Math.min(anchor.x - 12, screen.width - MENU_WIDTH - 8));
  const up = anchor.y + GAP + menuH > screen.height - 24;
  const top = up ? Math.max(28, anchor.y - GAP - menuH) : anchor.y + GAP;
  return { left, top, up };
}

// Which row a finger at (x, y) is over, or -1.
function rowAt(s: MenuState, x: number, y: number): number {
  if (x < s.left || x > s.left + MENU_WIDTH) return -1;
  const localY = y - (s.top + V_PAD);
  if (localY < 0 || localY >= s.items.length * ROW_HEIGHT) return -1;
  return Math.floor(localY / ROW_HEIGHT);
}

// ----- store -----

let current: MenuState | null = null;
const listeners = new Set<() => void>();
let counter = 0;
let exitTimer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  for (const l of listeners) l();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function snapshot(): MenuState | null {
  return current;
}

/** Open the menu anchored at `anchor`. `onClose` runs once when it dismisses (the
 *  trigger uses it to unlock scrolling). A new open supersedes any previous one. */
export function openContextMenu(items: ContextMenuItem[], anchor: ContextMenuAnchor, onClose?: () => void): void {
  if (items.length === 0) return;
  if (current && !current.closing) current.onClose?.();
  if (exitTimer) {
    clearTimeout(exitTimer);
    exitTimer = undefined;
  }
  const { left, top, up } = place(anchor, items.length);
  current = { id: `m${++counter}`, items, left, top, up, highlight: -1, onClose };
  emit();
}

/** Update the highlighted row from the live finger position (a selection tick on
 *  change, like iOS). Called throughout the drag. */
export function moveContextMenu(x: number, y: number): void {
  if (!current || current.closing) return;
  const next = rowAt(current, x, y);
  if (next === current.highlight) return;
  current = { ...current, highlight: next };
  emit();
  if (next >= 0) Haptics.selectionAsync().catch(() => {});
}

/** Release: fire the highlighted row and close, or — if the finger is over no row
 *  (released in place) — leave the menu open so the user can tap an option. */
export function commitContextMenu(): void {
  if (!current || current.closing) return;
  const idx = current.highlight;
  if (idx < 0) return; // released in place → stay open for a tap
  const item = current.items[idx];
  closeContextMenu();
  item?.onPress();
}

/** Animate the menu out and dismiss it. Unlocks scroll immediately via onClose. */
export function closeContextMenu(): void {
  if (!current || current.closing) return;
  current.onClose?.();
  current = { ...current, closing: true, onClose: undefined };
  emit();
  exitTimer = setTimeout(() => {
    current = null;
    exitTimer = undefined;
    emit();
  }, EXIT_MS);
}

// ----- view -----

function Overlay({ state, c }: { state: MenuState; c: ThemeColors }) {
  const anim = useRef(new Animated.Value(0)).current;
  const dark = isDark(c);

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, stiffness: 320, damping: 22, mass: 0.85 }).start();
  }, [anim]);

  useEffect(() => {
    if (state.closing) {
      Animated.timing(anim, { toValue: 0, duration: EXIT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    }
  }, [state.closing, anim]);

  // Android hardware back dismisses the menu (a <Modal> would do this for free, but
  // this is a same-window overlay so we wire it up ourselves).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeContextMenu();
      return true;
    });
    return () => sub.remove();
  }, []);

  // Soft, light shadow — iOS menus separate with blur, not a heavy drop shadow.
  const shadow = dark ? '0px 8px 24px rgba(0,0,0,0.40)' : '0px 6px 20px rgba(0,0,0,0.10)';
  const dimTo = dark ? 0.42 : 0.08;
  const highlightBg = dark ? '#2C2C2C' : '#EBEBEB';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop: a faint dim for separation; tap to dismiss. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={closeContextMenu}>
        <Animated.View
          style={{ flex: 1, backgroundColor: '#000', opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0, dimTo] }) }}
        />
      </Pressable>

      <Animated.View
        style={{
          position: 'absolute',
          left: state.left,
          top: state.top,
          width: MENU_WIDTH,
          paddingVertical: V_PAD,
          backgroundColor: c.card,
          borderRadius: 14,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          overflow: 'hidden',
          boxShadow: shadow,
          // Grow from the corner nearest the finger.
          transformOrigin: state.up ? ['0%', '100%', 0] : ['0%', '0%', 0],
          opacity: anim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 1, 1] }),
          transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
        }}
      >
        {state.items.map((it, i) => {
          const active = i === state.highlight;
          const fg = it.tone === 'danger' ? c.dangerFg : c.text;
          return (
            <Pressable
              key={i}
              onPress={() => {
                closeContextMenu();
                it.onPress();
              }}
              style={({ pressed }) => ({
                height: ROW_HEIGHT,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                gap: 12,
                backgroundColor: active || pressed ? highlightBg : 'transparent',
                borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: c.border,
              })}
            >
              <Text style={{ flex: 1, fontSize: 16, color: fg }} numberOfLines={1}>
                {it.label}
              </Text>
              {it.icon ? <LucideIcon name={it.icon} size={18} color={fg} /> : null}
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );
}

/** Mount once at the app root (alongside <Toaster/> and <ConfirmHost/>), as the
 *  last child so it overlays everything. Renders nothing when no menu is open. */
export function ContextMenuHost({ theme }: { theme: 'light' | 'dark' }) {
  const state = useSyncExternalStore(subscribe, snapshot);
  const c = colors(theme);
  if (!state) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000 }]} pointerEvents="box-none">
      <Overlay state={state} c={c} />
    </View>
  );
}
