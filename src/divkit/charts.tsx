// Native chart primitives drawn with react-native-svg — the RN equivalent of the
// web SPA's recharts usage (sparkline / bar / line / area / pie / donut / gauge).
// Each chart measures its own width via onLayout (RN SVG needs explicit sizes),
// then maps the data into SVG paths. Colors come from a theme-driven categorical
// palette mirroring the web `--chart-N` CSS vars, overridable per widget.

import React, { useId, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { formatCompact } from './format';
import type { ThemeColors } from './theme';
import type { SeriesData } from './widgetData';
import { SINGLE_SERIES } from './widgetData';

// ----- color resolution (mirrors lib/chart-colors.ts, with concrete HSL) -----

// The `--chart-N` palettes from the web index.css, per theme.
const PALETTE_LIGHT = ['222,83%,58%', '152,60%,42%', '38,92%,50%', '348,83%,58%', '262,70%,60%', '190,80%,42%', '24,90%,55%', '322,75%,58%'];
const PALETTE_DARK = ['222,90%,66%', '152,55%,52%', '38,92%,58%', '348,85%,66%', '262,78%,70%', '190,75%,52%', '24,90%,62%', '322,78%,66%'];

const hsl = (triple: string) => `hsl(${triple})`;

export function chartPalette(theme: 'light' | 'dark'): string[] {
  return (theme === 'dark' ? PALETTE_DARK : PALETTE_LIGHT).map(hsl);
}

/** Resolve one `config("colors", …)` token: a named alias, a `chart-N` slot, or a literal color. */
function resolveColorToken(token: string, theme: 'light' | 'dark', c: ThemeColors): string {
  const t = token.trim();
  if (!t) return '';
  const lower = t.toLowerCase();
  const palette = chartPalette(theme);
  const aliases: Record<string, string> = {
    primary: c.primary,
    success: c.successFg,
    warning: hsl('38,92%,50%'),
    destructive: c.dangerFg,
    danger: c.dangerFg,
    muted: c.muted,
  };
  if (lower in aliases) return aliases[lower];
  const slot = /^chart-([1-8])$/.exec(lower);
  if (slot) return palette[Number(slot[1]) - 1];
  return t; // a literal CSS color (#hex / rgb() / hsl() / named)
}

function parseColors(override: string | undefined, theme: 'light' | 'dark', c: ThemeColors): string[] {
  return (override ?? '').split(',').map((tok) => resolveColorToken(tok, theme, c)).filter(Boolean);
}

/** Exactly `count` colors: author overrides win slot-by-slot, palette fills (and cycles for) the rest. */
export function resolveColors(count: number, override: string | undefined, theme: 'light' | 'dark', c: ThemeColors): string[] {
  const palette = chartPalette(theme);
  const custom = parseColors(override, theme, c);
  return Array.from({ length: count }, (_, i) => custom[i] ?? palette[i % palette.length]);
}

/** A single color — the first override token, else the lead palette slot. */
export function resolveColor(override: string | undefined, theme: 'light' | 'dark', c: ThemeColors): string {
  return resolveColors(1, override, theme, c)[0];
}

// ----- smooth curve (monotone cubic, mirrors recharts' type="monotone") -----

// Fritsch–Carlson monotone cubic interpolation, the same curve d3-shape's
// `curveMonotoneX` (and therefore recharts) draws: smooth through every point
// but guaranteed not to overshoot, so a sparkline never dips below its own min.
// Emits an SVG path of one `M` + cubic `C` segments through the given points.
type Pt = readonly [number, number];

const sign = (x: number) => (x < 0 ? -1 : 1);

// Tangent at an interior point from the slopes of its two neighbouring segments.
function slope3(p0: Pt, p1: Pt, p2: Pt): number {
  const h0 = p1[0] - p0[0];
  const h1 = p2[0] - p1[0];
  const s0 = (p1[1] - p0[1]) / (h0 || (h1 < 0 ? -0 : 1e-9));
  const s1 = (p2[1] - p1[1]) / (h1 || (h0 < 0 ? -0 : 1e-9));
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}

// Endpoint tangent (one-sided), given the interior tangent next to it.
function slope2(p0: Pt, p1: Pt, t: number): number {
  const h = p1[0] - p0[0];
  return h ? (3 * ((p1[1] - p0[1]) / h) - t) / 2 : t;
}

function bezierTo(p0: Pt, p1: Pt, t0: number, t1: number): string {
  const dx = (p1[0] - p0[0]) / 3;
  return `C${(p0[0] + dx).toFixed(2)} ${(p0[1] + dx * t0).toFixed(2)} ${(p1[0] - dx).toFixed(2)} ${(p1[1] - dx * t1).toFixed(2)} ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
}

// The curve commands AFTER the initial point — i.e. the `C…`/`L` that draw from
// pts[0] through pts[n-1]. Split out so a stacked area can trace its top edge
// forward and its (already-positioned) bottom edge backward without a stray `M`.
function monotoneSegments(pts: Pt[]): string {
  const n = pts.length;
  if (n < 2) return '';
  if (n === 2) return `L${pts[1][0].toFixed(2)} ${pts[1][1].toFixed(2)}`;
  let d = '';
  let t0 = NaN;
  for (let i = 2; i < n; i++) {
    const t1 = slope3(pts[i - 2], pts[i - 1], pts[i]); // tangent at pts[i-1]
    const startT = i === 2 ? slope2(pts[0], pts[1], t1) : t0; // tangent at pts[i-2]
    d += (d ? ' ' : '') + bezierTo(pts[i - 2], pts[i - 1], startT, t1);
    t0 = t1;
  }
  // closing segment, with a one-sided tangent at the final point
  return `${d} ${bezierTo(pts[n - 2], pts[n - 1], t0, slope2(pts[n - 2], pts[n - 1], t0))}`;
}

export function monotonePath(pts: Pt[]): string {
  if (pts.length === 0) return '';
  const head = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  return pts.length === 1 ? head : `${head} ${monotoneSegments(pts)}`;
}

// ----- layout helper: measure width before drawing -----

function ChartFrame({ height, children }: { height: number; children: (w: number) => React.ReactNode }) {
  const [w, setW] = useState(0);
  return (
    <View
      style={{ height, width: '100%', position: 'relative' }}
      onLayout={(e) => {
        const nw = Math.round(e.nativeEvent.layout.width);
        if (nw && nw !== w) setW(nw);
      }}
    >
      {w > 0 ? children(w) : null}
    </View>
  );
}

// ----- sparkline (axis-less area/line trend) -----

export function Sparkline({
  data,
  color,
  kind = 'area',
  height = 48,
  c,
}: {
  data: number[];
  color: string;
  kind?: 'area' | 'line';
  height?: number;
  c: ThemeColors;
}) {
  const gradId = `spark-${useId().replace(/:/g, '')}`;
  if (data.length === 0) return <View style={{ height }} />;
  if (data.length === 1) data = [data[0], data[0]];

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 2;

  return (
    <ChartFrame height={height}>
      {(w) => {
        const innerH = height - pad * 2;
        const pts = data.map((v, i) => {
          const x = (i / (data.length - 1)) * w;
          const y = pad + innerH - ((v - min) / span) * innerH;
          return [x, y] as const;
        });
        const line = monotonePath(pts);
        const base = height - pad;
        const area = `${line} L${w.toFixed(1)} ${base} L0 ${base} Z`;
        return (
          <Svg width={w} height={height}>
            {kind === 'area' && (
              <>
                <Defs>
                  <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor={color} stopOpacity={0.35} />
                    <Stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </LinearGradient>
                </Defs>
                <Path d={area} fill={`url(#${gradId})`} />
              </>
            )}
            <Path d={line} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          </Svg>
        );
      }}
    </ChartFrame>
  );
}

