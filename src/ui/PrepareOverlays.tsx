import { BRUSHES, BRUSH_LABELS, type BrushType } from '../engine/brush';
import { useEffect, useMemo, useRef, useState } from 'react';
import { autoOrient, importDialog } from '../state/actions';
import { splitObject } from '../state/objectOps';
import { dropToBed, objectPlate, slotColor, useStore, worldBounds, type SceneObject, type Tool } from '../state/store';
import { addPlate, arrangeAll, arrangeSelected, currentProfile, orientPlate, signedVolume, objectHeight, profileBounds, vlhAdaptive, vlhRange, vlhReset, vlhSmooth } from '../state/ops';
import { viewApi } from '../viewport/Viewport';
import { Icon } from './icons';

/** The Prepare toolbar: object commands, then the gizmos and tools. */
export function Toolbar() {
  const { tool, set, selected, objects, showOverhangs, selectedPart, activePlate, plates } = useStore();
  const has = selected.length > 0 || !!selectedPart;
  const one = selected.length === 1 && !selectedPart;
  const T = (t: Tool, icon: string, label: string, key: string, disabled = false) => (
    <button className={`icon-btn ${tool === t ? 'active' : ''}`} title={`${label} (${key})`} aria-label={label} disabled={disabled}
      onClick={() => set({ tool: tool === t ? 'select' : t })}><Icon name={icon} /></button>
  );
  const locked = !!plates[activePlate]?.locked;
  const [arrOpen, setArrOpen] = useState(false);
  return (
    <div className="float toolbar" role="toolbar">
      <button className="icon-btn" title="Add (Ctrl+I)" aria-label="Add model" onClick={importDialog}><Icon name="add" /></button>
      <button className="icon-btn" title="Add plate" aria-label="Add plate" onClick={addPlate}><Icon name="addPlate" /></button>
      <button className="icon-btn" title={has ? 'Auto orient selected (O)' : 'Auto orient all objects on the plate (O)'} aria-label="Auto orient"
        disabled={!objects.length || (!has && locked)} onClick={() => (has ? autoOrient() : orientPlate())}><Icon name="orient" /></button>
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button className="icon-btn" title="Arrange all objects (A) · Shift+A: arrange selected · right click: arrange settings" aria-label="Arrange" disabled={!objects.length}
          onClick={(e) => (e.shiftKey ? arrangeSelected() : arrangeAll())} onContextMenu={(e) => { e.preventDefault(); setArrOpen(!arrOpen); }}><Icon name="arrange" /></button>
        {arrOpen && <ArrangeSettings onClose={() => setArrOpen(false)} />}
      </span>
      <button className="icon-btn" title="Split to objects" aria-label="Split to objects" disabled={!one} onClick={() => splitObject(selected[0])}><Icon name="split" /></button>
      {T('vlh', 'vlh', 'Variable layer height', 'H', !objects.length)}
      <span className="sep" />
      {T('move', 'move', 'Move', 'M')}
      {T('rotate', 'rotate', 'Rotate', 'R')}
      {T('scale', 'scale', 'Scale', 'S')}
      {T('face', 'face', 'Lay on face', 'F')}
      {T('cut', 'cut', 'Cut', 'C')}
      {T('boolean', 'boolean', 'Mesh boolean', 'B')}
      {T('paint_support', 'brushSupport', 'Support painting', 'L')}
      {T('paint_seam', 'brushSeam', 'Seam painting', 'P')}
      {T('text', 'text', 'Text shape', 'T')}
      {T('paint_color', 'brushColor', 'Color painting', 'N')}
      {T('measure', 'measure', 'Measure', 'U')}
      {T('brim_ears', 'ears', 'Brim ears', 'E')}
      <span className="sep" />
      <button className={`icon-btn ${showOverhangs ? 'active' : ''}`} title="Highlight overhangs" aria-label="Highlight overhangs" onClick={() => set({ showOverhangs: !showOverhangs })}><Icon name="overhang" /></button>
    </div>
  );
}

