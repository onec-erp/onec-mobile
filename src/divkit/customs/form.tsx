// onec-form — create/edit a catalog or document. The server emits a portable
// descriptor (field metadata + initial values + submit target); we render
// controls, validate, and submit to the REST API. Port of onec_form.dart.
// Covered: text / number / boolean / enum / ref / date / secret + catalog
// code+description. Not yet: tabular sections (shown as a notice).

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { BottomSheetBackdrop, BottomSheetFlatList, BottomSheetModal, BottomSheetTextInput, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import type { Row } from '../../api/onecClient';
import { colors, isDark, type ThemeColors } from '../theme';
import type { CustomRenderer, DivHost } from '../types';
import { GeoField, MapEditor } from './geo';
import { LucideIcon } from './lucide';
import { FileField, GalleryField, ImageField } from './media';
import { Touchable } from '../../ui/touchable';

type Attr = Record<string, any>;
const NUMERIC = new Set(['BigDecimal', 'Integer', 'Long', 'Double', 'Float', 'Short', 'int', 'long', 'double']);
const ThemeC = createContext<ThemeColors>(colors('light'));

function OnecForm({ form, host }: { form: Record<string, any>; host: DivHost }) {
  const c = colors(host.theme);
  const meta = form.meta ?? {};
  const initial: Row = form.initial ?? {};
  const kind = (form.kind as string) ?? 'catalogs';
  const name = (form.name as string) ?? '';
  const id = form.id as string | undefined;
  const isEdit = id != null && form.duplicate !== true;

  const attributes: Attr[] = useMemo(
    () => ((meta.attributes as Attr[]) ?? []).filter((a) => a.visibleInForm !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [meta],
  );

  // Document child collections. The metadata ships them with the form.
  const tabularSections: Attr[] = useMemo(() => (Array.isArray(meta.tabularSections) ? meta.tabularSections : []), [meta]);

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
  // Rows per section, keyed by attribute fieldName. Loaded rows arrive keyed by column name, so
  // seed each cell from initial[section][columnName] — the same column→field asymmetry the
  // top-level fields handle. All attributes are seeded (not just visible) so hidden columns
  // survive the delete-and-reinsert on save.
  const [sections, setSections] = useState<Record<string, Row[]>>(() => {
    const seed: Record<string, Row[]> = {};
    for (const ts of tabularSections) {
      const raw = initial[ts.name];
      const attrs: Attr[] = (ts.attributes as Attr[]) ?? [];
      seed[ts.name] = Array.isArray(raw)
        ? (raw as Row[]).map((r) => {
            const row: Row = {};
            for (const a of attrs) {
              if (a.secret === true) continue;
              const col = a.columnName ?? a.fieldName;
              if (r[col] != null) row[a.fieldName] = r[col];
              // Carry the server-resolved ref label (`{col}_display`) so the picker shows the name,
              // not the stored uuid. Ignored by payload() (it only reads each attr's fieldName).
              const disp = r[`${col}_display`];
              if (disp != null) row[`${a.fieldName}_display`] = disp;
            }
            return row;
          })
        : [];
    }
    return seed;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const set = (field: string, value: unknown) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => {
      if (!e[field]) return e;
      const { [field]: _, ...rest } = e;
      return rest;
    });
  };

  // New rows go to the top so the tap has an immediately-visible result (the old append
  // dropped the row at the bottom, often off-screen — which read as "nothing happened").
  const addRow = (section: string) => setSections((p) => ({ ...p, [section]: [{}, ...(p[section] ?? [])] }));
  const removeRow = (section: string, idx: number) =>
    setSections((p) => ({ ...p, [section]: (p[section] ?? []).filter((_, i) => i !== idx) }));
  const setCell = (section: string, idx: number, key: string, value: unknown) =>
    setSections((p) => ({ ...p, [section]: (p[section] ?? []).map((row, i) => (i === idx ? { ...row, [key]: value } : row)) }));

  function validate(): boolean {
    const errs: Record<string, string> = {};
    for (const a of attributes) {
      if (a.required === true && a.secret !== true) {
        const v = values[a.fieldName];
        if (v == null || (typeof v === 'string' && !v.trim())) errs[a.fieldName] = `'${a.displayName}' is required`;
      }
    }
    if (kind === 'catalogs' && meta.autoNumber !== true && !String(values.__code ?? '').trim()) errs.__code = 'Code is required';
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
    // Attach each tabular section as rows keyed by fieldName. Drop rows where every attribute is
    // blank; booleans map to primitive columns, so always send true/false (never null).
    for (const ts of tabularSections) {
      const attrs: Attr[] = (ts.attributes as Attr[]) ?? [];
      body[ts.name] = (sections[ts.name] ?? [])
        .filter((row) => attrs.some((a) => row[a.fieldName] != null && row[a.fieldName] !== ''))
        .map((row) => {
          const out: Row = {};
          for (const a of attrs) {
            const v = row[a.fieldName];
            out[a.fieldName] = a.javaType === 'boolean' || a.javaType === 'Boolean' ? v === true : v ?? null;
          }
          return out;
        });
    }
    if (isEdit && initial._version != null) body._version = initial._version;
    return body;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true);
    setNotice('');
    try {
      const saved = isEdit ? await host.client.updateEntity(kind, name, id!, payload()) : await host.client.createEntity(kind, name, payload());
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

  // Leave without saving. The form lives at its own route (…/{id}/edit or …/new),
  // so refresh() would just reload the form — i.e. look dead. Navigate away instead:
  // edit → back to the record's detail, create/duplicate → back to the list.
  function cancel() {
    if (isEdit && id != null) host.fire(`onec://${kind}/${name}/${id}`);
    else host.fire(`onec://${kind}/${name}`);
  }

  return (
    <ThemeC.Provider value={c}>
      <View>
        <Text style={{ fontSize: 20, fontWeight: '700', color: c.text, marginBottom: 12 }}>{form.title ?? 'Form'}</Text>

        {kind === 'catalogs' && meta.autoNumber !== true && (
          <Field label="Code" required error={errors.__code}>
            <Input value={str(values.__code)} onChangeText={(t) => set('__code', t)} />
          </Field>
        )}
        {kind === 'catalogs' && (
          <Field label="Description">
            <Input value={str(values.__description)} onChangeText={(t) => set('__description', t)} />
          </Field>
        )}

        {attributes.map((a) => (
          <FieldControl key={a.fieldName} attr={a} value={values[a.fieldName]} display0={str(initial[`${a.columnName ?? a.fieldName}_display`])} error={errors[a.fieldName]} onChange={(v) => set(a.fieldName, v)} host={host} />
        ))}

        {tabularSections.map((ts) => (
          <SectionEditor
            key={ts.name}
            section={ts}
            rows={sections[ts.name] ?? []}
            host={host}
            onAdd={() => addRow(ts.name)}
            onRemove={(i) => removeRow(ts.name, i)}
            onCell={(i, key, v) => setCell(ts.name, i, key, v)}
          />
        ))}

        {notice ? <Text style={{ color: c.dangerFg, fontSize: 12, marginTop: 8 }}>{notice}</Text> : null}

        <Touchable style={{ backgroundColor: c.accentBg, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 20, opacity: saving ? 0.6 : 1 }} disabled={saving} onPress={submit}>
          {saving ? <ActivityIndicator color={c.accentFg} /> : <Text style={{ color: c.accentFg, fontWeight: '700', fontSize: 15 }}>{form.submitLabel ?? 'Save'}</Text>}
        </Touchable>
        <Touchable style={{ paddingVertical: 12, alignItems: 'center', marginTop: 8 }} disabled={saving} onPress={cancel}>
          <Text style={{ color: c.muted, fontWeight: '600' }}>Cancel</Text>
        </Touchable>
      </View>
    </ThemeC.Provider>
  );
}

// An editable grid for one tabular section: add/remove rows, each cell rendered by the same
// FieldControl the top-level fields use. On mobile each row is a stacked card (not a wide
// spreadsheet line) so ref pickers, enums and dates stay tappable. New rows land on top and
// briefly flash, so adding one is obviously felt.
function SectionEditor({
  section,
  rows,
  host,
  onAdd,
  onRemove,
  onCell,
}: {
  section: Attr;
  rows: Row[];
  host: DivHost;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onCell: (idx: number, key: string, value: unknown) => void;
}) {
  const c = useContext(ThemeC);
  const press = isDark(c) ? '#262626' : '#F3F4F6';
  const columns: Attr[] = ((section.attributes as Attr[]) ?? [])
    .filter((a) => a.visibleInForm !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const title = (section.label as string) ?? (section.name ? section.name.charAt(0).toUpperCase() + section.name.slice(1) : 'Rows');

  // Flash the just-added (top) row so the add reads as a clear, located change.
  const [flashing, setFlashing] = useState(false);
  const add = () => {
    onAdd();
    setFlashing(true);
    setTimeout(() => setFlashing(false), 1100);
  };

  const AddBtn = ({ label }: { label: string }) => (
    <Pressable
      onPress={add}
      android_ripple={{ color: press }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: pressed ? press : 'transparent' })}
    >
      <LucideIcon name="plus" size={15} color={c.primary} />
      <Text style={{ color: c.primary, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ marginTop: 16, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 12, backgroundColor: c.card }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }} numberOfLines={1}>{title}</Text>
          {rows.length > 0 ? (
            <View style={{ minWidth: 22, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: c.surface }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: c.muted }}>{rows.length}</Text>
            </View>
          ) : null}
        </View>
        <AddBtn label="Add row" />
      </View>
      {rows.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 16 }}>
          <Text style={{ color: c.muted, fontSize: 13 }}>No rows yet.</Text>
          <AddBtn label="Add the first row" />
        </View>
      ) : (
        rows.map((row, idx) => {
          const flash = idx === 0 && flashing;
          return (
            <View
              key={idx}
              style={{
                backgroundColor: flash ? c.successBg : c.surface,
                borderWidth: 1,
                borderColor: flash ? c.successFg : c.border,
                borderRadius: 12,
                padding: 12,
                marginTop: 8,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: c.muted, letterSpacing: 0.4 }}>{`ROW ${idx + 1}`}</Text>
                <Pressable
                  onPress={() => onRemove(idx)}
                  hitSlop={8}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: pressed ? c.dangerBg : 'transparent' })}
                >
                  <LucideIcon name="trash-2" size={15} color={c.dangerFg} />
                  <Text style={{ color: c.dangerFg, fontSize: 13, fontWeight: '600' }}>Remove</Text>
                </Pressable>
              </View>
              {columns.map((a) => (
                <FieldControl key={a.fieldName} attr={a} value={row[a.fieldName]} display0={str(row[`${a.fieldName}_display`])} onChange={(v) => onCell(idx, a.fieldName, v)} host={host} />
              ))}
            </View>
          );
        })
      )}
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  const c = useContext(ThemeC);
  return (
    <TextInput
      placeholderTextColor={c.muted}
      {...props}
      style={[{ borderWidth: 1, borderColor: c.fieldBorder, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: c.text, backgroundColor: c.fieldBg, minHeight: 44 }, props.style]}
    />
  );
}

