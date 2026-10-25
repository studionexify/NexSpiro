// Motion tab: change the motion of one placement and watch it on the model as you go. The model view
// keeps drawing the quick motion preview; this panel holds the shape, depth and spacing, how layers lead
// or lag each other, layer stacking and the advanced curves, with close-ups of a short piece of wall.
// Edits go into the placement's own copy of the motion; the library is left alone unless you save to it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../../state/store';
import { currentConfig } from '../../../state/slicing';
import { SURFACE_COLORS } from '../../../state/motionPaint';
import { profilesFromConfig } from '../engine';
import { composePath, layerPhase } from '../modifier';
import { VIEW_COLORS, type PreviewView } from '../preview';
import type { PrintProfiles } from '../core/profiles';
import type { Toolpath, ToolpathPoint } from '../core/types';
import { CURVE_INFO, pt, type CurveKey, type EventType, type Interpolation, type LayerEffect, type LayerMode, type WaveShape, type MotionApplication, type MotionBrush, type MotionEvent } from '../model';
import { CurveEditor } from './curveEditor';
import { activate, activeApp, addApplication, brushOf, changed, lastPreview, mx, surfaceOf, useMx, Wave } from './MotionexPanel';

/** The motion being edited: the placement's own copy, or a copy of the library motion with its size slider baked in. */
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
  { id: 'bricks', label: 'Bricks', hint: 'Every few layers the motion moves half a step, like brickwork.', make: () => ({ shift_deg: 180, mode: 'alternate', every: 4, band_on: 0, band_off: 0 }) },
  { id: 'zigzag', label: 'Zigzag', hint: 'Layers lead for a while, then lag back.', make: () => ({ shift_deg: 6, mode: 'back_and_forth', every: 15, band_on: 0, band_off: 0 }) },
  { id: 'wavy', label: 'Wavy', hint: 'Layers swing smoothly between leading and lagging: ridges snake up the wall.', make: () => ({ shift_deg: 30, lag_deg: 30, mode: 'wave', wave_shape: 'sine', every: 24, band_on: 0, band_off: 0 }) },
  { id: 'diamond', label: 'Diamonds', hint: 'Slants both ways at once for a diamond grid.', make: () => ({ shift_deg: 6, mode: 'back_and_forth', every: 15, band_on: 0, band_off: 0, cross: true }) },
  { id: 'bands', label: 'Bands', hint: 'Motion for some layers, then plain wall.', make: (b) => ({ shift_deg: 0, mode: 'steady', every: 1, ...b.layers, band_on: 10, band_off: 6 }) },
];
const MODES: [LayerMode, string, string][] = [
  ['steady', 'Keep going', 'Each step leads (or lags) further: a twist.'],
  ['alternate', 'Swap', 'Moves over and back every step.'],
  ['back_and_forth', 'There and back', 'Leads for a number of steps, then comes back.'],
  ['shift_hold', 'With pauses', 'Like there and back, but holds at each end.'],
  ['wave', 'Wave', 'Swings between leading and lagging in a smooth (or chosen) wave.'],
];
const WAVE_SHAPES: [WaveShape, string, string][] = [
  ['sine', 'Smooth', 'A smooth sine swing: soft S-shaped ridges.'],
  ['rounded', 'Rounded', 'Holds near full lead and full lag, with smooth turns.'],
  ['triangle', 'Zigzag', 'Straight runs with sharp turns.'],
  ['square', 'Jump', 'Jumps between lead and lag: offset blocks.'],
  ['ramp', 'Ramp', 'Creeps forward, then snaps back: saw-tooth ridges.'],
];

const ADV_KEYS: CurveKey[] = ['along_offset', 'z_offset', 'extrusion_mult', 'speed_mult'];
const CURVE_HINT: Record<CurveKey, string> = {
  lateral_offset: 'Side to side, in and out of the wall.',
  along_offset: 'Forwards and back along the wall: makes loops and curls. The model shows the motion itself.',
  z_offset: 'Up and down within the layer. The model is coloured by height: orange lifted, blue lowered.',
  extrusion_mult: 'How much plastic each spot gets. The model is coloured by plastic and the close-up line gets thicker and thinner.',
  speed_mult: 'How fast each spot prints. The model is coloured by speed.',
};

