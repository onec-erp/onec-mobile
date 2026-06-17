// A small confirm-dialog system for the RN client — the native stand-in for the
// web SPA's shadcn AlertDialog. Same ergonomics as ./toast: a module-level store
// lets any code call `confirm({...})` and await a boolean, while a single
// <ConfirmHost/> at the app root subscribes and draws the animated modal.
//
//   if (await confirm({ title: 'Delete record?', destructive: true })) …
//
// Animated like the web: the backdrop fades in, the card springs up (scale+fade),
// and both ease back out on dismiss. No dependency, Expo-Go friendly.

import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Easing, Modal, Pressable, Text, View } from 'react-native';
import { colors, isDark, type ThemeColors } from '../divkit/theme';
import { LucideIcon } from '../divkit/customs/lucide';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button + red-tinted icon, for delete/irreversible actions. */
  destructive?: boolean;
  /** Optional lucide glyph shown in a tinted circle above the title. */
  icon?: string;
}

interface DialogItem extends ConfirmOptions {
  id: string;
  confirmLabel: string;
  cancelLabel: string;
  closing?: boolean;
  resolve: (ok: boolean) => void;
}

const EXIT_MS = 160; // exit-animation window before the modal unmounts

// ----- store -----

let current: DialogItem | null = null;
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
function snapshot(): DialogItem | null {
  return current;
}

/** Show a confirm dialog; resolves true on confirm, false on cancel/backdrop. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  // Only one dialog at a time — a new request supersedes (cancels) the old.
  if (current && !current.closing) current.resolve(false);
  if (exitTimer) {
    clearTimeout(exitTimer);
    exitTimer = undefined;
  }
  return new Promise<boolean>((resolve) => {
    current = {
      id: `d${++counter}`,
      title: opts.title,
      message: opts.message,
      icon: opts.icon,
      destructive: opts.destructive,
      confirmLabel: opts.confirmLabel ?? (opts.destructive ? 'Delete' : 'Confirm'),
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      resolve,
    };
    emit();
  });
}

// Resolve the promise and play the exit animation before unmounting.
function settle(result: boolean) {
  if (!current || current.closing) return;
  current.resolve(result);
  current = { ...current, closing: true };
  emit();
  exitTimer = setTimeout(() => {
    current = null;
    exitTimer = undefined;
    emit();
  }, EXIT_MS);
}

// ----- view -----

const DESTRUCTIVE = '#DC2626'; // solid red for the confirm button (both themes)

function DialogView({ item, c }: { item: DialogItem; c: ThemeColors }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, stiffness: 280, damping: 26, mass: 0.9 }).start();
  }, [anim]);

  useEffect(() => {
    if (item.closing) {
      Animated.timing(anim, { toValue: 0, duration: EXIT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    }
  }, [item.closing, anim]);

  const shadow = isDark(c) ? '0px 24px 60px rgba(0,0,0,0.65)' : '0px 24px 60px rgba(0,0,0,0.22)';
  const confirmBg = item.destructive ? DESTRUCTIVE : c.primary;
  const iconTintBg = item.destructive ? (isDark(c) ? '#3A1414' : '#FEE2E2') : (isDark(c) ? '#172554' : '#EFF6FF');
  const iconTintFg = item.destructive ? (isDark(c) ? '#F87171' : DESTRUCTIVE) : c.primary;

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      {/* Backdrop: tinted, fades with the card; tap outside to cancel. */}
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={() => settle(false)}>
        <Animated.View style={{ flex: 1, backgroundColor: '#000', opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }) }} />
      </Pressable>

      <Animated.View
        style={{
          width: '100%',
          maxWidth: 420,
          backgroundColor: c.card,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: 18,
          padding: 22,
          boxShadow: shadow,
          opacity: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] }),
          transform: [
            { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        }}
      >
        {item.icon ? (
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: iconTintBg, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <LucideIcon name={item.icon} size={22} color={iconTintFg} />
          </View>
        ) : null}

        <Text style={{ fontSize: 18, fontWeight: '700', color: c.text }}>{item.title}</Text>
        {item.message ? (
          <Text style={{ fontSize: 14, lineHeight: 20, color: c.muted, marginTop: 8 }}>{item.message}</Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
          <Pressable
            onPress={() => settle(false)}
            style={({ pressed }) => ({
              flex: 1,
              height: 46,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: pressed ? c.surface : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{item.cancelLabel}</Text>
          </Pressable>
          <Pressable
            onPress={() => settle(true)}
            style={({ pressed }) => ({
              flex: 1,
              height: 46,
              borderRadius: 10,
              backgroundColor: confirmBg,
              opacity: pressed ? 0.85 : 1,
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>{item.confirmLabel}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

/** Mount once at the app root (alongside <Toaster/>). Draws the active dialog. */
export function ConfirmHost({ theme }: { theme: 'light' | 'dark' }) {
  const item = useSyncExternalStore(subscribe, snapshot);
  const c = colors(theme);
  return (
    <Modal visible={!!item} transparent animationType="none" statusBarTranslucent onRequestClose={() => settle(false)}>
      {item ? <DialogView item={item} c={c} /> : null}
    </Modal>
  );
}
