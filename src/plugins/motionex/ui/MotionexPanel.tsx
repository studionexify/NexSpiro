// Motionex panel in Nexspiro's right dock: pick surfaces, add patterns, see what the last slice found.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../../state/store';
import { currentConfig } from '../../../state/slicing';
import { createMotionexState, defaultApplication, saveMotionexState, toConfig, type MotionexState } from '../index';
import { profilesFromConfig, type MotionexConfig, type MotionexReport } from '../engine';
import type { MotionApplication, WallChoice } from '../model';
import type { CollisionMode } from '../core/toolhead';
import { openMotionexEditor } from './motionexEditor';
import { SURFACE_COLORS, surfaceName } from '../../registry';
import './editor.css';

const storage = typeof localStorage !== 'undefined' ? localStorage : null;
export const mx: MotionexState = createMotionexState(storage);

// tiny external store so React re-renders after edits to the plain Motionex state
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export function changed(): void {
  saveMotionexState(mx, storage);
  version++;
  listeners.forEach((l) => l());
  useStore.getState().markDirty();
}

/** Slicer config, or undefined when no pattern is switched on. */
export function motionexConfig(printerId: string): MotionexConfig | undefined {
  return mx.applications.some((a) => a.enabled) ? toConfig(mx, printerId) : undefined;
}

/** Patterns and settings stored in the project file. Pattern designs travel with them. */
export function motionexProject() {
  const used = new Set(mx.applications.map((a) => a.brush_id));
  return {
    applications: structuredClone(mx.applications), options: { ...mx.options }, collisionMode: mx.collisionMode,
    brushes: [...used].map((id) => mx.library.get(id)).filter((b) => !!b).map((b) => structuredClone(b)),
  };
}

export function loadMotionexProject(data: unknown) {
  const d = data as Partial<ReturnType<typeof motionexProject>> | null;
  if (!d) return;
  for (const b of d.brushes ?? []) if (b && !mx.library.get(b.id)) mx.library.save(b);
  mx.applications = d.applications ?? [];
  if (d.options) mx.options = { ...mx.options, ...d.options };
  if (d.collisionMode) mx.collisionMode = d.collisionMode;
  changed();
}

const SURFACES = 6;
const WALLS: [WallChoice, string][] = [['outer', 'Outer wall'], ['inner', 'Inner walls'], ['all', 'All walls']];
const COLLIDE: [CollisionMode, string][] = [['clamp', 'Lower the movement there'], ['skip', 'Skip the movement there'], ['fail', 'Stop and show me']];

