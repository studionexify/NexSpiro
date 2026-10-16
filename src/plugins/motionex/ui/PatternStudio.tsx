// Pattern tab: change the pattern of one placement and watch it on the model as you go. The model view
// keeps drawing the quick pattern preview; this panel holds the shape, depth and spacing, how layers lead
// or lag each other, layer stacking and the advanced curves, with close-ups of a short piece of wall.
// Edits go into the placement's own copy of the pattern; the library is left alone unless you save to it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../../state/store';
import { currentConfig } from '../../../state/slicing';
import { SURFACE_COLORS } from '../../../state/motionPaint';
import { profilesFromConfig } from '../engine';
import { brushAt, layerPhase } from '../modifier';
import { CURVE_INFO, pt, type CurveKey, type EventType, type Interpolation, type LayerEffect, type LayerMode, type MotionApplication, type MotionBrush, type MotionEvent } from '../model';
import { CurveEditor } from './curveEditor';
import { activate, activeApp, brushOf, changed, mx, surfaceOf, useMx, Wave } from './MotionexPanel';

/** The pattern being edited: the placement's own copy, or a copy of the library pattern with its size slider baked in. */
function draftOf(a: MotionApplication): MotionBrush | undefined {
  if (a.brush) return a.brush;
  const b = mx.library.get(a.brush_id);
  if (!b) return undefined;
  const c = structuredClone(b), k = a.scale ?? 1;
  if (k !== 1) { c.amplitude *= k; c.period_mm *= k; c.z_amplitude = (c.z_amplitude ?? 0) * k; }
  return c;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

// ----- wave shapes for the side-to-side curve
const SINE_H = 0.25 / 3, SINE_D = SINE_H * 2 * Math.PI;
const SHAPES: { id: string; label: string; make: () => MotionBrush['curves']['lateral_offset'] }[] = [
  { id: 'sine', label: 'Wave', make: () => ({ interpolation: 'bezier', points: [pt(0, 0, [-SINE_H, -SINE_D], [SINE_H, SINE_D]), pt(0.25, 1, [-SINE_H, 0], [SINE_H, 0]), pt(0.5, 0, [-SINE_H, SINE_D], [SINE_H, -SINE_D]), pt(0.75, -1, [-SINE_H, 0], [SINE_H, 0]), pt(1, 0, [-SINE_H, -SINE_D], [SINE_H, SINE_D])] }) },
  { id: 'zigzag', label: 'Zigzag', make: () => ({ interpolation: 'linear', points: [pt(0, 0), pt(0.25, 1), pt(0.75, -1), pt(1, 0)] }) },
  { id: 'square', label: 'Square', make: () => ({ interpolation: 'linear', points: [pt(0, 1), pt(0.48, 1), pt(0.52, -1), pt(0.98, -1), pt(1, 1)] }) },
  { id: 'scallop', label: 'Scallops', make: () => ({ interpolation: 'bezier', points: [pt(0, 0, [0, 0], [1 / 6, Math.PI / 6]), pt(0.5, 1, [-1 / 6, 0], [1 / 6, 0]), pt(1, 0, [-1 / 6, Math.PI / 6], [0, 0])] }) },
  { id: 'saw', label: 'Saw', make: () => ({ interpolation: 'linear', points: [pt(0, -1), pt(0.9, 1), pt(1, -1)] }) },
  { id: 'pulse', label: 'Bumps', make: () => ({ interpolation: 'bezier', points: [pt(0, 0), pt(0.35, 0, [0, 0], [0.06, 0]), pt(0.5, 1, [-0.06, 0], [0.06, 0]), pt(0.65, 0, [-0.06, 0], [0, 0]), pt(1, 0)] }) },
];

// ----- layer stacking presets
const STACKS: { id: string; label: string; hint: string; make: (b: MotionBrush) => LayerEffect | null }[] = [
  { id: 'aligned', label: 'Lined up', hint: 'Every layer sits exactly on the one below.', make: () => null },
  { id: 'twist', label: 'Twist', hint: 'Each layer leads the one below a little, so the ridges climb round the part.', make: () => ({ shift_deg: 6, mode: 'steady', every: 1, band_on: 0, band_off: 0 }) },
  { id: 'bricks', label: 'Bricks', hint: 'Every few layers the pattern moves half a step, like brickwork.', make: () => ({ shift_deg: 180, mode: 'alternate', every: 4, band_on: 0, band_off: 0 }) },
  { id: 'zigzag', label: 'Zigzag', hint: 'Layers lead for a while, then lag back.', make: () => ({ shift_deg: 6, mode: 'back_and_forth', every: 15, band_on: 0, band_off: 0 }) },
  { id: 'diamond', label: 'Diamonds', hint: 'Slants both ways at once for a diamond grid.', make: () => ({ shift_deg: 6, mode: 'back_and_forth', every: 15, band_on: 0, band_off: 0, cross: true }) },
  { id: 'bands', label: 'Bands', hint: 'Pattern for some layers, then plain wall.', make: (b) => ({ shift_deg: 0, mode: 'steady', every: 1, ...b.layers, band_on: 10, band_off: 6 }) },
];
const MODES: [LayerMode, string, string][] = [
  ['steady', 'Keep going', 'Each step leads (or lags) further: a twist.'],
  ['alternate', 'Swap', 'Moves over and back every step.'],
  ['back_and_forth', 'There and back', 'Leads for a number of steps, then comes back.'],
  ['shift_hold', 'With pauses', 'Like there and back, but holds at each end.'],
];

const ADV_KEYS: CurveKey[] = ['along_offset', 'z_offset', 'extrusion_mult', 'speed_mult'];

export function PatternStudio() {
  useMx();
  const set = useStore((s) => s.set);
  const printerId = useStore((s) => s.printerId);
  const overrides = useStore((s) => s.overrides);
  const apps = mx.applications;
  const a = activeApp();
  const draft = useMemo(() => (a ? draftOf(a) : undefined), [a, a?.brush, a?.brush_id, a?.scale]); // eslint-disable-line react-hooks/exhaustive-deps
  const profiles = useMemo(() => profilesFromConfig(currentConfig(), printerId), [printerId, overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const [layer, setLayer] = useState(10);

  if (!a || !draft) {
    return (
      <aside className="studio">
        <div className="studio-empty">
          <b>No pattern on the plate yet</b>
          <p className="mx-muted">Add a pattern in Prepare and choose where it goes. Then come back here to change how it looks.</p>
          <button className="btn-primary btn-small" onClick={() => set({ workspace: 'prepare', dock: { ...useStore.getState().dock, open: true, tab: 'motionex' } })}>Go to Prepare</button>
        </div>
      </aside>
    );
  }

  /** Make an edit: the placement takes its own copy on the first one. */
  const edit = (fn: (b: MotionBrush) => void) => {
    if (!a.brush) { a.brush = draft; a.scale = 1; }
    fn(draft);
    changed();
  };
  const base = mx.library.get(a.brush_id);
  const libGroups = new Map<string, MotionBrush[]>();
  for (const b of mx.library.all()) { const g = mx.library.isPreset(b.id) ? b.category ?? 'Other' : 'My patterns'; libGroups.set(g, [...(libGroups.get(g) ?? []), b]); }
  const saveToLibrary = () => {
    const name = prompt('Name for the new pattern', `${draft.name} (mine)`)?.trim();
    if (!name) return;
    const saved = mx.library.save({ ...structuredClone(draft), id: `user-${Date.now().toString(36)}`, name, version: 1, tags: ['custom'], category: undefined });
    a.brush_id = saved.id; a.brush = undefined; a.scale = 1;
    changed();
    useStore.getState().set({ toast: { kind: 'info', text: `Saved “${name}” under My patterns.` } });
  };

  return (
    <aside className="studio" aria-label="Pattern editor">
      <div className="studio-head">
        {apps.length > 1 && (
          <div className="studio-places">
            {apps.map((x, i) => (
              <button key={i} className={`studio-place ${x === a ? 'on' : ''}`} onClick={() => activate(i)} title={brushOf(x)?.name}>
                <i className="mx-dot" style={{ background: SURFACE_COLORS[surfaceOf(x) - 1] }} />{brushOf(x)?.name ?? x.brush_id}
              </button>
            ))}
          </div>
        )}
        <div className="row" style={{ gap: 8, margin: 0, alignItems: 'center' }}>
          <i className="mx-dot" style={{ background: SURFACE_COLORS[surfaceOf(a) - 1] }} />
          <select className="select" style={{ flex: 1 }} value={a.brush_id} aria-label="Pattern"
            onChange={(e) => { if (a.brush && !confirm('Switching pattern drops your changes to this one. Switch anyway?')) return; a.brush_id = e.target.value; a.brush = undefined; changed(); }}>
            {[...libGroups].map(([g, bs]) => <optgroup key={g} label={g}>{bs.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>)}
          </select>
        </div>
        <div className="row" style={{ gap: 6, margin: 0, alignItems: 'center' }}>
          <span className="mx-muted" style={{ flex: 1, margin: 0 }}>{a.brush ? `Changed for this placement · library “${base?.name ?? a.brush_id}” is unchanged` : 'As in the library · any change applies to this placement only'}</span>
          <button className="btn-secondary btn-small" disabled={!a.brush} onClick={() => { if (confirm('Go back to the library pattern?')) { a.brush = undefined; changed(); } }}>Reset</button>
          <button className="btn-secondary btn-small" onClick={saveToLibrary} title="Keep these changes as a new pattern in My patterns">Save to library</button>
        </div>
      </div>

      <CloseUps b={draft} lineWidth={profiles.process.lineWidth} layerHeight={profiles.process.layerHeight || 0.2} layer={layer} setLayer={setLayer} />

      <section className="mx-card">
        <div className="mx-card-title">Wave shape</div>
        <div className="studio-shapes">
          {SHAPES.map((sh) => {
            const demo = { ...draft, curves: { ...draft.curves, lateral_offset: sh.make() }, layers: null, noise: null, z_amplitude: 0, repeat_mode: 'tile' as const };
            return (
              <button key={sh.id} className="mx-lib-card" title={sh.label} onClick={() => edit((b) => { b.curves.lateral_offset = sh.make(); })}>
                <Wave b={demo} small /><span>{sh.label}</span>
              </button>
            );
          })}
        </div>
        <CurveBox b={draft} k="lateral_offset" onEdit={edit} />
      </section>

      <section className="mx-card">
        <div className="mx-card-title">Depth and spacing</div>
        <Slider label="Depth (in and out)" unit="mm" min={0} max={Math.max(3, draft.amplitude * 1.5)} step={0.05} value={draft.amplitude} onChange={(v) => edit((b) => { b.amplitude = v; })} />
        <Slider label="Spacing (one repeat)" unit="mm" min={0.4} max={Math.max(30, draft.period_mm * 1.5)} step={0.1} value={draft.period_mm} onChange={(v) => edit((b) => { b.period_mm = v; })} />
        <Slider label="Start shift along the wall" unit="mm" min={0} max={draft.period_mm} step={0.05} value={r3((draft.phase_deg / 360) * draft.period_mm)}
          onChange={(v) => edit((b) => { b.phase_deg = r3((v / b.period_mm) * 360) % 360; })} />
        <label className="row" style={{ gap: 8, margin: 0 }}>
          <span style={{ flex: 1, fontSize: 12 }}>Fit a whole number of repeats round each loop<div className="mx-muted" style={{ margin: 0 }}>Stretches the spacing a little so there is no seam where a loop closes.</div></span>
          <button className={`toggle ${draft.repeat_mode === 'stretch' ? 'on' : ''}`} aria-label="Fit evenly" onClick={() => edit((b) => { b.repeat_mode = b.repeat_mode === 'stretch' ? 'tile' : 'stretch'; })} />
        </label>
      </section>

      <LeadLag b={draft} layerHeight={profiles.process.layerHeight || 0.2} onEdit={edit} />

      <section className="mx-card">
        <div className="mx-card-title">Layer stacking</div>
        <div className="studio-shapes">
          {STACKS.map((st) => (
            <button key={st.id} className={`mx-tool ${stackId(draft) === st.id ? 'on' : ''}`} title={st.hint} onClick={() => edit((b) => { b.layers = st.make(b); })}>{st.label}</button>
          ))}
        </div>
        <p className="mx-muted" style={{ margin: 0 }}>{STACKS.find((s) => s.id === stackId(draft))?.hint ?? 'Your own stacking.'}</p>
        {draft.layers && (
          <>
            <div className="mx-label">How the lead changes from step to step</div>
            <div className="seg mx-seg">
              {MODES.map(([m, l, hint]) => <button key={m} title={hint} className={draft.layers!.mode === m ? 'on' : ''} onClick={() => edit((b) => { b.layers = { ...b.layers!, mode: m }; })}>{l}</button>)}
            </div>
            {draft.layers.mode !== 'alternate' && (
              <label className="row" style={{ gap: 8, margin: 0 }}>
                <span style={{ flex: 1, fontSize: 12 }}>Slant both ways (diamonds and cells)</span>
                <button className={`toggle ${draft.layers.cross ? 'on' : ''}`} aria-label="Slant both ways" onClick={() => edit((b) => { b.layers = { ...b.layers!, cross: !b.layers!.cross }; })} />
              </label>
            )}
          </>
        )}
        <div className="mx-two">
          <label className="mx-field">Pattern on for (layers)
            <input className="input" type="number" min={0} step={1} value={draft.layers?.band_on ?? 0} title="0 = on all the time"
              onChange={(e) => edit((b) => { b.layers = { shift_deg: 0, mode: 'steady', every: 1, band_off: 0, ...b.layers, band_on: Math.max(0, Math.round(+e.target.value)) }; })} />
          </label>
          <label className="mx-field">then plain for (layers)
            <input className="input" type="number" min={0} step={1} value={draft.layers?.band_off ?? 0} disabled={!draft.layers?.band_on}
              onChange={(e) => edit((b) => { b.layers = { ...b.layers!, band_off: Math.max(0, Math.round(+e.target.value)) }; })} />
          </label>
        </div>
      </section>

      <Advanced b={draft} onEdit={edit} />
    </aside>
  );
}

function stackId(b: MotionBrush): string | null {
  const e = b.layers;
  if (!e || (!e.shift_deg && !e.band_on)) return 'aligned';
  if (e.band_on > 0) return 'bands';
  if (e.cross) return 'diamond';
  if (e.mode === 'steady') return 'twist';
  if (e.mode === 'alternate') return 'bricks';
  if (e.mode === 'back_and_forth') return 'zigzag';
  return null;
}

function Slider({ label, unit, min, max, step, value, onChange }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="studio-slider">
      <span className="studio-slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} aria-label={label} />
      <input className="input studio-num" type="number" min={min} step={step} value={r3(value)} onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) onChange(Math.max(min, v)); }} aria-label={`${label} (${unit})`} />
      <span className="studio-unit">{unit}</span>
    </div>
  );
}

