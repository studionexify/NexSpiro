// Weave mode inside the slicer.
// prepare(): every woven layer gets its filament (the colours take turns layer by layer) through a
//            plugin region covering the whole cross-section, and each filament change gets the chosen
//            purge: full, reduced, or none at all (bleed: the new colour prints straight away).
// pass():    after toolpaths are made, each outer wall loop is pushed out where the picture shows that
//            layer's colour and pulled in where it doesn't, starts on the chosen seam line, and its start
//            and end are tucked inside the wall (lead-in from inside, tail and wipe going inside).
import type { Config } from '../../../profiles/settings';
import type { LayerOps, Op } from '../../../engine/gcode';
import type { Paths } from '../../../engine/types';
import { offset, pointIn } from '../../../engine/clipper';
import type { PluginSession, PrepareContext, RegionContribution, TransitionPlan } from '../../api';
import { cycleLayers, type WeaveSettings } from './model';
import { filamentAt, inBand, offsetAt, planLayers, signedArea, weaveLoop, type Pt, type WovenPoint } from './core';

type Move = Extract<Op, { k: 'move' }>;
const OUTER = new Set(['outer_wall', 'overhang_wall']);

export interface WeaveReport {
  wovenLayers: number;
  loops: number;
  /** Filament changes the weave asks for. */
  changes: number;
  /** Seams tucked inside the wall. */
  seamsTucked: number;
  columns: number;
  rows: number;
  /** Largest in-out step from one layer to the next (mm), against the line width. */
  swing: number;
  lineWidth: number;
}

export interface WeaveSession extends PluginSession {
  weave: { targets: (o: number) => boolean; maskAt(layer: number): Paths | null };
}

const num = (cfg: Config, k: string, d: number) => { const v = parseFloat(String(cfg[k] ?? '')); return Number.isFinite(v) ? v : d; };

/** Region and transition hooks for weave mode (colour mode needs them; mono only the target mask). */
export function weaveSession(w: WeaveSettings, ctx: PrepareContext): WeaveSession {
  const ids = new Set(w.objects ?? []);
  const targets = (o: number) => !ids.size || ids.has(ctx.meshes[o]?.id);
  const masks = new Map<number, Paths | null>();
  const session: WeaveSession = {
    weave: {
      targets,
      maskAt(layer) {
        if (!ids.size) return null;
        let m = masks.get(layer);
        if (m === undefined) {
          const all: Paths = [];
          for (let o = 0; o < ctx.meshes.length; o++) if (targets(o)) all.push(...ctx.sliceAt(o, layer));
          m = offset(all, 0.8);
          masks.set(layer, m);
        }
        return m;
      },
    },
  };
  if (w.mode !== 'colour' || w.slots.length < 2) return session;
  const usable = w.slots.every((s) => s >= 0 && s < ctx.filamentCount);
  if (!usable) { ctx.warn(`Weave: the picture uses filament slots ${w.slots.map((s) => s + 1).join(', ')} but this print has ${ctx.filamentCount}. Add the missing filaments.`); return session; }
  if (!ctx.hasAms) ctx.warn('Weave: this printer has no AMS, so every layer is a manual filament change. Use an AMS printer (A1 / P1S / X1 combo) for colour weave, or mono relief.');
  session.regionsAt = (o, layer): RegionContribution[] => {
    if (!targets(o)) return [];
    const paths = ctx.sliceAt(o, layer);
    return paths.length ? [{ regionId: 'motionex-weave', fil: filamentAt(w, ctx.layerZ, layer), paths }] : [];
  };
  session.transition = (t): TransitionPlan | undefined => {
    if (!inBand(w, ctx.layerZ[t.layer] ?? -1) || !w.slots.includes(t.to)) return undefined;
    if (w.change.mode === 'bleed') return { flushVolume: 0, skipTower: true, regionId: 'motionex-weave' };
    if (w.change.mode === 'reduced') return { flushVolume: Math.max(0, w.change.volume_mm3), regionId: 'motionex-weave' };
    return { regionId: 'motionex-weave' };
  };
  return session;
}

/** A closed outer wall loop found in a layer's moves. */
interface Loop {
  start: number; end: number;
  pts: Pt[];
  /** Feature of each segment pts[i] → pts[i + 1]. */
  feat: Move['feature'][];
  f: number[];
  z: number; w: number; h: number;
  ePerMm: number;
  area: number;
}

