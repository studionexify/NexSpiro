import { useEffect, useMemo, useRef, useState } from 'react';
import { arrange, autoOrient, exportGcode, importDialog, sliceAndPreview } from '../state/actions';
import { dropToBed, objectPlate, slotColor, useStore, worldBounds, type SceneObject, type Tool } from '../state/store';
import { addPlate, currentProfile, deletePlate, objectHeight, profileBounds, vlhAdaptive, vlhRange, vlhReset, vlhSmooth } from '../state/ops';
import { plateObjects } from '../state/slicing';
import { viewApi } from '../viewport/Viewport';
import { Icon } from './icons';

export function Toolbar() {
  const { tool, set, selected, objects, removeSelected, duplicateSelected, showOverhangs, selectedPart } = useStore();
  const has = selected.length > 0 || !!selectedPart;
  const T = (t: Tool, icon: string, label: string, key: string) => (
    <button className={`icon-btn ${tool === t ? 'active' : ''}`} title={`${label} (${key})`} aria-label={label}
      onClick={() => set({ tool: tool === t ? 'select' : t })}><Icon name={icon} /></button>
  );
  return (
    <div className="float toolbar" role="toolbar">
      <button className="icon-btn" title="Add model (Ctrl+I)" aria-label="Add model" onClick={importDialog}><Icon name="add" /></button>
      <button className="icon-btn" title="Auto orient (O)" aria-label="Auto orient" disabled={!has} onClick={() => autoOrient()}><Icon name="orient" /></button>
      <button className="icon-btn" title="Arrange all (A)" aria-label="Arrange" disabled={!objects.length} onClick={() => arrange()}><Icon name="arrange" /></button>
      <button className="icon-btn" title="Duplicate (Ctrl+D)" aria-label="Duplicate" disabled={!has} onClick={duplicateSelected}><Icon name="copy" /></button>
      <button className="icon-btn" title="Delete (Del)" aria-label="Delete" disabled={!has} onClick={removeSelected}><Icon name="trash" /></button>
      <span className="sep" />
      {T('move', 'move', 'Move', 'M')}
      {T('rotate', 'rotate', 'Rotate', 'R')}
      {T('scale', 'scale', 'Scale', 'S')}
      {T('face', 'face', 'Lay on face', 'F')}
      <span className="sep" />
      {T('paint_support', 'brushSupport', 'Support painting', 'L')}
      {T('paint_seam', 'brushSeam', 'Seam painting', 'P')}
      {T('paint_color', 'brushColor', 'Colour painting', 'N')}
      {T('vlh', 'vlh', 'Variable layer height', 'H')}
      <span className="sep" />
      <button className={`icon-btn ${showOverhangs ? 'active' : ''}`} title="Highlight overhangs" aria-label="Highlight overhangs" onClick={() => set({ showOverhangs: !showOverhangs })}><Icon name="overhang" /></button>
    </div>
  );
}

export function ViewCube() {
  const v = (name: 'iso' | 'top' | 'front' | 'left' | 'right' | 'back', label: string) => <button onClick={() => viewApi.current?.setView(name)}>{label}</button>;
  return (
    <div className="float viewcube" aria-label="Camera views">
      {v('left', 'LEFT')}{v('top', 'TOP')}{v('right', 'RIGHT')}
      {v('front', 'FRONT')}{v('iso', 'ISO')}{v('back', 'BACK')}
    </div>
  );
}

export function ActionBar() {
  const { slice, objects } = useStore();
  return (
    <div className="float actionbar">
      <button className="btn-secondary" onClick={exportGcode} disabled={!objects.length || slice.status === 'slicing'} title="Slice (if needed) and export G-code (Ctrl+G)">
        <Icon name="download" />Export G-code
      </button>
      <button className="btn-primary" onClick={sliceAndPreview} disabled={!objects.length || slice.status === 'slicing'} title="Slice plate (Ctrl+R)">
        <Icon name="slice" />{slice.status === 'slicing' ? 'Slicing…' : 'Slice plate'}
      </button>
    </div>
  );
}