/** How far each layer's pattern sits ahead of (lead) or behind (lag) the layer below, in mm along the wall. */
function LeadLag({ b, layerHeight, onEdit }: { b: MotionBrush; layerHeight: number; onEdit: (fn: (b: MotionBrush) => void) => void }) {
  const e = b.layers;
  const mm = r3((((e?.shift_deg ?? 0) / 360) * b.period_mm));
  const every = e?.every ?? 1;
  const setShift = (v: number) => onEdit((x) => { x.layers = { mode: 'steady', every: 1, band_on: 0, band_off: 0, ...x.layers, shift_deg: r3((v / x.period_mm) * 360) }; });
  const angle = Math.atan2(Math.abs(mm), layerHeight * every) * 180 / Math.PI;
  return (
    <section className="mx-card">
      <div className="mx-card-title">Lead and lag between layers</div>
      <p className="mx-muted" style={{ margin: 0 }}>Moves each layer's pattern along the wall compared with the layer below. 0 lines the layers up exactly. Plus leads, minus lags.</p>
      <Slider label="Each step leads by" unit="mm" min={-b.period_mm / 2} max={b.period_mm / 2} step={0.01} value={mm} onChange={setShift} />
      <div className="studio-slider">
        <span className="studio-slider-label">One step every</span>
        <input type="range" min={1} max={40} step={1} value={every} onChange={(ev) => onEdit((x) => { x.layers = { shift_deg: 0, mode: 'steady', band_on: 0, band_off: 0, ...x.layers, every: +ev.target.value }; })} aria-label="Layers per step" />
        <input className="input studio-num" type="number" min={1} step={1} value={every} onChange={(ev) => onEdit((x) => { x.layers = { shift_deg: 0, mode: 'steady', band_on: 0, band_off: 0, ...x.layers, every: Math.max(1, Math.round(+ev.target.value)) }; })} aria-label="Layers per step (number)" />
        <span className="studio-unit">layers</span>
      </div>
      <div className="row" style={{ gap: 6, margin: 0, flexWrap: 'wrap' }}>
        <button className="btn-secondary btn-small" onClick={() => setShift(0)}>Line up (0)</button>
        <button className="btn-secondary btn-small" onClick={() => setShift(b.period_mm / 2)}>Half a repeat</button>
        <button className="btn-secondary btn-small" title="Lag by one line width, so each ridge sits a line behind the one below" onClick={() => setShift(-0.4)}>Lag 0.4 mm</button>
        <button className="btn-secondary btn-small" onClick={() => setShift(-mm)} disabled={!mm}>Flip lead ↔ lag</button>
      </div>
      <p className="mx-muted" style={{ margin: 0 }}>
        {mm === 0 ? 'Layers are lined up.' : `${mm > 0 ? 'Leads' : 'Lags'} ${Math.abs(mm).toFixed(2)} mm every ${every} layer${every > 1 ? 's' : ''}: ridges lean about ${angle.toFixed(0)}° from upright.`}
        {angle > 60 ? ' That is a steep lean; ridges may not stack well.' : ''}
      </p>
    </section>
  );
}

