import { useEffect, useState } from 'react';
import { arrange, autoOrient, exportGcode, importDialog, sliceAndPreview } from '../state/actions';
import { dropToBed, useStore, worldBounds, type SceneObject, type Tool } from '../state/store';
import { viewApi } from '../viewport/Viewport';
import { Icon } from './icons';

export function Toolbar() {
  const { tool, set, selected, objects, removeSelected, duplicateSelected, showOverhangs } = useStore();
  const has = selected.length > 0;
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
  const { tool, objects, selected, updateObjects } = useStore();
  const o = objects.find((x) => x.id === selected[0]);
  const [uniform, setUniform] = useState(true);
  if (!o || !['move', 'rotate', 'scale'].includes(tool)) return null;
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