// A real checkbox that owns its label — the default for boolean fields (a Switch is opt-in
// via .widget("switch"/"toggle")). Tapping the whole row toggles it.
function Checkbox({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const c = useContext(ThemeC);
  return (
    <Touchable onPress={() => onChange(!value)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: value ? c.primary : c.fieldBorder, backgroundColor: value ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {value ? <LucideIcon name="check" size={15} color="#fff" /> : null}
      </View>
      <Text style={{ fontSize: 14, color: c.text, flex: 1 }}>{label}</Text>
    </Touchable>
  );
}

function FieldControl({ attr, value, error, onChange, host, display0 }: { attr: Attr; value: unknown; error?: string; onChange: (v: unknown) => void; host: DivHost; display0?: string }) {
  const c = useContext(ThemeC);
  const label = (attr.displayName as string) ?? attr.fieldName;
  const required = attr.required === true;
  const javaType = (attr.javaType as string) ?? 'String';

  if (attr.secret === true) {
    return (
      <Field label={label} error={error}>
        <Input secureTextEntry placeholder="Leave blank to keep current" onChangeText={onChange} />
      </Field>
    );
  }
  // A field widget hint (.field(...).widget("map"|"image"|…)) wins over the type-based control.
  // All store a plain String — coordinates for map, a stored-media reference URL for the rest.
  const widget = ((attr.widget as string) ?? '').toLowerCase();
  const str0 = value == null ? undefined : String(value);
  const onStr = (v: string) => onChange(v === '' ? null : v);
  if (/^geojson$/.test(widget)) {
    return (
      <Field label={label} required={required} error={error}>
        <MapEditor value={str0} onChange={onStr} theme={host.theme} lockScroll={host.lockScroll} />
      </Field>
    );
  }
  if (/^(map|geo|geolocation)$/.test(widget)) {
    return (
      <Field label={label} required={required} error={error}>
        <GeoField value={str0} onChange={onStr} theme={host.theme} lockScroll={host.lockScroll} />
      </Field>
    );
  }
  if (/^(images|gallery|photos)$/.test(widget)) {
    return (
      <Field label={label} required={required} error={error}>
        <GalleryField value={str0} onChange={onStr} host={host} />
      </Field>
    );
  }
  if (/^(image|photo|avatar)$/.test(widget)) {
    return (
      <Field label={label} required={required} error={error}>
        <ImageField value={str0} onChange={onStr} host={host} variant={widget === 'avatar' ? 'avatar' : 'image'} />
      </Field>
    );
  }
  if (/^(file|upload|attachment)$/.test(widget)) {
    return (
      <Field label={label} required={required} error={error}>
        <FileField value={str0} onChange={onStr} host={host} />
      </Field>
    );
  }
  if (attr.isRef === true) return <RefField attr={attr} value={value} error={error} onChange={onChange} host={host} label={label} required={required} initialDisplay={display0} />;
  if (attr.isEnum === true) {
    // Respect a configured display label (displayName/label) but store the raw enum name.
    const options: EnumOption[] = ((attr.enumValues as Attr[]) ?? [])
      .filter((e) => e?.name)
      .map((e) => ({ value: String(e.name), label: String(e.displayName ?? e.label ?? e.name) }));
    return <EnumField label={label} required={required} error={error} value={str(value)} options={options} onChange={onChange} />;
  }
  if (javaType === 'boolean' || javaType === 'Boolean') {
    // A settings-style switch only when hinted; otherwise a plain checkbox (mirrors the web).
    if (/^(switch|toggle)$/.test(widget)) {
      return (
        <View style={{ marginVertical: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Text style={{ fontSize: 14, color: c.text, fontWeight: '500', flex: 1 }}>{label}</Text>
            <Switch value={value === true} onValueChange={onChange} />
          </View>
          {error ? <Text style={{ color: c.dangerFg, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
        </View>
      );
    }
    return (
      <View style={{ marginVertical: 6 }}>
        <Checkbox value={value === true} onChange={onChange} label={label} />
        {error ? <Text style={{ color: c.dangerFg, fontSize: 12, marginTop: 2 }}>{error}</Text> : null}
      </View>
    );
  }
  const number = NUMERIC.has(javaType);
  return (
    <Field label={label} required={required} error={error}>
      <Input value={str(value)} placeholder={attr.placeholder as string | undefined} keyboardType={number ? 'numeric' : 'default'} onChangeText={(t) => onChange(number ? (t === '' ? null : Number(t)) : t)} />
    </Field>
  );
}

// The configured representation of a ref row: prefer the description/name, fall back to
// code/number/id — mirrors the web's `displayOf`, so the picker shows the name when the
// catalog is set up to display by name (not its internal code).
function refDisplay(r: Row): string {
  const desc = r._description;
  if (desc != null && String(desc).trim() !== '') return String(desc);
  return String(r._code ?? r._number ?? r.name ?? r._id ?? '');
}
// A muted secondary line (the code) shown under the name when it adds information.
function refSecondary(r: Row, primary: string): string | undefined {
  const code = r._code != null && String(r._code).trim() !== '' ? String(r._code) : '';
  return code && code !== primary ? code : undefined;
}

type EnumOption = { value: string; label: string };
type PickerRow = { id: string; label: string; sub?: string };

// The tappable field control that opens a Picker — shared by ref + enum so they look alike.
// Shows the resolved display, a chevron affordance, and a clear (×) for optional fields.
function SelectTrigger({ display, placeholder, onPress, onClear }: { display?: string; placeholder: string; onPress: () => void; onClear?: () => void }) {
  const c = useContext(ThemeC);
  const press = isDark(c) ? '#262626' : '#F3F4F6';
  const has = !!display;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: press }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderWidth: 1,
        borderColor: c.fieldBorder,
        borderRadius: 10,
        paddingHorizontal: 12,
        minHeight: 46,
        backgroundColor: pressed ? press : c.fieldBg,
      })}
    >
      <Text style={{ flex: 1, fontSize: 15, color: has ? c.text : c.muted }} numberOfLines={1}>{has ? display : placeholder}</Text>
      {has && onClear ? (
        <Touchable onPress={onClear} hitSlop={10} style={{ padding: 2 }}>
          <LucideIcon name="x" size={16} color={c.muted} />
        </Touchable>
      ) : null}
      <LucideIcon name="chevrons-up-down" size={16} color={c.muted} />
    </Pressable>
  );
}

function RefField({ attr, value, error, onChange, host, label, required, initialDisplay }: { attr: Attr; value: unknown; error?: string; onChange: (v: unknown) => void; host: DivHost; label: string; required: boolean; initialDisplay?: string }) {
  const refKind = (attr.refKind ?? 'catalog') === 'document' ? 'documents' : 'catalogs';
  const target = (attr.refTarget as string) ?? '';
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  // Seed from the server-resolved label so an existing ref shows its name (not the stored uuid).
  const [display, setDisplay] = useState(initialDisplay || str(attr.__display));
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

  const shown = display || (value != null ? String(value) : undefined);
  return (
    <Field label={label} required={required} error={error}>
      <SelectTrigger
        display={shown}
        placeholder={`Select ${target || 'value'}…`}
        onPress={() => { setOpen(true); search(''); }}
        onClear={required ? undefined : () => { onChange(null); setDisplay(''); }}
      />
      <Picker
        open={open}
        loading={loading}
        title={`Select ${target}`}
        selectedId={value != null ? String(value) : undefined}
        onClose={() => setOpen(false)}
        onSearch={search}
        rows={rows.map((r) => {
          const lbl = refDisplay(r);
          return { id: String(r._id), label: lbl, sub: refSecondary(r, lbl) };
        })}
        onPick={(opt) => { onChange(opt.id); setDisplay(opt.label); setOpen(false); }}
      />
    </Field>
  );
}

function EnumField({ label, required, error, value, options, onChange }: { label: string; required: boolean; error?: string; value: string; options: EnumOption[]; onChange: (v: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Field label={label} required={required} error={error}>
      <SelectTrigger
        display={selected?.label || value || undefined}
        placeholder="Select…"
        onPress={() => setOpen(true)}
        onClear={required ? undefined : () => onChange(null)}
      />
      <Picker
        open={open}
        title={label}
        selectedId={value || ''}
        onClose={() => setOpen(false)}
        rows={[{ id: '', label: '—' }, ...options.map((o) => ({ id: o.value, label: o.label }))]}
        onPick={(opt) => { onChange(opt.id || null); setOpen(false); }}
      />
    </Field>
  );
}

// A bottom-sheet picker on @gorhom/bottom-sheet: drag handle, animated backdrop, optional
// server-search box, and a result list whose rows show the display label (+ a muted secondary)
// and a check on the current value. `open` is the source of truth — it drives present/dismiss.
function Picker({ open, title, rows, onPick, onClose, onSearch, loading, selectedId }: {
  open: boolean; title: string; rows: PickerRow[]; onPick: (o: PickerRow) => void; onClose: () => void; onSearch?: (q: string) => void; loading?: boolean; selectedId?: string;
}) {
  const c = useContext(ThemeC);
  const press = isDark(c) ? '#262626' : '#F3F4F6';
  const ref = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['55%', '90%'], []);

  useEffect(() => {
    if (open) ref.current?.present();
    else ref.current?.dismiss();
  }, [open]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" opacity={0.45} />
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: PickerRow }) => {
      const sel = selectedId != null && item.id === selectedId;
      return (
        <Touchable
          onPress={() => onPick(item)}
          dim={1}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: pressed ? press : 'transparent' })}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, color: c.text, fontWeight: sel ? '600' : '400' }} numberOfLines={1}>{item.label}</Text>
            {item.sub ? <Text style={{ fontSize: 12, color: c.muted, marginTop: 1 }} numberOfLines={1}>{item.sub}</Text> : null}
          </View>
          {sel ? <LucideIcon name="check" size={18} color={c.primary} /> : null}
        </Touchable>
      );
    },
    [c, press, selectedId, onPick],
  );

  return (
    <BottomSheetModal
      ref={ref}
      index={onSearch ? 1 : 0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: c.card }}
      handleIndicatorStyle={{ backgroundColor: c.border, width: 40 }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: c.text, flex: 1 }} numberOfLines={1}>{title}</Text>
          <Touchable onPress={onClose} hitSlop={8}><Text style={{ color: c.primary, fontWeight: '600', fontSize: 15 }}>Done</Text></Touchable>
        </View>
        {onSearch && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.fieldBorder, borderRadius: 10, paddingHorizontal: 10, height: 42, backgroundColor: c.fieldBg, marginHorizontal: 16, marginBottom: 6 }}>
            <LucideIcon name="search" size={16} color={c.muted} />
            <BottomSheetTextInput placeholder="Search…" placeholderTextColor={c.muted} style={{ flex: 1, fontSize: 15, color: c.text, paddingVertical: 0 }} onChangeText={onSearch} />
          </View>
        )}
        {loading ? (
          <ActivityIndicator style={{ marginVertical: 28 }} color={c.text} />
        ) : rows.length === 0 ? (
          <Text style={{ textAlign: 'center', color: c.muted, fontSize: 14, paddingVertical: 28 }}>No matches</Text>
        ) : (
          <BottomSheetFlatList
            data={rows}
            keyExtractor={(it, i) => it.id + i}
            keyboardShouldPersistTaps="handled"
            renderItem={renderItem}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24 }}
          />
        )}
      </View>
    </BottomSheetModal>
  );
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  const c = useContext(ThemeC);
  return (
    <View style={{ marginVertical: 6 }}>
      <Text style={{ fontSize: 13, color: c.text, marginBottom: 4, fontWeight: '500' }}>{label}{required ? ' *' : ''}</Text>
      {children}
      {error ? <Text style={{ color: c.dangerFg, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

const str = (v: unknown) => (v == null ? '' : String(v));

export const onecForm: CustomRenderer = ({ block, host }) => {
  const form = (block.custom_props?.form as Record<string, any>) ?? {};
  return <OnecForm form={form} host={host} />;
};