/** Numeric transform panel for the active tool. */
export function TransformPanel() {
  const { tool, objects, selected, updateObjects, selectedPart } = useStore();
  const o = objects.find((x) => x.id === selected[0]);
  const [uniform, setUniform] = useState(true);
  if (!o || selectedPart || !['move', 'rotate', 'scale'].includes(tool)) return null;
  const b = worldBounds(o);
  const size = [0, 1, 2].map((k) => b.max[k] - b.min[k]);
  const commit = (fn: (o: SceneObject) => SceneObject, drop = true) => updateObjects((x) => (drop ? dropToBed(fn(x)) : fn(x)), [o.id]);
  const field = (axis: number, value: number, onSet: (v: number) => void, unit: string) => (
    <div className="xyz" key={axis}>
      <span className={`ax ${'xyz'[axis]}`}>{'XYZ'[axis]}</span>
      <NumField value={value} onSet={onSet} />
      <span className="unit">{unit}</span>
    </div>
  );
  return (
    <div className="float panel">
      {tool === 'move' && <>
        <h4>Move · world coordinates</h4>
        {[0, 1, 2].map((k) => field(k, k === 2 ? b.min[2] : (b.min[k] + b.max[k]) / 2, (v) => {
          const delta = k === 2 ? v - b.min[2] : v - (b.min[k] + b.max[k]) / 2;
          commit((x) => { const p = [...x.position] as [number, number, number]; p[k] += delta; return { ...x, position: p }; }, false);
        }, 'mm'))}
        <button className="btn-secondary btn-small" disabled={Math.abs(b.min[2]) < 1e-4} onClick={() => commit((x) => x)}>Drop to bed</button>
      </>}
      {tool === 'rotate' && <>
        <h4>Rotate · degrees</h4>
        {[0, 1, 2].map((k) => field(k, o.rotation[k], (v) => commit((x) => { const r = [...x.rotation] as [number, number, number]; r[k] = v; return { ...x, rotation: r }; }), '°'))}
        <button className="btn-secondary btn-small" onClick={() => commit((x) => ({ ...x, rotation: [0, 0, 0] }))}>Reset rotation</button>
      </>}
      {tool === 'scale' && <>
        <h4 className="row" style={{ justifyContent: 'space-between' }}>Scale
          <label className="row" style={{ fontWeight: 400, gap: 6, marginTop: 0 }}><Icon name="lock" size={14} />Uniform
            <button className={`toggle ${uniform ? 'on' : ''}`} onClick={() => setUniform(!uniform)} aria-label="Uniform scale" /></label>
        </h4>
        {[0, 1, 2].map((k) => field(k, o.scale[k] * 100, (v) => commit((x) => {
          const f = v / 100;
          const sc = uniform ? ([f, f, f].map((ff, i) => (x.scale[i] / x.scale[k]) * ff) as [number, number, number]) : (() => { const t = [...x.scale] as [number, number, number]; t[k] = f; return t; })();
          return { ...x, scale: sc };
        }), '%'))}
        <h4 style={{ marginTop: 10 }}>Size</h4>
        {[0, 1, 2].map((k) => field(k, size[k], (v) => commit((x) => {
          const f = v / size[k];
          const sc = (uniform ? x.scale.map((s) => s * f) : x.scale.map((s, i) => (i === k ? s * f : s))) as [number, number, number];
          return { ...x, scale: sc };
        }), 'mm'))}
        <div className="row">
          <button className="btn-secondary btn-small" onClick={() => commit((x) => ({ ...x, scale: x.scale.map((s) => s * 25.4) as [number, number, number] }))}>From inches</button>
          <button className="btn-secondary btn-small" onClick={() => commit((x) => ({ ...x, scale: [1, 1, 1] }))}>Reset</button>
        </div>
      </>}
    </div>
  );
}

function NumField({ value, onSet }: { value: number; onSet: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  return (
    <input className="input" style={{ textAlign: 'right' }} value={draft ?? value.toFixed(2)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) { const v = parseFloat(draft); if (isFinite(v)) onSet(v); setDraft(null); } }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  );
}

export function EmptyHint() {
  const objects = useStore((s) => s.objects);
  if (objects.length) return null;
  return (
    <div className="empty">
      <div className="hint">
        <b>Drop STL, OBJ or 3MF files here</b>
        or <button className="btn-secondary btn-small" style={{ display: 'inline-flex', margin: '0 4px' }} onClick={importDialog}><Icon name="add" size={14} />Add model</button> · pick a sample on the Home tab
      </div>
    </div>
  );
}

