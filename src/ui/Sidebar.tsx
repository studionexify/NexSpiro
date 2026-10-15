import { useMemo, useRef, useState } from 'react';
import { FILAMENTS, filamentById } from '../profiles/filaments';
import { PRINTERS, printerById, printerName } from '../profiles/printers';
import { baseProcess } from '../profiles/resolve';
import { PROCESS_PARAMS, PROCESS_PRESETS, PROCESS_TABS, type Config, type ParamDef, type ProcessTab } from '../profiles/settings';
import { isOutOfBounds, useStore } from '../state/store';
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
  const { filamentId, filamentColor, plate, set, markDirty } = useStore();
  const [edit, setEdit] = useState(false);
  const fil = filamentById(filamentId);
  const bed = fil.bedTemp[plate] ?? 0;
  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title"><Icon name="filament" />Filament</span>
        <span className="spacer" />
        <span className="badge">{fil.nozzleTemp}°C / bed {bed ? `${bed}°C` : 'n/a'}</span>
      </div>
      <div className="row">
        <label title="Filament colour" style={{ position: 'relative', width: 28, height: 28, borderRadius: 6, background: filamentColor, border: '1px solid var(--border)', cursor: 'pointer', flex: 'none' }}>
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#142030' }}>1</span>
          <input type="color" value={filamentColor} onChange={(e) => set({ filamentColor: e.target.value })} style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }} />
        </label>
        <select className="select" value={filamentId} aria-label="Filament" onChange={(e) => { set({ filamentId: e.target.value, filamentColor: filamentById(e.target.value).color }); markDirty(); }}>
          {FILAMENTS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button className="icon-btn" title="Filament details" onClick={() => setEdit(true)}><Icon name="edit" /></button>
      </div>
      {!bed && <div className="row" style={{ color: 'var(--warning)' }}><Icon name="warn" size={14} />Not recommended on this build plate.</div>}
      {edit && <FilamentModal onClose={() => setEdit(false)} />}
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
      {s.processMode === 'objects' && <ObjectList />}
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
      {!q && (
        <div className="ptabs">
          {PROCESS_TABS.map((t) => (
            <button key={t} className={`ptab ${s.processTab === t ? 'active' : ''}`} onClick={() => s.set({ processTab: t })}>
              <Icon name={TAB_ICONS[t]} size={15} />{t}
            </button>
          ))}
        </div>
      )}
      <div className="params">
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
      </div>
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

function ObjectList() {
  const { objects, selected, set, printerId } = useStore();
  return (
    <div className="objlist">
      <div style={{ padding: '2px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Plate 1 · {objects.length} object{objects.length === 1 ? '' : 's'}</div>
      {objects.map((o) => (
        <div key={o.id} className={`objrow ${selected.includes(o.id) ? 'sel' : ''}`}
          onClick={(e) => set({ selected: e.shiftKey || e.ctrlKey ? [...new Set([...selected, o.id])] : [o.id] })}>
          <Icon name="cube" size={14} />
          <span className="name">{o.name}</span>
          {o.openEdges > 0 && <span className="warn" title={`${o.openEdges} open edges — mesh is not watertight`}><Icon name="warn" size={14} /></span>}
          {isOutOfBounds(o, printerId) && <span className="warn" title="Outside the printable area" style={{ color: 'var(--error)' }}><Icon name="warn" size={14} /></span>}
        </div>
      ))}
      {!objects.length && <div style={{ padding: '6px 12px', color: 'var(--text-muted)' }}>No objects yet.</div>}
      <div style={{ padding: '6px 12px', color: 'var(--text-muted)', fontSize: 11 }}>Per-object setting overrides arrive in Phase 2.</div>
    </div>
  );
}