export function MotionStudio() {
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
          <b>No motion yet</b>
          <p className="mx-muted">Start with a Wave and change it here. Choose where it goes on the model from the Motionex bar.</p>
          <button className="btn-primary btn-small" onClick={() => { addApplication('preset-sine'); changed(); }}>Add a Wave</button>
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
  for (const b of mx.library.all()) { const g = mx.library.isPreset(b.id) ? b.category ?? 'Other' : 'My motions'; libGroups.set(g, [...(libGroups.get(g) ?? []), b]); }
  const saveToLibrary = () => {
    const name = prompt('Name for the new motion', `${draft.name} (mine)`)?.trim();
    if (!name) return;
    const saved = mx.library.save({ ...structuredClone(draft), id: `user-${Date.now().toString(36)}`, name, version: 1, tags: ['custom'], category: undefined });
    a.brush_id = saved.id; a.brush = undefined; a.scale = 1;
    changed();
    useStore.getState().set({ toast: { kind: 'info', text: `Saved “${name}” under My motions.` } });
  };

  return (
    <aside className="studio" aria-label="Motion editor">
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
          <select className="select" style={{ flex: 1 }} value={a.brush_id} aria-label="Motion"
            onChange={(e) => { if (a.brush && !confirm('Switching motion drops your changes to this one. Switch anyway?')) return; a.brush_id = e.target.value; a.brush = undefined; changed(); }}>
            {[...libGroups].map(([g, bs]) => <optgroup key={g} label={g}>{bs.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>)}
          </select>
        </div>
        <div className="row" style={{ gap: 6, margin: 0, alignItems: 'center' }}>
          <span className="mx-muted" style={{ flex: 1, margin: 0 }}>{a.brush ? `Changed for this placement · library “${base?.name ?? a.brush_id}” is unchanged` : 'As in the library · any change applies to this placement only'}</span>
          <button className="btn-secondary btn-small" disabled={!a.brush} onClick={() => { if (confirm('Go back to the library motion?')) { a.brush = undefined; changed(); } }}>Reset</button>
          <button className="btn-secondary btn-small" onClick={saveToLibrary} title="Keep these changes as a new motion in My motions">Save to library</button>
        </div>
      </div>

      <ViewPicker />

      <CloseUps b={draft} profiles={profiles} layer={layer} setLayer={setLayer} />

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
          <label className="mx-field">Motion on for (layers)
            <input className="input" type="number" min={0} step={1} value={draft.layers?.band_on ?? 0} title="0 = on all the time"
              onChange={(e) => edit((b) => { b.layers = { shift_deg: 0, mode: 'steady', every: 1, band_off: 0, ...b.layers, band_on: Math.max(0, Math.round(+e.target.value)) }; })} />
          </label>
          <label className="mx-field">then plain for (layers)
            <input className="input" type="number" min={0} step={1} value={draft.layers?.band_off ?? 0} disabled={!draft.layers?.band_on}
              onChange={(e) => edit((b) => { b.layers = { ...b.layers!, band_off: Math.max(0, Math.round(+e.target.value)) }; })} />
          </label>
        </div>
      </section>

      <Advanced b={draft} onEdit={edit} profiles={profiles} />
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
  if (e.mode === 'wave') return 'wavy';
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

/** How far each layer's motion sits ahead of (lead) or behind (lag) the layer below, in mm along the wall. */
function LeadLag({ b, layerHeight, onEdit }: { b: MotionBrush; layerHeight: number; onEdit: (fn: (b: MotionBrush) => void) => void }) {
  const e = b.layers;
  const mm = r3((((e?.shift_deg ?? 0) / 360) * b.period_mm));
  const every = e?.every ?? 1;
  const setShift = (v: number) => onEdit((x) => { x.layers = { mode: 'steady', every: 1, band_on: 0, band_off: 0, ...x.layers, shift_deg: r3((v / x.period_mm) * 360) }; });
  const angle = Math.atan2(Math.abs(mm), layerHeight * every) * 180 / Math.PI;
  return (
    <section className="mx-card">
      <div className="mx-card-title">Lead and lag between layers</div>
      <p className="mx-muted" style={{ margin: 0 }}>Moves each layer's motion along the wall compared with the layer below. 0 lines the layers up exactly. Plus leads, minus lags.</p>
      <Slider label="Each step leads by" unit="mm" min={-b.period_mm / 2} max={b.period_mm / 2} step={0.01} value={mm} onChange={setShift} />
      <div className="studio-slider">
        <span className="studio-slider-label">{e?.mode === 'wave' ? 'One full swing every' : 'One step every'}</span>
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
      {(e?.mode === 'alternate' || e?.mode === 'wave') && (
        <>
          <Slider label={e.mode === 'wave' ? 'Lags by (at the other end of the swing)' : 'The other layers lag by'} unit="mm" min={0} max={b.period_mm / 2} step={0.01}
            value={r3((((e.lag_deg ?? (e.mode === 'wave' ? e.shift_deg : 0)) / 360) * b.period_mm))}
            onChange={(v) => onEdit((x) => { x.layers = { ...x.layers!, lag_deg: r3((v / x.period_mm) * 360) }; })} />
          <p className="mx-muted" style={{ margin: 0 }}>{e.mode === 'wave' ? 'Lead and lag can differ: an uneven swing leans the snaking ridges one way.' : 'Alternate layers lead and lag by these amounts: 0 lag swaps between lined up and leading.'}</p>
        </>
      )}
      {e?.mode === 'wave' && (
        <>
          <div className="mx-label">Wave type</div>
          <div className="seg mx-seg">
            {WAVE_SHAPES.map(([k, l, hint]) => <button key={k} title={hint} className={(e.wave_shape ?? 'sine') === k ? 'on' : ''} onClick={() => onEdit((x) => { x.layers = { ...x.layers!, wave_shape: k }; })}>{l}</button>)}
          </div>
          <SwingGraph e={e} />
        </>
      )}
      <p className="mx-muted" style={{ margin: 0 }}>
        {e?.mode === 'wave' ? `One full swing every ${Math.max(2, every)} layers (${(Math.max(2, every) * layerHeight).toFixed(1)} mm of height). ` : ''}
        {mm === 0 ? 'Layers are lined up.' : `${mm > 0 ? 'Leads' : 'Lags'} ${Math.abs(mm).toFixed(2)} mm every ${every} layer${every > 1 ? 's' : ''}: ridges lean about ${angle.toFixed(0)}° from upright.`}
        {angle > 60 ? ' That is a steep lean; ridges may not stack well.' : ''}
      </p>
    </section>
  );
}

/** Lead (up) and lag (down) of each layer over two swings, so the chosen wave type and amounts are visible. */
function SwingGraph({ e }: { e: LayerEffect }) {
  const n = Math.max(2, e.every) * 2, lead = Math.max(1e-9, e.shift_deg), lag = e.lag_deg ?? e.shift_deg, m = Math.max(lead, lag, 1e-9);
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const d = layerPhase({ layers: { ...e, band_on: 0 } } as MotionBrush, i) ?? 0;
    return `${(i / n) * 100},${15 - (d / m) * 13}`;
  }).join(' ');
  return (
    <svg className="mx-wave" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="Lead and lag by layer">
      <line x1="0" y1="15" x2="100" y2="15" stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
      <polyline points={pts} fill="none" stroke="var(--accent, #2b7cff)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
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

/** The model preview shows what each advanced curve changes. */
const VIEW_FOR: Record<CurveKey, PreviewView> = { lateral_offset: 'motion', along_offset: 'motion', z_offset: 'height', extrusion_mult: 'plastic', speed_mult: 'speed' };

function Advanced({ b, onEdit, profiles }: { b: MotionBrush; onEdit: (fn: (b: MotionBrush) => void) => void; profiles: PrintProfiles }) {
  const [k, setKey] = useState<CurveKey>('z_offset');
  const setK = (x: CurveKey) => { setKey(x); setView(VIEW_FOR[x]); };
  const n = b.noise;
  const zFlat = !(b.z_amplitude && b.z_amplitude > 0);
  // a Z curve does nothing at zero height: editing it gives it a height so the change shows
  const curveEdit = k === 'z_offset' ? (fn: (x: MotionBrush) => void) => onEdit((x) => { fn(x); if (!(x.z_amplitude && x.z_amplitude > 0)) x.z_amplitude = Math.min(0.3, profiles.process.layerHeight * 1.5 || 0.3); }) : onEdit;
  // plastic limits and plastic events show in the plastic view
  const plasticEdit = (fn: (x: MotionBrush) => void) => { setView('plastic'); onEdit(fn); };
  const newEvent = (t: EventType): MotionEvent => t === 'dwell' ? { at: { mode: 'percent', value: 50 }, type: t, params: { ms: 300, blob_mm3: 0 } }
    : t === 'flow_change' ? { at: { mode: 'percent', value: 50 }, type: t, params: { mult: 1.3 } }
    : { at: { mode: 'percent', value: 50 }, type: t, params: { length: 0, travel_mm: 1 } };
  return (
    <details className="mx-card mx-more" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setView(VIEW_FOR[k]); }}>
      <summary className="mx-card-title">Advanced</summary>
      <div className="seg mx-seg">
        {ADV_KEYS.map((x) => <button key={x} className={k === x ? 'on' : ''} onClick={() => setK(x)}>{CURVE_INFO[x].label}</button>)}
      </div>
      {k === 'z_offset' && <Slider label="Up-and-down height" unit="mm" min={0} max={3} step={0.05} value={b.z_amplitude ?? 0} onChange={(v) => onEdit((x) => { x.z_amplitude = v; })} />}
      {k === 'z_offset' && zFlat && <p className="mx-muted" style={{ margin: 0 }}>Up-and-down height is 0, so this curve has no effect yet. Changing the curve gives it a small height so you can see it.</p>}
      <p className="mx-muted" style={{ margin: 0 }}>{CURVE_HINT[k]}</p>
      <CurveBox b={b} k={k} onEdit={curveEdit} />
      <div className="mx-two">
        <label className="mx-field">Least plastic (×)<input className="input" type="number" step={0.05} value={b.limits.min_flow_mult} onChange={(e) => plasticEdit((x) => { x.limits = { ...x.limits, min_flow_mult: +e.target.value }; })} /></label>
        <label className="mx-field">Most plastic (×)<input className="input" type="number" step={0.05} value={b.limits.max_flow_mult} onChange={(e) => plasticEdit((x) => { x.limits = { ...x.limits, max_flow_mult: +e.target.value }; })} /></label>
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
          <Slider label="Motion number" unit="" min={1} max={9999} step={1} value={n.seed} onChange={(v) => onEdit((x) => { x.noise = { ...x.noise!, seed: Math.round(v) }; })} />
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
          {e.type === 'flow_change' && <label className="mx-field">Plastic ×<input className="input" type="number" min={0} step={0.1} value={e.params.mult ?? 1} onChange={(ev) => plasticEdit((x) => { x.events[i].params = { ...x.events[i].params, mult: Math.max(0, +ev.target.value) }; })} /></label>}
          {e.type === 'retract' && <label className="mx-field">Jump mm<input className="input" type="number" min={0} step={0.5} value={e.params.travel_mm ?? 0} onChange={(ev) => onEdit((x) => { x.events[i].params = { ...x.events[i].params, travel_mm: Math.max(0, +ev.target.value) }; })} /></label>}
          <button className="icon-btn" title="Remove" onClick={() => onEdit((x) => { x.events.splice(i, 1); })}>✕</button>
        </div>
      ))}
      <div className="row" style={{ gap: 6, margin: 0 }}>
        {([['dwell', '+ Pause'], ['flow_change', '+ Plastic change'], ['retract', '+ Lift-off']] as [EventType, string][]).map(([t, l]) => (
          <button key={t} className="btn-secondary btn-small" onClick={() => { if (t === 'flow_change') setView('plastic'); onEdit((x) => { x.events = [...x.events, newEvent(t)]; }); }}>{l}</button>
        ))}
      </div>
    </details>
  );
}