/** One curve with its graph editor and a choice of smooth, straight or stepped. */
function CurveBox({ b, k, onEdit }: { b: MotionBrush; k: CurveKey; onEdit: (fn: (b: MotionBrush) => void) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const info = CURVE_INFO[k];
  const editRef = useRef(onEdit);
  editRef.current = onEdit;
  useEffect(() => {
    if (!host.current) return;
    const ed = new CurveEditor(b.curves[k], { min: info.min, max: info.max, disabled: false, onChange: () => editRef.current(() => {}), onSelect: () => {} });
    ed.canvas.style.height = '170px';
    ed.canvas.style.width = '100%';
    host.current.replaceChildren(ed.canvas);
    requestAnimationFrame(() => ed.draw());
  }, [b, b.curves[k], k]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="studio-curve">
      <div className="row" style={{ gap: 6, margin: 0, alignItems: 'center' }}>
        <span className="mx-muted" style={{ flex: 1, margin: 0 }}>{info.label} · {info.unit} · drag the dots, double-click to add one, Delete removes</span>
        <select className="select" style={{ width: 'auto' }} value={b.curves[k].interpolation} aria-label="Curve type"
          onChange={(e) => onEdit((x) => { x.curves[k] = { ...x.curves[k], interpolation: e.target.value as Interpolation }; })}>
          <option value="bezier">Smooth</option><option value="linear">Straight</option><option value="step">Steps</option>
        </select>
      </div>
      <div ref={host} className="studio-curve-host" />
    </div>
  );
}

function Advanced({ b, onEdit }: { b: MotionBrush; onEdit: (fn: (b: MotionBrush) => void) => void }) {
  const [k, setK] = useState<CurveKey>('z_offset');
  const n = b.noise;
  const newEvent = (t: EventType): MotionEvent => t === 'dwell' ? { at: { mode: 'percent', value: 50 }, type: t, params: { ms: 300, blob_mm3: 0 } }
    : t === 'flow_change' ? { at: { mode: 'percent', value: 50 }, type: t, params: { mult: 1.3 } }
    : { at: { mode: 'percent', value: 50 }, type: t, params: { length: 0, travel_mm: 1 } };
  return (
    <details className="mx-card mx-more">
      <summary className="mx-card-title">Advanced</summary>
      <div className="seg mx-seg">
        {ADV_KEYS.map((x) => <button key={x} className={k === x ? 'on' : ''} onClick={() => setK(x)}>{CURVE_INFO[x].label}</button>)}
      </div>
      {k === 'z_offset' && <Slider label="Up-and-down height" unit="mm" min={0} max={3} step={0.05} value={b.z_amplitude ?? 0} onChange={(v) => onEdit((x) => { x.z_amplitude = v; })} />}
      <CurveBox b={b} k={k} onEdit={onEdit} />
      <div className="mx-two">
        <label className="mx-field">Least plastic (×)<input className="input" type="number" step={0.05} value={b.limits.min_flow_mult} onChange={(e) => onEdit((x) => { x.limits = { ...x.limits, min_flow_mult: +e.target.value }; })} /></label>
        <label className="mx-field">Most plastic (×)<input className="input" type="number" step={0.05} value={b.limits.max_flow_mult} onChange={(e) => onEdit((x) => { x.limits = { ...x.limits, max_flow_mult: +e.target.value }; })} /></label>
      </div>
      <label className="row" style={{ gap: 8, margin: 0 }}>
        <span style={{ flex: 1, fontSize: 12 }}>Random roughness</span>
        <button className={`toggle ${n?.enabled ? 'on' : ''}`} aria-label="Random roughness"
          onClick={() => onEdit((x) => { x.noise = x.noise ? { ...x.noise, enabled: !x.noise.enabled } : { enabled: true, type: 'value', seed: 1337, scale: 1, octaves: 3, persistence: 0.5 }; })} />
      </label>
      {n?.enabled && (
        <>
          <Slider label="Roughness size" unit="×" min={0.05} max={4} step={0.05} value={n.scale} onChange={(v) => onEdit((x) => { x.noise = { ...x.noise!, scale: v }; })} />
          <Slider label="Bumpiness" unit="" min={0.1} max={0.9} step={0.05} value={n.persistence} onChange={(v) => onEdit((x) => { x.noise = { ...x.noise!, persistence: v }; })} />
          <Slider label="Pattern number" unit="" min={1} max={9999} step={1} value={n.seed} onChange={(v) => onEdit((x) => { x.noise = { ...x.noise!, seed: Math.round(v) }; })} />
        </>
      )}
      <div className="mx-label">Pauses, blobs and lift-offs</div>
      {b.events.map((e, i) => (
        <div key={i} className="studio-event">
          <b>{{ dwell: 'Pause', flow_change: 'Plastic change', retract: 'Lift-off' }[e.type]}</b>
          <label className="mx-field">At %<input className="input" type="number" min={0} max={100} step={5} value={e.at.mode === 'percent' ? e.at.value : 0} onChange={(ev) => onEdit((x) => { x.events[i] = { ...x.events[i], at: { mode: 'percent', value: Math.min(100, Math.max(0, +ev.target.value)) } }; })} /></label>
          {e.type === 'dwell' && <>
            <label className="mx-field">ms<input className="input" type="number" min={0} step={50} value={e.params.ms ?? 0} onChange={(ev) => onEdit((x) => { x.events[i].params = { ...x.events[i].params, ms: Math.max(0, +ev.target.value) }; })} /></label>
            <label className="mx-field">Blob mm³<input className="input" type="number" min={0} step={0.5} value={e.params.blob_mm3 ?? 0} onChange={(ev) => onEdit((x) => { x.events[i].params = { ...x.events[i].params, blob_mm3: Math.max(0, +ev.target.value) }; })} /></label>
          </>}
          {e.type === 'flow_change' && <label className="mx-field">Plastic ×<input className="input" type="number" min={0} step={0.1} value={e.params.mult ?? 1} onChange={(ev) => onEdit((x) => { x.events[i].params = { ...x.events[i].params, mult: Math.max(0, +ev.target.value) }; })} /></label>}
          {e.type === 'retract' && <label className="mx-field">Jump mm<input className="input" type="number" min={0} step={0.5} value={e.params.travel_mm ?? 0} onChange={(ev) => onEdit((x) => { x.events[i].params = { ...x.events[i].params, travel_mm: Math.max(0, +ev.target.value) }; })} /></label>}
          <button className="icon-btn" title="Remove" onClick={() => onEdit((x) => { x.events.splice(i, 1); })}>✕</button>
        </div>
      ))}
      <div className="row" style={{ gap: 6, margin: 0 }}>
        {([['dwell', '+ Pause'], ['flow_change', '+ Plastic change'], ['retract', '+ Lift-off']] as [EventType, string][]).map(([t, l]) => (
          <button key={t} className="btn-secondary btn-small" onClick={() => onEdit((x) => { x.events = [...x.events, newEvent(t)]; })}>{l}</button>
        ))}
      </div>
    </details>
  );
}

/** Close-ups of a short piece of wall: from above with the layers below and above, and from the side. */
function CloseUps({ b, lineWidth, layerHeight, layer, setLayer }: { b: MotionBrush; lineWidth: number; layerHeight: number; layer: number; setLayer: (n: number) => void }) {
  const top = useRef<HTMLCanvasElement>(null);
  const side = useRef<HTMLCanvasElement>(null);
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const draw = () => {
      if (top.current) drawTop(top.current, b, lineWidth, layer, theme === 'dark');
      if (side.current) drawSide(side.current, b, layer, theme === 'dark');
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (top.current) ro.observe(top.current);
    return () => ro.disconnect();
  });
  const off = layerPhase(b, layer) === null;
  return (
    <section className="mx-card studio-closeups">
      <div className="mx-card-title">Close-up<span className="spacer" />
        <span className="mx-muted" style={{ margin: 0, fontWeight: 400 }}>layer</span>
        <input className="input studio-num" type="number" min={1} step={1} value={layer} onChange={(e) => setLayer(Math.max(1, Math.round(+e.target.value)))} aria-label="Close-up layer" />
      </div>
      <canvas ref={top} className="studio-canvas" style={{ height: 150 }} />
      <div className="studio-legend"><i className="lg cur" />layer {layer}{off ? ' (plain)' : ''}<i className="lg below" />layer below<i className="lg above" />layer above<span className="spacer" />seen from above</div>
      <canvas ref={side} className="studio-canvas" style={{ height: 110 }} />
      <div className="studio-legend"><i className="lg out" />sticks out<i className="lg in" />pressed in<span className="spacer" />{(layerHeight * 36).toFixed(1)} mm of wall seen from the side</div>
    </section>
  );
}

