// Path tool: pick pixels of the woven picture (any motif or imported image) and move their toolpath by hand,
// out of the wall or in, with the whole stack of layers of those pixels moving together. The 3D view shows
// the moved threads at once, and the drool check says when a move reaches too far out to print.
import { useEffect, useMemo, useRef, useState } from 'react';
import { changed, mx, useMx } from './MotionexPanel';
import { weaveColours } from './WeavePanel';
import type { WeaveSettings } from '../weave/model';

type Mode = 'brush' | 'box' | 'same' | 'all';
const MODES: [Mode, string, string][] = [
  ['brush', 'Brush', 'Paint over pixels to select them'],
  ['box', 'Box', 'Drag a rectangle'],
  ['same', 'Same colour', 'Click a pixel to select its whole patch of one colour'],
  ['all', 'All', 'Select every pixel'],
];

/** Selected pixels per grid, kept while the panel is open (not saved with the project). */
let selection = new Set<number>();
let selectionGrid = '';
const sel = (w: WeaveSettings) => {
  const key = `${w.image.w}x${w.image.h}`;
  if (key !== selectionGrid) { selection = new Set(); selectionGrid = key; }
  return selection;
};

/** The nudge map for the current grid; a map made for another grid size is dropped. */
function nudgeOf(w: WeaveSettings) {
  if (!w.nudge || w.nudge.w !== w.image.w || w.nudge.h !== w.image.h) w.nudge = { w: w.image.w, h: w.image.h, d: {} };
  return w.nudge;
}

/** Pixels of the same palette index joined to (x, y). */
function patch(w: WeaveSettings, x: number, y: number): number[] {
  const { w: W, h: H, px } = w.image, v = px[y * W + x], seen = new Set<number>([y * W + x]), stack = [y * W + x];
  while (stack.length) {
    const i = stack.pop()!, cx = i % W, cy = (i - cx) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = (cx + dx + W) % W, ny = cy + dy;
      if (ny < 0 || ny >= H) continue;
      const j = ny * W + nx;
      if (!seen.has(j) && px[j] === v) { seen.add(j); stack.push(j); }
    }
  }
  return [...seen];
}