/** Switch what the model preview and the close-ups are coloured by. */
const VIEWS: [PreviewView, string, string][] = [
  ['motion', 'Motion', 'Each motion in its own colour; fainter where it fades out.'],
  ['height', 'Up / down', 'How far each spot is lifted (orange) or lowered (blue).'],
  ['plastic', 'Plastic', 'More plastic in orange, less in blue (after the plastic limits).'],
  ['speed', 'Speed', 'Faster in orange, slower in blue.'],
];
export function setView(v: PreviewView) {
  if (mx.previewView === v) return;
  mx.previewView = v;
  changed();
}
const css = (c: readonly number[]) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

function ViewPicker() {
  useMx();
  const [, bump] = useState(0);
  useEffect(() => { const on = () => bump((n) => n + 1); window.addEventListener('nx-preview-built', on); return () => window.removeEventListener('nx-preview-built', on); }, []);
  const v = mx.previewView;
  const lp = lastPreview && lastPreview.view === v ? lastPreview : null;
  const unit = v === 'height' ? ' mm' : '×';
  const fmt = (x: number) => (v === 'height' ? x.toFixed(2) : x.toFixed(2));
  return (
    <section className="mx-card">
      <div className="mx-card-title">Show on the model</div>
      <div className="seg mx-seg">
        {VIEWS.map(([id, label, hint]) => <button key={id} className={v === id ? 'on' : ''} title={hint} onClick={() => setView(id)}>{label}</button>)}
      </div>
      <div className="studio-legend">
        {v === 'motion'
          ? <span>{VIEWS[0][2]}</span>
          : <><i className="lg" style={{ background: css(VIEW_COLORS.low) }} />{lp ? `${fmt(lp.range[0])}${unit}` : 'low'}
            <i className="lg" style={{ background: css(VIEW_COLORS.mid) }} />{v === 'height' ? '0 mm' : '1×'}
            <i className="lg" style={{ background: css(VIEW_COLORS.high) }} />{lp ? `${fmt(lp.range[1])}${unit}` : 'high'}</>}
        <span className="spacer" />
        <i className="lg" style={{ background: css(VIEW_COLORS.pause) }} />pause / blob
        <i className="lg" style={{ background: css(VIEW_COLORS.lift) }} />lift-off
        <i className="lg" style={{ background: css(VIEW_COLORS.jump) }} />jump
      </div>
    </section>
  );
}

