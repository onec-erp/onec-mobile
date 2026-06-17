// A tiny toast system for the RN client — the native stand-in for the web SPA's
// `sonner` (which renders <Toaster/> and exposes a `toast.*` singleton importable
// anywhere). Same surface: `toast(msg)`, `toast.success/error/info/loading`,
// `toast.dismiss(id)`. A module-level store lets non-React code (the api client)
// raise a toast exactly like the web's `fetchJson` does, and the <Toaster/> at the
// app root subscribes and draws the stack. No dependency, Expo-Go friendly.

import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, Text, View } from 'react-native';
import { colors, isDark, type ThemeColors } from '../divkit/theme';
import { LucideIcon } from '../divkit/customs/lucide';

export type ToastVariant = 'default' | 'success' | 'error' | 'info' | 'loading';

export interface ToastItem {
  id: string;
  message: string;
  description?: string;
  variant: ToastVariant;
  duration: number; // ms; Infinity = sticky (dismiss explicitly)
  dismissing?: boolean;
}

export interface ToastOptions {
  id?: string;
  description?: string;
  duration?: number;
}

const EXIT_MS = 200; // exit-animation window before the row is actually removed

// Per-variant defaults. Errors linger longer; a "loading" toast is sticky until
// the caller dismisses it (mirrors sonner's toast.loading).
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  default: 4000,
  success: 4000,
  info: 4000,
  error: 6000,
  loading: Infinity,
};

// ----- store -----

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const autoTimers = new Map<string, ReturnType<typeof setTimeout>>();
const exitTimers = new Map<string, ReturnType<typeof setTimeout>>();
let counter = 0;

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): ToastItem[] {
  return items;
}

function clearTimers(id: string) {
  const a = autoTimers.get(id);
  if (a) { clearTimeout(a); autoTimers.delete(id); }
  const e = exitTimers.get(id);
  if (e) { clearTimeout(e); exitTimers.delete(id); }
}

function hardRemove(id: string) {
  clearTimers(id);
  const next = items.filter((t) => t.id !== id);
  if (next.length !== items.length) {
    items = next;
    emit();
  }
}

// Begin the exit animation, then drop the row. Auto-dismiss and tap-to-dismiss
// both route through here so the row always animates out.
function dismiss(id?: string) {
  if (id == null) {
    for (const t of [...items]) dismiss(t.id);
    return;
  }
  const cur = items.find((t) => t.id === id);
  if (!cur || cur.dismissing) return;
  const a = autoTimers.get(id);
  if (a) { clearTimeout(a); autoTimers.delete(id); }
  items = items.map((t) => (t.id === id ? { ...t, dismissing: true } : t));
  emit();
  exitTimers.set(id, setTimeout(() => hardRemove(id), EXIT_MS));
}

function add(variant: ToastVariant, message: string, opts: ToastOptions = {}): string {
  const id = opts.id ?? `t${++counter}`;
  const duration = opts.duration ?? DEFAULT_DURATION[variant];
  const item: ToastItem = { id, message, description: opts.description, variant, duration };

  const existing = items.find((t) => t.id === id);
  if (existing) {
    // Re-raising an id (e.g. a loading→success swap) updates it in place.
    clearTimers(id);
    items = items.map((t) => (t.id === id ? item : t));
  } else {
    items = [...items, item];
  }
  emit();

  if (Number.isFinite(duration)) {
    autoTimers.set(id, setTimeout(() => dismiss(id), duration));
  }
  return id;
}

type ToastFn = ((message: string, opts?: ToastOptions) => string) & {
  success: (message: string, opts?: ToastOptions) => string;
  error: (message: string, opts?: ToastOptions) => string;
  info: (message: string, opts?: ToastOptions) => string;
  loading: (message: string, opts?: ToastOptions) => string;
  dismiss: (id?: string) => void;
};

export const toast: ToastFn = Object.assign(
  (message: string, opts?: ToastOptions) => add('default', message, opts),
  {
    success: (message: string, opts?: ToastOptions) => add('success', message, opts),
    error: (message: string, opts?: ToastOptions) => add('error', message, opts),
    info: (message: string, opts?: ToastOptions) => add('info', message, opts),
    loading: (message: string, opts?: ToastOptions) => add('loading', message, opts),
    dismiss,
  },
);

// ----- view -----

function accentFor(variant: ToastVariant, c: ThemeColors): string {
  switch (variant) {
    case 'success': return c.successFg;
    case 'error': return c.dangerFg;
    case 'info':
    case 'loading': return c.primary;
    default: return c.muted;
  }
}

function iconFor(variant: ToastVariant): string {
  switch (variant) {
    case 'success': return 'check';
    case 'error': return 'x';
    case 'info': return 'info';
    default: return 'circle';
  }
}

function ToastRow({ item, c }: { item: ToastItem; c: ThemeColors }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, stiffness: 260, damping: 24, mass: 0.9 }).start();
  }, [anim]);

  useEffect(() => {
    if (item.dismissing) {
      Animated.timing(anim, { toValue: 0, duration: EXIT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    }
  }, [item.dismissing, anim]);

  const accent = accentFor(item.variant, c);
  const shadow = isDark(c)
    ? '0px 8px 24px rgba(0,0,0,0.5)'
    : '0px 8px 24px rgba(0,0,0,0.12)';

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
      }}
    >
      <Pressable
        onPress={() => dismiss(item.id)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: c.card,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          boxShadow: shadow,
        }}
      >
        {item.variant === 'loading' ? (
          <ActivityIndicator size="small" color={accent} />
        ) : (
          <LucideIcon name={iconFor(item.variant)} size={18} color={accent} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{item.message}</Text>
          {item.description ? (
            <Text style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{item.description}</Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Mount once at the app root, above all content (and the bottom nav). Subscribes
 * to the toast store and draws the stack pinned to the bottom — newest lowest.
 * `bottomOffset` clears the nav bar / home indicator.
 */
export function Toaster({ theme, bottomOffset = 0 }: { theme: 'light' | 'dark'; bottomOffset?: number }) {
  const data = useSyncExternalStore(subscribe, snapshot);
  const c = colors(theme);
  if (data.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 12, right: 12, bottom: bottomOffset + 12, gap: 8 }}
    >
      {data.map((item) => (
        <ToastRow key={item.id} item={item} c={c} />
      ))}
    </View>
  );
}