/** Shown while the motion preview is drawn on the model. */
export function LiveChip() {
  const { liveToolpaths, objects } = useStore();
  const [info, setInfo] = useState('');
  useEffect(() => {
    const on = () => setInfo(`${Math.round((window as any).__nxPreviewMs ?? 0)} ms`);
    window.addEventListener('nx-preview-built', on);
    return () => window.removeEventListener('nx-preview-built', on);
  }, []);
  if (!liveToolpaths || !objects.length) return null;
  return <div className="float live-chip" role="status"><i />Toolpath view (quick){info ? ` · ${info}` : ''} · slice for exact G-code</div>;
}

type CubeFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
// Each face in world space (Z up, front = -Y): screen-right, screen-down and outward normal.
const FACES: [CubeFace, string, number[], number[], number[]][] = [
  ['top', 'Top', [1, 0, 0], [0, -1, 0], [0, 0, 1]],
  ['bottom', 'Bottom', [1, 0, 0], [0, 1, 0], [0, 0, -1]],
  ['front', 'Front', [1, 0, 0], [0, 0, -1], [0, -1, 0]],
  ['back', 'Back', [-1, 0, 0], [0, 0, -1], [0, 1, 0]],
  ['right', 'Right', [0, 1, 0], [0, 0, -1], [1, 0, 0]],
  ['left', 'Left', [0, -1, 0], [0, 0, -1], [-1, 0, 0]],
];
const CUBE = 62;

/** View cube: turns with the camera, click a face to look at it, drag to orbit. */
export function ViewCube() {
  const cube = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  useEffect(() => {
    const on = (e: ArrayLike<number>) => {
      // camera rotation, with y flipped into CSS's y-down screen space
      if (cube.current) cube.current.style.transform = `matrix3d(${[e[0], -e[1], e[2], 0, e[4], -e[5], e[6], 0, e[8], -e[9], e[10], 0, 0, 0, 0, 1].join(',')})`;
    };
    viewApi.cameraListeners.add(on);
    viewApi.current?.emitCamera();
    return () => { viewApi.cameraListeners.delete(on); };
  }, []);
  const h = CUBE / 2;
  return (
    <div className="float viewcube" aria-label="View cube">
      <div className="cube-stage" title="Click a face to view from that side · drag to rotate"
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 3) return;
          d.moved = true; d.x = e.clientX; d.y = e.clientY;
          viewApi.current?.orbit(-dx * 0.012, -dy * 0.012);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const face = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.dataset.face as CubeFace | undefined;
            if (face) viewApi.current?.setView(face);
          }
        }}>
        <div className="cube" ref={cube}>
          {FACES.map(([id, label, r, d, n]) => (
            <div key={id} data-face={id} className={`cube-face ${id}`}
              style={{ width: CUBE, height: CUBE, marginLeft: -h, marginTop: -h, transform: `matrix3d(${[...r, 0, ...d, 0, ...n, 0, n[0] * h, n[1] * h, n[2] * h, 1].join(',')})` }}>
              {label}
            </div>
          ))}
        </div>
      </div>
      <button className="icon-btn cube-fit" title="Zoom to fit the plate (Z) · 0: default view" aria-label="Zoom to fit" onClick={() => viewApi.current?.fit()}><Icon name="fit" size={16} /></button>
    </div>
  );
}

