// Value-formatting helpers shared by the custom widgets — a port of the Flutter
// client's format.dart (itself a port of the web's lib/format.ts +
// lib/cell-format.ts), using JS Intl instead of Dart intl.

export interface NumberFormatOptions {
  currency?: string;
  unit?: string;
  unitPosition?: string; // 'prefix' | 'suffix'
  format?: string; // 'integer' | 'decimal'
  locale?: string;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim());
    return isFinite(n) ? n : null;
  }
  return null;
}

function attachUnit(num: string, unit: string, pos?: string): string {
  return pos === 'prefix' ? `${unit}${num}` : `${num} ${unit}`;
}

function formatPlain(value: number, o: NumberFormatOptions): string {
  const frac = o.format === 'integer' ? 0 : 2;
  return new Intl.NumberFormat(o.locale, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  }).format(value);
}

export function formatNumber(value: number, o: NumberFormatOptions = {}): string {
  const unit = o.unit?.trim();
  if (unit) return attachUnit(formatPlain(value, o), unit, o.unitPosition);
  if (o.currency) {
    try {
      return new Intl.NumberFormat(o.locale, { style: 'currency', currency: o.currency }).format(value);
    } catch {
      /* invalid code → plain */
    }
  }
  return formatPlain(value, o);
}

// React Native's Hermes engine ships Intl.NumberFormat but ignores the
// `notation: 'compact'` option — `1000` comes back as "1,000" instead of the
// web's "1K". So compact by hand (K/M/B/T) to match lib/format.ts on the web:
// 1 fraction digit, 0 for integer counts, trailing zeros trimmed ("1K", "1.2M").
const COMPACT_TIERS = [
  { v: 1e12, s: 'T' },
  { v: 1e9, s: 'B' },
  { v: 1e6, s: 'M' },
  { v: 1e3, s: 'K' },
] as const;

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

function compactDigits(value: number, maxFrac: number): string {
  const tier = COMPACT_TIERS.find((t) => Math.abs(value) >= t.v);
  if (!tier) return trimZeros(value.toFixed(maxFrac));
  return `${trimZeros((value / tier.v).toFixed(maxFrac))}${tier.s}`;
}

/** The currency symbol for a code (e.g. "$", "€"); plain currency formatting
 *  works in Hermes, it's only compact notation that doesn't. */
function currencySymbol(currency: string, locale?: string): string | null {
  try {
    const part = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? null;
  } catch {
    return null;
  }
}

export function formatCompact(value: number, o: NumberFormatOptions = {}): string {
  const unit = o.unit?.trim();
  if (unit) return attachUnit(compactDigits(value, 1), unit, o.unitPosition);
  if (o.currency) {
    const sym = currencySymbol(o.currency, o.locale);
    if (sym) return `${sym}${compactDigits(value, 1)}`;
  }
  return compactDigits(value, o.format === 'integer' ? 0 : 1);
}

export function formatAmount(value: number, o: NumberFormatOptions = {}): string {
  if (o.unit?.trim() || o.currency) return formatNumber(value, o);
  return `$${value.toFixed(2)}`;
}

// ----- cell-format -----

const NUMBER_KEYWORD = /^(integer|decimal|percent|currency(:[a-zA-Z]{3})?)$/i;

export function isImageWidget(w?: string): boolean {
  return /^(image|photo|avatar)$/i.test(w ?? '');
}
export function isAvatarWidget(w?: string): boolean {
  return /^avatar$/i.test(w ?? '');
}
export function looksLikeImageUrl(v: string): boolean {
  return v.startsWith('data:') || /^https?:\/\//i.test(v);
}

function isNumberSpec(fmt: string): boolean {
  return NUMBER_KEYWORD.test(fmt) || /[#0]/.test(fmt);
}

/** Apply a column `.format(...)` hint; null when blank or value doesn't fit. */
export function applyFormat(raw: string, format?: string): string | null {
  const fmt = (format ?? '').trim();
  if (!fmt || !raw) return null;
  return isNumberSpec(fmt) ? formatNumberSpec(raw, fmt) : formatDateSpec(raw, fmt);
}

function formatNumberSpec(raw: string, fmt: string): string | null {
  const n = Number(raw);
  if (!isFinite(n) || raw.trim() === '') return null;
  const lower = fmt.toLowerCase();
  try {
    if (lower === 'integer') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
    if (lower === 'decimal')
      return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    if (lower === 'percent') return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 }).format(n);
    if (lower.startsWith('currency')) {
      const code = lower.includes(':') ? fmt.slice(fmt.indexOf(':') + 1).trim().toUpperCase() : 'USD';
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n);
      } catch {
        return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
      }
    }
    const dot = fmt.indexOf('.');
    const decimals = dot >= 0 ? fmt.length - dot - 1 : 0;
    return new Intl.NumberFormat(undefined, {
      useGrouping: fmt.includes(','),
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  } catch {
    return null;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateSpec(raw: string, _fmt: string): string | null {
  const norm = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(norm);
  if (isNaN(d.getTime())) return null;
  // Good-enough common shape; the server's patterns are date-fns-ish.
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Short month/day, e.g. "Jun 3". */
export function formatMonthDay(raw: string): string | null {
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// ----- field/template helpers -----

export function splitFields(cfg?: string): string[] {
  if (!cfg) return [];
  return cfg.split(',').map((s) => s.trim()).filter(Boolean);
}

export function pickField(row: Record<string, any>, fields: string[]): string | null {
  for (const f of fields) {
    const v = row[f];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

export function applyTemplate(template: string, row: Record<string, any>): string {
  return template
    .replace(/\{([^}]+)\}/g, (_, k) => {
      const v = row[String(k).trim()];
      return v == null ? '' : String(v);
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function resolveText(
  row: Record<string, any>,
  o: { template?: string; fields?: string[]; fallbacks?: string[] },
): string {
  if (o.template) return applyTemplate(o.template, row);
  if (o.fields && o.fields.length) {
    const parts = o.fields
      .map((f) => row[f])
      .filter((v) => v != null && String(v).trim())
      .map(String);
    if (parts.length) return parts.join(' — ');
  }
  return o.fallbacks ? pickField(row, o.fallbacks) ?? '' : '';
}

export function resolveCurrency(row: Record<string, any>, currencyField?: string, currency?: string): string | undefined {
  if (currency?.trim()) return currency.trim();
  if (currencyField) {
    const v = row[currencyField];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}