// ----- shared XY axis math (bar / line / area) -----

const AXIS_W = 40;
const LABEL_H = 22;
const TOP_PAD = 6;

/**
 * A "nice" axis from 0 to just above `max`: pick a round step (1/2/2.5/5 × 10ⁿ)
 * targeting ~5 intervals, then top = the first multiple of that step at or above
 * `max`. Unlike a single round-up, this hugs the data (22K → 25K, not 50K) so the
 * series fill the plot instead of cowering in the bottom quarter.
 */
function niceScale(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const rough = max / 5;
  const base = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / base;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * base;
  const count = Math.ceil(max / step);
  const top = count * step;
  // index × step (not a += accumulator) so we don't drift to 0.6000000000001
  const ticks = Array.from({ length: count + 1 }, (_, i) => i * step);
  return { top, ticks };
}

interface XYProps {
  data: SeriesData;
  colors: string[];
  c: ThemeColors;
  fmtAxis: (n: number) => string;
  stacked?: boolean;
  height?: number;
}

export function XYChart({ kind, ...p }: XYProps & { kind: 'bar' | 'line' | 'area' }) {
  const { data, colors, c, fmtAxis, stacked = false, height = 230 } = p;
  const gradId = `xy-${useId().replace(/:/g, '')}`;
  const keys = data.seriesKeys;
  const n = data.rows.length;

  let maxY = 0;
  for (const row of data.rows) {
    if (stacked) maxY = Math.max(maxY, keys.reduce((s, k) => s + (Number(row[k]) || 0), 0));
    else for (const k of keys) maxY = Math.max(maxY, Number(row[k]) || 0);
  }
  const { top, ticks: yTicks } = niceScale(maxY);

  return (
    <ChartFrame height={height}>
      {(w) => {
        const plotX = AXIS_W;
        const plotW = Math.max(1, w - AXIS_W);
        const plotH = height - LABEL_H - TOP_PAD;
        const yOf = (v: number) => TOP_PAD + plotH - (v / top) * plotH;
        const band = plotW / Math.max(1, n);

        const grid = yTicks.map((t, i) => {
          const y = yOf(t);
          return (
            <G key={`g${i}`}>
              <Line x1={plotX} y1={y} x2={w} y2={y} stroke={c.border} strokeWidth={1} strokeDasharray="3 3" />
              <SvgText x={plotX - 6} y={y + 3} fontSize={9} fill={c.muted} textAnchor="end">
                {fmtAxis(t)}
              </SvgText>
            </G>
          );
        });

        const step = Math.max(1, Math.ceil(n / 6));
        const xLabels = data.rows.map((row, i) => {
          if (step > 1 && i % step !== 0) return null;
          const cx = plotX + (i + 0.5) * band;
          return (
            <SvgText key={`x${i}`} x={cx} y={height - 6} fontSize={9} fill={c.muted} textAnchor="middle">
              {String(row.label)}
            </SvgText>
          );
        });

        let marks: React.ReactNode;
        if (kind === 'bar') {
          marks = data.rows.flatMap((row, i) => {
            const x0 = plotX + i * band;
            if (stacked) {
              const barW = Math.min(band * 0.6, 48);
              const bx = x0 + (band - barW) / 2;
              let acc = 0;
              return keys.map((k, j) => {
                const v = Number(row[k]) || 0;
                const y1 = yOf(acc + v);
                const y2 = yOf(acc);
                acc += v;
                if (v <= 0) return null;
                const isTop = j === keys.length - 1;
                return <Rect key={`${i}-${j}`} x={bx} y={y1} width={barW} height={Math.max(0, y2 - y1)} fill={colors[j]} rx={isTop ? 3 : 0} />;
              });
            }
            const groupW = Math.min(band * 0.8, 48 * keys.length);
            const gx = x0 + (band - groupW) / 2;
            const rodW = groupW / keys.length;
            return keys.map((k, j) => {
              const v = Number(row[k]) || 0;
              const y = yOf(v);
              return <Rect key={`${i}-${j}`} x={gx + j * rodW + 1} y={y} width={Math.max(1, rodW - 2)} height={Math.max(0, TOP_PAD + plotH - y)} fill={colors[j]} rx={3} />;
            });
          });
        } else {
          const isArea = kind === 'area';
          const xOf = (i: number) => (n === 1 ? plotX + plotW / 2 : plotX + (i + 0.5) * band);
          // Stacked: each series sits on the running total of the ones below it, so
          // the band's top is `lower + value` and its bottom is `lower` (which is the
          // previous series' top — the same monotone curve, so the bands tessellate
          // with no seams). Non-stacked: every series is an independent line from 0.
          const lower = data.rows.map(() => 0); // running baseline per row, advanced as we stack
          marks = keys.flatMap((k, j) => {
            const upperPts = data.rows.map((row, i) => [xOf(i), yOf(lower[i] + (Number(row[k]) || 0))] as const);
            const lowerPts = data.rows.map((row, i) => [xOf(i), yOf(stacked ? lower[i] : 0)] as const);
            if (stacked) data.rows.forEach((row, i) => (lower[i] += Number(row[k]) || 0));

            const lineD = monotonePath(upperPts);
            const out: React.ReactNode[] = [];
            if (isArea && upperPts.length) {
              let areaD: string;
              if (stacked) {
                // top edge forward, then back along the lower edge (reversed points)
                const back = lowerPts.slice().reverse();
                areaD = `${lineD} L${back[0][0].toFixed(1)} ${back[0][1].toFixed(1)} ${monotoneSegments(back)} Z`;
              } else {
                const baseY = (TOP_PAD + plotH).toFixed(1);
                areaD = `${lineD} L${upperPts[upperPts.length - 1][0].toFixed(1)} ${baseY} L${upperPts[0][0].toFixed(1)} ${baseY} Z`;
              }
              out.push(<Path key={`a${j}`} d={areaD} fill={`url(#${gradId}-${j})`} />);
            }
            out.push(<Path key={`l${j}`} d={lineD} stroke={colors[j]} strokeWidth={2.25} fill="none" strokeLinejoin="round" strokeLinecap="round" />);
            return out;
          });
        }

        return (
          <Svg width={w} height={height}>
            {kind === 'area' && (
              <Defs>
                {keys.map((k, j) => (
                  <LinearGradient key={j} id={`${gradId}-${j}`} x1="0" y1="0" x2="0" y2="1">
                    {/* Same airy gradient the web uses, stacked or not — the line
                        strokes on top are what delineate the bands. */}
                    <Stop offset="5%" stopColor={colors[j]} stopOpacity={0.3} />
                    <Stop offset="95%" stopColor={colors[j]} stopOpacity={0.02} />
                  </LinearGradient>
                ))}
              </Defs>
            )}
            {grid}
            {marks}
            {xLabels}
          </Svg>
        );
      }}
    </ChartFrame>
  );
}

