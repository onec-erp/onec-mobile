// onec-form — create/edit a catalog or document. The server emits a portable
// descriptor (field metadata + initial values + submit target); we render
// controls, validate, and submit to the REST API. Port of onec_form.dart.
// Covered: text / number / boolean / enum / ref / date / secret + catalog
// code+description. Not yet: tabular sections (logged as a notice).

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Row } from '../../api/onecClient';
import type { CustomRenderer, DivHost } from '../types';

type Attr = Record<string, any>;
const NUMERIC = new Set(['BigDecimal', 'Integer', 'Long', 'Double', 'Float', 'Short', 'int', 'long', 'double']);

function OnecForm({ form, host }: { form: Record<string, any>; host: DivHost }) {
  const meta = form.meta ?? {};
  const initial: Row = form.initial ?? {};
  const kind = (form.kind as string) ?? 'catalogs';
  const name = (form.name as string) ?? '';
  const id = form.id as string | undefined;
  const isEdit = id != null && form.duplicate !== true;

  const attributes: Attr[] = useMemo(
    () =>
      ((meta.attributes as Attr[]) ?? [])
        .filter((a) => a.visibleInForm !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [meta],
  );

  const [values, setValues] = useState<Row>(() => {
    const v: Row = {};
    if (kind === 'catalogs') {
      if (meta.autoNumber !== true) v.__code = initial._code;
      v.__description = initial._description;
    }
    for (const a of attributes) {
      if (a.secret === true) continue;
      v[a.fieldName] = initial[a.columnName ?? a.fieldName];
    }
    return v;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>('');

  const set = (field: string, value: unknown) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => {
      if (!e[field]) return e;
      const { [field]: _, ...rest } = e;
      return rest;
    });
  };

  function validate(): boolean {
    const errs: Record<string, string> = {};
    for (const a of attributes) {
      if (a.required === true && a.secret !== true) {
        const v = values[a.fieldName];
        if (v == null || (typeof v === 'string' && !v.trim())) errs[a.fieldName] = `'${a.displayName}' is required`;
      }
    }
    if (kind === 'catalogs' && meta.autoNumber !== true && !String(values.__code ?? '').trim()) {
      errs.__code = 'Code is required';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function payload(): Row {
    const body: Row = {};
    if (kind === 'catalogs') {
      if (values.__code != null) body.code = values.__code;
      if (values.__description != null) body.description = values.__description;
    }
    for (const a of attributes) {
      const field = a.fieldName as string;
      if (a.secret === true) {
        if (values[field]) body[field] = values[field];
        continue;
      }
      body[field] = values[field];
    }
    if (isEdit && initial._version != null) body._version = initial._version;
    return body;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true);
    setNotice('');
    try {
      const body = payload();
      const saved = isEdit
        ? await host.client.updateEntity(kind, name, id!, body)
        : await host.client.createEntity(kind, name, body);
      const savedId = saved._id ?? id;
      if (savedId != null) host.fire(`onec://${kind}/${name}/${savedId}`);
      else host.refresh();
    } catch (e: any) {
      const data = e?.data;
      if (data?.fieldErrors) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(data.fieldErrors)) fe[k] = Array.isArray(v) ? String(v[0]) : String(v);
        setErrors(fe);
        setNotice('Please fix the errors');
      } else {
        setNotice(String(data?.message ?? e?.message ?? 'Save failed'));
      }
    } finally {
      setSaving(false);
    }
  }

  const hasSections = Array.isArray(meta.tabularSections) && meta.tabularSections.length > 0;

  return (
    <View>
      <Text style={s.title}>{form.title ?? 'Form'}</Text>

      {kind === 'catalogs' && meta.autoNumber !== true && (
        <Field label="Code" required error={errors.__code}>
          <TextInput style={s.input} value={str(values.__code)} onChangeText={(t) => set('__code', t)} />
        </Field>
      )}
      {kind === 'catalogs' && (
        <Field label="Description">
          <TextInput style={s.input} value={str(values.__description)} onChangeText={(t) => set('__description', t)} />
        </Field>
      )}

      {attributes.map((a) => (
        <FieldControl key={a.fieldName} attr={a} value={values[a.fieldName]} error={errors[a.fieldName]} onChange={(v) => set(a.fieldName, v)} host={host} />
      ))}

      {hasSections && <Text style={s.notice}>Tabular sections aren’t rendered yet on mobile.</Text>}
      {notice ? <Text style={s.error}>{notice}</Text> : null}

      <Pressable style={[s.submit, saving && { opacity: 0.6 }]} disabled={saving} onPress={submit}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>{form.submitLabel ?? 'Save'}</Text>}
      </Pressable>
      <Pressable style={s.cancel} disabled={saving} onPress={() => host.refresh()}>
        <Text style={s.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function FieldControl({
  attr,
  value,
  error,
  onChange,
  host,
}: {
  attr: Attr;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  host: DivHost;
}) {
  const label = (attr.displayName as string) ?? attr.fieldName;
  const required = attr.required === true;
  const javaType = (attr.javaType as string) ?? 'String';

  if (attr.secret === true) {
    return (
      <Field label={label} error={error}>
        <TextInput style={s.input} secureTextEntry placeholder="Leave blank to keep current" onChangeText={onChange} />
      </Field>
    );
  }
  if (attr.isRef === true) {
    return <RefField attr={attr} value={value} error={error} onChange={onChange} host={host} label={label} required={required} />;
  }
  if (attr.isEnum === true) {
    const options: string[] = ((attr.enumValues as Attr[]) ?? []).map((e) => e.name).filter(Boolean);
    return <EnumField label={label} required={required} error={error} value={str(value)} options={options} onChange={onChange} />;
  }
  if (javaType === 'boolean' || javaType === 'Boolean') {
    return (
      <View style={s.switchRow}>
        <Text style={s.label}>{label}</Text>
        <Switch value={value === true} onValueChange={onChange} />
      </View>
    );
  }
  const number = NUMERIC.has(javaType);
  return (
    <Field label={label} required={required} error={error}>
      <TextInput
        style={s.input}
        value={str(value)}
        placeholder={attr.placeholder as string | undefined}
        keyboardType={number ? 'numeric' : 'default'}
        onChangeText={(t) => onChange(number ? (t === '' ? null : Number(t)) : t)}
      />
    </Field>
  );
}

function RefField({
  attr,
  value,
  error,
  onChange,
  host,
  label,
  required,
}: {
  attr: Attr;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  host: DivHost;
  label: string;
  required: boolean;
}) {
  const refKind = (attr.refKind ?? 'catalog') === 'document' ? 'documents' : 'catalogs';
  const target = (attr.refTarget as string) ?? '';
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [display, setDisplay] = useState<string>(str(attr.__display));
  const [loading, setLoading] = useState(false);

  async function search(q: string) {
    setLoading(true);
    try {
      setRows(await host.client.typeahead(refKind, target, q, 30));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Field label={label} required={required} error={error}>
      <Pressable style={s.input} onPress={() => { setOpen(true); search(''); }}>
        <Text style={{ color: display || value ? '#0A0A0A' : '#9CA3AF' }}>{display || (value ? String(value) : 'Select…')}</Text>
      </Pressable>
      <Picker
        open={open}
        loading={loading}
        title={`Select ${target}`}
        onClose={() => setOpen(false)}
        onSearch={search}
        rows={rows.map((r) => ({ id: String(r._id), label: String(r._code ?? r._description ?? r.name ?? r._id) }))}
        onPick={(opt) => { onChange(opt.id); setDisplay(opt.label); setOpen(false); }}
      />
    </Field>
  );
}

function EnumField({
  label, required, error, value, options, onChange,
}: { label: string; required: boolean; error?: string; value: string; options: string[]; onChange: (v: unknown) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Field label={label} required={required} error={error}>
      <Pressable style={s.input} onPress={() => setOpen(true)}>
        <Text style={{ color: value ? '#0A0A0A' : '#9CA3AF' }}>{value || '—'}</Text>
      </Pressable>
      <Picker
        open={open}
        title={label}
        onClose={() => setOpen(false)}
        rows={[{ id: '', label: '—' }, ...options.map((o) => ({ id: o, label: o }))]}
        onPick={(opt) => { onChange(opt.id || null); setOpen(false); }}
      />
    </Field>
  );
}

function Picker({
  open, title, rows, onPick, onClose, onSearch, loading,
}: {
  open: boolean;
  title: string;
  rows: { id: string; label: string }[];
  onPick: (o: { id: string; label: string }) => void;
  onClose: () => void;
  onSearch?: (q: string) => void;
  loading?: boolean;
}) {
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalSheet}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{title}</Text>
            <Pressable onPress={onClose}><Text style={s.modalClose}>Close</Text></Pressable>
          </View>
          {onSearch && (
            <TextInput style={[s.input, { margin: 12 }]} placeholder="Search…" placeholderTextColor="#9CA3AF" onChangeText={onSearch} autoFocus />
          )}
          {loading ? (
            <ActivityIndicator style={{ marginVertical: 24 }} />
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(it, i) => it.id + i}
              renderItem={({ item }) => (
                <Pressable style={s.pickRow} onPress={() => onPick(item)}>
                  <Text style={{ fontSize: 15, color: '#0A0A0A' }}>{item.label}</Text>
                </Pressable>
              )}
              style={{ maxHeight: 360 }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginVertical: 6 }}>
      <Text style={s.label}>{label}{required ? ' *' : ''}</Text>
      {children}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

const str = (v: unknown) => (v == null ? '' : String(v));

export const onecForm: CustomRenderer = ({ block, host }) => {
  const form = (block.custom_props?.form as Record<string, any>) ?? {};
  return <OnecForm form={form} host={host} />;
};

const s = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '700', color: '#0A0A0A', marginBottom: 12 },
  label: { fontSize: 13, color: '#374151', marginBottom: 4, fontWeight: '500' },
  input: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 15, color: '#0A0A0A', backgroundColor: '#FFFFFF', justifyContent: 'center', minHeight: 44,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  error: { color: '#B91C1C', fontSize: 12, marginTop: 4 },
  notice: { color: '#92400E', fontSize: 12, marginTop: 8 },
  submit: { backgroundColor: '#111827', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  submitText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  cancel: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  cancelText: { color: '#374151', fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#0A0A0A' },
  modalClose: { color: '#2563EB', fontWeight: '600' },
  pickRow: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
});
