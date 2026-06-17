// onec-list — a catalog/document browse list. The server emits a descriptor
// (columns, sort, searchability, routes); the widget fetches rows from
// GET /api/list/{kind}/{name} and renders a bordered, horizontally-scrollable
// table. Row tap opens onec://{kind}/{name}/{id}. Port of onec_list.dart.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Row } from '../../api/onecClient';
import { applyFormat, isAvatarWidget, isImageWidget, looksLikeImageUrl } from '../format';
import type { CustomRenderer, DivHost } from '../types';
import { LucideIcon } from './lucide';

interface Col {
  columnName: string;
  label?: string;
  width?: string | number;
  widget?: string;
  format?: string;
}

function colWidth(col: Col, first: boolean): number {
  const w = col.width;
  if (typeof w === 'number') return w;
  if (typeof w === 'string') {
    const m = w.match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return first ? 170 : 150;
}

function cellText(row: Row, col: Col): string {
  const raw = row[col.columnName];
  if (raw === '__SECRET_SET__') return '•••• set';
  const display = row[`${col.columnName}_display`] ?? raw;
  if (display == null) return '';
  if (typeof display === 'boolean') return display ? 'Yes' : 'No';
  const text = String(display);
  if (text.startsWith('data:')) return '🖼';
  return applyFormat(text, col.format) ?? text;
}

function OnecList({ desc, host }: { desc: Record<string, any>; host: DivHost }) {
  const kind = (desc.kind as string) ?? 'catalogs';
  const name = (desc.name as string) ?? '';
  const pageSize = Number(desc.pageSize ?? 100);
  const searchable = desc.searchable === true;
  const newUrl = desc.newUrl as string | undefined;
  const columns: Col[] = Array.isArray(desc.columns) ? desc.columns : [];

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(desc.sort?.column ?? null);
  const [sortDesc, setSortDesc] = useState<boolean>(desc.sort?.descending === true);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(reset: boolean, q = query, sc = sortColumn, sd = sortDesc) {
    reset ? setLoading(true) : setLoadingMore(true);
    setError(null);
    try {
      const page = await host.client.listRows(kind, name, {
        q,
        limit: pageSize,
        offset: reset ? 0 : rows.length,
        sort: sc ?? undefined,
        descending: sd,
      });
      setRows((prev) => (reset ? page.rows : [...prev, ...page.rows]));
      setTotal(page.total);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, name]);

  function onQuery(q: string) {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(true, q), 250);
  }

  function toggleSort(column: string) {
    let nextCol: string | null = column;
    let nextDesc = false;
    if (sortColumn === column) {
      if (!sortDesc) nextDesc = true;
      else { nextCol = null; nextDesc = false; }
    }
    setSortColumn(nextCol);
    setSortDesc(nextDesc);
    load(true, query, nextCol, nextDesc);
  }

  const widths = columns.map((c, i) => colWidth(c, i === 0));
  const tableWidth = widths.reduce((a, b) => a + b, 0) + 24;
  const title = (desc.title as string) ?? name;

  return (
    <View>
      <Text style={s.h1}>{title}</Text>
      {!loading && <Text style={s.muted}>{total} {total === 1 ? 'row' : 'rows'}</Text>}

      {searchable && (
        <View style={s.searchRow}>
          <View style={s.search}>
            <LucideIcon name="search" size={16} color="#9CA3AF" />
            <TextInput
              placeholder="Search…"
              placeholderTextColor="#9CA3AF"
              style={s.searchInput}
              onChangeText={onQuery}
            />
          </View>
          {newUrl && (
            <Pressable style={s.addBtn} onPress={() => host.fire(newUrl)}>
              <LucideIcon name="plus" size={20} color="#FFFFFF" />
            </Pressable>
          )}
        </View>
      )}

      {loading ? (
        <View style={s.center}><ActivityIndicator /></View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.muted}>Failed to load: {error}</Text>
          <Pressable style={s.retry} onPress={() => load(true)}><Text style={s.retryText}>Retry</Text></Pressable>
        </View>
      ) : rows.length === 0 ? (
        <View style={s.center}><Text style={s.muted}>{query ? 'No matches.' : 'No records.'}</Text></View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tableWrap}>
            <View style={{ width: tableWidth }}>
              <View style={s.headerRow}>
                {columns.map((c, i) => (
                  <Pressable key={i} style={{ width: widths[i], flexDirection: 'row', alignItems: 'center' }} onPress={() => toggleSort(c.columnName)}>
                    <Text style={s.headerCell} numberOfLines={1}>{c.label ?? c.columnName}</Text>
                    <LucideIcon
                      name={sortColumn !== c.columnName ? 'chevrons-up-down' : sortDesc ? 'arrow-down' : 'arrow-up'}
                      size={13}
                      color="#9CA3AF"
                    />
                  </Pressable>
                ))}
              </View>
              {rows.map((row, r) => (
                <Pressable
                  key={r}
                  style={[s.dataRow, r < rows.length - 1 && s.rowDivider]}
                  onPress={() => { if (row._id != null) host.fire(`onec://${kind}/${name}/${row._id}`); }}
                >
                  {columns.map((c, i) => (
                    <View key={i} style={{ width: widths[i], paddingRight: 12 }}>
                      <Cell row={row} col={c} first={i === 0} baseUrl={host.baseUrl} />
                    </View>
                  ))}
                </Pressable>
              ))}
            </View>
          </ScrollView>
          {rows.length < total && (
            <View style={s.center}>
              {loadingMore ? (
                <ActivityIndicator />
              ) : (
                <Pressable style={s.retry} onPress={() => load(false)}>
                  <Text style={s.retryText}>Load more ({total - rows.length})</Text>
                </Pressable>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}

function Cell({ row, col, first, baseUrl }: { row: Row; col: Col; first: boolean; baseUrl?: string }) {
  if (col.columnName === '_posted') {
    const posted = row._posted === true;
    return (
      <View style={[s.badge, { backgroundColor: posted ? '#DCFCE7' : '#F3F4F6' }]}>
        <Text style={{ fontSize: 11, fontWeight: '500', color: posted ? '#16A34A' : '#737373' }}>
          {posted ? 'Posted' : 'Draft'}
        </Text>
      </View>
    );
  }
  if (isImageWidget(col.widget)) {
    const v = String(row[`${col.columnName}_display`] ?? row[col.columnName] ?? '');
    if (looksLikeImageUrl(v)) {
      const uri = v.startsWith('/') ? `${baseUrl ?? ''}${v}` : v;
      const dim = isAvatarWidget(col.widget) ? 28 : 40;
      return <Image source={{ uri }} style={{ width: dim, height: dim, borderRadius: isAvatarWidget(col.widget) ? dim / 2 : 6 }} />;
    }
  }
  const isRef = Object.prototype.hasOwnProperty.call(row, `${col.columnName}_ref`);
  return (
    <Text
      numberOfLines={1}
      style={{ fontSize: 14, color: isRef ? '#2563EB' : first ? '#0A0A0A' : '#737373', fontWeight: first ? '500' : '400' }}
    >
      {cellText(row, col)}
    </Text>
  );
}

export const onecList: CustomRenderer = ({ block, host }) => {
  const desc = (block.custom_props?.list as Record<string, any>) ?? {};
  return <OnecList desc={desc} host={host} />;
};

const s = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '700', color: '#0A0A0A' },
  muted: { color: '#737373', fontSize: 13 },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  search: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, paddingHorizontal: 10, height: 40,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0A0A0A', paddingVertical: 0 },
  addBtn: { width: 44, height: 40, borderRadius: 8, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 10 },
  tableWrap: { marginTop: 12, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10 },
  headerRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerCell: { fontSize: 12, color: '#737373', fontWeight: '500', flexShrink: 1 },
  dataRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 12 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start' },
  retry: { backgroundColor: '#111827', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  retryText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
});
