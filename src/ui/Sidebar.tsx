import { useMemo, useRef, useState } from 'react';
import { FILAMENTS, filamentById } from '../profiles/filaments';
import { PRINTERS, printerById, printerName } from '../profiles/printers';
import { baseProcess } from '../profiles/resolve';
import { MODIFIER_KEYS, OBJECT_KEYS, PARAM_BY_KEY, PROCESS_PARAMS, PROCESS_PRESETS, PROCESS_TABS, type Config, type ParamDef, type ProcessTab } from '../profiles/settings';
import { isOutOfBounds, objectPlate, slotColor, useStore } from '../state/store';
import { addPart, moveToPlate, PART_LABELS, updatePart } from '../state/ops';
import { Icon } from './icons';
import { FilamentModal, PrinterModal } from './Modals';

const TAB_ICONS: Record<ProcessTab, string> = { Quality: 'quality', Strength: 'strength', Speed: 'speed', Support: 'support', Others: 'others' };

export function Sidebar() {
  return (
    <aside className="sidebar">
      <PrinterCard />
      <FilamentCard />
      <ProcessCard />
    </aside>
  );
}

function PrinterCard() {
  const { printerId, plate, set, markDirty } = useStore();
  const [edit, setEdit] = useState(false);
  const printer = printerById(printerId);
  const vendors = [...new Set(PRINTERS.map((p) => p.vendor))];
  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title"><Icon name="printer" />Printer</span>
        <span className="spacer" />
        <span className="badge">{printer.bed.x}×{printer.bed.y}×{printer.bed.z} mm</span>
      </div>
      <div className="row">
        <select className="select" value={printerId} aria-label="Printer" onChange={(e) => {
          const p = printerById(e.target.value);
          set({ printerId: p.id, plate: p.plates.some((x) => x.type === plate) ? plate : p.plates[0].type, machineOverrides: {} });
          markDirty();
        }}>
          {vendors.map((v) => (
            <optgroup key={v} label={v}>
              {PRINTERS.filter((p) => p.vendor === v).map((p) => <option key={p.id} value={p.id}>{printerName(p)}</option>)}
            </optgroup>
          ))}
        </select>
        <button className="icon-btn" title="Edit printer settings" onClick={() => setEdit(true)}><Icon name="edit" /></button>
      </div>
      <div className="row">
        <Icon name="plate" size={16} style={{ color: 'var(--text-muted)' }} />
        <select className="select" value={plate} aria-label="Build plate" onChange={(e) => { set({ plate: e.target.value as any }); markDirty(); }}>
          {printer.plates.map((p) => <option key={p.type} value={p.type}>{p.label}</option>)}
        </select>
      </div>
      {edit && <PrinterModal onClose={() => setEdit(false)} />}
    </section>
  );
}