// ----- pie / donut -----

function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${cx} ${cy} L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

export function PieChartView({
  data,
  colors,
  c,
  kind,
  height = 230,
}: {
  data: SeriesData;
  colors: string[];
  c: ThemeColors;
  kind: 'pie' | 'donut';
  height?: number;
}) {
  const slices = data.rows.map((r, i) => ({ value: Number(r[SINGLE_SERIES]) || 0, color: colors[i % colors.length] }));
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const gap = kind === 'donut' ? 0.03 : 0; // small inter-slice gap (radians)

  return (
    <ChartFrame height={height}>
      {(w) => {
        const cx = w / 2;
        const cy = height / 2;
        const r = Math.min(w, height) / 2 - 8;
        const positive = slices.filter((s) => s.value > 0);
        let a0 = -Math.PI / 2;
        const paths = positive.map((sl, i) => {
          const frac = sl.value / total;
          const a1 = a0 + frac * 2 * Math.PI;
          // A lone full slice can't be drawn as an arc (start === end) — use a ring/circle.
          if (positive.length === 1) {
            a0 = a1;
            return <Circle key={i} cx={cx} cy={cy} r={r} fill={sl.color} />;
          }
          const d = arcPath(cx, cy, r, a0 + gap / 2, a1 - gap / 2);
          a0 = a1;
          return <Path key={i} d={d} fill={sl.color} stroke={c.card} strokeWidth={2} />;
        });
        return (
          <Svg width={w} height={height}>
            {paths}
            {kind === 'donut' && <Circle cx={cx} cy={cy} r={r * 0.6} fill={c.card} />}
          </Svg>
        );
      }}
    </ChartFrame>
  );
}