/** A straight piece of wall run through the same code the slicer uses, for the close-ups. */
function closeUpPath(b: MotionBrush, p: PrintProfiles, layer: number, L: number, step: number): ToolpathPoint[] {
  const pts: ToolpathPoint[] = [{ x: 0, y: 0, z: 1, f: 50, flow: 1, e: 0 }, { x: L, y: 0, z: 1, f: 50, flow: 1, e: 0 }];
  const tp: Toolpath = { feature: 'outer_wall', closed: false, points: pts };
  // tile at the brush's own repeat, as on a long wall
  const brush: MotionBrush = b.repeat_mode === 'stretch' ? { ...b, repeat_mode: 'tile' } : b;
  // the wall runs along +x, so its outward side is −y: flip so "sticks out" is up in the drawing
  return composePath(tp, [{ brush, weight: () => 1, blend: 'add' }], p, { resampleStep: step, loopSpeedShare: 1 }, () => {}, layer)
    .points.map((q) => ({ ...q, y: -q.y }));
}
const valueOf = (q: ToolpathPoint, v: PreviewView) => (v === 'height' ? q.zOff ?? 0 : v === 'plastic' ? q.flow : v === 'speed' ? q.f / 50 : q.y);
const rampCss = (t: number) => {
  const u = Math.max(-1, Math.min(1, t)), m = VIEW_COLORS.mid, e = u < 0 ? VIEW_COLORS.low : VIEW_COLORS.high, a = Math.abs(u);
  return [0, 1, 2].map((i) => m[i] + (e[i] - m[i]) * a);
};