export function PathTool() {
  useMx();
  const w = mx.weave;
  const colours = weaveColours(w);
  const ref = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>('brush');
  const [radius, setRadius] = useState(1);
  const [move, setMove] = useState(0.5);
  const [, bump] = useState(0);
  const drag = useRef<{ x0: number; y0: number; x1: number; y1: number; base: Set<number> } | null>(null);
  const S = sel(w);
  const stale = !!w.nudge && (w.nudge.w !== w.image.w || w.nudge.h !== w.image.h);
  const d = !stale ? w.nudge?.d ?? {} : {};
  const moved = Object.keys(d).length;
  const peak = useMemo(() => Object.values(d).reduce((m, v) => Math.max(m, Math.abs(v)), 0), [w.nudge, stale]); // eslint-disable-line react-hooks/exhaustive-deps
  const cap = w.max_deviation_mm > 0 ? w.max_deviation_mm : 6;
  const draw = () => {
    const c = ref.current;
    if (!c) return;
    const W = w.image.w, H = w.image.h, k = Math.max(1, Math.min(8, Math.floor(480 / W)));
    c.width = W * k; c.height = H * k;
    const g = c.getContext('2d')!;
    w.image.px.forEach((v, i) => {
      const p = colours[v] ?? [128, 128, 128], x = (i % W) * k, y = Math.floor(i / W) * k;
      g.fillStyle = `rgb(${p[0]},${p[1]},${p[2]})`; g.fillRect(x, y, k, k);
      const m = d[i];
      if (m) { g.fillStyle = m > 0 ? `rgba(255,120,30,${Math.min(0.85, 0.25 + Math.abs(m) / cap)})` : `rgba(40,120,255,${Math.min(0.85, 0.25 + Math.abs(m) / cap)})`; g.fillRect(x, y, k, k); }
    });
    g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, k / 4); g.setLineDash([Math.max(2, k / 2), Math.max(2, k / 2)]);
    for (const i of S) { const x = (i % W) * k, y = Math.floor(i / W) * k; g.strokeRect(x + 0.5, y + 0.5, k - 1, k - 1); }
  };
  useEffect(draw); // eslint-disable-line react-hooks/exhaustive-deps

  const cell = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(w.image.w - 1, Math.floor(((e.clientX - r.left) / r.width) * w.image.w))), Math.max(0, Math.min(w.image.h - 1, Math.floor(((e.clientY - r.top) / r.height) * w.image.h)))];
  };
  const paint = (cx: number, cy: number) => {
    for (let y = cy - radius + 1; y < cy + radius; y++) for (let x = cx - radius + 1; x < cx + radius; x++) {
      if (x < 0 || y < 0 || x >= w.image.w || y >= w.image.h || (x - cx) ** 2 + (y - cy) ** 2 >= radius * radius + 0.5) continue;
      S.add(y * w.image.w + x);
    }
  };
  const onDown = (e: React.PointerEvent) => {
    ref.current!.setPointerCapture(e.pointerId);
    const [x, y] = cell(e);
    if (!e.shiftKey && mode !== 'same') S.clear();
    if (mode === 'brush') paint(x, y);
    else if (mode === 'box') drag.current = { x0: x, y0: y, x1: x, y1: y, base: new Set(S) };
    else if (mode === 'same') { if (!e.shiftKey) S.clear(); for (const i of patch(w, x, y)) S.add(i); }
    bump((n) => n + 1);
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    const [x, y] = cell(e);
    if (mode === 'brush') paint(x, y);
    else if (mode === 'box' && drag.current) {
      const b = drag.current; b.x1 = x; b.y1 = y;
      S.clear(); b.base.forEach((i) => S.add(i));
      for (let yy = Math.min(b.y0, y); yy <= Math.max(b.y0, y); yy++) for (let xx = Math.min(b.x0, x); xx <= Math.max(b.x0, x); xx++) S.add(yy * w.image.w + xx);
    }
    bump((n) => n + 1);
  };
  const onUp = () => { drag.current = null; };

  /** Set the picked pixels to `value` mm (0 removes the move). */
  const apply = (value: number) => {
    const n = nudgeOf(w);
    for (const i of S) { if (Math.abs(value) < 1e-6) delete n.d[i]; else n.d[i] = value; }
    changed();
  };
  const selectAll = () => { for (let i = 0; i < w.image.w * w.image.h; i++) S.add(i); bump((n) => n + 1); };

  return (
    <details className="mx-more" open={moved > 0 || S.size > 0}>
      <summary className="mx-label" style={{ cursor: 'pointer' }}>Move the path by hand{moved ? ` · ${moved} pixel${moved === 1 ? '' : 's'} moved` : ''}</summary>
      <div className="mx-muted" style={{ margin: 0, display: 'block' }}>Pick pixels of the picture, then push their toolpath out of the wall or pull it in. Every layer of those pixels moves together. Works on any motif or picture you load.</div>
      {stale && <div className="mx-muted bad" style={{ margin: 0, display: 'block' }}>The picture changed size, so the earlier moves no longer fit and are ignored. <button className="btn-secondary btn-small" onClick={() => { delete w.nudge; changed(); }}>Clear them</button></div>}
      <div className="seg mx-seg">
        {MODES.map(([m, l, t]) => <button key={m} className={mode === m ? 'on' : ''} title={t} onClick={() => { setMode(m); if (m === 'all') selectAll(); }}>{l}</button>)}
      </div>
      {mode === 'brush' && (
        <label className="mx-field">Brush size: {radius} px
          <input type="range" min={1} max={6} step={1} value={radius} onChange={(e) => setRadius(+e.target.value)} />
        </label>
      )}
      <div style={{ background: 'var(--panel-2, #222)', borderRadius: 6, padding: 4 }}>
        <canvas ref={ref} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          style={{ width: '100%', imageRendering: 'pixelated', aspectRatio: `${w.image.w} / ${Math.max(1, w.image.h * 0.45)}`, display: 'block', cursor: 'crosshair', touchAction: 'none' }}
          aria-label="Picture: pick pixels to move" title="Shift adds to the selection. Orange = moved out, blue = moved in." />
      </div>
      <div className="mx-muted" style={{ margin: 0, display: 'block' }}>{S.size ? `${S.size} pixel${S.size === 1 ? '' : 's'} picked` : 'Nothing picked yet'} · orange = out, blue = in</div>
      <label className="mx-field">Move picked pixels: {move > 0 ? '+' : ''}{move.toFixed(2)} mm {move > 0 ? 'out' : move < 0 ? 'in' : ''}
        <input type="range" min={-cap} max={cap} step={0.05} value={move} onChange={(e) => { const v = +e.target.value; setMove(v); if (S.size) apply(v); }} />
      </label>
      <div className="row" style={{ gap: 6, margin: 0, flexWrap: 'wrap' }}>
        <button className="btn-primary btn-small" disabled={!S.size} onClick={() => apply(move)}>Move picked</button>
        <button className="btn-secondary btn-small" disabled={!S.size} onClick={() => apply(0)} title="Put the picked pixels back on the wall">Reset picked</button>
        <button className="btn-secondary btn-small" disabled={!S.size} onClick={() => { S.clear(); bump((n) => n + 1); }}>Pick none</button>
        <button className="btn-secondary btn-small" disabled={!moved} onClick={() => { delete w.nudge; changed(); }}>Clear all moves</button>
      </div>
      {moved > 0 && <div className="mx-check"><span className={peak >= cap ? 'bad' : 'ok'}>↔</span>Largest hand move {peak.toFixed(2)} mm · total stays within {w.max_deviation_mm.toFixed(1)} mm of the wall</div>}
    </details>
  );
}
