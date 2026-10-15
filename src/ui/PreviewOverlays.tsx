import { useEffect, useRef, useState } from 'react';
import { FEATURE_LABELS, FEATURE_ORDER, type FeatureType } from '../engine/types';
import { exportGcode, sliceAndPreview } from '../state/actions';
import { useStore, type ColorScheme } from '../state/store';
import { FEATURE_COLORS, RAMP_CSS } from '../viewport/toolpaths';
import { Icon } from './icons';

export const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
};

const SCHEMES: { id: ColorScheme; label: string }[] = [
  { id: 'feature', label: 'Line type' },
  { id: 'filament', label: 'Filament' },
  { id: 'speed', label: 'Speed' },
  { id: 'height', label: 'Layer height' },
  { id: 'width', label: 'Line width' },
  { id: 'flow', label: 'Flow' },
  { id: 'layer_time', label: 'Layer time' },
];

export function Legend() {
  const { slice, colorScheme, hiddenFeatures, showTravel, set, filaments } = useStore();
  const [range, setRange] = useState<{ min: number; max: number; unit: string } | null>(null);
  useEffect(() => {
    const f = () => setRange((window as any).__nxLegend ?? null);
    window.addEventListener('nx-legend', f);
    f();
    return () => window.removeEventListener('nx-legend', f);
  }, []);
  const r = slice.result;
  if (!r) return null;
  const st = r.stats;
  const feats = FEATURE_ORDER.filter((f) => f !== 'travel' && st.byFeature[f]);
  const toggle = (f: FeatureType) => set({ hiddenFeatures: hiddenFeatures.includes(f) ? hiddenFeatures.filter((x) => x !== f) : [...hiddenFeatures, f] });
  return (
    <div className="float legend">
      <div className="row" style={{ marginBottom: 8 }}>
        <h4>Color scheme</h4><span className="spacer" />
        <select className="select" style={{ flex: 'none', width: 140 }} value={colorScheme} onChange={(e) => set({ colorScheme: e.target.value as ColorScheme })}>
          {SCHEMES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {colorScheme !== 'feature' && range && (
        <>
          <div className="ramp" style={{ background: RAMP_CSS }} />
          <div className="row" style={{ justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span>{range.min.toFixed(range.max < 10 ? 2 : 0)} {range.unit}</span>
            <span>{((range.min + range.max) / 2).toFixed(range.max < 10 ? 2 : 0)}</span>
            <span>{range.max.toFixed(range.max < 10 ? 2 : 0)} {range.unit}</span>
          </div>
        </>
      )}
      <div style={{ marginTop: 8 }}>
        <div className="lrow" style={{ color: 'var(--text-muted)', fontSize: 11 }}><span /><span /><span>Line type</span><span className="num">Time</span><span className="num">%</span></div>
        {feats.map((f) => {
          const off = hiddenFeatures.includes(f);
          const b = st.byFeature[f]!;
          return (
            <div key={f} className={`lrow ${off ? 'off' : ''}`}>
              <button className="eye" onClick={() => toggle(f)} aria-label={`Toggle ${FEATURE_LABELS[f]}`}><Icon name={off ? 'eyeOff' : 'eye'} size={15} /></button>
              <span className="swatch" style={{ background: FEATURE_COLORS[f] }} />
              <span>{FEATURE_LABELS[f]}</span>
              <span className="num">{fmtTime(b.time)}</span>
              <span className="num">{((b.time / st.timeSeconds) * 100).toFixed(1)}%</span>
            </div>
          );
        })}
        <div className={`lrow ${showTravel ? '' : 'off'}`}>
          <button className="eye" onClick={() => set({ showTravel: !showTravel })} aria-label="Toggle travel"><Icon name={showTravel ? 'eye' : 'eyeOff'} size={15} /></button>
          <span className="swatch" style={{ background: FEATURE_COLORS.travel }} />
          <span>Travel</span>
          <span className="num">{fmtTime(st.byFeature.travel?.time ?? 0)}</span>
          <span className="num">{(((st.byFeature.travel?.time ?? 0) / st.timeSeconds) * 100).toFixed(1)}%</span>
        </div>
      </div>
      {st.perFilament.length > 1 && (
        <div className="summary">
          {st.perFilament.map((f, k) => f.mm > 0.01 && (
            <span key={k} style={{ display: 'contents' }}>
              <span className="k row" style={{ margin: 0 }}><span className="swatch" style={{ background: filaments[k]?.color ?? '#888' }} />Filament {k + 1}</span>
              <span className="v">{(f.mm / 1000).toFixed(2)} m · {f.grams.toFixed(2)} g</span>
            </span>
          ))}
          <span className="k">Filament changes</span><span className="v">{st.toolChanges}</span>
          {st.towerGrams > 0 && <><span className="k">Prime tower</span><span className="v">{st.towerGrams.toFixed(2)} g</span></>}
        </div>
      )}
      <div className="summary">
        <span className="k">Estimated time</span><span className="v">{fmtTime(st.timeSeconds)}</span>
        <span className="k">Filament</span><span className="v">{(st.filamentMm / 1000).toFixed(2)} m · {st.filamentGrams.toFixed(2)} g</span>
        <span className="k">Cost</span><span className="v">{st.filamentCost.toFixed(2)}</span>
        <span className="k">Layers</span><span className="v">{st.layerCount}</span>
      </div>
      {slice.dirty && (
        <div className="row" style={{ marginTop: 10, color: 'var(--warning)' }}>
          <Icon name="warn" size={14} /><span style={{ flex: 1 }}>Settings changed since this slice.</span>
          <button className="btn-secondary btn-small" onClick={sliceAndPreview}>Re-slice</button>
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn-primary" style={{ flex: 1, minWidth: 0 }} onClick={exportGcode}><Icon name="download" />Export G-code</button>
      </div>
    </div>
  );
}

/** Dual-handle vertical layer slider. */
export function LayerSlider() {
  const { slice, layerRange, set } = useStore();
  const track = useRef<HTMLDivElement>(null);
  const layers = slice.result?.layers ?? [];
  const n = layers.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!n || (e.target as HTMLElement).tagName === 'INPUT') return;
      const [lo, hi] = useStore.getState().layerRange;
      if (e.key === 'ArrowUp') { set({ layerRange: [lo, Math.min(n - 1, hi + 1)], moveCursor: -1 }); e.preventDefault(); }
      if (e.key === 'ArrowDown') { set({ layerRange: [lo, Math.max(lo, hi - 1)], moveCursor: -1 }); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n, set]);
  if (!n) return null;
  const [lo, hi] = layerRange;
  const pos = (i: number) => `${100 - (i / Math.max(1, n - 1)) * 100}%`;
  const plates = useStore.getState().plates;
  const plateIdx = slice.plate;
  const actions = plates[plateIdx]?.layerActions ?? [];
  const layerOf = (z: number) => Math.max(0, layers.findIndex((L) => L.z >= z - 1e-6));
  const drag = (which: 0 | 1) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = track.current!;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const t = 1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      const i = Math.round(t * (n - 1));
      const [a, b] = useStore.getState().layerRange;
      set({ layerRange: which === 1 ? [a, Math.max(a, i)] : [Math.min(i, b), b], moveCursor: -1 });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="float vslider" aria-label="Layer slider">
      <div className="lbl">{hi + 1}<small>{layers[hi].z.toFixed(2)}</small></div>
      <div className="track" ref={track}>
        <div className="fill" style={{ top: pos(hi), bottom: `${100 - parseFloat(pos(lo))}%` }} />
        <div className="handle" style={{ top: pos(hi) }} onPointerDown={drag(1)} title="Top layer (↑/↓)" />
        <div className="handle" style={{ top: pos(lo), background: 'var(--surface-secondary)' }} onPointerDown={drag(0)} title="Bottom layer" />
        {actions.map((a, k) => (
          <div key={k} className={`marker ${a.type}`} style={{ top: pos(layerOf(a.z)) }} title={`${a.type === 'pause' ? 'Pause' : a.type === 'color' ? `Change to filament ${(a.filament ?? 0) + 1}` : 'Custom G-code'} at layer ${layerOf(a.z) + 1} — click to remove`}
            onClick={() => removeAction(plateIdx, k)} />
        ))}
      </div>
      <LayerActionMenu z={layers[hi].z} layer={hi} plate={plateIdx} />
      <div className="lbl">{lo + 1}<small>{layers[lo].z.toFixed(2)}</small></div>
    </div>
  );
}

export function MoveSlider() {
  const { slice, layerRange, moveCursor, set } = useStore();
  const r = slice.result;
  if (!r || !r.layers.length) return null;
  const L = r.layers[layerRange[1]];
  const count = L.moveEnd - L.moveStart;
  const v = moveCursor < 0 ? count - 1 : moveCursor;
  return (
    <div className="float hslider">
      <Icon name="slice" size={16} />
      <input type="range" min={0} max={Math.max(0, count - 1)} value={v} aria-label="Move slider"
        onChange={(e) => { const x = +e.target.value; set({ moveCursor: x >= count - 1 ? -1 : x }); }} />
      <span className="mono" style={{ minWidth: 90, textAlign: 'right', color: 'var(--text-muted)' }}>{v + 1} / {count}</span>
    </div>
  );
}

export function SliceProgress() {
  const slice = useStore((s) => s.slice);
  if (slice.status !== 'slicing') return null;
  return (
    <div className="float progress" role="status">
      <div className="row"><b>Slicing plate</b><span className="spacer" /><span className="mono">{Math.round(slice.progress * 100)}%</span></div>
      <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{slice.stage}…</div>
      <div className="bar"><div style={{ width: `${slice.progress * 100}%` }} /></div>
    </div>
  );
}

export function PreviewEmpty() {
  const { slice, objects } = useStore();
  if (slice.result || slice.status === 'slicing') return null;
  return (
    <div className="empty">
      <div className="hint">
        <b>Nothing sliced yet</b>
        {objects.length ? <button className="btn-primary" style={{ marginTop: 8 }} onClick={sliceAndPreview}><Icon name="slice" />Slice plate</button> : 'Add a model in Prepare, then slice.'}
      </div>
    </div>
  );
}

function removeAction(plate: number, k: number) {
  const s = useStore.getState();
  s.set({ plates: s.plates.map((p, i) => (i === plate ? { ...p, layerActions: p.layerActions.filter((_, j) => j !== k) } : p)) });
  s.markDirty();
}

function LayerActionMenu({ z, layer, plate }: { z: number; layer: number; plate: number }) {
  const { filaments, set } = useStore();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [fil, setFil] = useState(1);
  const add = (a: { type: 'pause' | 'color' | 'custom'; filament?: number; gcode?: string }) => {
    const s = useStore.getState();
    set({ plates: s.plates.map((p, i) => (i === plate ? { ...p, layerActions: [...p.layerActions, { z, ...a }] } : p)) });
    s.markDirty();
    setOpen(false);
  };
  return (
    <div className="menu" style={{ marginTop: 4 }}>
      <button className="icon-btn" title={`Add action at layer ${layer + 1}`} aria-label="Add layer action" onClick={() => setOpen(!open)}><Icon name="add" /></button>
      {open && (
        <div className="menu-pop" style={{ right: 40, left: 'auto', top: -120, width: 260 }}>
          <div className="menu-label">At layer {layer + 1} ({z.toFixed(2)} mm)</div>
          <button className="menu-item" onClick={() => add({ type: 'pause' })}><span>Add pause</span><kbd>M400 U1 / PAUSE</kbd></button>
          <div className="row" style={{ padding: '4px 10px' }}>
            <span style={{ flex: 1 }}>Change filament to</span>
            <select className="select" style={{ flex: 'none', width: 60 }} value={fil} onChange={(e) => setFil(+e.target.value)}>
              {filaments.map((_, k) => <option key={k} value={k}>{k + 1}</option>)}
            </select>
            <button className="btn-secondary btn-small" onClick={() => add({ type: 'color', filament: fil })}>Add</button>
          </div>
          <div style={{ padding: '4px 10px' }}>
            <textarea className="input mono" style={{ width: '100%', height: 54, padding: 6 }} placeholder="Custom G-code, e.g. M104 S215" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button className="btn-secondary btn-small" style={{ marginTop: 4 }} disabled={!custom.trim()} onClick={() => add({ type: 'custom', gcode: custom.trim() })}>Add custom G-code</button>
          </div>
        </div>
      )}
    </div>
  );
}