function findLoops(L: LayerOps): Loop[] {
  const out: Loop[] = [];
  let last: { x: number; y: number } | null = null;
  let i = 0;
  const ops = L.ops;
  while (i < ops.length) {
    const op = ops[i];
    if (op.k === 'raw' && op.resetPos) { last = null; i++; continue; }
    if (op.k !== 'move') { i++; continue; }
    if (op.travel || op.e <= 0 || !last || !OUTER.has(op.feature)) { last = { x: op.x, y: op.y }; i++; continue; }
    const pts: Pt[] = [{ ...last }], feat: Move['feature'][] = [], f: number[] = [];
    let j = i, e = 0, len = 0, z = op.z;
    while (j < ops.length) {
      const m = ops[j];
      if (m.k !== 'move' || m.travel || m.e <= 0 || !OUTER.has(m.feature)) break;
      const p = pts[pts.length - 1];
      len += Math.hypot(m.x - p.x, m.y - p.y);
      e += m.e;
      pts.push({ x: m.x, y: m.y }); feat.push(m.feature); f.push(m.f);
      z = Math.max(z, m.z);
      j++;
    }
    const a = pts[0], b = pts[pts.length - 1];
    if (pts.length > 3 && Math.hypot(a.x - b.x, a.y - b.y) < Math.max(0.1, 1.5 * op.w) && len > 1) {
      pts.pop();
      out.push({ start: i, end: j, pts, feat, f, z, w: op.w, h: op.h, ePerMm: e / len, area: signedArea(pts) });
    }
    last = { x: b.x, y: b.y };
    i = j;
  }
  return out;
}