/** Close-ups of a short piece of wall: from above with the layers below and above, and from the side. */
function CloseUps({ b, profiles, layer, setLayer }: { b: MotionBrush; profiles: PrintProfiles; layer: number; setLayer: (n: number) => void }) {
  useMx();
  const top = useRef<HTMLCanvasElement>(null);
  const side = useRef<HTMLCanvasElement>(null);
  const theme = useStore((s) => s.theme);
  const view = mx.previewView;
  const lineWidth = profiles.process.lineWidth, layerHeight = profiles.process.layerHeight || 0.2;
  useEffect(() => {
    const draw = () => {
      if (top.current) drawTop(top.current, b, profiles, layer, theme === 'dark', view);
      if (side.current) drawSide(side.current, b, profiles, layer, theme === 'dark', view);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (top.current) ro.observe(top.current);
    return () => ro.disconnect();
  });
  const off = layerPhase(b, layer) === null;
  const sideLegend = view === 'height' ? ['lifted', 'lowered'] : view === 'plastic' ? ['more plastic', 'less plastic'] : view === 'speed' ? ['faster', 'slower'] : ['sticks out', 'pressed in'];
  return (
    <section className="mx-card studio-closeups">
      <div className="mx-card-title">Close-up<span className="spacer" />
        <span className="mx-muted" style={{ margin: 0, fontWeight: 400 }}>layer</span>
        <input className="input studio-num" type="number" min={1} step={1} value={layer} onChange={(e) => setLayer(Math.max(1, Math.round(+e.target.value)))} aria-label="Close-up layer" />
      </div>
      <canvas ref={top} className="studio-canvas" style={{ height: 150 }} />
      <div className="studio-legend"><i className="lg cur" />layer {layer}{off ? ' (plain)' : ''} · line thickness = plastic<i className="lg below" />layer below<i className="lg above" />layer above<span className="spacer" />seen from above</div>
      <canvas ref={side} className="studio-canvas" style={{ height: 110 }} />
      <div className="studio-legend"><i className="lg out" />{sideLegend[0]}<i className="lg in" />{sideLegend[1]}<span className="spacer" />{(layerHeight * 36).toFixed(1)} mm of wall seen from the side · {lineWidth.toFixed(2)} mm line</div>
    </section>
  );
}

const SPAN = (b: MotionBrush) => Math.max(10, Math.min(60, b.period_mm * 3));

function drawTop(cv: HTMLCanvasElement, b: MotionBrush, p: PrintProfiles, layer: number, dark: boolean, view: PreviewView) {
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const lineWidth = p.process.lineWidth;
  const L = SPAN(b), A = Math.max(0.3, b.amplitude * 1.25 + lineWidth);
  const sx = (W - 24) / L, sy = Math.min(sx * 2, (H - 26) / (2 * A));
  const X = (x: number) => 12 + x * sx, Y = (y: number) => H / 2 - 4 - y * sy;
  g.strokeStyle = dark ? '#4a5260' : '#cfd5dd'; g.lineWidth = 1; g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(L), Y(0)); g.stroke(); g.setLineDash([]);
  const step = Math.max(0.05, L / 400);
  const plain = (n: number, style: string, width: number, dash: number[] = []) => {
    if (n < 0) return;
    const pts = closeUpPath(b, p, n, L, step);
    g.strokeStyle = style; g.lineWidth = width; g.setLineDash(dash); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    pts.forEach((q, i) => { if (i === 0 || q.travel) g.moveTo(X(q.x), Y(q.y)); else g.lineTo(X(q.x), Y(q.y)); });
    g.stroke(); g.setLineDash([]);
  };
  plain(layer - 1, dark ? 'rgba(170,180,195,.55)' : 'rgba(110,120,135,.45)', Math.max(1.5, lineWidth * sx * 0.9));
  // this layer: thickness follows the plastic, colour follows the chosen view, events marked
  const pts = closeUpPath(b, p, layer, L, step);
  const vals = pts.map((q) => valueOf(q, view));
  const centre = view === 'height' || view === 'motion' ? 0 : 1;
  const span = Math.max(0.05, ...vals.map((v) => Math.abs(v - centre)));
  g.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], q = pts[i];
    if (q.travel) {
      g.strokeStyle = css(VIEW_COLORS.jump); g.lineWidth = 1.5; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(q.x), Y(q.y)); g.stroke(); g.setLineDash([]);
      continue;
    }
    g.strokeStyle = view === 'motion' ? 'rgba(255,122,69,.85)' : css(rampCss((vals[i] - centre) / span));
    g.lineWidth = Math.max(1, lineWidth * sx * Math.max(0.1, q.flow));
    g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(q.x), Y(q.y)); g.stroke();
  }
  for (const q of pts) {
    if (!q.post) continue;
    const c = q.post.retract_mm ? VIEW_COLORS.lift : VIEW_COLORS.pause;
    if (q.post.retract_mm || q.post.dwell_ms || q.post.blob_mm) {
      g.fillStyle = css(c); g.beginPath(); g.arc(X(q.x), Y(q.y), q.post.blob_mm ? 6 : 4, 0, Math.PI * 2); g.fill();
    }
  }
  plain(layer + 1, dark ? '#69c0ff' : '#1f6fd1', 1.5, [5, 4]);
  g.fillStyle = dark ? '#9aa3b0' : '#6b7380'; g.font = '11px Inter, system-ui, sans-serif';
  const bar = Math.min(10, Math.max(1, Math.round(L / 4)));
  g.fillText(`${bar} mm`, X(L - bar), H - 4);
  g.strokeStyle = g.fillStyle; g.lineWidth = 1; g.beginPath(); g.moveTo(X(L - bar), H - 14); g.lineTo(X(L), H - 14); g.stroke();
}