const SPAN = (b: MotionBrush) => Math.max(10, Math.min(60, b.period_mm * 3));

function drawTop(cv: HTMLCanvasElement, b: MotionBrush, lineWidth: number, layer: number, dark: boolean) {
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const L = SPAN(b), A = Math.max(0.3, b.amplitude * 1.25 + lineWidth);
  const sx = (W - 24) / L, sy = Math.min(sx * 2, (H - 26) / (2 * A));
  const X = (x: number) => 12 + x * sx, Y = (y: number) => H / 2 - 4 - y * sy;
  g.strokeStyle = dark ? '#4a5260' : '#cfd5dd'; g.lineWidth = 1; g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(L), Y(0)); g.stroke(); g.setLineDash([]);
  const line = (n: number, style: string, width: number, dash: number[] = []) => {
    if (n < 0) return;
    g.strokeStyle = style; g.lineWidth = width; g.setLineDash(dash); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    let pen = false;
    for (let k = 0; k <= 400; k++) {
      const s = (k / 400) * L;
      const m = brushAt(b, s, 1e6, n, b.period_mm);
      const x = s + (m?.along ?? 0), y = m?.lat ?? 0;
      if (!pen) { g.moveTo(X(x), Y(y)); pen = true; } else g.lineTo(X(x), Y(y));
    }
    g.stroke(); g.setLineDash([]);
  };
  line(layer - 1, dark ? 'rgba(170,180,195,.55)' : 'rgba(110,120,135,.45)', Math.max(1.5, lineWidth * sx * 0.9));
  line(layer, 'rgba(255,122,69,.85)', Math.max(2, lineWidth * sx));
  line(layer + 1, dark ? '#69c0ff' : '#1f6fd1', 1.5, [5, 4]);
  g.fillStyle = dark ? '#9aa3b0' : '#6b7380'; g.font = '11px Inter, system-ui, sans-serif';
  const bar = Math.min(10, Math.max(1, Math.round(L / 4)));
  g.fillText(`${bar} mm`, X(L - bar), H - 4);
  g.strokeStyle = g.fillStyle; g.lineWidth = 1; g.beginPath(); g.moveTo(X(L - bar), H - 14); g.lineTo(X(L), H - 14); g.stroke();
}

