// Descriptor + aggregation for the dashboard widgets (onec-widget). Port of the
// Flutter client's widget_data.dart (the bits the RN widgets use).

import { toNumber } from './format';

export class WidgetMeta {
  constructor(public raw: Record<string, any>) {}
  get title(): string { return this.raw.title ?? ''; }
  get widgetType(): string { return this.raw.widgetType ?? ''; }
  get entityType(): string { return this.raw.entityType ?? 'document'; }
  get entityName(): string { return this.raw.entityName ?? ''; }
  get maxItems(): number { return Number(this.raw.maxItems ?? 8); }
  get hint(): string { return this.raw.hint ?? ''; }
  get extra(): Record<string, any> { return this.raw.extraConfig ?? {}; }

  cfg(key: string, fallback = ''): string {
    const v = this.extra[key];
    return v == null ? fallback : String(v);
  }

  /** REST `{kind}` segment: documents | catalogs | registers. */
  get kind(): string {
    return this.entityType === 'catalog' ? 'catalogs' : this.entityType === 'register' ? 'registers' : 'documents';
  }
}

/** A single aggregate over all rows (count / sum / avg / min / max). */
export function aggregate(rows: Record<string, any>[], metric = 'count', metricField?: string): number {
  if (metric === 'count' || !metricField) return metric === 'count' ? rows.length : 0;
  const nums = rows.map((r) => toNumber(r[metricField])).filter((n): n is number => n != null);
  if (!nums.length) return 0;
  switch (metric) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    default: return nums.reduce((a, b) => a + b, 0);
  }
}
