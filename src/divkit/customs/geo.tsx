// GeoField — the form control for an attribute hinted `.widget("map")` (also "geo" /
// "geolocation"). The value is a plain "lat,lng" string (so it round-trips through any
// String attribute). RN has no Leaflet and the app ships no map SDK / WebView, so this is
// a hand-written OpenStreetMap raster-tile slippy map — the RN stand-in for the web SPA's
// geo-picker.tsx, the same way charts.tsx stands in for recharts. Pan to move, tap to drop
// the pin, +/- to zoom, or type precise coordinates into the lat/lng fields.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../theme';

const TILE = 256;
const MAP_HEIGHT = 220;
const MIN_ZOOM = 2;
const MAX_ZOOM = 19;
const DEFAULT_CENTER: [number, number] = [20, 0];

// ----- Web Mercator: lat/lng <-> world pixels at a zoom level -----

function project(lat: number, lng: number, zoom: number): [number, number] {
  const scale = TILE * 2 ** zoom;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const x = ((lng + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return [x, y];
}

function unproject(x: number, y: number, zoom: number): [number, number] {
  const scale = TILE * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return [lat, lng];
}

function parseLatLng(value: string | undefined): [number, number] | null {
  if (!value) return null;
  const parts = value.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

const format = (lat: number, lng: number) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
// Trim trailing zeros for display in the numeric fields (12.500000 -> "12.5").
const num = (n: number) => String(Number(n.toFixed(6)));

export function GeoField({ value, onChange, theme }: { value?: string; onChange: (v: string) => void; theme: 'light' | 'dark' }) {
  const c = colors(theme);
  const point = parseLatLng(value);
  const [center, setCenter] = useState<[number, number]>(point ?? DEFAULT_CENTER);
  const [zoom, setZoom] = useState(point ? 13 : MIN_ZOOM);
  const [width, setWidth] = useState(0);

  // The pan/tap handlers are created once, so read live state through a ref to avoid stale closures.
  const live = useRef({ center, zoom, width, onChange });
  live.current = { center, zoom, width, onChange };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 2,
      onPanResponderGrant: (e) => {
        const { center: ctr, zoom: z } = live.current;
        grab.current = {
          lx: e.nativeEvent.locationX,
          ly: e.nativeEvent.locationY,
          world: project(ctr[0], ctr[1], z),
          moved: 0,
        };
      },
      onPanResponderMove: (_e, g) => {
        const start = grab.current;
        if (!start) return;
        start.moved = Math.abs(g.dx) + Math.abs(g.dy);
        const z = live.current.zoom;
        setCenter(unproject(start.world[0] - g.dx, start.world[1] - g.dy, z));
      },
      onPanResponderRelease: (_e, g) => {
        const start = grab.current;
        grab.current = null;
        if (!start) return;
        const { zoom: z, width: w, onChange: cb } = live.current;
        // A tap (negligible travel) drops the pin where the finger landed; a drag just panned.
        if (start.moved + Math.abs(g.dx) + Math.abs(g.dy) < 6) {
          const tlx = start.world[0] - w / 2;
          const tly = start.world[1] - MAP_HEIGHT / 2;
          const [lat, lng] = unproject(tlx + start.lx, tly + start.ly, z);
          cb(format(lat, lng));
        }
      },
    }),
  ).current;
  const grab = useRef<{ lx: number; ly: number; world: [number, number]; moved: number } | null>(null);

  // ----- numeric fields (free typing; only committed when both parse to a valid point) -----

  const [latText, setLatText] = useState(point ? num(point[0]) : '');
  const [lngText, setLngText] = useState(point ? num(point[1]) : '');
  // Reflect an externally-set value (tap/pan/record load) into the fields — but not our own
  // just-typed value, or the cursor would jump.
  useEffect(() => {
    const p = parseLatLng(value);
    const curLat = latText.trim() === '' ? null : Number(latText);
    const curLng = lngText.trim() === '' ? null : Number(lngText);
    const same = p
      ? curLat != null && curLng != null && Math.abs(p[0] - curLat) < 1e-6 && Math.abs(p[1] - curLng) < 1e-6
      : curLat == null && curLng == null;
    if (!same) {
      setLatText(p ? num(p[0]) : '');
      setLngText(p ? num(p[1]) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (latStr: string, lngStr: string) => {
    if (latStr.trim() === '' && lngStr.trim() === '') {
      onChange('');
      return;
    }
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (latStr.trim() === '' || lngStr.trim() === '' || Number.isNaN(lat) || Number.isNaN(lng)) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    onChange(format(lat, lng));
    setCenter([lat, lng]);
  };

  // ----- tile + marker geometry for the current view -----

  const view = useMemo(() => {
    if (width <= 0) return null;
    const [cx, cy] = project(center[0], center[1], zoom);
    const tlx = cx - width / 2;
    const tly = cy - MAP_HEIGHT / 2;
    const scale = 2 ** zoom;
    const tiles: { key: string; left: number; top: number; uri: string }[] = [];
    for (let tx = Math.floor(tlx / TILE); tx <= Math.floor((tlx + width) / TILE); tx++) {
      for (let ty = Math.floor(tly / TILE); ty <= Math.floor((tly + MAP_HEIGHT) / TILE); ty++) {
        if (ty < 0 || ty >= scale) continue; // no vertical wrap (poles)
        const wx = ((tx % scale) + scale) % scale; // wrap longitude
        tiles.push({
          key: `${zoom}/${tx}/${ty}`,
          left: tx * TILE - tlx,
          top: ty * TILE - tly,
          uri: `https://tile.openstreetmap.org/${zoom}/${wx}/${ty}.png`,
        });
      }
    }
    let marker: { left: number; top: number } | null = null;
    if (point) {
      const [mx, my] = project(point[0], point[1], zoom);
      marker = { left: mx - tlx, top: my - tly };
    }
    return { tiles, marker };
  }, [width, center, zoom, point?.[0], point?.[1]]);

  const fieldStyle = {
    borderWidth: 1,
    borderColor: c.fieldBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: c.text,
    backgroundColor: c.fieldBg,
    minHeight: 40,
  } as const;

  return (
    <View style={{ gap: 8 }}>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
        style={{ height: MAP_HEIGHT, borderRadius: 10, borderWidth: 1, borderColor: c.border, overflow: 'hidden', backgroundColor: c.surface }}
      >
        {view?.tiles.map((t) => (
          <Image key={t.key} source={{ uri: t.uri }} style={{ position: 'absolute', left: t.left, top: t.top, width: TILE, height: TILE }} fadeDuration={0} />
        ))}

        {view?.marker && (
          <View pointerEvents="none" style={{ position: 'absolute', left: view.marker.left - 13, top: view.marker.top - 34 }}>
            <Svg width={26} height={34} viewBox="0 0 26 34">
              <Path
                d="M13 0C5.82 0 0 5.82 0 13c0 9.2 11.1 19.6 11.6 20.04a2 2 0 0 0 2.8 0C14.9 32.6 26 22.2 26 13 26 5.82 20.18 0 13 0z"
                fill="#DC2626"
              />
              <Circle cx={13} cy={13} r={5} fill="#fff" />
            </Svg>
          </View>
        )}

        {/* Zoom controls */}
        <View style={{ position: 'absolute', top: 8, right: 8, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: c.border }}>
          {(['+', '−'] as const).map((sym, i) => (
            <Pressable
              key={sym}
              onPress={() => setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + (sym === '+' ? 1 : -1))))}
              style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}
            >
              <Text style={{ fontSize: 20, fontWeight: '600', color: c.text, lineHeight: 22 }}>{sym}</Text>
            </Pressable>
          ))}
        </View>

        {/* Tile attribution (OSM requires it) */}
        <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 4, borderTopLeftRadius: 4 }}>
          <Text style={{ fontSize: 9, color: '#333' }}>© OpenStreetMap</Text>
        </View>

        {width > 0 && !view?.tiles.length && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 12, color: c.muted }}>Tap the map to set a location.</Text>
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 11, color: c.muted }}>Latitude</Text>
          <TextInput
            value={latText}
            onChangeText={(t) => {
              setLatText(t);
              commit(t, lngText);
            }}
            keyboardType="numbers-and-punctuation"
            placeholder="—"
            placeholderTextColor={c.muted}
            style={fieldStyle}
          />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 11, color: c.muted }}>Longitude</Text>
          <TextInput
            value={lngText}
            onChangeText={(t) => {
              setLngText(t);
              commit(latText, t);
            }}
            keyboardType="numbers-and-punctuation"
            placeholder="—"
            placeholderTextColor={c.muted}
            style={fieldStyle}
          />
        </View>
      </View>
    </View>
  );
}
