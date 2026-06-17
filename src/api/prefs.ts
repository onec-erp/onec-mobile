// Local app preferences, persisted with AsyncStorage (Expo Go friendly — no
// native rebuild). Currently just the light/dark theme: this mirrors the web
// SPA, which remembers the chosen theme in localStorage ("onec-ui-theme") and
// restores it on load (see onec-ui-starter providers/theme-provider.tsx).

import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeName = 'light' | 'dark';

const THEME_KEY = 'onec.theme';

/** The saved theme, or null if none has been chosen yet (use the app default). */
export async function getStoredTheme(): Promise<ThemeName | null> {
  try {
    const v = await AsyncStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** Remember the chosen theme. Best-effort — a storage failure is non-fatal. */
export async function setStoredTheme(theme: ThemeName): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_KEY, theme);
  } catch {
    /* best-effort */
  }
}
