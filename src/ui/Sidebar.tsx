import { useMemo, useState, type ReactNode } from 'react';
import { FILAMENTS, filamentById } from '../profiles/filaments';
import { PRINTERS, printerById } from '../profiles/printers';
import { autoFlushMatrix } from '../profiles/flush';
import { baseProcess, effectiveNozzle, NOZZLES } from '../profiles/resolve';
import { HEIGHT_RANGE_KEYS, MODIFIER_KEYS, OBJECT_KEYS, PARAM_BY_KEY, PROCESS_PARAMS, PROCESS_PRESETS, PROCESS_TABS, type Config, type ProcessTab } from '../profiles/settings';
import { isOutOfBounds, objectPlate, slotColor, useStore } from '../state/store';
import { updateHeightRange, updatePart } from '../state/ops';
import { renameObject } from '../state/objectOps';
import { Icon } from './icons';
import { PlateThumb, PrinterThumb } from './assets/Thumbs';
import { FilamentModal, Modal, PrinterModal } from './Modals';
import { ParamRow } from './ParamRow';
import { useAdvanced } from '../state/advanced';
import { AdvancedPanel } from './advanced/AdvancedPanel';

/** Collapsed state of the sidebar sections, kept between sessions. */
const COLLAPSE_KEY = 'nexspiro.sidebar.collapsed.v1';
const readCollapsed = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}'); } catch { return {}; } };
function useCollapsed(id: string): [boolean, () => void] {
  const [c, setC] = useState(() => !!readCollapsed()[id]);
  return [c, () => { const v = !c; setC(v); try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ ...readCollapsed(), [id]: v })); } catch { /* storage unavailable */ } }];
}

/** Section title: icon, name and a chevron; clicking it collapses the section. */
function CardTitle({ icon, label, closed, onToggle }: { icon: string; label: string; closed: boolean; onToggle: () => void }) {
  return (
    <button className="card-title card-toggle" aria-expanded={!closed} title={closed ? `Expand ${label}` : `Collapse ${label}`} onClick={onToggle}>
      <Icon name="chevronDown" size={14} className={`card-chev ${closed ? 'closed' : ''}`} />
      <Icon name={icon} size={17} />{label}
    </button>
  );
}
const Body = ({ closed, children }: { closed: boolean; children: ReactNode }) => (closed ? null : <>{children}</>);

const TAB_ICONS: Record<ProcessTab, string> = { Quality: 'quality', Strength: 'strength', Speed: 'speed', Support: 'support', Others: 'others' };

export function Sidebar() {
  const advanced = useAdvanced((a) => a.engineMode === 'advanced');
  // Progressive disclosure: Basic shows the classic process settings; Advanced swaps them for the
  // Intent Cards, Zone Inspector and technology graph (the base process stays one click away).
  return (
    <aside className={`sidebar ${advanced ? 'is-advanced' : ''}`}>
      <PrinterCard />
      <FilamentCard />
      <ObjectsCard />
      {advanced ? <><BaseProcessRow /><AdvancedPanel /></> : <ProcessCard />}
    </aside>
  );
}

/** Advanced mode: the base process preset, with the full Basic settings in a dialog. */
function BaseProcessRow() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const n = Object.keys(s.overrides).length;
  return (
    <div className="base-process">
      <Icon name="layers" size={15} />
      <span className="muted">Base process</span>
      <select className="select" value={s.presetId} aria-label="Base process preset" onChange={(e) => { s.set({ presetId: e.target.value }); s.markDirty(); }}>
        {PROCESS_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}{n && p.id === s.presetId ? ' (modified)' : ''}</option>)}
      </select>
      <button className="icon-btn" title="Layer height, walls, speeds… (shared with Basic mode)" onClick={() => setOpen(true)}><Icon name="edit" size={15} /></button>
      {open && <Modal title="Base process settings (shared with Basic mode)" onClose={() => setOpen(false)}><div className="base-process-modal"><ProcessCard /></div></Modal>}
    </div>
  );
}

