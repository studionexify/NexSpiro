// Select & apply: a full-screen window over NexSpiro, opened from the Motionex tab. It shows the sliced print as
// its real lines (orbit, pan, zoom, cut away from the top) and lets the user pick layer ranges, single lines or
// brush an area, then choose what changes there: filament, a motion, speed, flow, temperature. Every rule lives
// here; the slicer applies them (select/engine.ts) and the window shows the same selection the slicer uses.
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import * as THREE from 'three';
import { useStore } from '../../../state/store';
import { currentConfig, plateMeshes, plateObjects, sliceNow } from '../../../state/slicing';
import { changerOf } from '../../../profiles/changer';
import { MOVE_STRIDE } from '../../../engine/gcode';
import type { SliceOutput } from '../../../engine/types';
import { changed, mx, useMx } from './MotionexPanel';
import { describePick, featuresOf, LINE_GROUPS, newRule, pickEmpty, ruleActive, type LineGroup, type PickKind, type SelectRule } from '../select/model';
import { piecesAt, weightAt, type Piece } from '../select/geometry';
import { objectAnchors } from '../select/engine';
import { FEATURE_RGB, featureName, hexRgb, runOf, segmentsOf, SelectView } from './selectView';

let isOpen = false;
const listeners = new Set<() => void>();
export function openSelectWindow(open = true) { isOpen = open; listeners.forEach((l) => l()); }
const useOpen = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => isOpen);

export function SelectWindowHost() {
  const open = useOpen();
  const installed = useStore((s) => s.plugins.includes('motionex'));
  if (!open || !installed || typeof document === 'undefined') return null;
  return createPortal(<SelectWindow />, document.body);
}

type Tool = 'orbit' | 'layers' | 'lines' | 'brush';
const TOOLS: [Tool, string, string][] = [
  ['orbit', 'Look', 'Left drag turns the view, right drag moves it, the wheel zooms'],
  ['layers', 'Layers', 'Click a line to choose its layer; Shift+click another to choose every layer between. Or drag on the height ruler'],
  ['lines', 'Lines', 'Click a printed line to add it; click it again to take it out'],
  ['brush', 'Brush', 'Drag over the print to paint an area; hold Alt to erase'],
];
const KIND_OF: Record<Exclude<Tool, 'orbit'>, PickKind> = { layers: 'layers', lines: 'lines', brush: 'brush' };
const ACTIVE = hexRgb('#ff3d7f'), OTHER = hexRgb('#4f8cff');

interface ObjBox { id: string; name: string; min: [number, number, number]; max: [number, number, number] }

