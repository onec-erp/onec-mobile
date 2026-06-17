// App-side palette for the custom widgets + chrome. The server-emitted DivKit
// cards already carry themed colors (light #FFFFFF/#0A0A0A → dark #121212/#EDEDED);
// these values harmonize the RN-drawn customs (cards, lists, forms) with them.

export interface ThemeColors {
  bg: string;
  card: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  primary: string;
  fieldBg: string;
  fieldBorder: string;
  dangerBg: string;
  dangerFg: string;
  accentBg: string;
  accentFg: string;
  successBg: string;
  successFg: string;
}

const light: ThemeColors = {
  bg: '#FFFFFF',
  card: '#FFFFFF',
  surface: '#F9FAFB',
  border: '#E5E7EB',
  text: '#0A0A0A',
  muted: '#737373',
  primary: '#2563EB',
  fieldBg: '#FFFFFF',
  fieldBorder: '#D1D5DB',
  dangerBg: '#FEF2F2',
  dangerFg: '#B91C1C',
  // Primary action buttons (+New, Save, Edit, Send…) — blue like the web, not a
  // high-contrast black/white. (accentBg is used only for these CTAs.)
  accentBg: '#2563EB',
  accentFg: '#FFFFFF',
  successBg: '#DCFCE7',
  successFg: '#16A34A',
};

const dark: ThemeColors = {
  bg: '#121212',
  card: '#1B1B1B',
  surface: '#1B1B1B',
  border: '#2A2A2A',
  text: '#EDEDED',
  muted: '#808080',
  primary: '#3B82F6',
  fieldBg: '#1B1B1B',
  fieldBorder: '#3A3A3A',
  dangerBg: '#3A1414',
  dangerFg: '#F87171',
  // Primary CTAs are blue (matching the web) — in dark mode the old near-white
  // accent made e.g. the "+New" button look like an un-themed light element.
  accentBg: '#3B82F6',
  accentFg: '#FFFFFF',
  successBg: '#0F2A19',
  successFg: '#4ADE80',
};

export function colors(theme: 'light' | 'dark'): ThemeColors {
  return theme === 'dark' ? dark : light;
}

/** True when the palette is the dark one (reference equality — the palettes are
 *  singletons returned by `colors()`). Lets components pick theme-aware extras
 *  (e.g. shadow strength) from a `ThemeColors` alone, without threading theme. */
export function isDark(c: ThemeColors): boolean {
  return c === dark;
}