/** Loops that sit inside a bigger loop of the same layer are holes (the inside of a tube): left alone. */
function outermost(loops: Loop[]): Loop[] {
  return loops.filter((l) => !loops.some((o) => o !== l && Math.abs(o.area) > Math.abs(l.area) && inside(l.pts[0], o.pts)));
}
function inside(p: Pt, poly: Pt[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}
const perimeter = (p: Pt[]) => p.reduce((s, q, i) => s + Math.hypot(p[(i + 1) % p.length].x - q.x, p[(i + 1) % p.length].y - q.y), 0);

/** The weave pass over the finished move list. Edits layers in place. */
export function applyWeave(layers: LayerOps[], w: WeaveSettings, cfg: Config, session: WeaveSession | undefined, warn: (m: string) => void): WeaveReport {
  const lw = num(cfg, 'outer_wall_line_width', 0) || num(cfg, 'line_width', 0.42);
  const rep: WeaveReport = { wovenLayers: 0, loops: 0, changes: 0, seamsTucked: 0, columns: w.image.w * Math.max(1, w.tiles_around), rows: w.image.h, swing: 0, lineWidth: lw };
  if (cfg.spiral_mode === true || cfg.spiral_mode === 'true') { warn('Weave: spiral vase is on. Turn it off: weave needs one closed loop per layer (and a filament change between layers).'); return rep; }
  if (num(cfg, 'wall_loops', 2) > 1) warn('Weave: works best with 1 wall. More walls sit behind the woven line and squash it where it pulls in (use "Set up print settings").');
  const idx = (li: number) => layers[li].layer ?? li;
  const target = (li: number, p: Pt) => { const m = session?.weave.maskAt(idx(li)); return !m || pointIn(p.x, p.y, m); };
  const found = layers.map((L, li) => (li === 0 ? [] : outermost(findLoops(L)).filter((l) => target(li, l.pts[0]))));
  // plan: colours by layer, rows by distance up the wall
  const zs = layers.map((L) => L.z);
  const per = found.map((ls) => (ls.length ? Math.max(...ls.map((l) => perimeter(l.pts))) : NaN));
  const plan = planLayers(w, zs, per);
  const step = Math.max(0.08, Math.min(0.25, (Math.min(...per.filter((p) => p > 0), 1e9) / Math.max(1, rep.columns)) / 6));
  const tuck = Math.max(0, w.seam.tuck_mm);
  let prevColour = -1;
  for (let li = 1; li < layers.length; li++) {
    const P = plan[li];
    if (P) { rep.wovenLayers++; if (w.mode === 'colour' && prevColour >= 0 && P.colour !== prevColour) rep.changes++; prevColour = P.colour; }
    if (!P && !w.seam.inward) continue;
    const loops = found[li];
    // from the last loop backwards so earlier op indices stay valid
    for (let n = loops.length - 1; n >= 0; n--) {
      const lp = loops[n];
      const woven = weaveLoop(lp.pts, P ? (u) => offsetAt(w, P, u) : null, step, w.smooth_mm, w.seam.angle_deg);
      if (woven.length < 4) continue;
      writeLoop(layers[li].ops, lp, woven, w.seam.inward ? tuck : 0, cfg);
      if (P) rep.loops++;
      if (w.seam.inward && tuck > 0) rep.seamsTucked++;
    }
  }
  // biggest out-to-in step between neighbouring layers: a showing line over a hidden one
  const maxMul = w.calibration ? 1.5 : 1;
  rep.swing = w.depth_mm * maxMul * (1 + w.recess);
  if (rep.swing > 0.6 * lw) warn(`Weave: lines step ${rep.swing.toFixed(2)} mm in and out between layers, more than 60% of the ${lw.toFixed(2)} mm line, so layers may not bond. Lower the depth or the pull-in.`);
  if (w.mode === 'colour' && rep.wovenLayers && cycleLayers(w) > rep.wovenLayers) warn('Weave: the woven band is shorter than one row of the picture.');
  return rep;
}

/** Replace a loop's moves with the woven loop, a lead-in from inside, a tail and wipe going inside. */
function writeLoop(ops: Op[], lp: Loop, woven: WovenPoint[], tuck: number, cfg: Config) {
  const first = ops[lp.start] as Move;
  const P0 = woven[0], n0x = P0.nx, n0y = P0.ny;
  // tangent at the seam (direction of travel)
  const t0x = woven[1].x - P0.x, t0y = woven[1].y - P0.y, tl = Math.hypot(t0x, t0y) || 1;
  const tx = t0x / tl, ty = t0y / tl;
  const S = tuck > 0 ? { x: P0.x - n0x * tuck - tx * tuck * 0.6, y: P0.y - n0y * tuck - ty * tuck * 0.6 } : { x: P0.x, y: P0.y };
  const T = tuck > 0 ? { x: P0.x - n0x * tuck + tx * tuck * 0.6, y: P0.y - n0y * tuck + ty * tuck * 0.6 } : null;
  const travelF = num(cfg, 'travel_speed', 200);
  const mv = (x: number, y: number, e: number, f: number, feature: Move['feature']): Move =>
    ({ k: 'move', x: round(x), y: round(y), z: lp.z, e: round5(e), f, feature, w: lp.w, h: lp.h, travel: false, noArc: true });
  const out: Op[] = [];
  // arrive at S, not at the old seam point on the outside of the wall
  const Q = lp.pts[0];
  let fixed = false;
  for (let k = lp.start - 1; k >= 0; k--) {
    const op = ops[k];
    if (op.k === 'raw' && op.resetPos) break;
    if (op.k !== 'move') continue;
    if (!op.travel) break;
    if (op.e < 0) break; // a wipe of the previous path: leave it
    if (Math.abs(op.x - Q.x) < 1e-3 && Math.abs(op.y - Q.y) < 1e-3) { op.x = round(S.x); op.y = round(S.y); fixed = true; } else break;
  }
  if (!fixed) out.push({ k: 'move', x: round(S.x), y: round(S.y), z: lp.z, e: 0, f: travelF, feature: 'travel', w: 0, h: lp.h, travel: true, noArc: true });
  const f0 = lp.f[0] ?? first.f;
  if (T) out.push(mv(P0.x, P0.y, Math.hypot(P0.x - S.x, P0.y - S.y) * lp.ePerMm, Math.min(f0, 30), lp.feat[0] ?? 'outer_wall'));
  for (let k = 1; k < woven.length; k++) {
    const a = woven[k - 1], b = woven[k];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    out.push(mv(b.x, b.y, len * lp.ePerMm, lp.f[b.src] ?? f0, lp.feat[b.src] ?? 'outer_wall'));
  }
  if (T) out.push(mv(T.x, T.y, Math.hypot(T.x - P0.x, T.y - P0.y) * lp.ePerMm * 0.5, Math.min(f0, 30), lp.feat[0] ?? 'outer_wall'));
  ops.splice(lp.start, lp.end - lp.start, ...out);
  // the slicer's wipe after the loop ran back along the outside: send it further inside instead
  if (!T) return;
  let at = { ...T }, was = { x: Q.x, y: Q.y };
  for (let k = lp.start + out.length; k < ops.length; k++) {
    const op = ops[k];
    if (op.k === 'retract') continue;
    if (op.k !== 'move' || !op.travel || op.e >= 0) break;
    const len = Math.hypot(op.x - was.x, op.y - was.y);
    was = { x: op.x, y: op.y };
    at = { x: at.x - n0x * len, y: at.y - n0y * len };
    op.x = round(at.x); op.y = round(at.y);
  }
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
const round5 = (v: number) => Math.round(v * 1e5) / 1e5;
