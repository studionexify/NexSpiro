// Floating panels for the Cut, Mesh Boolean, Text and Measure tools.
import { useEffect, useState } from 'react';
import { useStore, worldBounds } from '../state/store';
import { addText, booleanSelected, cutObject, FONTS, type TextOptions } from '../state/tools';
import { Icon } from './icons';

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="row" style={{ marginBottom: 6 }}>
      <span style={{ width: 62 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, minWidth: 0 }} />
      <input className="input mono" style={{ width: 58, textAlign: 'right' }} value={+value.toFixed(2)} onChange={(e) => { const v = parseFloat(e.target.value); if (isFinite(v)) onChange(Math.min(max, Math.max(min, v))); }} />
      <span className="unit">{unit}</span>
    </div>
  );
}

export function CutPanel() {
  const { tool, objects, selected, cutPlane, set } = useStore();
  const o = objects.find((x) => x.id === selected[0]);
  const [keepAbove, setAbove] = useState(true);
  const [keepBelow, setBelow] = useState(true);
  const [flip, setFlip] = useState(true);
  const b = o ? worldBounds(o) : null;
  useEffect(() => {
    if (tool === 'cut' && b) set({ cutPlane: { ...cutPlane, height: +((b.min[2] + b.max[2]) / 2).toFixed(2) } });
  }, [tool, o?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (tool !== 'cut') return null;
  return (
    <div className="float panel" style={{ width: 290 }}>
      <h4>Cut</h4>
      {!o || !b ? <p className="muted">Select an object to cut.</p> : <>
        <Slider label="Height" value={cutPlane.height} min={b.min[2]} max={b.max[2]} step={0.1} unit="mm" onChange={(v) => set({ cutPlane: { ...cutPlane, height: v } })} />
        <Slider label="Tilt X" value={cutPlane.tiltX} min={-90} max={90} step={1} unit="°" onChange={(v) => set({ cutPlane: { ...cutPlane, tiltX: v } })} />
        <Slider label="Tilt Y" value={cutPlane.tiltY} min={-90} max={90} step={1} unit="°" onChange={(v) => set({ cutPlane: { ...cutPlane, tiltY: v } })} />
        <label className="row"><input type="checkbox" checked={keepAbove} onChange={(e) => setAbove(e.target.checked)} />Keep upper part</label>
        <label className="row" style={{ marginLeft: 20 }}><input type="checkbox" checked={flip} disabled={!keepAbove} onChange={(e) => setFlip(e.target.checked)} />Place on cut face</label>
        <label className="row"><input type="checkbox" checked={keepBelow} onChange={(e) => setBelow(e.target.checked)} />Keep lower part</label>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn-secondary btn-small" onClick={() => set({ cutPlane: { height: +((b.min[2] + b.max[2]) / 2).toFixed(2), tiltX: 0, tiltY: 0 } })}>Reset</button>
          <button className="btn-primary btn-small" disabled={!keepAbove && !keepBelow} onClick={() => cutObject(o.id, { ...cutPlane, keepAbove, keepBelow, flipAbove: flip })}><Icon name="cut" size={14} />Perform cut</button>
        </div>
      </>}
    </div>
  );
}

export function BooleanPanel() {
  const { tool, objects, selected } = useStore();
  if (tool !== 'boolean') return null;
  const sel = selected.map((id) => objects.find((o) => o.id === id)).filter(Boolean);
  return (
    <div className="float panel" style={{ width: 290 }}>
      <h4>Mesh boolean</h4>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Shift+click to select two or more objects. The first selected is the base: <b>Difference</b> subtracts the others from it.</p>
      {sel.map((o, i) => <div key={o!.id} className="row" style={{ marginBottom: 2 }}><span className="badge">{i === 0 ? 'Base' : `+${i}`}</span>{o!.name}</div>)}
      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {([['union', 'Union'], ['difference', 'Difference'], ['intersection', 'Intersection']] as const).map(([op, label]) => (
          <button key={op} className="btn-secondary btn-small" disabled={sel.length < 2} onClick={() => booleanSelected(op)}>{label}</button>
        ))}
      </div>
    </div>
  );
}

export function TextPanel() {
  const { tool, selected } = useStore();
  const [o, setO] = useState<TextOptions>({ text: 'NexSpiro', font: 'helvetiker_bold', size: 10, depth: 2, mode: 'object' });
  const [busy, setBusy] = useState(false);
  if (tool !== 'text') return null;
  return (
    <div className="float panel" style={{ width: 290 }}>
      <h4>Text</h4>
      <input className="input" style={{ width: '100%', marginBottom: 8 }} value={o.text} onChange={(e) => setO({ ...o, text: e.target.value })} placeholder="Text" />
      <div className="row" style={{ marginBottom: 6 }}>
        <span style={{ width: 62 }}>Font</span>
        <select className="select" value={o.font} onChange={(e) => setO({ ...o, font: e.target.value })}>
          {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </select>
      </div>
      <Slider label="Height" value={o.size} min={2} max={80} step={0.5} unit="mm" onChange={(v) => setO({ ...o, size: v })} />
      <Slider label="Depth" value={o.depth} min={0.2} max={20} step={0.1} unit="mm" onChange={(v) => setO({ ...o, depth: v })} />
      <div className="seg" style={{ margin: '4px 0 10px' }}>
        {([['object', 'New object'], ['emboss', 'Emboss'], ['engrave', 'Engrave']] as const).map(([m, label]) => (
          <button key={m} className={o.mode === m ? 'on' : ''} disabled={m !== 'object' && !selected.length} onClick={() => setO({ ...o, mode: m })}>{label}</button>
        ))}
      </div>
      {o.mode !== 'object' && <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>{o.mode === 'emboss' ? 'Raised' : 'Cut'} into the top face of the selected object.</p>}
      <button className="btn-primary btn-small" disabled={busy || !o.text.trim()} onClick={async () => { setBusy(true); try { await addText(o); } finally { setBusy(false); } }}><Icon name="text" size={14} />{busy ? 'Working…' : 'Add text'}</button>
    </div>
  );
}

export function MeasurePanel() {
  const { tool, measurePoints, set } = useStore();
  if (tool !== 'measure') return null;
  const [a, b] = measurePoints;
  const d = a && b ? [b[0] - a[0], b[1] - a[1], b[2] - a[2]] : null;
  return (
    <div className="float panel" style={{ width: 250 }}>
      <h4>Measure</h4>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Click two points on the models.</p>
      {measurePoints.map((p, i) => <div key={i} className="row mono" style={{ fontSize: 12 }}><span className="badge">{i + 1}</span>{p.map((x) => x.toFixed(2)).join(', ')}</div>)}
      {d && (
        <div className="summary">
          <span className="k">Distance</span><span className="v">{Math.hypot(d[0], d[1], d[2]).toFixed(3)} mm</span>
          <span className="k">ΔX</span><span className="v">{Math.abs(d[0]).toFixed(3)} mm</span>
          <span className="k">ΔY</span><span className="v">{Math.abs(d[1]).toFixed(3)} mm</span>
          <span className="k">ΔZ</span><span className="v">{Math.abs(d[2]).toFixed(3)} mm</span>
        </div>
      )}
      {measurePoints.length > 0 && <button className="btn-secondary btn-small" style={{ marginTop: 8 }} onClick={() => set({ measurePoints: [] })}>Clear</button>}
    </div>
  );
}