/** Object info box (bottom right) for the selected object: name, size, volume, triangles, mesh errors. */
export function ObjectInfo() {
  const { objects, selected, selectedPart } = useStore();
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [mini, setMini] = useState(false);
  const o = selected.length === 1 && !selectedPart ? objects.find((x) => x.id === selected[0]) : undefined;
  const volume = useMemo(() => (o ? Math.abs(signedVolume(o.mesh) * o.scale[0] * o.scale[1] * o.scale[2]) : 0), [o?.mesh, o?.scale]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o || closedFor === o.id) return null;
  const b = worldBounds(o);
  const size = [0, 1, 2].map((k) => (b.max[k] - b.min[k]).toFixed(2));
  return (
    <div className={`float object-info ${mini ? 'mini' : ''}`} role="status" aria-label="Object info">
      <div className="oi-head">
        <span className="oi-title">{mini ? o.name : 'Object info'}</span>
        <button className="oi-btn" title={mini ? 'Expand' : 'Minimize'} onClick={() => setMini(!mini)}><Icon name={mini ? 'chevronDown' : 'minus'} size={13} /></button>
        <button className="oi-btn" title="Close" onClick={() => setClosedFor(o.id)}><Icon name="close" size={13} /></button>
      </div>
      {!mini && <div className="oi-body">
        <span>Object name:</span><b>{o.name}</b>
        <span>Size:</span><b>{size[0]} x {size[1]} x {size[2]} mm</b>
        <span>Volume:</span><b>{volume.toFixed(2)} mm³</b>
        <span>Triangles:</span><b>{(o.mesh.indices.length / 3).toLocaleString()}</b>
        {o.openEdges > 0 && <><span>Errors:</span><b className="oi-warn">{o.openEdges} open edges</b></>}
        {o.printable === false && <><span>Printable:</span><b>No</b></>}
      </div>}
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

/** Painting panel: brush size, modes and colour palette. */
const BRUSH_TIPS: Record<BrushType, string> = {
  circle: 'Paints the surface facing you inside the circle',
  sphere: 'Paints every triangle inside the sphere, including hidden ones',
  triangle: 'Paints the triangle under the cursor',
  height_range: 'Paints a horizontal band of the model (pen size = band height)',
  fill: 'Click: fills the surface up to edges sharper than the smart fill angle',
  gap_fill: 'Click: fills small unpainted gaps between painted areas',
};

export function PaintPanel() {
  const s = useStore();
  if (!['paint_support', 'paint_seam', 'paint_color'].includes(s.tool)) return null;
  const sel = s.objects.find((o) => o.id === s.selected[0]);
  const layer = s.tool === 'paint_support' ? 'support' : s.tool === 'paint_seam' ? 'seam' : 'color';
  const brush = BRUSHES[layer].includes(s.brushType) ? s.brushType : 'circle';
  const title = { paint_support: 'Support painting', paint_seam: 'Seam painting', paint_color: 'Colour painting' }[s.tool as 'paint_support'];
  const clear = () => {
    const ids = sel ? [sel.id] : s.objects.map((o) => o.id);
    s.updateObjects((o) => ({ ...o, paint: { ...(o.paint ?? {}), [layer]: undefined } }), ids);
  };
  return (
    <div className="float panel">
      <h4>{title}</h4>
      <div className="seg brush-seg" role="radiogroup" aria-label="Brush">
        {BRUSHES[layer].map((b) => <button key={b} className={brush === b ? 'on' : ''} onClick={() => s.set({ brushType: b })} title={BRUSH_TIPS[b]}>{BRUSH_LABELS[b]}</button>)}
      </div>
      {(brush === 'circle' || brush === 'sphere' || brush === 'height_range') && <>
        <div className="row"><span style={{ flex: 1 }}>{brush === 'height_range' ? 'Height range' : 'Pen size'}</span><span className="mono">{s.brushSize.toFixed(1)} mm</span></div>
        <input type="range" min={0.4} max={20} step={0.2} value={s.brushSize} onChange={(e) => s.set({ brushSize: +e.target.value })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
      </>}
      {brush === 'fill' && <>
        <div className="row"><span style={{ flex: 1 }}>Smart fill angle</span><span className="mono">{s.smartFillAngle}°</span></div>
        <input type="range" min={0} max={90} step={1} value={s.smartFillAngle} onChange={(e) => s.set({ smartFillAngle: +e.target.value })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
      </>}
      {brush === 'gap_fill' && <>
        <div className="row"><span style={{ flex: 1 }}>Gap area</span><span className="mono">{s.gapArea.toFixed(1)} mm²</span></div>
        <input type="range" min={0.1} max={20} step={0.1} value={s.gapArea} onChange={(e) => s.set({ gapArea: +e.target.value })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
      </>}
      {s.tool === 'paint_support' && <>
        <div className="row"><span style={{ flex: 1 }}>Highlight overhangs below</span><span className="mono">{s.paintOverhangAngle}°</span></div>
        <input type="range" min={0} max={90} step={1} value={s.paintOverhangAngle} onChange={(e) => s.set({ paintOverhangAngle: +e.target.value })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
      </>}
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
          ? <><span><kbd>Left drag</kbd> on model: paint</span><span><kbd>Alt + drag</kbd> reset to object filament</span></>
          : <><span><kbd>Left drag</kbd> on model: {s.tool === 'paint_support' ? 'enforce support' : 'enforce seam'}</span><span><kbd>Alt + drag</kbd> block</span></>}
        <span><kbd>Shift + drag</kbd> erase</span><span><kbd>Left drag</kbd> off model: rotate · <kbd>Middle</kbd>/<kbd>Right drag</kbd> pan · <kbd>Wheel</kbd> zoom</span>
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

export { slotColor };

/** Arrange settings popup (right click on the arrange button). */
function ArrangeSettings({ onClose }: { onClose: () => void }) {
  const { arrangeSettings: a, set } = useStore();
  const up = (p: Partial<typeof a>) => set({ arrangeSettings: { ...a, ...p } });
  return (
    <div className="menu-pop arrange-pop" style={{ top: 40, left: 0, padding: 12, width: 240 }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="row"><b style={{ flex: 1 }}>Arrange settings</b><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button></div>
      <div className="row"><span style={{ flex: 1 }}>Spacing</span><span className="mono">{a.spacing.toFixed(1)} mm</span></div>
      <input type="range" min={0} max={30} step={0.5} value={a.spacing} onChange={(e) => up({ spacing: +e.target.value })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
      <label className="row"><input type="checkbox" checked={a.rotate} onChange={(e) => up({ rotate: e.target.checked })} />Auto rotate for arrangement</label>
      <div className="row"><span style={{ flex: 1 }}>Align</span>
        <div className="seg">{([['center', 'Centre'], ['x', 'X axis'], ['y', 'Y axis']] as const).map(([v, l]) => <button key={v} className={a.align === v ? 'on' : ''} onClick={() => up({ align: v })}>{l}</button>)}</div>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn-secondary btn-small" onClick={() => up({ spacing: 6, rotate: false, align: 'center' })}>Reset</button>
        <span className="spacer" />
        <button className="btn-primary btn-small" onClick={() => { arrangeAll(); onClose(); }}>Arrange</button>
      </div>
    </div>
  );
}

/** Brim ears tool panel. */
export function BrimEarsPanel() {
  const s = useStore();
  if (s.tool !== 'brim_ears') return null;
  const o = s.objects.find((x) => x.id === s.selected[0]);
  const n = s.objects.reduce((a, x) => a + (x.brimEars?.length ?? 0), 0);
  const painted = s.overrides.brim_type === 'brim_ears';
  return (
    <div className="float panel" style={{ width: 270 }}>
      <h4>Brim ears</h4>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Click a model near the bed to add an ear; click an ear to remove it. Ears use the brim width ({Number(s.overrides.brim_width ?? 5)} mm).</p>
      <div className="row" style={{ fontSize: 12 }}>{n} ear{n === 1 ? '' : 's'} placed{!painted && n > 0 && <span className="badge" style={{ marginLeft: 6 }}>brim type is not Painted</span>}</div>
      <div className="row" style={{ marginTop: 8 }}>
        {!painted && <button className="btn-secondary btn-small" onClick={() => { s.setOverride('brim_type', 'brim_ears'); s.markDirty(); }}>Use painted brim</button>}
        <span className="spacer" />
        <button className="btn-secondary btn-small" disabled={!n} onClick={() => { s.updateObjects((x) => ({ ...x, brimEars: undefined }), o ? [o.id] : s.objects.map((x) => x.id)); s.markDirty(); }}>{o ? 'Clear on selected' : 'Clear all'}</button>
      </div>
    </div>
  );
}