export function MotionexPanel() {
  useSyncExternalStore(subscribe, () => version);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const apps = mx.applications;
  const add = () => {
    const a = defaultApplication('preset-sine');
    a.order = apps.length;
    apps.push(a);
    changed();
  };
  return (
    <div className="mx-panel">
      <div className="mx-head">
        <span className="mx-badge">M</span>
        <div><div className="mx-title">Motionex</div><div className="mx-sub">Waves, loops and textures on your walls</div></div>
      </div>
      <SurfacePicker />
      <section className="mx-card">
        <div className="mx-card-title">Patterns<span className="spacer" /><button className="btn-secondary btn-small" onClick={() => setEditing(null)}>Pattern library…</button></div>
        {!apps.length && <p className="mx-muted">No patterns yet. Add one, then choose where it goes.</p>}
        {apps.map((a, i) => <AppCard key={i} a={a} i={i} onEdit={() => setEditing(a.brush_id)} />)}
        <button className="btn-primary btn-small mx-add" onClick={add}>+ Add pattern</button>
      </section>
      <Settings />
      <Report />
      {editing !== undefined && <EditorHost startId={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function SurfacePicker() {
  const { tool, set, motionSet, motionGrowAngle, brushSize, objects } = useStore();
  const counts = Array.from({ length: SURFACES }, (_, k) => objects.reduce((n, o) => n + (o.paint?.motion?.reduce((c, v) => c + (v === k + 1 ? 1 : 0), 0) ?? 0), 0));
  const clear = (n: number) => {
    const s = useStore.getState();
    s.updateObjects((o) => (o.paint?.motion ? { ...o, paint: { ...o.paint, motion: o.paint.motion.map((v) => (v === n ? 0 : v)) } } : o), s.objects.map((o) => o.id));
    s.markDirty();
  };
  const picking = tool === 'pick_motion' || tool === 'paint_motion';
  return (
    <section className="mx-card">
      <div className="mx-card-title">Surfaces</div>
      <p className="mx-muted">Pick the faces a pattern should cover. Flat or curved — one click takes the whole smooth surface.</p>
      <div className="mx-chips">
        {counts.map((c, k) => (
          <button key={k} className={`mx-chip ${motionSet === k + 1 ? 'on' : ''}`} onClick={() => set({ motionSet: k + 1 })} title={`${surfaceName(k + 1)}: ${c} triangles`}>
            <i style={{ background: SURFACE_COLORS[k] }} />{k + 1}{c ? '' : ' ·'}
          </button>
        ))}
      </div>
      <div className="seg mx-seg">
        <button className={tool === 'pick_motion' ? 'on' : ''} onClick={() => set({ tool: tool === 'pick_motion' ? 'select' : 'pick_motion' })}>Click surface</button>
        <button className={tool === 'paint_motion' ? 'on' : ''} onClick={() => set({ tool: tool === 'paint_motion' ? 'select' : 'paint_motion' })}>Paint</button>
        <button disabled={!picking} onClick={() => set({ tool: 'select' })}>Done</button>
      </div>
      {tool === 'pick_motion' && (
        <label className="mx-field">Spread over edges up to {motionGrowAngle}°
          <input type="range" min={1} max={60} value={motionGrowAngle} onChange={(e) => set({ motionGrowAngle: +e.target.value })} />
        </label>
      )}
      {tool === 'paint_motion' && (
        <label className="mx-field">Brush size {brushSize} mm
          <input type="range" min={0.4} max={20} step={0.2} value={brushSize} onChange={(e) => set({ brushSize: +e.target.value })} />
        </label>
      )}
      {picking && <p className="mx-muted">Left click adds to {surfaceName(motionSet)}. Right click or Shift+click removes.</p>}
      {counts[motionSet - 1] > 0 && <button className="btn-secondary btn-small" onClick={() => clear(motionSet)}>Clear {surfaceName(motionSet)}</button>}
    </section>
  );
}

function AppCard({ a, i, onEdit }: { a: MotionApplication; i: number; onEdit: () => void }) {
  const objects = useStore((s) => s.objects);
  const present = new Set<number>();
  for (const o of objects) o.paint?.motion?.forEach((v) => { if (v) present.add(v); });
  const upd = (f: () => void) => { f(); changed(); };
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const b of mx.library.all()) {
    const g = mx.library.isPreset(b.id) ? b.category ?? 'Other' : 'My patterns';
    groups.set(g, [...(groups.get(g) ?? []), { id: b.id, name: b.name }]);
  }
  const faces = a.target.faces ?? [];
  return (
    <div className={`mx-app ${a.enabled ? '' : 'off'}`}>
      <div className="mx-app-top">
        <input type="checkbox" checked={a.enabled} aria-label="On" title="On / off" onChange={(e) => upd(() => { a.enabled = e.target.checked; })} />
        <select className="select" value={a.brush_id} aria-label="Pattern" onChange={(e) => upd(() => { a.brush_id = e.target.value; })}>
          {[...groups].map(([g, bs]) => <optgroup key={g} label={g}>{bs.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>)}
        </select>
        <button className="icon-btn" title="Edit this pattern" onClick={onEdit}>✎</button>
        <button className="icon-btn" title="Remove" onClick={() => upd(() => { mx.applications.splice(i, 1); })}>✕</button>
      </div>
      <div className="mx-label">Goes on</div>
      <div className="seg mx-seg">
        <button className={a.target.type === 'body' ? 'on' : ''} onClick={() => upd(() => { a.target = { ...a.target, type: 'body' }; })}>Whole body</button>
        <button className={a.target.type === 'faces' ? 'on' : ''} onClick={() => upd(() => { a.target = { ...a.target, type: 'faces', faces: faces.length ? faces : [String(useStore.getState().motionSet)] }; })}>Picked surfaces</button>
      </div>
      {a.target.type === 'faces' && (
        <div className="mx-chips">
          {Array.from({ length: SURFACES }, (_, k) => String(k + 1)).map((n) => (
            <label key={n} className={`mx-chip ${faces.includes(n) ? 'on' : ''}`} title={present.has(+n) ? surfaceName(+n) : `${surfaceName(+n)} (nothing picked yet)`}>
              <input type="checkbox" checked={faces.includes(n)} onChange={(e) => upd(() => { a.target.faces = e.target.checked ? [...faces, n] : faces.filter((x) => x !== n); })} />
              <i style={{ background: SURFACE_COLORS[+n - 1], opacity: present.has(+n) ? 1 : 0.35 }} />{n}
            </label>
          ))}
        </div>
      )}
      <div className="mx-label">Walls</div>
      <div className="seg mx-seg">
        {WALLS.map(([w, l]) => <button key={w} className={(a.target.walls ?? 'outer') === w ? 'on' : ''} onClick={() => upd(() => { a.target = { ...a.target, walls: w }; })}>{l}</button>)}
      </div>
      <label className="mx-field">Size ×{(a.scale ?? 1).toFixed(2)}
        <input type="range" min={0.25} max={3} step={0.05} value={a.scale ?? 1} onChange={(e) => upd(() => { a.scale = +e.target.value; })} />
      </label>
      <div className="mx-two">
        <label className="mx-field">Start at (mm)<input className="input" type="number" min={0} step={0.2} value={a.mask.z_start} onChange={(e) => upd(() => { a.mask.z_start = +e.target.value; })} /></label>
        <label className="mx-field">Stop at (mm)<input className="input" type="number" min={0} step={0.2} value={a.mask.z_end >= 1e4 ? '' : a.mask.z_end} placeholder="top" onChange={(e) => upd(() => { a.mask.z_end = e.target.value === '' ? 1e4 : +e.target.value; })} /></label>
      </div>
      {i > 0 && (
        <div className="seg mx-seg">
          <button className={a.blend === 'add' ? 'on' : ''} onClick={() => upd(() => { a.blend = 'add'; })}>Add on top</button>
          <button className={a.blend === 'override' ? 'on' : ''} onClick={() => upd(() => { a.blend = 'override'; })}>Replace earlier</button>
        </div>
      )}
    </div>
  );
}

function Settings() {
  return (
    <section className="mx-card">
      <div className="mx-card-title">Safety</div>
      <label className="mx-field">If the print head would hit the print
        <select className="select" value={mx.collisionMode} onChange={(e) => { mx.collisionMode = e.target.value as CollisionMode; changed(); }}>
          {COLLIDE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="mx-field">Loops print at {Math.round(mx.options.loopSpeedShare * 100)}% speed
        <input type="range" min={0.2} max={1} step={0.05} value={mx.options.loopSpeedShare} onChange={(e) => { mx.options.loopSpeedShare = +e.target.value; changed(); }} />
      </label>
      <p className="mx-muted">Print-head shape: {mx.toolheads.get(useStore.getState().printerId).name}. Used to check up-and-down patterns for collisions.</p>
    </section>
  );
}

function Report() {
  const result = useStore((s) => s.slice.result);
  const dirty = useStore((s) => s.slice.dirty);
  const rep = result?.pluginReports?.motionex as MotionexReport | undefined;
  if (!rep) return null;
  const c = rep.check;
  const rows: [boolean, string][] = [
    [c.collisionCount === 0, c.collisionCount ? `Print head would hit the print in ${c.collisionCount} spots${c.blocking ? ' — export stopped' : ' (fixed)'}` : 'Print head stays clear of the print'],
    [c.flowCapHits === 0, c.flowCapHits ? `Slowed in ${c.flowCapHits} spots to stay within the hotend's melt limit` : 'Plastic flow within the hotend limit'],
    [c.speedHits + c.zSpeedHits + c.accelHits === 0, c.speedHits + c.zSpeedHits + c.accelHits ? `Kept within printer speed limits in ${c.speedHits + c.zSpeedHits + c.accelHits} spots` : 'Within printer speed limits'],
    [c.loopSlowed === 0, c.loopSlowed ? `Loops printed slower in ${c.loopSlowed} spots` : 'No loops slowed'],
  ];
  return (
    <section className="mx-card">
      <div className="mx-card-title">Last slice{dirty ? ' (out of date)' : ''}</div>
      <p className="mx-muted">{rep.movedPaths} wall paths changed · pauses {c.events.dwell} · lift-offs {c.events.retract} · plastic changes {c.events.flow}</p>
      {rows.map(([ok, t], k) => <div key={k} className="mx-check"><span className={ok ? 'ok' : 'bad'}>{ok ? '✓' : '!'}</span>{t}</div>)}
    </section>
  );
}

function EditorHost({ startId, onClose }: { startId: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const printerId = useStore.getState().printerId;
    openMotionexEditor(ref.current, mx, () => profilesFromConfig(currentConfig(), printerId), startId, (didChange) => { if (didChange) changed(); onClose(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(<div className="mx-modal" ref={ref} />, document.body);
}
