// Left column of Flenex Studio: Design (shape, add-ons), Cuts (joints and where they go), Paint, Print.
import { useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore, PRINTERS_VENDORS } from './storeBridge';
import { loadModelFile } from '../../../io/load';
import { ADDONS, RELIEFS, SECTION_KINDS, SPINES, addOn, type AddOn, type AddOnKind, type CreatureDesign } from '../design';
import { JOINTS, type JointKind, type PinShape } from '../joints';
import { FAMILIES, PRESETS, PROFILES } from '../presets';
import { SCHEMES, type PaintOp } from '../paint';
import { ORIENTATIONS, cutAt, type CutOrientation } from '../place';
import { cutFrame, newCut, type Cut } from '../flexi';
import { Card, Select, Slider, Toggle } from './controls';
import {
  addColour, addCut, addPaint, autoCutsAgain, built, changed, currentMachine, editCut, export3mf, freezeCuts, fx, hasImport, importModel, loadPreset, nextCutId, removeCut, schedule,
  sendToPlate, setPaint, setPalette, setPrinter, undoPaint, useFx, coloursUsed, notify,
} from './state';

const d = () => fx.design;
const edit = (f: (x: CreatureDesign) => void) => { f(fx.design); changed(); };

// ---------------------------------------------------------------- design
function Presets() {
  const [fam, setFam] = useState<string>('All');
  const list = PRESETS.filter((p) => fam === 'All' || p.family === fam);
  return (
    <Card title={`Designs (${PRESETS.length})`}>
      <div className="fx-chips">
        {['All', ...FAMILIES].map((f) => <button key={f} className={`btn-small ${fam === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFam(f)}>{f}</button>)}
      </div>
      <div className="fx-presets">
        {list.map((p) => (
          <button key={p.id} className={`fx-preset ${fx.source === 'creature' && fx.presetId === p.id ? 'on' : ''}`} onClick={() => loadPreset(p.id)} title={p.family}>
            <span>{p.name}</span><small>{p.family}</small>
          </button>
        ))}
      </div>
    </Card>
  );
}

function AddOnEditor({ a }: { a: AddOn }) {
  const info = ADDONS.find((x) => x.id === a.kind)!;
  const set = (f: (x: AddOn) => void) => edit(() => f(a));
  const has = (k: string) => (info.fields as string[]).includes(k);
  const lenLabel = a.kind === 'wings' || a.kind === 'fins' ? 'Span' : 'Length';
  return (
    <details className="fx-addon" open={false}>
      <summary><b>{info.name}</b> <small>at {Math.round(a.t * 100)}%</small>
        <button className="btn-small btn-secondary" style={{ float: 'right' }} onClick={(e) => { e.preventDefault(); edit((x) => { x.addons = x.addons.filter((q) => q !== a); }); }}>Remove</button>
      </summary>
      <div className="fx-addon-body">
        <div className="mx-sub">{info.blurb}</div>
        {has('t') && <Slider label="Position (head → tail)" value={a.t} min={0} max={1} step={0.005} onChange={(v) => set((x) => { x.t = v; })} />}
        {has('size') && <Slider label="Size" value={a.size} min={0.2} max={3} step={0.05} onChange={(v) => set((x) => { x.size = v; })} />}
        {has('length') && <Slider label={lenLabel} value={a.length} min={0.3} max={4} step={0.05} onChange={(v) => set((x) => { x.length = v; })} />}
        {has('width') && <Slider label="Width" value={a.width} min={0.3} max={3} step={0.05} onChange={(v) => set((x) => { x.width = v; })} />}
        {has('count') && <Slider label="Count" value={a.count} min={1} max={24} onChange={(v) => set((x) => { x.count = Math.round(v); })} />}
        {has('spread') && <Slider label={a.kind === 'arms' || a.kind === 'frill' ? 'Fan angle' : 'Spread'} value={a.spread} min={0} max={a.kind === 'arms' ? 360 : 1} step={a.kind === 'arms' ? 5 : 0.01} onChange={(v) => set((x) => { x.spread = v; })} />}
        {has('tilt') && <Slider label="Tilt" unit="°" value={a.tilt} min={-180} max={180} onChange={(v) => set((x) => { x.tilt = v; })} />}
        {has('curl') && <Slider label="Curl" value={a.curl} min={0} max={1.5} step={0.02} onChange={(v) => set((x) => { x.curl = v; })} />}
        {has('side') && <Select label="Where" value={a.side} options={[['top', 'On the back'], ['sides', 'On the sides'], ['belly', 'Underneath']]} onChange={(v) => set((x) => { x.side = v; })} />}
      </div>
    </details>
  );
}

function CreatureDesigner() {
  const b = d().body;
  const set = (f: (x: CreatureDesign['body']) => void) => edit((x) => f(x.body));
  const [add, setAdd] = useState<AddOnKind>('eyes');
  return (
    <>
      <Presets />
      <Card title="Name">
        <input className="input" value={d().name} onChange={(e) => { d().name = e.target.value; notify(); }} />
      </Card>
      <Card title="Body">
        <div className="mx-two">
          <Slider label="Length" unit="mm" value={b.length} min={40} max={500} onChange={(v) => set((x) => { x.length = v; })} />
          <Slider label="Thickness" unit="mm" value={b.thickness} min={4} max={40} step={0.5} onChange={(v) => set((x) => { x.thickness = v; })} />
          <Slider label="Height / width" value={b.heightRatio} min={0.4} max={1.6} step={0.01} onChange={(v) => set((x) => { x.heightRatio = v; })} />
          <Slider label="End rounding" value={b.endRound} min={0.15} max={1.5} step={0.05} onChange={(v) => set((x) => { x.endRound = v; })} />
        </div>
        <Select label="Spine shape" value={b.spine.kind} options={SPINES.map((s) => [s.id, s.name])} onChange={(v) => set((x) => { x.spine.kind = v; })} />
        <div className="mx-two">
          <Slider label="Bend" unit="°" value={b.spine.bend} min={0} max={120} onChange={(v) => set((x) => { x.spine.bend = v; })} />
          <Slider label="Waves / turns" value={b.spine.waves} min={0.5} max={5} step={0.1} onChange={(v) => set((x) => { x.spine.waves = v; })} />
          <Slider label="Phase" value={b.spine.phase} min={-3.14} max={3.14} step={0.05} onChange={(v) => set((x) => { x.spine.phase = v; })} />
        </div>
        <Select label="Silhouette preset" value={'custom'} options={[['custom', 'Pick to reset the profile…'], ...Object.entries(PROFILES).map(([k, p]) => [k, p.name] as [string, string])]}
          onChange={(v) => { if (PROFILES[v]) set((x) => { x.profile = PROFILES[v].handles.slice(); }); }} />
        <div className="mx-label">Thickness profile (head → tail)</div>
        {b.profile.map((h, i) => <Slider key={i} label={`Handle ${i + 1}`} value={h} min={0.1} max={1.8} step={0.01} onChange={(v) => set((x) => { x.profile[i] = v; })} />)}
      </Card>
      <Card title="Cross-section" open={false}>
        <Select label="Shape" value={b.section.kind} options={SECTION_KINDS.map((s) => [s.id, s.name])} onChange={(v) => set((x) => { x.section.kind = v; })} />
        <div className="mx-two">
          <Slider label="Roundness" value={b.section.power} min={1} max={6} step={0.1} onChange={(v) => set((x) => { x.section.power = v; })} />
          <Slider label="Flat belly" value={b.section.flat} min={0} max={0.9} step={0.01} hint="Share of the underside flattened so the print sits on the bed" onChange={(v) => set((x) => { x.section.flat = v; })} />
          {b.section.kind === 'star' && <Slider label="Points" value={b.section.sides} min={3} max={12} onChange={(v) => set((x) => { x.section.sides = Math.round(v); })} />}
        </div>
      </Card>
      <Card title="Surface relief" open={false}>
        <Select label="Pattern" value={b.relief.kind} options={RELIEFS.map((s) => [s.id, s.name])} onChange={(v) => set((x) => { x.relief.kind = v; })} />
        <div className="mx-two">
          <Slider label="Depth" value={b.relief.depth} min={0} max={0.5} step={0.01} onChange={(v) => set((x) => { x.relief.depth = v; })} />
          <Slider label="Period" unit="mm" value={b.relief.period} min={2} max={30} step={0.5} onChange={(v) => set((x) => { x.relief.period = v; })} />
          <Slider label="From" value={b.relief.from} min={0} max={1} step={0.01} onChange={(v) => set((x) => { x.relief.from = v; })} />
          <Slider label="To" value={b.relief.to} min={0} max={1} step={0.01} onChange={(v) => set((x) => { x.relief.to = v; })} />
        </div>
      </Card>
      <Card title={`Add-ons (${d().addons.length})`}>
        {d().addons.map((a) => <AddOnEditor key={a.id} a={a} />)}
        <div className="row" style={{ gap: 6 }}>
          <select className="select" value={add} onChange={(e) => setAdd(e.target.value as AddOnKind)} style={{ flex: 1 }}>
            {ADDONS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button className="btn-small btn-primary" onClick={() => edit((x) => { x.addons = [...x.addons, addOn(add)]; })}>Add</button>
        </div>
        <div className="mx-sub">Parts stuck on the body (legs, wings, fins, eyes) stay on one piece; the automatic cuts go around them. Spikes, sails, plates and manes are cut along with the body.</div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- import
function ImportDesigner() {
  const rot = (axis: 0 | 1 | 2, q: number) => { fx.importRot = fx.importRot.map((v, i) => (i === axis ? (v + q + 4) % 4 : v)) as [number, number, number]; changed(); };
  return (
    <>
      <Card title="Imported model">
        <div className="mx-sub"><b>{fx.importName}</b></div>
        <div className="mx-label">Turn the model (it rests on the bed after turning)</div>
        <div className="fx-chips">
          {(['X', 'Y', 'Z'] as const).map((a, i) => (
            <span key={a} className="fx-pair"><button className="btn-small btn-secondary" onClick={() => rot(i as 0, -1)}>{a} −90°</button><button className="btn-small btn-secondary" onClick={() => rot(i as 0, 1)}>{a} +90°</button></span>
          ))}
        </div>
        <Slider label="Scale" unit="%" value={Math.round(fx.importScale * 100)} min={10} max={400} onChange={(v) => { fx.importScale = v / 100; changed(); }} />
        <div className="mx-sub">Cuts are placed in the <b>Cuts</b> tab. Cutting changes the model, so turn and scale it first.</div>
      </Card>
    </>
  );
}

export function SourceBar() {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const models = await loadModelFile(f.name, await f.arrayBuffer());
      if (!models.length) throw new Error('No mesh found in the file.');
      await importModel(models[0].name || f.name, models[0].mesh);
      setMsg(models.length > 1 ? `Imported the first of ${models.length} objects.` : '');
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="fx-source">
      <div className="fx-chips">
        <button className={`btn-small ${fx.source === 'creature' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { if (fx.source !== 'creature') loadPreset(fx.presetId); }}>Design a creature</button>
        <button className={`btn-small ${fx.source === 'import' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => input.current?.click()}>{hasImport() ? 'Import another model…' : 'Import a model…'}</button>
        <input ref={input} type="file" accept=".stl,.obj,.3mf" style={{ display: 'none' }} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {msg && <div className="mx-sub" style={{ color: 'var(--warn, #d98)' }}>{msg}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- cuts
function JointEditor({ j, onChange, auto }: { j: Cut['joint']; onChange: (f: (x: Cut['joint']) => void) => void; auto?: boolean }) {
  return (
    <>
      <Select label="Joint" value={j.kind} options={JOINTS.map((x) => [x.id, x.name])} onChange={(v) => onChange((x) => { x.kind = v as JointKind; })} />
      <div className="mx-sub">{JOINTS.find((x) => x.id === j.kind)?.blurb}</div>
      <div className="mx-two">
        <Slider label="Range of motion" unit="°" value={j.rom} min={5} max={50} onChange={(v) => onChange((x) => { x.rom = v; })} />
        <Slider label="Joint size" value={j.scale} min={0.5} max={1.4} step={0.02} hint="1 = automatic from the thickness at the cut" onChange={(v) => onChange((x) => { x.scale = v; })} />
        {j.kind === 'ball' || j.kind === 'swivel' ? <Slider label="Neck" value={j.neck} min={0.25} max={0.8} step={0.01} onChange={(v) => onChange((x) => { x.neck = v; })} /> : null}
        <Slider label="Clearance (0 = machine)" unit="mm" value={j.clearance} min={0} max={0.6} step={0.01} onChange={(v) => onChange((x) => { x.clearance = v; })} />
      </div>
      {j.kind === 'hinge' && <Select label="Pin shape" value={j.pin} options={[['round', 'Round'], ['hex', 'Hexagon'], ['teardrop', 'Teardrop (prints sideways)']]} onChange={(v) => onChange((x) => { x.pin = v as PinShape; })} />}
      {auto && null}
    </>
  );
}

function CutEditor({ c }: { c: Cut }) {
  const nudge = (mm: number) => editCut(c.id, (x) => { const n = new THREE.Vector3(...x.normal).normalize(); x.origin = [x.origin[0] + n.x * mm, x.origin[1] + n.y * mm, x.origin[2] + n.z * mm]; });
  const tilt = (axis: 'a' | 'u', deg: number) => editCut(c.id, (x) => {
    const M = cutFrame(x.origin, x.normal, x.roll);
    const u = new THREE.Vector3(), a = new THREE.Vector3(), n = new THREE.Vector3(); M.extractBasis(u, a, n);
    const v = n.clone().applyAxisAngle(axis === 'a' ? a : u, (deg * Math.PI) / 180).normalize();
    x.normal = [v.x, v.y, v.z];
  });
  return (
    <div className="fx-cutedit">
      <input className="input" value={c.name} onChange={(e) => editCut(c.id, (x) => { x.name = e.target.value; })} />
      <div className="mx-label">Slide along the body</div>
      <div className="fx-chips">{[-5, -1, -0.2, 0.2, 1, 5].map((m) => <button key={m} className="btn-small btn-secondary" onClick={() => nudge(m)}>{m > 0 ? '+' : ''}{m} mm</button>)}</div>
      <div className="mx-label">Tilt the cut plane</div>
      <div className="fx-chips">{[-10, -2, 2, 10].map((m) => <button key={`a${m}`} className="btn-small btn-secondary" onClick={() => tilt('a', m)}>↺ {m > 0 ? '+' : ''}{m}°</button>)}{[-10, -2, 2, 10].map((m) => <button key={`u${m}`} className="btn-small btn-secondary" onClick={() => tilt('u', m)}>↻ {m > 0 ? '+' : ''}{m}°</button>)}</div>
      {c.joint.kind === 'hinge' && <Slider label="Hinge direction" unit="°" value={c.roll} min={-90} max={180} onChange={(v) => editCut(c.id, (x) => { x.roll = v; })} />}
      <Slider label="Cut disc radius (0 = automatic)" unit="mm" value={c.radius} min={0} max={80} step={0.5} onChange={(v) => editCut(c.id, (x) => { x.radius = v; })} />
      <JointEditor j={c.joint} onChange={(f) => editCut(c.id, (x) => f(x.joint))} />
      <div className="fx-chips"><button className="btn-small btn-secondary" onClick={() => editCut(c.id, (x) => { x.enabled = !x.enabled; })}>{c.enabled ? 'Disable' : 'Enable'}</button><button className="btn-small btn-secondary" onClick={() => removeCut(c.id)}>Delete cut</button></div>
    </div>
  );
}

function CutsTab() {
  const seg = d().segments;
  const setSeg = (f: (s: typeof seg) => void) => edit((x) => f(x.segments));
  const auto = fx.source === 'creature' && fx.cutsMode === 'auto';
  const reports = built?.flexi.reports ?? [];
  const cuts = auto ? (built?.cuts ?? []) : fx.manualCuts;
  const sel = cuts.find((c) => c.id === fx.selectedCut);
  const along = (axis: 0 | 1 | 2, n: number) => {
    if (!built) return;
    const m = built.base.vertices; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m[i + k]); hi[k] = Math.max(hi[k], m[i + k]); }
    const out: Cut[] = []; let id = +nextCutId();
    for (let i = 0; i < n; i++) {
      const t = 0.12 + (0.76 * (i + 0.5)) / n;
      const o: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]; o[axis] = lo[axis] + (hi[axis] - lo[axis]) * t;
      const nrm: [number, number, number] = [0, 0, 0]; nrm[axis] = 1;
      const c = newCut(String(id++), o, nrm, { ...fx.design.segments.joint, kind: fx.placeKind }); c.name = `Cut ${c.id}`;
      out.push(c);
    }
    fx.manualCuts = [...fx.manualCuts, ...out]; fx.cutsMode = 'manual'; schedule();
  };
  return (
    <>
      {fx.source === 'creature' && (
        <Card title={auto ? 'Automatic cuts' : 'Cuts (edited by hand)'}>
          {auto ? (
            <>
              <Select label="Spacing" value={seg.mode} options={[['scaled', 'Follow the thickness (best look)'], ['even', 'Even, fixed count'], ['length', 'Fixed segment length']]} onChange={(v) => setSeg((s) => { s.mode = v; })} />
              {seg.mode === 'even' && <Slider label="Number of cuts" value={seg.count} min={1} max={40} onChange={(v) => setSeg((s) => { s.count = Math.round(v); })} />}
              {seg.mode === 'length' && <Slider label="Segment length" unit="mm" value={seg.length} min={5} max={60} step={0.5} onChange={(v) => setSeg((s) => { s.length = v; })} />}
              {seg.mode === 'scaled' && <Slider label="Segment length ÷ thickness" value={seg.ratio} min={1.4} max={5} step={0.05} hint="Smaller gives more, shorter segments" onChange={(v) => setSeg((s) => { s.ratio = v; })} />}
              <div className="mx-two">
                <Slider label="Start (head → tail)" value={seg.from} min={0} max={0.95} step={0.005} onChange={(v) => setSeg((s) => { s.from = Math.min(v, s.to - 0.02); })} />
                <Slider label="End" value={seg.to} min={0.05} max={1} step={0.005} onChange={(v) => setSeg((s) => { s.to = Math.max(v, s.from + 0.02); })} />
              </div>
              <JointEditor j={seg.joint} onChange={(f) => setSeg((s) => f(s.joint))} auto />
              {seg.joint.kind === 'hinge' && <Toggle label="Alternate hinge direction" on={seg.alternate} onChange={(v) => setSeg((s) => { s.alternate = v; })} />}
              <button className="btn-secondary" onClick={freezeCuts}>Edit the cuts by hand…</button>
            </>
          ) : (
            <button className="btn-secondary" onClick={autoCutsAgain}>Back to automatic cuts</button>
          )}
        </Card>
      )}
      {fx.source === 'import' && (
        <Card title="Place cuts on the model">
          <Select label="Cut type" value={fx.placeKind} options={JOINTS.map((j) => [j.id, j.name])} onChange={(v) => { fx.placeKind = v; notify(); }} />
          <div className="mx-sub">{JOINTS.find((j) => j.id === fx.placeKind)?.blurb}</div>
          <Select label="Cut direction" value={fx.orientation} options={ORIENTATIONS.map((o) => [o.id, o.name])} onChange={(v) => { fx.orientation = v as CutOrientation; notify(); }} />
          <button className={fx.tool === 'place' ? 'btn-primary' : 'btn-secondary'} onClick={() => { fx.tool = fx.tool === 'place' ? 'orbit' : 'place'; notify(); }}>
            {fx.tool === 'place' ? 'Click on the model to place a cut…' : 'Place a cut (click the model)'}
          </button>
          <div className="mx-label">Or add evenly spaced cuts across the model</div>
          <div className="fx-chips">{(['X', 'Y', 'Z'] as const).map((a, i) => [4, 8].map((n) => <button key={a + n} className="btn-small btn-secondary" onClick={() => along(i as 0, n)}>{n} across {a}</button>))}</div>
        </Card>
      )}
      <Card title={`Cuts (${cuts.length})`}>
        {!cuts.length && <div className="mx-sub">{fx.source === 'import' ? 'No cuts yet. Pick a cut type and click the model.' : 'This design has no cuts: widen the start / end range or lower the segment ratio.'}</div>}
        <div className="fx-cutlist">
          {cuts.map((c) => {
            const r = reports.find((x) => x.id === c.id);
            return (
              <button key={c.id} className={`fx-cut ${fx.selectedCut === c.id ? 'on' : ''} ${r && !r.ok ? 'bad' : r?.warnings.length ? 'warn' : ''}`} onClick={() => { fx.selectedCut = c.id; notify(); }}>
                <span>{c.name}</span><small>{c.joint.kind}{c.enabled ? '' : ' · off'}{r ? (r.ok ? (r.warnings.length ? ' · ⚠' : ' · ✓') : ' · ✕') : ''}</small>
              </button>
            );
          })}
        </div>
        {sel && !auto && <CutEditor c={sel} />}
        {sel && auto && <div className="mx-sub">Automatic cuts follow the settings above. Choose “Edit the cuts by hand” to move or delete single cuts.</div>}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- paint
function PaintTab() {
  const mac = currentMachine();
  const used = coloursUsed();
  const tools: [typeof fx.tool, string, string][] = [['orbit', 'Orbit', 'Just look around'], ['brush', 'Brush', 'Paint with a round brush'], ['bucket', 'Fill area', 'Fill a smooth surface region'], ['piece', 'Fill piece', 'Colour a whole segment']];
  return (
    <>
      <Card title="Colours">
        <div className="fx-palette">
          {fx.palette.map((c, i) => (
            <label key={i} className={`fx-sw ${fx.slot === i + 1 ? 'on' : ''}`} style={{ background: c }} title={`Colour ${i + 1} (click to paint with, double-click to change)`}
              onClick={() => { fx.slot = i + 1; notify(); }}>
              <input type="color" value={c} onChange={(e) => setPalette(i, e.target.value)} />
              <span>{i + 1}</span>
            </label>
          ))}
          {fx.palette.length < 16 && <button className="fx-sw add" onClick={() => addColour()}>+</button>}
        </div>
        <div className="mx-sub">{mac.multiColour === 'ams' ? `${mac.printer.model}: up to 16 colours with the AMS.` : `${mac.printer.model} has no AMS: every colour change is a pause for a manual swap.`} This design uses {used.length} colour{used.length === 1 ? '' : 's'}.</div>
      </Card>
      <Card title="Paint tools">
        <div className="fx-chips">{tools.map(([t, n, h]) => <button key={t} title={h} className={`btn-small ${fx.tool === t ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { fx.tool = t; notify(); }}>{n}</button>)}</div>
        {fx.tool === 'brush' && <Slider label="Brush size" unit="mm" value={fx.brush} min={1} max={40} step={0.5} onChange={(v) => { fx.brush = v; notify(); }} />}
        {fx.tool === 'bucket' && <Slider label="Edge angle that stops the fill" unit="°" value={fx.bucketAngle} min={5} max={90} onChange={(v) => { fx.bucketAngle = v; notify(); }} />}
        <div className="fx-chips">
          <button className="btn-small btn-secondary" onClick={() => addPaint({ kind: 'fill', slot: fx.slot })}>Fill everything</button>
          <button className="btn-small btn-secondary" onClick={undoPaint}>Undo</button>
          <button className="btn-small btn-secondary" onClick={() => setPaint([{ kind: 'fill', slot: 1 }])}>Clear paint</button>
        </div>
        <div className="mx-sub">Painting follows the model: change the design and the colours stay where they were.</div>
      </Card>
      <Card title="Colour schemes (one click)">
        <div className="fx-presets">
          {SCHEMES.map((s) => <button key={s.id} className="fx-preset" onClick={() => setPaint(s.ops(fx.palette.length) as PaintOp[])}><span>{s.name}</span></button>)}
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- print
export function PrinterPicker() {
  const { vendors, byVendor } = PRINTERS_VENDORS();
  const id = useStore((s) => s.printerId);
  return (
    <select className="select" value={id} aria-label="Printer" onChange={(e) => setPrinter(e.target.value)}>
      {vendors.map((v) => <optgroup key={v} label={v}>{byVendor(v).map((p) => <option key={p.id} value={p.id}>{p.vendor} {p.model} · {p.nozzle} mm</option>)}</optgroup>)}
    </select>
  );
}

function PrintTab({ onToast }: { onToast: (t: string) => void }) {
  const mac = currentMachine();
  const f = built?.fit;
  const fitNow = () => {
    if (!f) return;
    if (fx.source === 'import') fx.importScale = +(fx.importScale * f.scale * 0.995).toFixed(3);
    else { fx.design.body.length = +(fx.design.body.length * f.scale * 0.995).toFixed(1); fx.design.body.thickness = +(fx.design.body.thickness * f.scale * 0.995).toFixed(2); }
    changed();
  };
  return (
    <>
      <Card title="Machine">
        <PrinterPicker />
        <div className="mx-sub">{mac.printer.vendor} {mac.printer.model} · nozzle {mac.nozzle} mm · bed {mac.bed.x} × {mac.bed.y} × {mac.bed.z} mm · {mac.multiColour === 'ams' ? 'AMS multi-colour' : 'manual colour swaps'}</div>
        <div className="mx-sub">Joint clearance follows the nozzle: <b>{mac.fit.clearance.toFixed(2)} mm</b> around moving parts, <b>{mac.fit.gap.toFixed(2)} mm</b> between pieces.</div>
        <div className="mx-two">
          <Slider label="Clearance (0 = from nozzle)" unit="mm" value={fx.clearance} min={0} max={0.6} step={0.01} hint="Tight printers: lower. Gaps fuse: raise." onChange={(v) => { fx.clearance = v; changed(); }} />
          <Slider label="Face gap (0 = automatic)" unit="mm" value={fx.gap} min={0} max={1.5} step={0.05} onChange={(v) => { fx.gap = v; changed(); }} />
        </div>
      </Card>
      <Card title="Fit on the bed">
        {f ? (
          <>
            <div className="mx-sub">Model {f.size.map((x) => x.toFixed(0)).join(' × ')} mm on a {mac.bed.x} × {mac.bed.y} × {mac.bed.z} mm bed.</div>
            <div className={`fx-fit ${f.fits ? 'ok' : 'bad'}`}>{f.fits ? (f.angle ? `Fits when turned ${f.angle}° on the bed.` : 'Fits the bed.') : `Too big for this bed: scale to ${(f.scale * 100).toFixed(0)}% (turned ${f.angle}°).`}</div>
            {!f.fits && <button className="btn-secondary" onClick={fitNow}>Scale to fit this printer</button>}
          </>
        ) : <div className="mx-sub">Building…</div>}
      </Card>
      <Card title="Output">
        <button className="btn-primary" disabled={!built} onClick={async () => { const p = await export3mf(); onToast(p ? `Saved ${p}` : 'Export cancelled'); }}>Export coloured 3MF</button>
        <button className="btn-secondary" disabled={!built} onClick={() => { const r = sendToPlate(); if (r) onToast(`Placed on the plate with ${r.colours} colour${r.colours === 1 ? '' : 's'}.`); }}>Send to the plate</button>
        <div className="mx-sub">The 3MF carries a colour for every triangle (Bambu Studio, OrcaSlicer and PrusaSlicer open it coloured). The joints are real geometry: print it as it is, then bend each joint once to free it.</div>
      </Card>
    </>
  );
}

export function EditorColumn({ onToast }: { onToast: (t: string) => void }) {
  useFx();
  return (
    <>
      <SourceBar />
      <div className="fx-tabs">
        {(['design', 'cuts', 'paint', 'print'] as const).map((t) => (
          <button key={t} className={`fx-tab ${fx.tab === t ? 'on' : ''}`} onClick={() => { fx.tab = t; if (t === 'paint' && fx.tool === 'place') fx.tool = 'orbit'; if (t === 'cuts' && (fx.tool === 'brush' || fx.tool === 'bucket' || fx.tool === 'piece')) fx.tool = 'orbit'; notify(); }}>
            {t === 'design' ? 'Design' : t === 'cuts' ? 'Cuts' : t === 'paint' ? 'Paint' : 'Print'}
          </button>
        ))}
      </div>
      {fx.tab === 'design' && (fx.source === 'creature' ? <CreatureDesigner /> : <ImportDesigner />)}
      {fx.tab === 'cuts' && <CutsTab />}
      {fx.tab === 'paint' && <PaintTab />}
      {fx.tab === 'print' && <PrintTab onToast={onToast} />}
    </>
  );
}
void cutAt;