function PrinterCard() {
  const { printerId, plate, machineOverrides, set, markDirty, setMachine } = useStore();
  const [edit, setEdit] = useState(false);
  const [closed, toggle] = useCollapsed('printer');
  const printer = printerById(printerId);
  const nozzle = effectiveNozzle(printerId, machineOverrides);
  const vendors = [...new Set(PRINTERS.map((p) => p.vendor))];
  const plateLabel = printer.plates.find((p) => p.type === plate)?.label ?? plate;
  return (
    <section className="card">
      <div className="card-head">
        <CardTitle icon="printer" label="Printer" closed={closed} onToggle={toggle} />
        <span className="spacer" />
        <span className="badge" title="Build volume">{printer.bed.x}×{printer.bed.y}×{printer.bed.z} mm</span>
        <button className="icon-btn" title="Edit printer settings" aria-label="Edit printer settings" onClick={() => setEdit(true)}><Icon name="edit" size={16} /></button>
      </div>
      <Body closed={closed}>
        <div className="thumb-pair">
          <label className="thumb-card" title={`${printer.vendor} ${printer.model}`}>
            <PrinterThumb printer={printer} />
            <select className="thumb-select" value={printerId} aria-label="Printer" onChange={(e) => {
              const p = printerById(e.target.value);
              set({ printerId: p.id, plate: p.plates.some((x) => x.type === plate) ? plate : p.plates[0].type, machineOverrides: {} });
              markDirty();
            }}>
              {vendors.map((v) => (
                <optgroup key={v} label={v}>
                  {PRINTERS.filter((p) => p.vendor === v).map((p) => <option key={p.id} value={p.id}>{p.vendor === 'Generic' ? p.model : `${p.vendor} ${p.model}`}</option>)}
                </optgroup>
              ))}
            </select>
            <span className="thumb-caption">{printer.model}</span>
          </label>
          <label className="thumb-card" title={plateLabel}>
            <PlateThumb type={plate} />
            <select className="thumb-select" value={plate} aria-label="Build plate" onChange={(e) => { set({ plate: e.target.value as any }); markDirty(); }}>
              {printer.plates.map((p) => <option key={p.type} value={p.type}>{p.label}</option>)}
            </select>
            <span className="thumb-caption">{plateLabel.replace(/ \(.*\)| Spring Steel/g, '')}</span>
          </label>
        </div>
        <div className="row nozzle-row">
          <Icon name="nozzle" size={16} style={{ color: 'var(--text-muted)' }} />
          <span className="muted" title="Nozzle diameter (mm)">Ø</span>
          <div className="seg nozzle-seg" role="radiogroup" aria-label="Nozzle diameter">
            {NOZZLES.map((n) => (
              <button key={n} role="radio" aria-checked={nozzle === n} className={nozzle === n ? 'on' : ''} title={`${n} mm nozzle`}
                onClick={() => { setMachine('nozzle_diameter', n === printer.nozzle ? undefined : n); markDirty(); }}>{n}</button>
            ))}
          </div>
        </div>
      </Body>
      {edit && <PrinterModal onClose={() => setEdit(false)} />}
    </section>
  );
}

function FilamentCard() {
  const { filaments, plate, printerId, set, markDirty } = useStore();
  const [edit, setEdit] = useState<number | null>(null);
  const [flush, setFlush] = useState(false);
  const [closed, toggle] = useCollapsed('filament');
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
    set({ filaments: filaments.filter((_, i) => i !== k), flushMatrix: null });
  };
  return (
    <section className="card">
      <div className="card-head">
        <CardTitle icon="filamentB" label="Filament" closed={closed} onToggle={toggle} />
        <span className="spacer" />
        <span className="badge" title={ams ? 'Automatic filament changes (AMS)' : 'Manual filament changes (M600 pause)'}>{ams ? 'AMS' : <Icon name="edit" size={12} />}</span>
        {filaments.length > 1 && <button className="icon-btn" title="Flushing volumes" aria-label="Flushing volumes" onClick={() => setFlush(true)}><Icon name="flush" /></button>}
        <button className="icon-btn" title="Add filament" aria-label="Add filament" disabled={filaments.length >= 16}
          onClick={() => { const palette = ['#FF5C8D', '#85A3B2', '#E9D8C8', '#732553', '#142030', '#FFC107', '#1E88E5']; set({ filaments: [...filaments, { presetId: filaments[filaments.length - 1].presetId, color: palette[(filaments.length - 1) % palette.length] }], flushMatrix: null }); }}>
          <Icon name="add" />
        </button>
      </div>
      <Body closed={closed}><div className="slots">
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
              <span className="badge mat" title={f.overrides ? 'Filament type · settings changed on this slot' : 'Filament type'}>{String(f.overrides?.filament_type ?? fil.type)}{f.overrides ? '*' : ''}</span>
              {!bed && <span title="Not recommended on this build plate" style={{ color: 'var(--warning)', display: 'flex' }}><Icon name="warn" size={14} /></span>}
              <button className="icon-btn" title="Filament details" onClick={() => setEdit(k)}><Icon name="edit" size={16} /></button>
              {filaments.length > 1 && <button className="icon-btn" title="Remove filament" onClick={() => remove(k)}><Icon name="close" size={14} /></button>}
            </div>
          );
        })}
      </div></Body>
      {edit !== null && <FilamentModal slot={edit} onClose={() => setEdit(null)} />}
      {flush && <FlushModal onClose={() => setFlush(false)} />}
    </section>
  );
}