// ----- gauge (radial progress toward a target) -----

export function GaugeView({
  pct,
  color,
  c,
  height = 168,
  children,
}: {
  pct: number; // 0..100
  color: string;
  c: ThemeColors;
  height?: number;
  children?: React.ReactNode; // centered readout
}) {
  const frac = Math.max(0, Math.min(1, pct / 100));
  return (
    <ChartFrame height={height}>
      {(w) => {
        const size = Math.min(w, height);
        const cx = w / 2;
        const cy = height / 2;
        const ringW = size * 0.13;
        const r = size / 2 - ringW / 2 - 2;
        const circ = 2 * Math.PI * r;
        return (
          <>
            <Svg width={w} height={height}>
              <Circle cx={cx} cy={cy} r={r} stroke={c.border} strokeWidth={ringW} fill="none" />
              <Circle
                cx={cx}
                cy={cy}
                r={r}
                stroke={color}
                strokeWidth={ringW}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${(circ * frac).toFixed(2)} ${(circ * (1 - frac) + 1).toFixed(2)}`}
                rotation={-90}
                originX={cx}
                originY={cy}
              />
            </Svg>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
              {children}
            </View>
          </>
        );
      }}
    </ChartFrame>
  );
}

// ----- legend (color swatch + key) -----

export function Legend({ labels, colors, c }: { labels: string[]; colors: string[]; c: ThemeColors }) {
  if (labels.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8, justifyContent: 'center' }}>
      {labels.map((label, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors[i % colors.length] }} />
          <Text style={{ color: c.muted, fontSize: 11 }}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

export { formatCompact };