function objectInfo(): { boxes: ObjBox[]; now: Record<string, [number, number]> } {
  try {
    const meshes = plateMeshes(plateObjects().filter((o) => o.printable !== false));
    const boxes = meshes.map((m) => {
      const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < m.vertices.length; k += 3) for (let a = 0; a < 3; a++) { const v = m.vertices[k + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
      return { id: m.id, name: m.name, min, max };
    });
    return { boxes, now: objectAnchors(meshes) };
  } catch { return { boxes: [], now: {} }; }
}

const objAt = (boxes: ObjBox[], x: number, y: number, z: number) =>
  boxes.find((b) => x >= b.min[0] - 0.6 && x <= b.max[0] + 0.6 && y >= b.min[1] - 0.6 && y <= b.max[1] + 0.6 && z >= b.min[2] - 0.6 && z <= b.max[2] + 0.6)?.id;

/** Makes the rule's selection of this kind, asking before a selection of another kind is thrown away. */
function ensureKind(r: SelectRule, kind: PickKind): boolean {
  if (r.pick.kind === kind) return true;
  if (!pickEmpty(r.pick) && !confirm(`"${r.name}" has a ${r.pick.kind} selection. Replace it with a ${kind} selection?`)) return false;
  r.pick = kind === 'layers' ? { kind, z0: 0, z1: 0 } : kind === 'lines' ? { kind, lines: [] } : { kind, dabs: [] };
  return true;
}

function SelectWindow() {
  useMx();
  const result = useStore((s) => s.slice.result);
  const status = useStore((s) => s.slice.status);
  const progress = useStore((s) => s.slice.progress);
  const dirty = useStore((s) => s.slice.dirty);
  const filaments = useStore((s) => s.filaments);
  const theme = useStore((s) => s.theme);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<SelectView | null>(null);
  const [tool, setTool] = useState<Tool>('lines');
  const [brushR, setBrushR] = useState(1.5);
  const [colorBy, setColorBy] = useState<'feature' | 'filament'>('feature');
  const [activeId, setActiveId] = useState<string | null>(mx.rules[0]?.id ?? null);
  const [cutLayer, setCutLayer] = useState<number>(Infinity);
  const [oneObject, setOneObject] = useState(false);
  const [info, setInfo] = useState(objectInfo);
  const rule = mx.rules.find((r) => r.id === activeId) ?? null;

  // slice when the window opens with nothing (or something out of date) to show
  useEffect(() => {
    const s = useStore.getState().slice;
    if (s.status !== 'slicing' && (!s.result || s.dirty)) void sliceNow();
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) openSelectWindow(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  useEffect(() => {
    const v = new SelectView(host.current!);
    view.current = v;
    return () => { v.dispose(); view.current = null; };
  }, []);
  useEffect(() => { view.current?.setBackground(getComputedStyle(document.body).getPropertyValue('--surface-primary').trim() || (theme === 'light' ? '#f4f4f6' : '#16181d')); }, [theme]);
  useEffect(() => { view.current?.setPickMode(tool !== 'orbit'); if (tool !== 'brush') view.current?.showBrush(null); }, [tool]);

  const segs = useMemo(() => (result ? segmentsOf(result) : null), [result]);
  const had = useRef(false);
  useEffect(() => {
    if (!segs || !view.current) return;
    view.current.setData(segs, had.current);
    had.current = true;
    setInfo(objectInfo());
  }, [segs]);

  const layers = result?.layers ?? [];
  const top = Math.max(0, layers.length - 1);
  const cut = Math.min(cutLayer, top);
  const cutZ = layers[cut]?.z ?? 1e4;
  useEffect(() => { view.current?.setCut(cutZ); }, [cutZ, segs]);

  // colours: line kind or filament, the active rule in pink and the others in blue, both fading with the blend
  const rulesKey = JSON.stringify(mx.rules);
  useEffect(() => {
    const v = view.current;
    if (!v || !segs || !result) return;
    const fil = filaments.map((f) => hexRgb(f.color));
    const live = mx.rules.filter((r) => r.enabled && !pickEmpty(r.pick));
    const feats = live.map((r) => featuresOf(r.lines));
    const cache = new Map<number, Piece[][]>();
    const pieces = (li: number) => {
      let p = cache.get(li);
      if (!p) { const L = layers[li]; p = live.map((r) => piecesAt(r, L.z, L.height, info.now)); cache.set(li, p); }
      return p;
    };
    const boxOf = new Map(info.boxes.map((b) => [b.id, b]));
    const P = segs.pos;
    v.paint((s, out, at) => {
      const base = colorBy === 'filament' ? fil[segs.tool[s]] ?? fil[0] ?? [0.8, 0.8, 0.8] : FEATURE_RGB[segs.feature[s]] ?? [0.7, 0.7, 0.7];
      let r = base[0] * 0.55, g = base[1] * 0.55, b = base[2] * 0.55;
      if (live.length) {
        const ps = pieces(segs.layer[s]);
        const x = (P[s * 6] + P[s * 6 + 3]) / 2, y = (P[s * 6 + 1] + P[s * 6 + 4]) / 2;
        const f = featureName(segs.feature[s]);
        live.forEach((rl, k) => {
          if (!ps[k].length || !feats[k].has(f)) return;
          const w = weightAt(ps[k], rl.blend_mm, x, y, f, (id) => { const bx = boxOf.get(id); return !bx || (x >= bx.min[0] - 0.6 && x <= bx.max[0] + 0.6 && y >= bx.min[1] - 0.6 && y <= bx.max[1] + 0.6); });
          if (w <= 0) return;
          const c = rl.id === activeId ? ACTIVE : OTHER, m = rl.id === activeId ? w : w * 0.7;
          r += (c[0] - r) * m; g += (c[1] - g) * m; b += (c[2] - b) * m;
        });
      }
      out[at] = r; out[at + 1] = g; out[at + 2] = b;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segs, rulesKey, activeId, colorBy, filaments, info]);

  const addRule = () => {
    const r = newRule(mx.rules.length + 1);
    if (tool !== 'orbit') r.pick = KIND_OF[tool] === 'layers' ? { kind: 'layers', z0: 0, z1: 0 } : KIND_OF[tool] === 'lines' ? { kind: 'lines', lines: [] } : { kind: 'brush', dabs: [] };
    mx.rules.push(r);
    setActiveId(r.id);
    changed();
    return r;
  };
  const target = () => rule ?? addRule();

  // ---- picking on the 3D view
  const painting = useRef<{ erase: boolean; last: THREE.Vector3 | null } | null>(null);
  const hoverRaf = useRef(0);
  const anchor = (r: SelectRule, obj: string | undefined) => { if (obj && info.now[obj] && !r.anchors[obj]) r.anchors[obj] = [...info.now[obj]]; };

  const dab = (r: SelectRule, p: THREE.Vector3, erase: boolean) => {
    if (r.pick.kind !== 'brush') return;
    if (erase) { r.pick.dabs = r.pick.dabs.filter((d) => Math.hypot(d.x - p.x, d.y - p.y, d.z - p.z) > brushR); return; }
    const obj = objAt(info.boxes, p.x, p.y, p.z);
    anchor(r, obj);
    r.pick.dabs.push({ obj, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), r: brushR });
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || tool === 'orbit' || !result || !segs || !view.current) return;
    const hit = view.current.pick(e.clientX, e.clientY, cutZ);
    if (tool === 'brush') {
      const r = target();
      if (!ensureKind(r, 'brush')) return;
      painting.current = { erase: e.altKey, last: hit?.point ?? null };
      if (hit) dab(r, hit.point, e.altKey);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      changed();
      return;
    }
    if (!hit) return;
    const r = target();
    const move = segs.move[hit.seg], li = segs.layer[hit.seg], L = layers[li];
    if (tool === 'layers') {
      if (!ensureKind(r, 'layers') || r.pick.kind !== 'layers') return;
      const obj = oneObject ? objAt(info.boxes, hit.point.x, hit.point.y, hit.point.z) : undefined;
      if (e.shiftKey && !pickEmpty(r.pick)) { r.pick.z0 = Math.min(r.pick.z0, L.z); r.pick.z1 = Math.max(r.pick.z1, L.z); }
      else { r.pick.z0 = L.z; r.pick.z1 = L.z; }
      r.pick.obj = obj;
      anchor(r, obj);
      changed();
      return;
    }
    if (!ensureKind(r, 'lines') || r.pick.kind !== 'lines') return;
    const { from, to } = runOf(result, move);
    const pts: [number, number][] = [];
    for (let k = Math.max(0, from - 1); k <= to; k++) pts.push([+result.moves[k * MOVE_STRIDE].toFixed(3), +result.moves[k * MOVE_STRIDE + 1].toFixed(3)]);
    const feature = featureName(result.moveFeatures[move]);
    const w = result.moves[move * MOVE_STRIDE + 3] || 0.42;
    const p = hit.point;
    const same = r.pick.lines.findIndex((l) => Math.abs(l.z - L.z) < 1e-3 && l.feature === feature && l.pts.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < Math.max(w, 0.5)));
    if (same >= 0) r.pick.lines.splice(same, 1);
    else {
      const obj = objAt(info.boxes, p.x, p.y, p.z);
      anchor(r, obj);
      // long lines are thinned to every 0.2 mm or so: picks stay small in the project file
      const thin = pts.filter((q, k) => k === 0 || k === pts.length - 1 || Math.hypot(q[0] - pts[k - 1][0], q[1] - pts[k - 1][1]) > 0.05);
      r.pick.lines.push({ obj, z: +L.z.toFixed(4), h: +L.height.toFixed(4), feature, w: +w.toFixed(3), pts: thin });
    }
    changed();
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (tool !== 'brush' || !view.current) return;
    const x = e.clientX, y = e.clientY, down = painting.current, alt = e.altKey;
    cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = requestAnimationFrame(() => {
      const v = view.current;
      if (!v) return;
      const hit = v.pick(x, y, cutZ);
      v.showBrush(hit?.point ?? null, brushR);
      if (!down || !hit || !rule || rule.pick.kind !== 'brush') return;
      if (down.last && hit.point.distanceTo(down.last) < brushR * 0.5) return;
      down.last = hit.point.clone();
      dab(rule, hit.point, alt || down.erase);
      changed();
    });
  };
  const onUp = () => { painting.current = null; };

  // ---- height ruler: drag to choose a layer range for the active rule
  const ruler = useRef<HTMLDivElement>(null);
  const zMax = layers[top]?.z ?? 1;
  const zFromY = (clientY: number) => {
    const b = ruler.current!.getBoundingClientRect();
    const z = (1 - (clientY - b.top) / b.height) * zMax;
    // snap to the nearest layer top
    let best = layers[0]?.z ?? 0;
    for (const L of layers) if (Math.abs(L.z - z) < Math.abs(best - z)) best = L.z;
    return best;
  };
  const rulerDrag = useRef<number | null>(null);
  const onRulerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!layers.length) return;
    const r = target();
    if (!ensureKind(r, 'layers') || r.pick.kind !== 'layers') return;
    const z = zFromY(e.clientY);
    rulerDrag.current = z;
    r.pick.z0 = z; r.pick.z1 = z;
    setTool('layers');
    (e.target as Element).setPointerCapture?.(e.pointerId);
    changed();
  };
  const onRulerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (rulerDrag.current === null || !rule || rule.pick.kind !== 'layers') return;
    const z = zFromY(e.clientY), a = rulerDrag.current;
    rule.pick.z0 = Math.min(a, z); rule.pick.z1 = Math.max(a, z);
    changed();
  };
  const band = rule?.pick.kind === 'layers' && !pickEmpty(rule.pick) ? rule.pick : null;

  const cost = useMemo(() => estimateCost(mx.rules, result, info.now, filaments.length), [rulesKey, result, info, filaments.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mxw-back" role="dialog" aria-label="Select and apply">
      <div className="mxw sxw">
        <header className="mxw-head">
          <b>Select &amp; apply</b>
          <span className="sxw-hint">{TOOLS.find((t) => t[0] === tool)?.[2]}</span>
          <span style={{ flex: 1 }} />
          {status === 'slicing' ? <span className="sxw-status">Slicing… {Math.round(progress * 100)}%</span>
            : <button className="btn-secondary btn-small" onClick={() => void sliceNow()} title="Slice again with the rules, to see them on the lines and the real time and filament">{dirty ? 'Re-slice to see changes' : 'Re-slice'}</button>}
          <button className="btn-primary btn-small" onClick={() => openSelectWindow(false)}>Done</button>
        </header>
        <div className="sxw-body">
          <aside className="sxw-side">
            <div className="sxw-sec">
              <div className="sxw-title">Rules<span style={{ flex: 1 }} /><button className="btn-secondary btn-small" onClick={addRule}>New rule</button></div>
              {!mx.rules.length && <p className="sxw-muted">Make a rule, choose Layers, Lines or Brush above the view, and pick on the print. Then choose what changes there.</p>}
              <div className="sxw-rules">
                {mx.rules.map((r, i) => (
                  <div key={r.id} className={`sxw-rule${r.id === activeId ? ' on' : ''}${ruleActive(r) ? '' : ' idle'}`} onClick={() => setActiveId(r.id)}>
                    <input type="checkbox" checked={r.enabled} aria-label="Rule on" onClick={(e) => e.stopPropagation()} onChange={(e) => { r.enabled = e.target.checked; changed(); }} />
                    <div className="sxw-rule-text"><b>{r.name}</b><span>{describePick(r.pick)} · {summary(r, filaments.length)}</span></div>
                    <div className="sxw-rule-btns">
                      <button disabled={i === 0} onClick={(e) => { e.stopPropagation(); mx.rules.splice(i - 1, 0, ...mx.rules.splice(i, 1)); changed(); }} title="Earlier: rules lower in the list win where they set the same thing">Up</button>
                      <button disabled={i === mx.rules.length - 1} onClick={(e) => { e.stopPropagation(); mx.rules.splice(i + 1, 0, ...mx.rules.splice(i, 1)); changed(); }}>Down</button>
                      <button onClick={(e) => { e.stopPropagation(); if (!confirm(`Delete "${r.name}"?`)) return; mx.rules.splice(i, 1); if (r.id === activeId) setActiveId(mx.rules[0]?.id ?? null); changed(); }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {rule && <RuleEditor r={rule} oneObject={oneObject} setOneObject={setOneObject} />}
          </aside>
          <main className="sxw-main">
            <div className="sxw-tools">
              {TOOLS.map(([t, label, tip]) => <button key={t} className={`sxw-tool${tool === t ? ' on' : ''}`} onClick={() => setTool(t)} title={tip}>{label}</button>)}
              {tool === 'brush' && <label className="sxw-inline">Brush size<input type="range" min={0.3} max={10} step={0.1} value={brushR} onChange={(e) => setBrushR(+e.target.value)} /><span>{brushR.toFixed(1)} mm</span></label>}
              {tool === 'layers' && <label className="sxw-inline"><input type="checkbox" checked={oneObject} onChange={(e) => setOneObject(e.target.checked)} />Only the clicked object</label>}
              <span style={{ flex: 1 }} />
              <label className="sxw-inline">Colour by
                <select className="select" value={colorBy} onChange={(e) => setColorBy(e.target.value as 'feature' | 'filament')}><option value="feature">Line kind</option><option value="filament">Filament</option></select>
              </label>
              {(['front', 'right', 'back', 'left', 'top'] as const).map((s) => <button key={s} className="sxw-tool" onClick={() => view.current?.look(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
              <button className="sxw-tool" onClick={() => view.current?.frame()}>Fit</button>
            </div>
            <div className="sxw-stage">
              <div ref={host} className={`sxw-canvas tool-${tool}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => view.current?.showBrush(null)} onContextMenu={(e) => e.preventDefault()} />
              {!result && <div className="sxw-empty">{status === 'slicing' ? 'Slicing the plate to show its lines…' : 'Nothing sliced yet. Add a model to the plate, then Re-slice.'}</div>}
              <div className="sxw-rails">
                <div className="sxw-rail">
                  <span>Cut</span>
                  <input type="range" className="sxw-vrange" min={0} max={top} value={cut} onChange={(e) => setCutLayer(+e.target.value >= top ? Infinity : +e.target.value)} aria-label="Hide layers above" />
                  <span>{layers[cut] ? `${cut + 1}` : ''}</span>
                </div>
                <div className="sxw-rail">
                  <span>Layers</span>
                  <div ref={ruler} className="sxw-ruler" onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={() => { rulerDrag.current = null; }} title="Drag to choose a range of layers for the selected rule">
                    {band && <div className="sxw-band" style={{ bottom: `${(Math.min(band.z0, band.z1) / zMax) * 100}%`, height: `${Math.max(0.6, ((Math.abs(band.z1 - band.z0)) / zMax) * 100)}%` }} />}
                    <div className="sxw-cutmark" style={{ bottom: `${(cutZ / zMax) * 100}%` }} />
                  </div>
                  <span>{zMax.toFixed(1)}</span>
                </div>
              </div>
            </div>
            <footer className="sxw-cost">
              <span><b>Estimate</b> for the rules{cost.layers ? ` (${cost.layers} layers touched)` : ''}:</span>
              <span>{cost.swaps ? `+${cost.swaps} filament ${cost.kind === 'toolchanger' ? 'head swaps' : 'changes'}` : 'no extra filament changes'}</span>
              {cost.swaps > 0 && <span>+{fmtTime(cost.seconds)}</span>}
              {cost.swaps > 0 && <span>{cost.purgeG > 0 ? `+${cost.purgeG.toFixed(1)} g purged` : 'no purge (tool changer)'}</span>}
              {cost.missing > 0 && <span className="sxw-warn">{cost.missing} rule{cost.missing > 1 ? 's use' : ' uses'} a filament that is not loaded: add it in the filament list</span>}
              {cost.kind === 'manual' && cost.swaps > 0 && <span className="sxw-warn">this printer changes filament by hand: {cost.swaps} pauses</span>}
              <span style={{ flex: 1 }} />
              {result && <span className="sxw-actual" title={dirty ? 'From the last slice, which is out of date' : 'From the last slice'}>{dirty ? 'Last slice' : 'Sliced'}: {fmtTime(result.stats.timeSeconds)} · {result.stats.toolChanges} changes · {(result.stats.flushGrams ?? 0).toFixed(1)} g purge · {result.stats.towerGrams.toFixed(1)} g tower</span>}
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}

const fmtTime = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

function summary(r: SelectRule, nFil: number): string {
  const a = r.apply, out: string[] = [];
  if (a.filament !== undefined) out.push(`filament ${a.filament + 1}${a.filament >= nFil ? ' (not loaded)' : ''}`);
  if (a.motion) out.push(mx.library.get(a.motion.brush_id)?.name ?? 'motion');
  if (a.speed !== undefined && a.speed !== 100) out.push(`speed ${a.speed}%`);
  if (a.flow !== undefined && a.flow !== 100) out.push(`flow ${a.flow}%`);
  if (a.temp !== undefined) out.push(`${a.temp} °C`);
  return out.length ? out.join(', ') : 'nothing to change yet';
}

/** Extra filament changes the rules cause on the last slice: whole layers change twice at the range ends, part layers twice per layer. */
function estimateCost(rules: SelectRule[], r: SliceOutput | null, now: Record<string, [number, number]>, loaded: number) {
  const cfg = currentConfig() as Record<string, unknown>;
  const kind = changerOf(cfg as never);
  const out = { swaps: 0, seconds: 0, purgeG: 0, layers: 0, kind, missing: 0 };
  if (!r) return out;
  out.missing = rules.filter((x) => ruleActive(x) && (x.apply.filament ?? -1) >= loaded).length;
  const fil = rules.filter((x) => ruleActive(x) && x.apply.filament !== undefined && x.apply.filament < loaded);
  if (!fil.length) return out;
  let prevWhole = new Set<string>();
  for (const L of r.layers) {
    const whole = new Set<string>();
    let touched = false;
    for (const x of fil) {
      const ps = piecesAt(x, L.z, L.height, now, true).filter((p) => p.zf >= 1);
      if (!ps.length) continue;
      touched = true;
      if (ps.some((p) => !p.polys) && !x.lines.length) { whole.add(x.id); if (!prevWhole.has(x.id)) out.swaps += 2; }
      else out.swaps += 2;
    }
    if (touched) out.layers++;
    prevWhole = whole;
  }
  const n = (k: string, d: number) => { const v = Number(cfg[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  out.seconds = out.swaps * n('filament_change_time', kind === 'toolchanger' ? 8 : 60);
  const vol = kind === 'toolchanger' ? n('tool_prime_volume', 0) : n('flush_volume', 140);
  out.purgeG = kind === 'toolchanger' && !cfg.tool_prime_volume ? 0 : (out.swaps * vol * n('filament_density', 1.24)) / 1000;
  return out;
}

function Num({ label, value, unit, min, max, step = 1, onChange, title }: { label: string; value: number | undefined; unit: string; min: number; max: number; step?: number; onChange(v: number | undefined): void; title?: string }) {
  const on = value !== undefined;
  return (
    <div className="sxw-row" title={title}>
      <label className="sxw-check"><input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? (unit === '%' ? 100 : unit === '°C' ? 220 : min) : undefined)} />{label}</label>
      <input className="input" type="number" disabled={!on} min={min} max={max} step={step} value={on ? value : ''} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v))); }} />
      <span className="sxw-unit">{unit}</span>
    </div>
  );
}

function RuleEditor({ r, oneObject, setOneObject }: { r: SelectRule; oneObject: boolean; setOneObject(v: boolean): void }) {
  const filaments = useStore((s) => s.filaments);
  const set = (f: () => void) => { f(); changed(); };
  const brushes = mx.library.all();
  const groups = [...new Set(brushes.map((b) => b.category ?? 'Motions'))];
  const p = r.pick;
  return (
    <div className="sxw-sec sxw-edit">
      <div className="sxw-title">Selected rule</div>
      <div className="sxw-row"><span className="sxw-lbl">Name</span><input className="input" value={r.name} onChange={(e) => set(() => { r.name = e.target.value; })} /></div>
      <div className="sxw-row"><span className="sxw-lbl">Selection</span><span className="sxw-val">{describePick(p)}</span>
        <button className="btn-secondary btn-small" disabled={pickEmpty(p)} onClick={() => set(() => { r.pick = p.kind === 'layers' ? { kind: 'layers', z0: 0, z1: 0 } : p.kind === 'lines' ? { kind: 'lines', lines: [] } : { kind: 'brush', dabs: [] }; r.anchors = {}; })}>Clear</button>
      </div>
      {p.kind === 'layers' && <>
        <div className="sxw-row"><span className="sxw-lbl">From</span><input className="input" type="number" step={0.01} value={p.z0} onChange={(e) => set(() => { p.z0 = +e.target.value || 0; })} /><span className="sxw-unit">mm</span></div>
        <div className="sxw-row"><span className="sxw-lbl">To</span><input className="input" type="number" step={0.01} value={p.z1} onChange={(e) => set(() => { p.z1 = +e.target.value || 0; })} /><span className="sxw-unit">mm</span></div>
        <div className="sxw-row"><label className="sxw-check"><input type="checkbox" checked={!!p.obj} disabled={!p.obj && !oneObject} onChange={(e) => set(() => { if (!e.target.checked) { p.obj = undefined; setOneObject(false); } })} />{p.obj ? 'Only on one object' : 'On every object'}</label></div>
      </>}
      <div className="sxw-sub">Line kinds</div>
      <div className="sxw-chips">
        <button className={!r.lines.length ? 'on' : ''} onClick={() => set(() => { r.lines = []; })}>All</button>
        {LINE_GROUPS.map(([g, label]) => <button key={g} className={r.lines.includes(g) ? 'on' : ''} onClick={() => set(() => { r.lines = r.lines.includes(g) ? r.lines.filter((x) => x !== g) : [...r.lines, g as LineGroup]; })}>{label}</button>)}
      </div>
      <div className="sxw-sub">Change there</div>
      <div className="sxw-row"><span className="sxw-lbl">Filament</span>
        <select className="select" value={r.apply.filament ?? ''} onChange={(e) => set(() => { r.apply.filament = e.target.value === '' ? undefined : +e.target.value; })}>
          <option value="">Keep as sliced</option>
          {filaments.map((f, k) => <option key={k} value={k}>Filament {k + 1} ({f.color})</option>)}
          {filaments.length < 4 && Array.from({ length: 4 - filaments.length }, (_, j) => <option key={`x${j}`} value={filaments.length + j}>Filament {filaments.length + j + 1} (not loaded)</option>)}
        </select>
        {r.apply.filament !== undefined && <span className="sxw-swatch" style={{ background: filaments[r.apply.filament]?.color ?? 'transparent' }} />}
      </div>
      <div className="sxw-row"><span className="sxw-lbl">Motion</span>
        <select className="select" value={r.apply.motion?.brush_id ?? ''} onChange={(e) => set(() => { r.apply.motion = e.target.value ? { brush_id: e.target.value, scale: r.apply.motion?.scale ?? 1 } : undefined; })}>
          <option value="">None</option>
          {groups.map((g) => <optgroup key={g} label={g}>{brushes.filter((b) => (b.category ?? 'Motions') === g).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>)}
        </select>
      </div>
      {r.apply.motion && <div className="sxw-row"><span className="sxw-lbl">Motion size</span><input type="range" min={0.2} max={3} step={0.05} value={r.apply.motion.scale} onChange={(e) => set(() => { r.apply.motion!.scale = +e.target.value; })} /><span className="sxw-unit">×{r.apply.motion.scale.toFixed(2)}</span></div>}
      <Num label="Speed" value={r.apply.speed} unit="%" min={10} max={300} onChange={(v) => set(() => { r.apply.speed = v; })} />
      <Num label="Flow" value={r.apply.flow} unit="%" min={10} max={200} onChange={(v) => set(() => { r.apply.flow = v; })} />
      <Num label="Temperature" value={r.apply.temp} unit="°C" min={150} max={320} onChange={(v) => set(() => { r.apply.temp = v; })} title="Set per layer: a hotend needs 10–30 s to settle, so it cannot change for single lines" />
      <div className="sxw-row" title="Speed, flow and motion fade in and out over this distance around the selection, along the layer and up and down. Filament changes are always sharp."><span className="sxw-lbl">Soft edge</span><input className="input" type="number" min={0} max={20} step={0.5} value={r.blend_mm} onChange={(e) => set(() => { r.blend_mm = Math.max(0, Math.min(20, +e.target.value || 0)); })} /><span className="sxw-unit">mm</span></div>
      <p className="sxw-muted">Rules lower in the list win where two set the same thing; different changes add up.</p>
    </div>
  );
}