function FilamentCard() {
  const { filaments, plate, printerId, set, markDirty } = useStore();
  const [edit, setEdit] = useState<number | null>(null);
  const ams = !!printerById(printerId).machine.has_ams;
  const update = (k: number, patch: Partial<{ presetId: string; color: string }>) => {
    set({ filaments: filaments.map((f, i) => (i === k ? { ...f, ...patch } : f)) });
    markDirty();
  };
  const remove = (k: number) => {
    const st = useStore.getState();
    // objects / paint referencing removed slots fall back to slot 1
    st.updateObjects((o) => ({
      ...o,
      filament: o.filament === k ? 0 : o.filament !== undefined && o.filament > k ? o.filament - 1 : o.filament,
      paint: o.paint?.color ? { ...o.paint, color: o.paint.color.map((c) => (c === k + 1 ? 0 : c > k + 1 ? c - 1 : c)) } : o.paint,
    }), st.objects.map((o) => o.id));
    set({ filaments: filaments.filter((_, i) => i !== k) });
  };
  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title"><Icon name="filament" />Filament</span>
        <span className="spacer" />
        <span className="badge" title={ams ? 'Automatic filament changes' : 'Manual filament changes (M600 pause)'}>{ams ? 'AMS' : 'Manual swap'}</span>
        <button className="icon-btn" title="Add filament" aria-label="Add filament" disabled={filaments.length >= 16}
          onClick={() => { const palette = ['#FF5C8D', '#85A3B2', '#E9D8C8', '#732553', '#142030', '#FFC107', '#1E88E5']; set({ filaments: [...filaments, { presetId: filaments[filaments.length - 1].presetId, color: palette[(filaments.length - 1) % palette.length] }] }); }}>
          <Icon name="add" />
        </button>
      </div>
      <div className="slots">
        {filaments.map((f, k) => {
          const fil = filamentById(f.presetId);
          const bed = fil.bedTemp[plate] ?? 0;
          return (
            <div className="row slot" key={k}>
              <label title="Filament colour" className="swatch-btn" style={{ background: f.color }}>
                <span>{k + 1}</span>
                <input type="color" value={f.color} onChange={(e) => update(k, { color: e.target.value })} />
              </label>
              <select className="select" value={f.presetId} aria-label={`Filament ${k + 1}`} onChange={(e) => update(k, { presetId: e.target.value })}>
                {FILAMENTS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              {!bed && <span title="Not recommended on this build plate" style={{ color: 'var(--warning)', display: 'flex' }}><Icon name="warn" size={14} /></span>}
              <button className="icon-btn" title="Filament details" onClick={() => setEdit(k)}><Icon name="edit" size={16} /></button>
              {filaments.length > 1 && <button className="icon-btn" title="Remove filament" onClick={() => remove(k)}><Icon name="close" size={14} /></button>}
            </div>
          );
        })}
      </div>
      {edit !== null && <FilamentModal slot={edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function ProcessCard() {
  const s = useStore();
  const base = useMemo(() => baseProcess({ printerId: s.printerId, presetId: s.presetId }), [s.printerId, s.presetId]);
  const cfg: Config = { ...base, ...s.overrides };
  const modifiedCount = Object.keys(s.overrides).length;
  const q = s.search.trim().toLowerCase();
  const visible = PROCESS_PARAMS.filter((p) => (s.showAdvanced || !p.advanced));
  const list = q
    ? visible.filter((p) => `${p.label} ${p.group} ${p.key} ${p.tab}`.toLowerCase().includes(q))
    : visible.filter((p) => p.tab === s.processTab);
  const groups = [...new Set(list.map((p) => (q ? `${p.tab} › ${p.group}` : p.group)))];
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <section className="card process">
      <div className="card-head">
        <span className="card-title"><Icon name="layers" />Process</span>
        <span className="spacer" />
        <div className="seg" role="tablist">
          <button className={s.processMode === 'global' ? 'on' : ''} onClick={() => s.set({ processMode: 'global' })}>Global</button>
          <button className={s.processMode === 'objects' ? 'on' : ''} onClick={() => s.set({ processMode: 'objects' })}>Objects</button>
        </div>
        <button className={`icon-btn ${searchOpen ? 'active' : ''}`} title="Search settings (Ctrl+F)" onClick={() => { setSearchOpen(!searchOpen); s.set({ search: '' }); }}><Icon name="search" /></button>
      </div>
      {s.processMode === 'objects' && <ObjectPanel />}
      <div className="row">
        <select className="select" value={s.presetId} aria-label="Process preset" onChange={(e) => { s.set({ presetId: e.target.value }); s.markDirty(); }}>
          {PROCESS_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name} @{printerById(s.printerId).model}{modifiedCount && p.id === s.presetId ? ' (modified)' : ''}</option>)}
        </select>
        <button className="icon-btn" title="Reset all modified values" disabled={!modifiedCount} onClick={() => { s.set({ overrides: {} }); s.markDirty(); }}><Icon name="reset" /></button>
      </div>
      <div className="row">
        {searchOpen
          ? <input id="param-search" className="input" style={{ flex: 1 }} autoFocus placeholder="Search parameters…" value={s.search} onChange={(e) => s.set({ search: e.target.value })} />
          : <span style={{ color: 'var(--text-muted)', flex: 1 }}>{modifiedCount ? `${modifiedCount} modified value${modifiedCount > 1 ? 's' : ''}` : 'System preset values'}</span>}
        <span style={{ color: 'var(--text-muted)' }}>Advanced</span>
        <button className={`toggle ${s.showAdvanced ? 'on' : ''}`} aria-label="Show advanced" onClick={() => s.set({ showAdvanced: !s.showAdvanced })} />
      </div>
      {s.processMode === 'global' && !q && (
        <div className="ptabs">
          {PROCESS_TABS.map((t) => (
            <button key={t} className={`ptab ${s.processTab === t ? 'active' : ''}`} onClick={() => s.set({ processTab: t })}>
              <Icon name={TAB_ICONS[t]} size={15} />{t}
            </button>
          ))}
        </div>
      )}
      {s.processMode === 'global' && <div className="params">
        {groups.map((g) => (
          <div key={g}>
            <div className={`group-title ${closed[g] ? 'closed' : ''}`} onClick={() => setClosed({ ...closed, [g]: !closed[g] })}>
              <Icon name="chevronDown" size={14} />{g}
            </div>
            {!closed[g] && list.filter((p) => (q ? `${p.tab} › ${p.group}` : p.group) === g).map((p) => (
              <ParamRow key={p.key} def={p} value={cfg[p.key]} baseValue={base[p.key]} cfg={cfg} modified={p.key in s.overrides} />
            ))}
          </div>
        ))}
        {!list.length && <div style={{ color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>No matching parameters.</div>}
      </div>}
    </section>
  );
}

function ParamRow({ def, value, baseValue, cfg, modified }: { def: ParamDef; value: Config[string]; baseValue: Config[string]; cfg: Config; modified: boolean }) {
  const setOverride = useStore((s) => s.setOverride);
  const disabled = def.disabledWhen?.(cfg) ?? false;
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number>();
  const commit = (v: Config[string]) => setOverride(def.key, v === baseValue ? undefined : v);

  let control;
  if (def.type === 'bool') {
    control = <div className="pinput"><button className={`toggle ${value ? 'on' : ''}`} disabled={disabled} aria-label={def.label} onClick={() => commit(!value)} /></div>;
  } else if (def.type === 'enum') {
    control = (
      <div className="pinput">
        <select className="select" disabled={disabled} value={String(value)} aria-label={def.label} onChange={(e) => commit(e.target.value)}>
          {def.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  } else {
    control = (
      <div className="pinput">
        <NumberInput value={Number(value)} def={def} disabled={disabled} onCommit={commit} />
        {def.unit && <span className="unit">{def.unit}</span>}
      </div>
    );
  }
  return (
    <div className={`prow ${modified ? 'modified' : ''} ${disabled ? 'disabled' : ''}`}>
      <span className="plabel"
        onMouseEnter={(e) => { const r = (e.target as HTMLElement).getBoundingClientRect(); timer.current = window.setTimeout(() => setTip({ x: r.right + 8, y: r.top }), 400); }}
        onMouseLeave={() => { clearTimeout(timer.current); setTip(null); }}>
        {def.label}
      </span>
      {modified ? <button className="reset" title={`Reset to ${String(baseValue)}`} onClick={() => setOverride(def.key, undefined)}><Icon name="reset" size={14} /></button> : <span />}
      {control}
      {tip && (
        <div className="tooltip" style={{ left: Math.min(tip.x, window.innerWidth - 350), top: Math.min(tip.y, window.innerHeight - 160) }}>
          <b>{def.label}</b>{def.tip}
          <div className="key">Default: {String(baseValue)}{def.unit ? ` ${def.unit}` : ''} · Internal key: <span className="mono">{def.key}</span></div>
        </div>
      )}
    </div>
  );
}

function NumberInput({ value, def, disabled, onCommit }: { value: number; def: ParamDef; disabled: boolean; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const apply = () => {
    if (draft === null) return;
    let v = parseFloat(draft);
    setDraft(null);
    if (!isFinite(v)) return;
    if (def.min !== undefined) v = Math.max(def.min, v);
    if (def.max !== undefined) v = Math.min(def.max, v);
    if (def.type === 'int' || def.type === 'percent') v = Math.round(v);
    onCommit(+v.toFixed(4));
  };
  return (
    <input className="input" disabled={disabled} aria-label={def.label} value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)} onBlur={apply}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(null); }} />
  );
}

function ObjectPanel() {
  const s = useStore();
  const base = useMemo(() => baseProcess({ printerId: s.printerId, presetId: s.presetId }), [s.printerId, s.presetId]);
  const global: Config = { ...base, ...s.overrides };
  const obj = s.objects.find((o) => o.id === s.selected[0]);
  const part = s.selectedPart ? obj?.parts?.find((p) => p.id === s.selectedPart) : undefined;
  const plates = s.plates.length;
  const [addKey, setAddKey] = useState('');
  const [partMenu, setPartMenu] = useState(false);

  const objOverrides = obj?.overrides ?? {};
  const setObjKey = (key: string, v: Config[string] | undefined) => {
    if (!obj) return;
    s.updateObjects((o) => {
      const ov = { ...(o.overrides ?? {}) };
      if (v === undefined) delete ov[key]; else ov[key] = v;
      return { ...o, overrides: ov };
    }, [obj.id]);
  };
  const setPartKey = (key: string, v: Config[string] | undefined) => {
    if (!obj || !part) return;
    updatePart(obj.id, part.id, (p) => {
      const ov = { ...p.overrides };
      if (v === undefined) delete ov[key]; else ov[key] = v;
      return { ...p, overrides: ov };
    });
  };

  return (
    <div className="objpanel">
      <div className="objlist">
        {s.plates.map((pl, pi) => {
          const objs = s.objects.filter((o) => objectPlate(o, s.printerId, plates) === pi);
          return (
            <div key={pl.id}>
              <div className={`plate-row ${pi === s.activePlate ? 'active' : ''}`} onClick={() => s.set({ activePlate: pi })}>{pl.name} · {objs.length} object{objs.length === 1 ? '' : 's'}</div>
              {objs.map((o) => (
                <div key={o.id}>
                  <div className={`objrow ${s.selected.includes(o.id) && !s.selectedPart ? 'sel' : ''}`}
                    onClick={(e) => s.set({ selected: e.shiftKey || e.ctrlKey ? [...new Set([...s.selected, o.id])] : [o.id], selectedPart: null, activePlate: pi })}>
                    <Icon name="cube" size={14} />
                    <span className="name">{o.name}</span>
                    {o.overrides && Object.keys(o.overrides).length > 0 && <span className="dot" title="Has per-object settings">●</span>}
                    {o.layerHeights && <span className="badge" title="Variable layer height">VLH</span>}
                    <select className="fil-pick" value={o.filament ?? 0} title="Filament" onClick={(e) => e.stopPropagation()}
                      style={{ background: slotColor(s, o.filament ?? 0) }}
                      onChange={(e) => s.updateObjects((x) => ({ ...x, filament: +e.target.value }), [o.id])}>
                      {s.filaments.map((_, k) => <option key={k} value={k}>{k + 1}</option>)}
                    </select>
                    {o.openEdges > 0 && <span className="warn" title={`${o.openEdges} open edges — mesh is not watertight`}><Icon name="warn" size={14} /></span>}
                    {isOutOfBounds(o, s.printerId, plates) && <span className="warn" title="Outside the printable area" style={{ color: 'var(--error)' }}><Icon name="warn" size={14} /></span>}
                  </div>
                  {(o.parts ?? []).map((p) => (
                    <div key={p.id} className={`objrow part ${s.selectedPart === p.id ? 'sel' : ''}`} onClick={() => s.set({ selected: [o.id], selectedPart: p.id })}>
                      <span className="part-dot" style={{ background: PART_DOT[p.type] }} />
                      <span className="name">{p.name}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
        {!s.objects.length && <div style={{ padding: '6px 12px', color: 'var(--text-muted)' }}>No objects yet.</div>}
      </div>

      {obj && !part && (
        <div className="params" style={{ flex: 'none', maxHeight: 'none' }}>
          <div className="row" style={{ marginTop: 8 }}>
            <b style={{ flex: 1, color: 'var(--text-strong)' }}>{obj.name}</b>
            <div className="menu">
              <button className="btn-secondary btn-small" onClick={() => setPartMenu(!partMenu)}><Icon name="add" size={14} />Part</button>
              {partMenu && (
                <div className="menu-pop" style={{ right: 0, left: 'auto' }} onMouseLeave={() => setPartMenu(false)}>
                  {(['negative', 'modifier', 'support_enforcer', 'support_blocker'] as const).map((t) => (
                    <div key={t} className="menu-group">
                      <div className="menu-label">{PART_LABELS[t]}</div>
                      <div className="row" style={{ margin: '0 0 6px' }}>
                        {(['box', 'cylinder', 'sphere'] as const).map((sh) => (
                          <button key={sh} className="btn-secondary btn-small" onClick={() => { addPart(obj.id, t, sh); setPartMenu(false); }}>{sh}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="group-title">Per-object settings</div>
          {Object.keys(objOverrides).length === 0 && <div style={{ color: 'var(--text-muted)', margin: '4px 0' }}>Uses global settings. Add a setting to override it for this object only.</div>}
          {Object.keys(objOverrides).map((k) => PARAM_BY_KEY[k] && (
            <OverrideRow key={k} def={PARAM_BY_KEY[k]} value={objOverrides[k]} cfg={{ ...global, ...objOverrides }} onSet={(v) => setObjKey(k, v)} onRemove={() => setObjKey(k, undefined)} />
          ))}
          <div className="row">
            <select className="select" value={addKey} onChange={(e) => setAddKey(e.target.value)} aria-label="Add setting">
              <option value="">Add setting…</option>
              {OBJECT_KEYS.filter((k) => !(k in objOverrides)).map((k) => <option key={k} value={k}>{PARAM_BY_KEY[k].tab} › {PARAM_BY_KEY[k].label}</option>)}
            </select>
            <button className="btn-secondary btn-small" disabled={!addKey} onClick={() => { setObjKey(addKey, global[addKey]); setAddKey(''); }}>Add</button>
          </div>
          {plates > 1 && (
            <div className="row">
              <span style={{ flex: 1 }}>Move to plate</span>
              <select className="select" style={{ flex: 'none', width: 120 }} value={objectPlate(obj, s.printerId, plates)} onChange={(e) => moveToPlate(+e.target.value)}>
                {s.plates.map((p, i) => <option key={p.id} value={i}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {obj && part && (
        <div className="params" style={{ flex: 'none', maxHeight: 'none' }}>
          <div className="row" style={{ marginTop: 8 }}>
            <span className="part-dot" style={{ background: PART_DOT[part.type] }} />
            <b style={{ flex: 1, color: 'var(--text-strong)' }}>{part.name}</b>
            <button className="icon-btn" title="Delete part" onClick={() => s.removeSelected()}><Icon name="trash" size={16} /></button>
          </div>
          <div style={{ color: 'var(--text-muted)', margin: '4px 0 8px' }}>{PART_HELP[part.type]} Use Move / Rotate / Scale in the toolbar to position it.</div>
          {part.type === 'modifier' && MODIFIER_KEYS.map((k) => (
            <OverrideRow key={k} def={PARAM_BY_KEY[k]} value={part.overrides[k] ?? global[k]} cfg={global} modified={k in part.overrides}
              onSet={(v) => setPartKey(k, v)} onRemove={() => setPartKey(k, undefined)} />
          ))}
        </div>
      )}
    </div>
  );
}

const PART_DOT: Record<string, string> = { negative: '#FF3B30', modifier: '#FFC107', support_enforcer: '#1E88E5', support_blocker: '#E53935' };
const PART_HELP: Record<string, string> = {
  negative: 'Material inside this volume is removed (holes, cut-outs).',
  modifier: 'Changes infill settings inside this volume.',
  support_enforcer: 'Support is generated under any overhang inside this volume.',
  support_blocker: 'No support is generated inside this volume.',
};

function OverrideRow({ def, value, cfg, onSet, onRemove, modified = true }: { def: ParamDef; value: Config[string]; cfg: Config; onSet: (v: Config[string]) => void; onRemove: () => void; modified?: boolean }) {
  let control;
  if (def.type === 'bool') control = <div className="pinput"><button className={`toggle ${value ? 'on' : ''}`} aria-label={def.label} onClick={() => onSet(!value)} /></div>;
  else if (def.type === 'enum') control = (
    <div className="pinput"><select className="select" value={String(value)} aria-label={def.label} onChange={(e) => onSet(e.target.value)}>
      {def.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select></div>
  );
  else control = <div className="pinput"><NumberInput value={Number(value)} def={def} disabled={false} onCommit={onSet} />{def.unit && <span className="unit">{def.unit}</span>}</div>;
  void cfg;
  return (
    <div className={`prow ${modified ? 'modified' : ''}`}>
      <span className="plabel" title={def.tip}>{def.label}</span>
      {modified ? <button className="reset" title="Remove override" onClick={onRemove}><Icon name="close" size={14} /></button> : <span />}
      {control}
    </div>
  );
}
