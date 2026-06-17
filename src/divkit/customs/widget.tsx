// onec-widget — a dashboard tile. The server ships a descriptor
// (custom_props.widget); each widget fetches its own rows and renders. Port of
// the Flutter onec_widget.dart. `list` and `stat` are fully rendered; chart-ish
// types (sparkline/gauge/chart/kanban/calendar) show their headline aggregate in
// a card (no chart graphics yet) rather than a raw placeholder.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Row } from '../../api/onecClient';
import {
  formatAmount,
  formatCompact,
  formatMonthDay,
  pickField,
  resolveCurrency,
  resolveText,
  splitFields,
  toNumber,
} from '../format';
import type { CustomRenderer, DivHost } from '../types';
import { aggregate, WidgetMeta } from '../widgetData';

function useRows(host: DivHost, meta: WidgetMeta) {
  const [state, setState] = useState<{ rows: Row[] | null; error: string | null }>({
    rows: null,
    error: null,
  });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows =
          meta.entityType === 'register'
            ? await host.client.rows('registers', meta.entityName, {
                registerPath: 'turnover',
                from: '1970-01-01T00:00:00',
                to: '2999-12-31T23:59:59',
              })
            : await host.client.rows(meta.kind, meta.entityName);
        if (alive) setState({ rows, error: null });
      } catch (e: any) {
        if (alive) setState({ rows: null, error: String(e?.message ?? e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [meta.entityType, meta.entityName, meta.kind]);
  return state;
}

function Card({ meta, children }: { meta: WidgetMeta; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.title} numberOfLines={1}>
        {meta.title}
      </Text>
      <View style={{ marginTop: 8 }}>{children}</View>
    </View>
  );
}

const Loading = () => (
  <View style={{ height: 64, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator />
  </View>
);
const Empty = ({ text = 'No data yet.' }: { text?: string }) => <Text style={s.muted}>{text}</Text>;

const ListWidget: CustomRenderer = ({ customProps, host }) => {
  const meta = new WidgetMeta((customProps.widget as Record<string, any>) ?? {});
  const { rows, error } = useRows(host, meta);
  const dateField = meta.cfg('dateField', '_date');

  let body: React.ReactNode;
  if (error) body = <Empty text="No records yet." />;
  else if (!rows) body = <Loading />;
  else {
    const sorted = [...rows].sort((a, b) =>
      String(b[dateField] ?? '').localeCompare(String(a[dateField] ?? '')),
    );
    const items = sorted.slice(0, meta.maxItems);
    body = items.length === 0 ? (
      <Empty text="No records yet." />
    ) : (
      <View>
        {items.map((row, i) => {
          const headline = resolveText(row, {
            template: meta.cfg('titleTemplate') || undefined,
            fields: splitFields(meta.cfg('titleField')),
            fallbacks: ['_number', '_code', '_description', 'name'],
          });
          const secondaryFields = splitFields(meta.cfg('secondaryField'));
          const secondary = pickField(
            row,
            secondaryFields.length
              ? secondaryFields
              : ['client_display', 'primary_client_display', 'property_display', 'customer_display'],
          );
          const amountFields = splitFields(meta.cfg('amountField'));
          const amountRaw = pickField(row, amountFields.length ? amountFields : ['total', 'total_gross', 'amount', '_sum']);
          const amount = amountRaw != null ? toNumber(amountRaw) : null;
          const currency = resolveCurrency(row, meta.cfg('currencyField'), meta.cfg('currency'));
          const dateStr = row[dateField] != null ? String(row[dateField]) : null;
          return (
            <Pressable
              key={i}
              style={s.row}
              onPress={() => {
                if (row._id != null) host.fire(`onec://${meta.kind}/${meta.entityName}/${row._id}`);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {headline || '—'}
                </Text>
                {secondary ? (
                  <Text style={s.muted} numberOfLines={1}>
                    {secondary}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {amount != null ? <Text style={s.amount}>{formatAmount(amount, { currency: currency ?? undefined })}</Text> : null}
                {dateStr ? <Text style={s.muted}>{formatMonthDay(dateStr) ?? ''}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return <Card meta={meta}>{body}</Card>;
};

const StatWidget: CustomRenderer = ({ customProps, host }) => {
  const meta = new WidgetMeta((customProps.widget as Record<string, any>) ?? {});
  const { rows, error } = useRows(host, meta);
  const metric = meta.cfg('metric', 'count');
  let body: React.ReactNode;
  if (error) body = <Empty />;
  else if (!rows) body = <Loading />;
  else {
    const value = aggregate(rows, metric, meta.cfg('metricField') || undefined);
    body = (
      <Text style={s.headline}>
        {formatCompact(value, { currency: meta.cfg('currency') || undefined, format: metric === 'count' ? 'integer' : undefined })}
      </Text>
    );
  }
  return <Card meta={meta}>{body}</Card>;
};

// sparkline/gauge/chart/kanban/calendar: headline aggregate in a card for now.
const AggregateCard: CustomRenderer = ({ customProps, host }) => {
  const meta = new WidgetMeta((customProps.widget as Record<string, any>) ?? {});
  const { rows, error } = useRows(host, meta);
  const metric = meta.cfg('metric', 'count');
  let body: React.ReactNode;
  if (error) body = <Empty />;
  else if (!rows) body = <Loading />;
  else {
    const value = aggregate(rows, metric, meta.cfg('metricField') || undefined);
    body = (
      <View>
        <Text style={s.headline}>{formatCompact(value, { format: metric === 'count' ? 'integer' : undefined })}</Text>
        <Text style={s.muted}>{meta.widgetType} · chart view pending</Text>
      </View>
    );
  }
  return <Card meta={meta}>{body}</Card>;
};

export const onecWidget: CustomRenderer = (p) => {
  const meta = new WidgetMeta((p.customProps.widget as Record<string, any>) ?? {});
  switch (meta.widgetType) {
    case 'list': return <ListWidget {...p} />;
    case 'stat': return <StatWidget {...p} />;
    case 'sparkline':
    case 'gauge':
    case 'chart':
    case 'kanban':
    case 'calendar': return <AggregateCard {...p} />;
    default:
      return (
        <Card meta={meta}>
          <Empty text={`No renderer for "${meta.widgetType}".`} />
        </Card>
      );
  }
};

const s = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    marginVertical: 6,
  },
  title: { fontSize: 15, fontWeight: '600', color: '#0A0A0A' },
  muted: { color: '#737373', fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  rowTitle: { fontWeight: '600', color: '#0A0A0A', fontSize: 14 },
  amount: { fontWeight: '500', color: '#0A0A0A', fontSize: 13 },
  headline: { fontSize: 28, fontWeight: '700', color: '#0A0A0A' },
});