function ProcessCard() {
  const s = useStore();
  const base = useMemo(() => baseProcess({ printerId: s.printerId, presetId: s.presetId, machineOverrides: s.machineOverrides }), [s.printerId, s.presetId, s.machineOverrides]);
  const global: Config = { ...base, ...s.overrides };
  const modifiedCount = Object.keys(s.overrides).length;
  const q = s.search.trim().toLowerCase();
  const objMode = s.processMode === 'objects';
  const selObjs = s.objects.filter((o) => s.selected.includes(o.id));
  const part = s.selectedPart ? selObjs[0]?.parts?.find((p) => p.id === s.selectedPart) : undefined;
  const range = !part && s.selectedRange && selObjs.length === 1 ? selObjs[0].heightRanges?.find((r) => r.id === s.selectedRange) : undefined;
  // Objects mode edits only what can differ per object (or per modifier / height range); everything else stays global
  const allowed = objMode ? new Set(part ? (part.type === 'modifier' ? MODIFIER_KEYS : []) : range ? HEIGHT_RANGE_KEYS : OBJECT_KEYS) : null;
  const visible = PROCESS_PARAMS.filter((p) => (s.showAdvanced || !p.advanced || allowed) && (!allowed || allowed.has(p.key)));
  const tabs = PROCESS_TABS.filter((t) => visible.some((p) => p.tab === t));
  const tab = tabs.includes(s.processTab) ? s.processTab : tabs[0];
  const list = q
    ? visible.filter((p) => `${p.label} ${p.group} ${p.key} ${p.tab}`.toLowerCase().includes(q))
    : visible.filter((p) => p.tab === tab);
  const groups = [...new Set(list.map((p) => (q ? `${p.tab} › ${p.group}` : p.group)))];
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [cardClosed, toggleCard] = useCollapsed('process');

  // per-object values: the object's override, else the global value
  const ov = (k: string): { value: Config[string]; modified: boolean } => {
    if (part) return { value: part.overrides[k] ?? global[k], modified: k in part.overrides };
    if (range) { const own = selObjs[0].overrides ?? {}; return { value: range.overrides[k] ?? own[k] ?? global[k], modified: k in range.overrides }; }
    const own = selObjs.find((o) => o.overrides && k in o.overrides);
    return { value: own ? own.overrides![k] : global[k], modified: !!own };
  };
  const setObj = (k: string, v: Config[string] | undefined) => {
    if (part) {
      updatePart(selObjs[0].id, part.id, (p) => { const o = { ...p.overrides }; if (v === undefined) delete o[k]; else o[k] = v; return { ...p, overrides: o }; });
      return;
    }
    if (range) {
      const o = { ...range.overrides };
      if (v === undefined) delete o[k]; else o[k] = v;
      updateHeightRange(selObjs[0].id, range.id, { overrides: o });
      return;
    }
    s.updateObjects((o) => {
      const o2 = { ...(o.overrides ?? {}) };
      if (v === undefined || v === global[k]) delete o2[k]; else o2[k] = v;
      return { ...o, overrides: Object.keys(o2).length ? o2 : undefined };
    }, selObjs.map((o) => o.id));
  };
  const changed = (k: string) => (objMode ? (part ? k in part.overrides : range ? k in range.overrides : selObjs.some((o) => o.overrides && k in o.overrides)) : k in s.overrides);
  const tabCount = (t: string) => visible.filter((p) => p.tab === t && changed(p.key)).length;
  const objOverrideCount = part ? Object.keys(part.overrides).length : range ? Object.keys(range.overrides).length : new Set(selObjs.flatMap((o) => Object.keys(o.overrides ?? {}))).size;
  const target = part ? part.name : range ? `${selObjs[0].name} · ${range.z0}–${range.z1} mm` : selObjs.length === 1 ? selObjs[0].name : `${selObjs.length} objects`;

  return (
    <section className="card process">
      <div className="card-head">
        <CardTitle icon="layers" label="Process" closed={cardClosed} onToggle={toggleCard} />
        <span className="spacer" />
        <div className="seg icon-seg" role="tablist">
          <button className={!objMode ? 'on' : ''} aria-label="Global settings" onClick={() => s.set({ processMode: 'global' })} title="Global: settings for the whole plate"><Icon name="plate" size={15} /></button>
          <button className={objMode ? 'on' : ''} aria-label="Object settings" onClick={() => s.set({ processMode: 'objects' })} title="Objects: settings for the selected objects only"><Icon name="cube" size={15} /></button>
        </div>
        <button className={`icon-btn ${searchOpen ? 'active' : ''}`} title="Search settings (Ctrl+F)" onClick={() => { setSearchOpen(!searchOpen); s.set({ search: '' }); }}><Icon name="search" /></button>
      </div>
      <Body closed={cardClosed}>
      {!objMode && (
        <div className="row">
          <select className="select" value={s.presetId} aria-label="Process preset" onChange={(e) => { s.set({ presetId: e.target.value }); s.markDirty(); }}>
            {PROCESS_PRESETS.map((p) => <option key={p.id} value={p.id}>{modifiedCount && p.id === s.presetId ? '* ' : ''}{p.name} @{printerById(s.printerId).model}{modifiedCount && p.id === s.presetId ? ' (modified)' : ''}</option>)}
          </select>
          <button className="icon-btn" title="Reset all modified values" disabled={!modifiedCount} onClick={() => { s.set({ overrides: {} }); s.markDirty(); }}><Icon name="reset" /></button>
        </div>
      )}
      {objMode && selObjs.length > 0 && (
        <div className="obj-target">
          <Icon name={part ? 'cube' : 'cube'} size={14} />
          <span className="name">{target}</span>
          <span className="muted">{objOverrideCount ? `${objOverrideCount} own setting${objOverrideCount > 1 ? 's' : ''}` : 'uses global'}</span>
          <button className="icon-btn" title="Reset to the global settings" disabled={!objOverrideCount}
            onClick={() => part ? updatePart(selObjs[0].id, part.id, (p) => ({ ...p, overrides: {} })) : range ? updateHeightRange(selObjs[0].id, range.id, { overrides: {} }) : s.updateObjects((o) => ({ ...o, overrides: undefined }), selObjs.map((o) => o.id))}>
            <Icon name="reset" size={15} />
          </button>
        </div>
      )}
      <div className="row">
        {searchOpen
          ? <input id="param-search" className="input" style={{ flex: 1 }} autoFocus placeholder="Search parameters…" value={s.search} onChange={(e) => s.set({ search: e.target.value })} />
          : <span style={{ color: 'var(--text-muted)', flex: 1 }}>{objMode ? (part ? 'Modifier settings' : range ? 'Height range settings' : 'Per-object settings') : modifiedCount ? `${modifiedCount} modified value${modifiedCount > 1 ? 's' : ''}` : 'System preset values'}</span>}
        {!objMode && <><span style={{ color: 'var(--text-muted)' }}>Advanced</span>
          <button className={`toggle ${s.showAdvanced ? 'on' : ''}`} aria-label="Show advanced" onClick={() => s.set({ showAdvanced: !s.showAdvanced })} /></>}
      </div>
      {objMode && !selObjs.length ? (
        <div className="empty-hint">Select an object in the object list or the 3D view to give it its own settings. Settings changed here apply to the selected objects only.</div>
      ) : objMode && part && part.type !== 'modifier' ? (
        <div className="empty-hint">{PART_HELP[part.type]} It has no settings of its own; move, rotate or scale it with the toolbar.</div>
      ) : <>
        {!q && (
          <div className="ptabs">
            {tabs.map((t) => (
              <button key={t} className={`ptab ${tab === t ? 'active' : ''}`} title={t} aria-label={t} onClick={() => s.set({ processTab: t })}>
                <Icon name={TAB_ICONS[t as ProcessTab]} size={17} />{tab === t && t}
                {tabCount(t) > 0 && <span className="tab-count" title={`${tabCount(t)} changed value${tabCount(t) > 1 ? 's' : ''}`}>{tabCount(t)}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="params">
          {groups.map((g) => (
            <div key={g}>
              <div className={`group-title ${closed[g] ? 'closed' : ''}`} onClick={() => setClosed({ ...closed, [g]: !closed[g] })}>
                <Icon name="chevronDown" size={14} /><Icon name={TAB_ICONS[(q ? g.split(' › ')[0] : tab) as ProcessTab] ?? 'layers'} size={14} className="group-ico" />{g}
              </div>
              {!closed[g] && list.filter((p) => (q ? `${p.tab} › ${p.group}` : p.group) === g).map((p) => {
                if (!objMode) return <ParamRow key={p.key} def={p} value={global[p.key]} baseValue={base[p.key]} cfg={global} modified={p.key in s.overrides}
                  onCommit={(x) => s.setOverride(p.key, x === base[p.key] ? undefined : x)} onReset={() => s.setOverride(p.key, undefined)} />;
                const v = ov(p.key);
                return <ParamRow key={p.key} def={p} value={v.value} baseValue={global[p.key]} cfg={{ ...global, [p.key]: v.value }} modified={v.modified}
                  onCommit={(x) => setObj(p.key, x)} onReset={() => setObj(p.key, undefined)} resetLabel="Use the global value" />;
              })}
            </div>
          ))}
          {!list.length && <div style={{ color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>No matching parameters.</div>}
        </div>
      </>}
      </Body>
    </section>
  );
}

/** Object list: plates, their objects and parts. Click selects (Ctrl toggles), right click opens the object menu. */
function ObjectsCard() {
  const s = useStore();
  const plates = s.plates.length;
  const menuAt = (e: React.MouseEvent, kind: 'object' | 'part', id: string, partId?: string) => {
    e.preventDefault();
    const st = useStore.getState();
    const plate = objectPlate(st.objects.find((o) => o.id === id)!, st.printerId, plates);
    if (kind === 'part') st.set({ selected: [id], selectedPart: partId!, contextMenu: { x: e.clientX, y: e.clientY, kind, plate, id, partId } });
    else st.set({ selected: st.selected.includes(id) ? st.selected : [id], selectedPart: null, contextMenu: { x: e.clientX, y: e.clientY, kind, plate, id } });
  };
  const [closed, toggle] = useCollapsed('objects');
  const pick = (e: React.MouseEvent, id: string, pi: number) => {
    const toggle = e.ctrlKey || e.metaKey;
    s.set({ selected: toggle ? (s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id]) : [id], selectedPart: null, selectedRange: null, activePlate: pi });
  };
  return (
    <section className="card objects-card">
      <div className="card-head">
        <CardTitle icon="cube" label="Objects" closed={closed} onToggle={toggle} />
        <span className="spacer" />
        <span className="badge">{s.objects.length}</span>
      </div>
      {!closed && <div className="objlist" role="tree">
        {s.plates.map((pl, pi) => {
          const objs = s.objects.filter((o) => objectPlate(o, s.printerId, plates) === pi);
          return (
            <div key={pl.id} role="group">
              {plates > 1 && <div className={`plate-row ${pi === s.activePlate ? 'active' : ''}`} onClick={() => s.set({ activePlate: pi })}>{pl.name}{pl.locked ? ' 🔒' : ''} · {objs.length}</div>}
              {objs.map((o) => {
                const own = Object.keys(o.overrides ?? {}).length;
                return (
                  <div key={o.id}>
                    <div role="treeitem" aria-selected={s.selected.includes(o.id) && !s.selectedPart}
                      className={`objrow ${s.selected.includes(o.id) && !s.selectedPart ? 'sel' : ''} ${o.printable === false ? 'off' : ''}`}
                      onClick={(e) => pick(e, o.id, pi)} onContextMenu={(e) => menuAt(e, 'object', o.id)}
                      onDoubleClick={() => renameObject(o.id)}>
                      <button className={`obj-eye ${o.hidden ? 'off' : ''}`} title={o.hidden ? 'Show in the 3D view' : 'Hide in the 3D view'} aria-label={o.hidden ? 'Show' : 'Hide'}
                        onClick={(e) => { e.stopPropagation(); s.updateObjects((x) => ({ ...x, hidden: !x.hidden || undefined }), [o.id]); }}>
                        <Icon name={o.hidden ? 'eyeOff' : 'eye'} size={13} />
                      </button>
                      <span className="name" title={o.name}>{o.name}</span>
                      {paintBadges(o).map(([k, t]) => <span key={k} className="badge paint" title={t}>{k}</span>)}
                      {o.layerHeights && <span className="badge" title="Variable layer height">VLH</span>}
                      {o.openEdges > 0 && <span className="warn" title={`${o.openEdges} open edges — mesh is not watertight`}><Icon name="warn" size={14} /></span>}
                      {isOutOfBounds(o, s.printerId, plates) && <span className="warn" title="Outside the printable area" style={{ color: 'var(--error)' }}><Icon name="warn" size={14} /></span>}
                      <button className={`obj-edit ${own ? 'has' : ''}`} title={own ? `${own} own setting${own > 1 ? 's' : ''} — edit` : 'Edit this object\'s settings'}
                        onClick={(e) => { e.stopPropagation(); s.set({ selected: [o.id], selectedPart: null, processMode: 'objects' }); }}>
                        <Icon name="gear" size={13} />
                      </button>
                      <select className="fil-pick" value={o.filament ?? 0} title="Filament" onClick={(e) => e.stopPropagation()}
                        style={{ background: slotColor(s, o.filament ?? 0) }}
                        onChange={(e) => s.updateObjects((x) => ({ ...x, filament: +e.target.value }), [o.id])}>
                        {s.filaments.map((_, k) => <option key={k} value={k}>{k + 1}</option>)}
                      </select>
                    </div>
                    {own > 0 && (
                      <div className="objrow sub" onClick={() => s.set({ selected: [o.id], selectedPart: null, processMode: 'objects' })}>
                        <Icon name="gear" size={12} /><span className="name">{Object.keys(o.overrides!).map((k) => PARAM_BY_KEY[k]?.label ?? k).join(', ')}</span>
                      </div>
                    )}
                    {(o.heightRanges ?? []).map((r) => (
                      <div key={r.id} className={`objrow part ${s.selectedRange === r.id && !s.selectedPart ? 'sel' : ''}`}
                        onClick={() => s.set({ selected: [o.id], selectedPart: null, selectedRange: r.id, processMode: 'objects', activePlate: pi })}>
                        <Icon name="layers" size={12} />
                        <span className="name">Layers</span>
                        <RangeInput value={r.z0} onCommit={(v) => updateHeightRange(o.id, r.id, { z0: Math.min(v, r.z1 - 0.01) })} />–
                        <RangeInput value={r.z1} onCommit={(v) => updateHeightRange(o.id, r.id, { z1: Math.max(v, r.z0 + 0.01) })} />mm
                        {Object.keys(r.overrides).length > 0 && <Icon name="gear" size={12} />}
                        <button className="icon-btn" title="Delete height range" onClick={(e) => { e.stopPropagation(); updateHeightRange(o.id, r.id, null); }}><Icon name="close" size={12} /></button>
                      </div>
                    ))}
                    {(o.parts ?? []).map((p) => (
                      <div key={p.id} className={`objrow part ${s.selectedPart === p.id ? 'sel' : ''}`}
                        onClick={() => s.set({ selected: [o.id], selectedPart: p.id, activePlate: pi })} onContextMenu={(e) => menuAt(e, 'part', o.id, p.id)}>
                        <span className="part-dot" style={{ background: PART_DOT[p.type] }} />
                        <span className="name">{p.name}</span>
                        {Object.keys(p.overrides).length > 0 && <Icon name="gear" size={12} />}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!s.objects.length && <div className="empty-hint" style={{ margin: 0 }}>No objects. Right-click the plate to add a shape, or drop a model file here.</div>}
      </div>}
    </section>
  );
}

function paintBadges(o: { paint?: { support?: ArrayLike<number>; seam?: ArrayLike<number>; color?: ArrayLike<number> }; brimEars?: unknown[] }): [string, string][] {
  const any = (a?: ArrayLike<number>) => !!a && Array.prototype.some.call(a, (v: number) => v !== 0);
  const out: [string, string][] = [];
  if (any(o.paint?.support)) out.push(['S', 'Support painted']);
  if (any(o.paint?.seam)) out.push(['Z', 'Seam painted']);
  if (any(o.paint?.color)) out.push(['C', 'Colour painted']);
  if (o.brimEars?.length) out.push(['B', 'Brim ears']);
  return out;
}

function RangeInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [d, setD] = useState<string | null>(null);
  return <input className="input range-z mono" value={d ?? String(value)} onClick={(e) => e.stopPropagation()} onChange={(e) => setD(e.target.value)}
    onBlur={() => { if (d !== null) { const v = parseFloat(d); if (isFinite(v) && v >= 0) onCommit(+v.toFixed(2)); setD(null); } }}
    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

const PART_DOT: Record<string, string> = { part: '#00AE42',  negative: '#FF3B30', modifier: '#FFC107', support_enforcer: '#1E88E5', support_blocker: '#E53935' };
const PART_HELP: Record<string, string> = {
  part: 'An extra solid volume printed as part of the object.',
  negative: 'Material inside this volume is removed (holes, cut-outs).',
  modifier: 'Changes infill settings inside this volume.',
  support_enforcer: 'Support is generated under any overhang inside this volume.',
  support_blocker: 'No support is generated inside this volume.',
};

function FlushModal({ onClose }: { onClose: () => void }) {
  const { filaments, flushMatrix, flushMultiplier, set, markDirty } = useStore();
  const colors = filaments.map((f) => f.color);
  const auto = autoFlushMatrix(colors);
  const val = (i: number, j: number) => flushMatrix?.[i]?.[j] ?? auto[i][j];
  const setVal = (i: number, j: number, v: number) => {
    const m = colors.map((_, a) => colors.map((__, b) => val(a, b)));
    m[i][j] = v;
    set({ flushMatrix: m }); markDirty();
  };
  return (
    <Modal title="Flushing volumes (mm³)" onClose={onClose} footer={<>
      <button className="btn-secondary btn-small" onClick={() => { set({ flushMatrix: null }); markDirty(); }}>Auto-calculate</button>
      <span className="spacer" />
      <span className="muted" style={{ fontSize: 12 }}>Multiplier</span>
      <input className="input mono" style={{ width: 60 }} type="number" step="0.1" min="0" value={flushMultiplier} onChange={(e) => { set({ flushMultiplier: Math.max(0, Number(e.target.value) || 0) }); markDirty(); }} />
      <button className="btn-primary btn-small" onClick={onClose}>Done</button>
    </>}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Purge needed when changing from the filament in a row to the filament in a column. Dark → light needs the most. {flushMatrix ? 'Edited values are used.' : 'Values are calculated from the colours.'}</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="flush-table">
          <thead><tr><th>From \ To</th>{filaments.map((f, j) => <th key={j}><span className="swatch" style={{ background: f.color, display: 'inline-block' }} /> {j + 1}</th>)}</tr></thead>
          <tbody>
            {filaments.map((f, i) => (
              <tr key={i}>
                <th><span className="swatch" style={{ background: f.color, display: 'inline-block' }} /> {i + 1}</th>
                {filaments.map((_, j) => <td key={j}>{i === j ? <span className="muted">—</span> : (
                  <input className="input mono" style={{ width: 64 }} value={val(i, j)} onChange={(e) => setVal(i, j, Math.max(0, Number(e.target.value.replace(/[^\d]/g, '')) || 0))} />
                )}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