function drawSide(cv: HTMLCanvasElement, b: MotionBrush, p: PrintProfiles, layer: number, dark: boolean, view: PreviewView) {
  const W = Math.max(1, Math.floor(cv.clientWidth)), H = Math.max(1, Math.floor(cv.clientHeight));
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!, img = g.createImageData(W, H), L = SPAN(b), rows = 36;
  const first = Math.max(0, layer - rows / 2);
  const bg = dark ? [42, 46, 54] : [246, 245, 242];
  const step = Math.max(0.05, L / W);
  // one row per layer: the value of the chosen view along the wall, from the slicer's own code
  const data = Array.from({ length: rows }, (_, r) => {
    const n = first + rows - 1 - r;
    const pts = closeUpPath(b, p, n, L, step);
    const col = new Float64Array(W).fill(NaN);
    for (const q of pts) { const x = Math.min(W - 1, Math.max(0, Math.round((q.x / L) * (W - 1)))); if (!q.travel) col[x] = valueOf(q, view); }
    return { n, col };
  });
  const centre = view === 'plastic' || view === 'speed' ? 1 : 0;
  let span = view === 'motion' ? Math.max(0.05, b.amplitude * 1.2) : 0.05;
  if (view !== 'motion') for (const { col } of data) for (const v of col) if (Number.isFinite(v)) span = Math.max(span, Math.abs(v - centre));
  for (let r = 0; r < rows; r++) {
    const { n, col } = data[r], y0 = Math.floor((r * H) / rows), y1 = Math.floor(((r + 1) * H) / rows);
    let last = centre;
    for (let x = 0; x < W; x++) {
      const v = Number.isFinite(col[x]) ? (last = col[x]) : last;
      const t = Math.max(-1, Math.min(1, (v - centre) / span));
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
