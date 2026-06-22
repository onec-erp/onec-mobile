// A small dialog system for the RN client — the native stand-in for the web SPA's
// shadcn AlertDialog. Two flavours share one animated modal and one module-level
// store (same ergonomics as ./toast):
//
//   • confirm({...}) — two buttons, awaits a boolean (Confirm / Cancel).
//       if (await confirm({ title: 'Delete record?', destructive: true })) …
//   • alert({...})   — one button, awaits void. The nicer replacement for the
//       cheap native Alert.alert(); carries a tone (success/error/warning) that
//       picks the icon, tint and haptic.
//       await alert({ title: 'Saved', message: 'Settings saved', tone: 'success' });
//
// A single <ConfirmHost/> at the app root subscribes and draws the active dialog.
// Animated like the web: the backdrop fades in, the card springs up (scale+fade),
// the buttons dip-and-scale under your finger with a selection tick, and a tone-
// matched haptic fires on open. No heavy deps, Expo-Go friendly.

import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Easing, Modal, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, isDark, type ThemeColors } from '../divkit/theme';
import { LucideIcon } from '../divkit/customs/lucide';

/** Colours/icon/haptic preset for an alert. `default` is the neutral brand tone. */
export type DialogTone = 'default' | 'success' | 'error' | 'warning';

interface BaseOptions {
  title: string;
  message?: string;
  /** Lucide glyph shown in a tinted circle above the title. Defaults to the tone's icon. */
  icon?: string;
}

export interface ConfirmOptions extends BaseOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button + red-tinted icon, for delete/irreversible actions. */
  destructive?: boolean;
}

export interface AlertOptions extends BaseOptions {
  /** Drives the icon, its tint and the open haptic. */
  tone?: DialogTone;
  /** Label for the single dismiss button (default 'OK'). */
  buttonLabel?: string;
}

interface DialogItem {
  id: string;
  kind: 'confirm' | 'alert';
  title: string;
  message?: string;
  icon?: string;
  tone: DialogTone;
  destructive?: boolean;
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

function present(item: DialogItem) {
  // Only one dialog at a time — a new request supersedes (cancels) the old.
  if (current && !current.closing) current.resolve(false);
  if (exitTimer) {
    clearTimeout(exitTimer);
    exitTimer = undefined;
  }
  current = item;
  emit();
}

/** Show a confirm dialog; resolves true on confirm, false on cancel/backdrop. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    present({
      id: `d${++counter}`,
      kind: 'confirm',
      title: opts.title,
      message: opts.message,
      icon: opts.icon,
      tone: opts.destructive ? 'error' : 'default',
      destructive: opts.destructive,
      confirmLabel: opts.confirmLabel ?? (opts.destructive ? 'Delete' : 'Confirm'),
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      resolve,
    });
  });
}

/** Show a single-button informational dialog — the modal replacement for Alert.alert(). */
export function alert(opts: AlertOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    present({
      id: `d${++counter}`,
      kind: 'alert',
      title: opts.title,
      message: opts.message,
      icon: opts.icon,
      tone: opts.tone ?? 'default',
      confirmLabel: opts.buttonLabel ?? 'OK',
      cancelLabel: '',
      resolve: () => resolve(),
    });
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

// ----- haptics -----

const TONE_ICON: Record<DialogTone, string> = {
  default: 'info',
  success: 'circle-check',
  error: 'circle-alert',
  warning: 'triangle-alert',
};

// A tone-matched tap as the dialog appears, so feedback is felt before it's read.
function openHaptic(item: DialogItem) {
  const N = Haptics.NotificationFeedbackType;
  if (item.kind === 'confirm') {
    // Confirms ask for a decision — a soft nudge, stronger when destructive.
    if (item.destructive) Haptics.notificationAsync(N.Warning).catch(() => {});
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    return;
  }
  if (item.tone === 'success') Haptics.notificationAsync(N.Success).catch(() => {});
  else if (item.tone === 'error') Haptics.notificationAsync(N.Error).catch(() => {});
  else if (item.tone === 'warning') Haptics.notificationAsync(N.Warning).catch(() => {});
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// ----- view -----

const DESTRUCTIVE = '#DC2626'; // solid red for the confirm button (both themes)
const WARNING = '#D97706'; // amber for the warning tone (no theme token for it)

// Tint pair (circle background, glyph colour) for the icon, per tone + theme.
function toneTint(tone: DialogTone, c: ThemeColors): { bg: string; fg: string } {
  const dark = isDark(c);
  switch (tone) {
    case 'success':
      return { bg: c.successBg, fg: c.successFg };
    case 'error':
      return { bg: dark ? '#3A1414' : '#FEE2E2', fg: dark ? '#F87171' : DESTRUCTIVE };
    case 'warning':
      return { bg: dark ? '#3A2A0E' : '#FEF3C7', fg: dark ? '#FBBF24' : WARNING };
    default:
      return { bg: dark ? '#172554' : '#EFF6FF', fg: c.primary };
  }
}

/** A dialog button with a spring dip-and-scale + selection haptic on press. */
function DialogButton({
  label,
  onPress,
  variant,
  c,
}: {
  label: string;
  onPress: () => void;
  variant: 'cancel' | 'confirm' | 'danger';
  c: ThemeColors;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const spring = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, stiffness: 400, damping: 28, mass: 0.7 }).start();

  const filled = variant !== 'cancel';
  const bg = variant === 'danger' ? DESTRUCTIVE : variant === 'confirm' ? c.primary : 'transparent';
  const fg = filled ? '#FFFFFF' : c.text;

  return (
    <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          Haptics.selectionAsync().catch(() => {});
          spring(0.96);
        }}
        onPressOut={() => spring(1)}
        style={({ pressed }) => ({
          height: 46,
          borderRadius: 10,
          borderWidth: filled ? 0 : 1,
          borderColor: c.border,
          backgroundColor: filled ? bg : pressed ? c.surface : 'transparent',
          opacity: filled && pressed ? 0.9 : 1,
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        <Text style={{ fontSize: 15, fontWeight: filled ? '700' : '600', color: fg }}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

function DialogView({ item, c }: { item: DialogItem; c: ThemeColors }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    openHaptic(item);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, stiffness: 280, damping: 26, mass: 0.9 }).start();
    // Run once on mount for the item that opened this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim]);

  useEffect(() => {
    if (item.closing) {
      Animated.timing(anim, { toValue: 0, duration: EXIT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    }
  }, [item.closing, anim]);

  const shadow = isDark(c) ? '0px 24px 60px rgba(0,0,0,0.65)' : '0px 24px 60px rgba(0,0,0,0.22)';
  const tint = toneTint(item.tone, c);
  const icon = item.icon ?? (item.kind === 'alert' ? TONE_ICON[item.tone] : undefined);

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
        {icon ? (
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tint.bg, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <LucideIcon name={icon} size={22} color={tint.fg} />
          </View>
        ) : null}

        <Text style={{ fontSize: 18, fontWeight: '700', color: c.text }}>{item.title}</Text>
        {item.message ? (
          <Text style={{ fontSize: 14, lineHeight: 20, color: c.muted, marginTop: 8 }}>{item.message}</Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
          {item.kind === 'confirm' ? (
            <DialogButton label={item.cancelLabel} onPress={() => settle(false)} variant="cancel" c={c} />
          ) : null}
          <DialogButton
            label={item.confirmLabel}
            onPress={() => settle(true)}
            variant={item.destructive ? 'danger' : 'confirm'}
            c={c}
          />
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
      {item ? <DialogView key={item.id} item={item} c={c} /> : null}
    </Modal>
  );
}