/** Painting panel: brush size, modes and colour palette. */
export function PaintPanel() {
  const s = useStore();
  if (!['paint_support', 'paint_seam', 'paint_color'].includes(s.tool)) return null;
  const sel = s.objects.find((o) => o.id === s.selected[0]);
  const layer = s.tool === 'paint_support' ? 'support' : s.tool === 'paint_seam' ? 'seam' : 'color';
  const title = { paint_support: 'Support painting', paint_seam: 'Seam painting', paint_color: 'Colour painting' }[s.tool as 'paint_support'];
  const clear = () => {
    const ids = sel ? [sel.id] : s.objects.map((o) => o.id);
    s.updateObjects((o) => ({ ...o, paint: { ...(o.paint ?? {}), [layer]: undefined } }), ids);
  };
  return (
    <div className="float panel">
      <h4>{title}</h4>
      <div className="row"><span style={{ flex: 1 }}>Pen size</span><span className="mono">{s.brushSize.toFixed(1)} mm</span></div>
      <input type="range" min={0.4} max={20} step={0.2} value={s.brushSize} onChange={(e) => s.set({ brushSize: +e.target.value })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
      {s.tool === 'paint_support' && (
        <label className="row"><span style={{ flex: 1 }}>On overhangs only</span><button className={`toggle ${s.overhangOnly ? 'on' : ''}`} onClick={() => s.set({ overhangOnly: !s.overhangOnly })} aria-label="On overhangs only" /></label>
      )}
      {s.tool === 'paint_color' && (
        <div className="palette">
          {s.filaments.map((f, k) => (
            <button key={k} className={`pal ${s.paintColor === k + 1 ? 'on' : ''}`} style={{ background: f.color }} onClick={() => s.set({ paintColor: k + 1 })} title={`Filament ${k + 1}`}>{k + 1}</button>
          ))}
          {s.filaments.length < 2 && <div style={{ color: 'var(--text-muted)' }}>Add a second filament in the Filament panel to paint colours.</div>}
        </div>
      )}
      <div className="hint-list">
        {s.tool === 'paint_color'
          ? <><span><kbd>Left drag</kbd> paint</span><span><kbd>Right drag</kbd> reset to object filament</span></>
          : <><span><kbd>Left drag</kbd> {s.tool === 'paint_support' ? 'enforce support' : 'enforce seam'}</span><span><kbd>Right drag</kbd> block</span></>}
        <span><kbd>Shift + drag</kbd> erase</span><span><kbd>Middle drag</kbd> orbit · <kbd>Wheel</kbd> zoom</span>
      </div>
      <button className="btn-secondary btn-small" onClick={clear}>{sel ? 'Clear on selected object' : 'Clear on all objects'}</button>
    </div>
  );
}

/** Variable layer height panel with profile chart. */
export function VlhPanel() {
  const s = useStore();
  const [quality, setQuality] = useState(0.5);
  const [radius, setRadius] = useState(5);
  const [keepMin, setKeepMin] = useState(false);
  const [range, setRange] = useState({ z0: 2, z1: 6, h: 0.1 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const o = s.objects.find((x) => x.id === s.selected[0]);
  const prof = useMemo(() => (o ? currentProfile(o) : []), [o, s.printerId, s.presetId, s.overrides]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !prof.length) return;
    const g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const pb = profileBounds();
    const total = prof.reduce((a, b) => a + b, 0);
    let z = 0;
    for (const h of prof) {
      const y0 = H - (z / total) * H, y1 = H - ((z + h) / total) * H;
      const t = (h - pb.minHeight) / Math.max(1e-6, pb.maxHeight - pb.minHeight);
      g.fillStyle = t < 0.5 ? `rgb(${Math.round(93 + 300 * t)}, 190, 122)` : `rgb(255, ${Math.round(255 - (t - 0.5) * 300)}, ${Math.round(141 - (t - 0.5) * 200)})`;
      g.fillRect(0, y1, (h / pb.maxHeight) * W, Math.max(1, y0 - y1));
      z += h;
    }
  }, [prof]);
  if (s.tool !== 'vlh') return null;
  if (!o) return <div className="float panel"><h4>Variable layer height</h4><div style={{ color: 'var(--text-muted)' }}>Select an object to edit its layer heights.</div></div>;
  const pb = profileBounds();
  const height = objectHeight(o);
  return (
    <div className="float panel vlh">
      <h4>Variable layer height · {o.name}</h4>
      <div className="vlh-body">
        <canvas ref={canvas} width={60} height={220} className="vlh-chart" title="Layer height along Z (green = thin, red = thick)" />
        <div style={{ flex: 1 }}>
          <div className="row"><span style={{ flex: 1 }}>Quality ↔ Speed</span><span className="mono">{quality.toFixed(2)}</span></div>
          <input type="range" min={0} max={1} step={0.05} value={quality} onChange={(e) => setQuality(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)' }} />
          <button className="btn-secondary btn-small" style={{ width: '100%' }} onClick={() => vlhAdaptive(o.id, quality)}>Adaptive</button>
          <div className="row"><span style={{ flex: 1 }}>Smooth radius</span><span className="mono">{radius}</span></div>
          <input type="range" min={1} max={10} step={1} value={radius} onChange={(e) => setRadius(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)' }} />
          <label className="row"><span style={{ flex: 1 }}>Keep min</span><button className={`toggle ${keepMin ? 'on' : ''}`} onClick={() => setKeepMin(!keepMin)} aria-label="Keep min" /></label>
          <button className="btn-secondary btn-small" style={{ width: '100%' }} onClick={() => vlhSmooth(o.id, radius, keepMin)}>Smooth</button>
        </div>
      </div>
      <h4 style={{ marginTop: 10 }}>Height range</h4>
      <div className="xyz" style={{ gridTemplateColumns: '40px 1fr 26px' }}><span>From</span><NumField value={range.z0} onSet={(v) => setRange({ ...range, z0: v })} /><span className="unit">mm</span></div>
      <div className="xyz" style={{ gridTemplateColumns: '40px 1fr 26px' }}><span>To</span><NumField value={range.z1} onSet={(v) => setRange({ ...range, z1: v })} /><span className="unit">mm</span></div>
      <div className="xyz" style={{ gridTemplateColumns: '40px 1fr 26px' }}><span>Layer</span><NumField value={range.h} onSet={(v) => setRange({ ...range, h: Math.min(pb.maxHeight, Math.max(pb.minHeight, v)) })} /><span className="unit">mm</span></div>
      <div className="row">
        <button className="btn-secondary btn-small" onClick={() => vlhRange(o.id, Math.max(0, range.z0), Math.min(height, range.z1), range.h)}>Apply range</button>
        <button className="btn-secondary btn-small" disabled={!o.layerHeights} onClick={() => vlhReset(o.id)}>Reset</button>
      </div>
      <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>{prof.length} layers · {pb.minHeight}–{pb.maxHeight} mm allowed{o.layerHeights ? '' : ' · uniform'}</div>
    </div>
  );
}

/** Plate selector and plate actions. */
export function PlateBar() {
  const s = useStore();
  const count = plateObjects(s.activePlate).length;
  void objectPlate;
  return (
    <div className="float platebar">
      <button className="icon-btn" disabled={s.activePlate === 0} onClick={() => s.set({ activePlate: s.activePlate - 1 })} aria-label="Previous plate"><Icon name="chevron" style={{ transform: 'rotate(180deg)' }} /></button>
      <span className="mono" style={{ minWidth: 90, textAlign: 'center' }}>{s.plates[s.activePlate].name} · {count}</span>
      <button className="icon-btn" disabled={s.activePlate >= s.plates.length - 1} onClick={() => s.set({ activePlate: s.activePlate + 1 })} aria-label="Next plate"><Icon name="chevron" /></button>
      <span className="sep" />
      <button className="icon-btn" title="Add plate" onClick={addPlate}><Icon name="add" /></button>
      <button className="icon-btn" title="Delete plate" disabled={s.plates.length < 2} onClick={() => deletePlate()}><Icon name="trash" /></button>
      <button className="icon-btn" title="Arrange this plate" onClick={() => arrange()} disabled={!count}><Icon name="arrange" /></button>
    </div>
  );
}

export { slotColor };