function drawSide(cv: HTMLCanvasElement, b: MotionBrush, layer: number, dark: boolean) {
  const W = Math.max(1, Math.floor(cv.clientWidth)), H = Math.max(1, Math.floor(cv.clientHeight));
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!, img = g.createImageData(W, H), L = SPAN(b), rows = 36, A = Math.max(0.05, b.amplitude * 1.2);
  const first = Math.max(0, layer - rows / 2);
  const bg = dark ? [42, 46, 54] : [246, 245, 242];
  for (let r = 0; r < rows; r++) {
    const n = first + rows - 1 - r, y0 = Math.floor((r * H) / rows), y1 = Math.floor(((r + 1) * H) / rows);
    for (let x = 0; x < W; x++) {
      const m = brushAt(b, (x / W) * L, 1e6, n, b.period_mm);
      const t = m ? Math.max(-1, Math.min(1, m.lat / A)) : 0;
      const c = t >= 0 ? [bg[0] + (255 - bg[0]) * t, bg[1] + (122 - bg[1]) * t, bg[2] + (69 - bg[2]) * t] : [bg[0] + (54 - bg[0]) * -t, bg[1] + (130 - bg[1]) * -t, bg[2] + (230 - bg[2]) * -t];
      const edge = n === layer;
      for (let y = y0; y < y1; y++) {
        const i = (y * W + x) * 4;
        const line = edge && (y === y0 || y === y1 - 1);
        img.data[i] = line ? 20 : c[0]; img.data[i + 1] = line ? 20 : c[1]; img.data[i + 2] = line ? 20 : c[2]; img.data[i + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
}
