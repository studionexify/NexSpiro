// Motion model of the planar slicer: turns a PlanarPlan into an explicit move list (travel, retraction, z-hop, wipe, extrusion),
// estimates time with an acceleration-limited look-ahead planner and applies the per-layer cooling rules. Shared by the G-code writer and the preview.
import { Feature } from "./types.ts";
import type { Path, Layer, PlanarJob, PlanarPlan } from "./types.ts";
import { getSetting } from "../settings.ts";
import type { MachinePreset, FilamentPreset, ProcessPreset } from "../presets.ts";

// ---------------------------------------------------------------- context & settings
export type MotionCtx = {
  job: PlanarJob; M: MachinePreset; F: FilamentPreset; P: ProcessPreset; flavor: string;
  num: (key: string) => number; bool: (key: string) => boolean;
  filArea: number;            // filament cross-section, mm²
  flowMul: number;            // print_flow_ratio × filament.flowRatio
  pfr: number;                // print_flow_ratio
  travelSpeed: number; travelAccel: number; travelJerk: number;
  pa: number;                 // pressure advance K (0 = off)
};

export function makeCtx(job: PlanarJob): MotionCtx {
  const M = job.machine, F = job.filament, P = job.process;
  const raw = (k: string) => (job.settings && k in job.settings ? job.settings[k] : getSetting(P, k));
  const num = (k: string) => { const v = raw(k); return typeof v === "number" ? v : Number(v) || 0; };
  const bool = (k: string) => { const v = raw(k); return v === true || v === "true" || v === 1 || v === "1"; };
  const pfr = num("print_flow_ratio") || 1;
  const ts = Math.min(num("travel_speed") || M.travelSpeed || 150, M.travelSpeed > 0 ? M.travelSpeed : Infinity, M.maxSpeedXY > 0 ? M.maxSpeedXY : Infinity);
  const poVerride = num("pressure_advance_override");
  const pa = poVerride > 0 ? poVerride : F.pressureAdvance > 0 ? F.pressureAdvance : M.pressureAdvanceDefault > 0 ? M.pressureAdvanceDefault : 0;
  return {
    job, M, F, P, flavor: M.flavor, num, bool, pfr, flowMul: pfr * F.flowRatio, pa,
    filArea: Math.PI * (F.diameter / 2) ** 2,
    travelSpeed: ts, travelAccel: num("travel_acceleration") || num("default_acceleration") || 5000, travelJerk: num("travel_jerk"),
  };
}

/** Rounded-end cross-section like Bambu/Orca: (w−h)·h + π(h/2)². */
export function crossSection(width: number, height: number): number {
  const h = Math.min(height, width);
  return (width - h) * h + (Math.PI * h * h) / 4;
}

/** Acceleration for a feature (mm/s²). */
export function accelFor(ctx: MotionCtx, feature: number, first: boolean, pathAccel?: number): number {
  if (pathAccel && pathAccel > 0) return pathAccel;
  const def = ctx.num("default_acceleration") || 5000;
  if (first) return ctx.num("initial_layer_acceleration") || def;
  switch (feature) {
    case Feature.OuterWall: case Feature.OverhangWall: return ctx.num("outer_wall_acceleration") || def;
    case Feature.InnerWall: return ctx.num("inner_wall_acceleration") || def;
    case Feature.TopSurface: case Feature.Ironing: return ctx.num("top_surface_acceleration") || def;
    case Feature.SparseInfill: return def * ((ctx.num("sparse_infill_acceleration") || 100) / 100);
    case Feature.Bridge: return def * ((ctx.num("bridge_acceleration") || 100) / 100);
    case Feature.Travel: return ctx.travelAccel;
    default: return def;
  }
}
/** Configured XY jerk for a feature (0 = leave firmware default). */
export function jerkFor(ctx: MotionCtx, feature: number, first: boolean): number {
  if (feature === Feature.Travel) return ctx.travelJerk;
  if (first) return ctx.num("initial_layer_jerk");
  switch (feature) {
    case Feature.OuterWall: case Feature.OverhangWall: return ctx.num("outer_wall_jerk");
    case Feature.InnerWall: return ctx.num("inner_wall_jerk");
    case Feature.SparseInfill: case Feature.InternalSolid: case Feature.GapFill: case Feature.Bridge: return ctx.num("infill_jerk");
    case Feature.TopSurface: case Feature.Ironing: return ctx.num("top_surface_jerk");
    default: return ctx.num("default_jerk");
  }
}
const effJerk = (ctx: MotionCtx, j: number) => (j > 0 ? j : ctx.M.maxJerk > 0 ? ctx.M.maxJerk : 9);

// ---------------------------------------------------------------- per-segment speed
/** Number of segments of a path (closed loops include the closing segment). */
export function pathSegCount(p: Path): number {
  const n = p.xyz.length / 3;
  return n < 2 ? 0 : p.closed ? n : n - 1;
}
/** Per-segment extrusion multiplier from Path.flowScale (mean of the end points; 1 when absent). */
export function segFlow(p: Path, k: number): number {
  const fs = p.flowScale;
  if (!fs) return 1;
  const n = p.xyz.length / 3, i1 = (k + 1) % n;
  return fs.length > Math.max(k, i1) ? (fs[k] + fs[i1]) / 2 : 1;
}
/** Cruise speed (mm/s) of segment k before layer slowdown: path speed × speedScale, volumetric / XY / Z limits. */
export function segCruise(ctx: MotionCtx, p: Path, k: number, len3: number, dz: number): number {
  const n = p.xyz.length / 3, i0 = k, i1 = (k + 1) % n;
  let v = p.speed > 0 ? p.speed : ctx.travelSpeed;
  const sc = p.speedScale;
  if (sc && sc.length > Math.max(i0, i1)) v *= (sc[i0] + sc[i1]) / 2;
  if (p.feature !== Feature.Travel) {
    const vpm = crossSection(p.width, p.height) * (p.flow || 1) * segFlow(p, k) * ctx.pfr;
    if (ctx.F.maxVolumetric > 0 && vpm > 0) v = Math.min(v, ctx.F.maxVolumetric / vpm);
  }
  if (ctx.M.maxSpeedXY > 0) v = Math.min(v, ctx.M.maxSpeedXY);
  if (len3 > 1e-9 && Math.abs(dz) > 1e-9 && ctx.M.maxZSpeed > 0) v = Math.min(v, (ctx.M.maxZSpeed * len3) / Math.abs(dz));
  return Math.max(v, 0.5);
}
/** Speed after the layer slowdown factor, never below filament.minSpeed (unless already slower). */
export const slowed = (v: number, factor: number, minSpeed: number) => (factor >= 1 ? v : Math.max(Math.min(v, minSpeed), v * factor));

// ---------------------------------------------------------------- look-ahead time model
/** Junction speed from the angle between two directions (dot = cos of the direction change), Marlin junction deviation with δ = 0.4·J²/a. */
export function junctionSpeed(dot: number, jerk: number, vmax: number): number {
  const s = Math.sqrt(Math.max(0, (1 + dot) / 2));
  if (s > 0.9999) return vmax;
  return Math.min(vmax, Math.sqrt(0.4) * jerk * Math.sqrt(s / (1 - s)));
}
/**
 * Trapezoid time of a chain of n moves (typed arrays). Items with `fixed[i] > 0` or `len[i] <= 0` stop the chain (time = fixed[i]).
 * vin is an optional scratch of length ≥ n+1.
 */
export function chainTimes(n: number, len: Float64Array, ux: Float64Array, uy: Float64Array, uz: Float64Array, vmax: Float64Array,
  acc: Float64Array, jerk: Float64Array, fixed: Float64Array, out: Float64Array, vin?: Float64Array): void {
  const v = vin && vin.length >= n + 1 ? vin : new Float64Array(n + 1);
  const motion = (i: number) => fixed[i] <= 0 && len[i] > 0;
  v[0] = 0; v[n] = 0;
  for (let i = 1; i < n; i++) {
    if (!motion(i - 1) || !motion(i)) { v[i] = 0; continue; }
    const dot = ux[i - 1] * ux[i] + uy[i - 1] * uy[i] + uz[i - 1] * uz[i];
    v[i] = junctionSpeed(dot, Math.min(jerk[i - 1], jerk[i]), Math.min(vmax[i - 1], vmax[i]));
  }
  for (let i = n - 1; i >= 0; i--) if (motion(i)) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * acc[i] * len[i]));
  for (let i = 0; i < n; i++) if (motion(i)) v[i + 1] = Math.min(v[i + 1], Math.sqrt(v[i] * v[i] + 2 * acc[i] * len[i]));
  for (let i = 0; i < n; i++) {
    if (!motion(i)) { out[i] = Math.max(0, fixed[i]); continue; }
    const L = len[i], a = acc[i], ve = v[i], vx = v[i + 1], vc = Math.max(vmax[i], ve, vx);
    const da = (vc * vc - ve * ve) / (2 * a), dd = (vc * vc - vx * vx) / (2 * a);
    if (da + dd > L) {
      const vp = Math.sqrt(Math.max(0, (2 * a * L + ve * ve + vx * vx) / 2));
      out[i] = (vp - ve) / a + (vp - vx) / a;
    } else out[i] = (vc - ve) / a + (vc - vx) / a + (L - da - dd) / vc;
  }
}

/**
 * Cooling slowdown: finds the speed factor (≤ 1) so extrusion time + other time reaches slowdownLayerTime.
 * `timeAt(f)` returns the extrusion time and non-extrusion time of the layer with extrusion speeds scaled by f.
 */
export function solveSlowdown(F: FilamentPreset, timeAt: (f: number) => { ext: number; other: number }): { factor: number; ext: number; other: number; baseTime: number } {
  let t = timeAt(1);
  const baseTime = t.ext + t.other;
  if (!(F.slowdownLayerTime > 0) || !(F.fanCoolingEnabled !== false) || baseTime >= F.slowdownLayerTime || t.ext <= 0) return { factor: 1, ext: t.ext, other: t.other, baseTime };
  let f = 1;
  for (let it = 0; it < 6; it++) {
    const target = F.slowdownLayerTime - t.other;
    if (target <= 1e-6) { f = 0.001; t = timeAt(f); break; }
    const nf = Math.min(1, Math.max(0.001, f * t.ext / target));
    if (Math.abs(nf - f) < 1e-4) break;
    f = nf; t = timeAt(f);
    if (Math.abs(t.ext + t.other - F.slowdownLayerTime) < 5e-3) break;
  }
  return { factor: f, ext: t.ext, other: t.other, baseTime };
}

/** Part-cooling fan percent for a layer (before bridge/overhang overrides). */
export function layerFanPct(F: FilamentPreset, ordinal: number, layerTime: number): number {
  if (ordinal < F.fanOffFirstLayers) return 0;
  if (F.fanCoolingEnabled === false) return F.fanMin;
  const off = F.fanOffFirstLayers, full = Math.max(F.fullFanLayer, off);
  let base = ordinal >= full ? F.fanMin : (F.fanMin * (ordinal - off + 1)) / (full - off + 1);
  if (layerTime < F.fanMaxBelowLayerTime) base = Math.max(base, F.fanMax);
  else if (F.slowdownLayerTime > F.fanMaxBelowLayerTime && layerTime < F.slowdownLayerTime) {
    const k = (F.slowdownLayerTime - layerTime) / (F.slowdownLayerTime - F.fanMaxBelowLayerTime);
    base = Math.max(base, F.fanMin + (F.fanMax - F.fanMin) * k);
  }
  return Math.min(100, Math.max(0, base));
}

// ---------------------------------------------------------------- move model
export type MoveKind = "extrude" | "travel" | "retract" | "deretract" | "wipe" | "mark";
export type PlannedMove = {
  kind: MoveKind;
  x0: number; y0: number; z0: number; x: number; y: number; z: number;
  e: number;                  // relative E delta, mm of filament (negative = retraction)
  len: number;                // 3D length, 0 for E-only moves
  speed: number;              // cruise mm/s (filament mm/s for retract/deretract), before layer slowdown
  accel: number; jerk: number; // jerk as configured (0 = firmware default)
  feature: number;            // Feature id; non-extruding moves are Feature.Travel
  width: number; height: number;
  fan?: number; fanAtLeast?: boolean; // per-path fan override (percent); atLeast = max(layer fan, fan)
  obj: number;
  pathStart?: boolean;
  note?: string;
  mark?: "start" | "stop"; label?: number; // kind === "mark": object label start/stop
};
export type LayerMoves = {
  pos: number;                // position in plan.layers
  layer: Layer; ordinal: number; objSwitch: boolean;
  moves: PlannedMove[];
  times: Float64Array;        // per move (after slowdown), s
  factor: number;             // cooling slowdown factor applied to extrusion speeds
  baseTime: number; time: number;
  fanPct: number;
};
export type MotionPlan = {
  ctx: MotionCtx; layers: LayerMoves[];
  timeS: number; filamentMm: number; filamentCm3: number; grams: number; cost: number; maxZ: number;
  byFeature: Record<number, { timeS: number; filamentMm: number }>;
};

/** Times of every move of a layer for a given extrusion slowdown factor. */
export function timeMoves(moves: PlannedMove[], ctx: MotionCtx, factor: number): { times: Float64Array; ext: number; other: number } {
  const idx: number[] = [];
  for (let i = 0; i < moves.length; i++) if (moves[i].kind !== "mark") idx.push(i);
  const n = idx.length;
  const len = new Float64Array(n), ux = new Float64Array(n), uy = new Float64Array(n), uz = new Float64Array(n), vmax = new Float64Array(n);
  const acc = new Float64Array(n), jerk = new Float64Array(n), fixed = new Float64Array(n), tt = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const m = moves[idx[k]];
    acc[k] = Math.max(1, m.accel); jerk[k] = effJerk(ctx, m.jerk);
    if (m.len > 1e-9) {
      len[k] = m.len; ux[k] = (m.x - m.x0) / m.len; uy[k] = (m.y - m.y0) / m.len; uz[k] = (m.z - m.z0) / m.len;
      vmax[k] = m.kind === "extrude" ? slowed(m.speed, factor, ctx.F.minSpeed) : m.speed;
    } else fixed[k] = m.e !== 0 ? Math.abs(m.e) / Math.max(m.speed, 1e-3) : 0;
  }
  chainTimes(n, len, ux, uy, uz, vmax, acc, jerk, fixed, tt);
  const times = new Float64Array(moves.length);
  let ext = 0, other = 0;
  for (let k = 0; k < n; k++) { const m = moves[idx[k]]; times[idx[k]] = tt[k]; if (m.kind === "extrude") ext += tt[k]; else other += tt[k]; }
  return { times, ext, other };
}

// ---------------------------------------------------------------- walls (for detours / retraction decisions)
type Poly = { xy: Float64Array; n: number; cum: Float64Array; perim: number; minx: number; miny: number; maxx: number; maxy: number };
function makePoly(p: Path): Poly | null {
  const n = p.xyz.length / 3;
  if (n < 3) return null;
  const xy = new Float64Array(n * 2), cum = new Float64Array(n + 1);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = p.xyz[i * 3], y = p.xyz[i * 3 + 1];
    xy[i * 2] = x; xy[i * 2 + 1] = y;
    minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
  }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; cum[i + 1] = cum[i] + Math.hypot(xy[j * 2] - xy[i * 2], xy[j * 2 + 1] - xy[i * 2 + 1]); }
  return { xy, n, cum, perim: cum[n], minx, miny, maxx, maxy };
}
function segCrossesPoly(ax: number, ay: number, bx: number, by: number, q: Poly): boolean {
  if (Math.max(ax, bx) < q.minx || Math.min(ax, bx) > q.maxx || Math.max(ay, by) < q.miny || Math.min(ay, by) > q.maxy) return false;
  const d1x = bx - ax, d1y = by - ay, L = Math.hypot(d1x, d1y);
  if (L < 1e-9) return false;
  const te = Math.min(0.45, 0.05 / L);
  for (let i = 0; i < q.n; i++) {
    const j = (i + 1) % q.n, cx = q.xy[i * 2], cy = q.xy[i * 2 + 1], d2x = q.xy[j * 2] - cx, d2y = q.xy[j * 2 + 1] - cy;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den, u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
    if (t > te && t < 1 - te && u >= 0 && u <= 1) return true;
  }
  return false;
}
function nearestOnPoly(px: number, py: number, q: Poly): { edge: number; t: number; x: number; y: number; d: number } {
  let best = { edge: 0, t: 0, x: q.xy[0], y: q.xy[1], d: Infinity };
  for (let i = 0; i < q.n; i++) {
    const j = (i + 1) % q.n, cx = q.xy[i * 2], cy = q.xy[i * 2 + 1], dx = q.xy[j * 2] - cx, dy = q.xy[j * 2 + 1] - cy, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - cx) * dx + (py - cy) * dy) / l2)) : 0;
    const x = cx + dx * t, y = cy + dy * t, d = Math.hypot(px - x, py - y);
    if (d < best.d) best = { edge: i, t, x, y, d };
  }
  return best;
}
function insideOrNear(px: number, py: number, q: Poly, tol: number): boolean {
  if (px < q.minx - tol || px > q.maxx + tol || py < q.miny - tol || py > q.maxy + tol) return false;
  let inside = false;
  for (let i = 0, j = q.n - 1; i < q.n; j = i++) {
    const xi = q.xy[i * 2], yi = q.xy[i * 2 + 1], xj = q.xy[j * 2], yj = q.xy[j * 2 + 1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside || nearestOnPoly(px, py, q).d <= tol;
}
/** Route from A to B along the boundary of the wall polygon both lie in when the straight line would cross it. */
function detourRoute(ax: number, ay: number, bx: number, by: number, barriers: Poly[], maxDetour: number): [number, number][] {
  const straight: [number, number][] = [[ax, ay], [bx, by]];
  const sl = Math.hypot(bx - ax, by - ay);
  for (const q of barriers) {
    if (!segCrossesPoly(ax, ay, bx, by, q)) continue;
    if (!insideOrNear(ax, ay, q, 0.6) || !insideOrNear(bx, by, q, 0.6)) continue;
    const a = nearestOnPoly(ax, ay, q), b = nearestOnPoly(bx, by, q);
    const sA = q.cum[a.edge] + a.t * (q.cum[a.edge + 1] - q.cum[a.edge]), sB = q.cum[b.edge] + b.t * (q.cum[b.edge + 1] - q.cum[b.edge]);
    const fwd = (((sB - sA) % q.perim) + q.perim) % q.perim, bwd = q.perim - fwd;
    const unw = (k: number) => q.cum[((k % q.n) + q.n) % q.n] + Math.floor(k / q.n) * q.perim;
    const vx = (k: number): [number, number] => { const m = ((k % q.n) + q.n) % q.n; return [q.xy[m * 2], q.xy[m * 2 + 1]]; };
    const mid: [number, number][] = [];
    if (fwd <= bwd) for (let k = a.edge + 1; unw(k) < sA + fwd - 1e-9; k++) mid.push(vx(k));
    else for (let k = a.edge; unw(k) > sA - bwd + 1e-9; k--) mid.push(vx(k));
    const route: [number, number][] = [[ax, ay], [a.x, a.y], ...mid, [b.x, b.y], [bx, by]];
    let rl = 0;
    for (let i = 1; i < route.length; i++) rl += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
    if (maxDetour > 0 && rl > sl + maxDetour) return straight;
    return route;
  }
  return straight;
}

// ---------------------------------------------------------------- planner
type St = {
  x: number; y: number; z: number; has: boolean; retracted: boolean; hopZ: number | null;
  lastPath: Path | null; lastFeature: number; lastLayerObj: number | null; printedTop: number; printed: boolean;
};
const isInfill = (f: number) => f === Feature.SparseInfill || f === Feature.InternalSolid;

export function planMoves(plan: PlanarPlan, job: PlanarJob): MotionPlan {
  const ctx = makeCtx(job);
  const { M, F } = ctx;
  const st: St = { x: 0, y: 0, z: 0, has: false, retracted: false, hopZ: null, lastPath: null, lastFeature: -1, lastLayerObj: null, printedTop: 0, printed: false };
  const ordCount = new Map<number, number>();
  const layers: LayerMoves[] = [];
  const byFeature: Record<number, { timeS: number; filamentMm: number }> = {};
  let timeS = 0, filamentMm = 0, maxZ = 0;
  const label = ctx.bool("gcode_label_objects");
  plan.layers.forEach((layer, pos) => {
    const group = plan.sequence === "object" && layer.obj >= 0 ? layer.obj : -1;
    const ordinal = ordCount.get(group) ?? 0; ordCount.set(group, ordinal + 1);
    const objSwitch = plan.sequence === "object" && st.lastLayerObj !== null && st.lastLayerObj !== layer.obj && st.has;
    const moves = planLayer(ctx, plan, layer, ordinal, objSwitch, st, label, pos === plan.layers.length - 1);
    const sol = solveSlowdown(F, (f) => timeMoves(moves, ctx, f));
    const t = timeMoves(moves, ctx, sol.factor);
    const total = t.ext + t.other;
    layers.push({ pos, layer, ordinal, objSwitch, moves, times: t.times, factor: sol.factor, baseTime: sol.baseTime, time: total, fanPct: layerFanPct(F, ordinal, sol.baseTime) });
    timeS += total;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m.kind === "mark") continue;
      const fe = m.kind === "extrude" ? m.feature : Feature.Travel;
      const slot = byFeature[fe] ?? (byFeature[fe] = { timeS: 0, filamentMm: 0 });
      slot.timeS += t.times[i];
      if (m.kind === "extrude") { slot.filamentMm += m.e; filamentMm += m.e; }
      if (m.kind === "extrude") maxZ = Math.max(maxZ, m.z);
    }
    st.lastLayerObj = layer.obj;
    st.printedTop = Math.max(st.printedTop, layer.z);
  });
  const filamentCm3 = (filamentMm * ctx.filArea) / 1000, grams = filamentCm3 * F.density;
  return { ctx, layers, timeS, filamentMm, filamentCm3, grams, cost: (grams / 1000) * F.costPerKg, maxZ, byFeature };
}

function planLayer(ctx: MotionCtx, plan: PlanarPlan, layer: Layer, ordinal: number, objSwitch: boolean, st: St, label: boolean, isLastLayer: boolean): PlannedMove[] {
  const { M, F } = ctx;
  const moves: PlannedMove[] = [];
  const first = ordinal === 0;
  const travelSpeed = ctx.travelSpeed * (first ? Math.min(2, (ctx.num("initial_layer_travel_speed") || 100) / 100) : 1);
  const tAccel = ctx.travelAccel, tJerk = ctx.travelJerk;
  const retrSpeed = M.retractSpeed > 0 ? M.retractSpeed : 35, deSpeed = M.deretractSpeed > 0 ? M.deretractSpeed : retrSpeed;
  const reduceCrossing = ctx.bool("reduce_crossing_wall"), reduceInfill = ctx.bool("reduce_infill_retraction");
  const maxDetour = ctx.num("max_travel_detour_distance");
  let barriers: Poly[] | null = null;
  const getBarriers = () => {
    if (!barriers) {
      barriers = [];
      for (const p of layer.paths) if (p.feature === Feature.OuterWall && p.closed) { const q = makePoly(p); if (q) barriers.push(q); }
    }
    return barriers;
  };
  const crosses = (ax: number, ay: number, bx: number, by: number) => getBarriers().some((q) => segCrossesPoly(ax, ay, bx, by, q));

  const push = (kind: MoveKind, x: number, y: number, z: number, e: number, speed: number, accel: number, jerk: number, feature: number, obj: number, extra?: Partial<PlannedMove>): PlannedMove => {
    let len = Math.hypot(x - st.x, y - st.y, z - st.z);
    if (len < 1e-9) len = 0;
    let sp = speed;
    const dz = Math.abs(z - st.z);
    if (len > 0 && dz > 1e-9 && M.maxZSpeed > 0 && kind !== "mark") sp = Math.min(sp, (M.maxZSpeed * len) / dz);
    const m: PlannedMove = { kind, x0: st.x, y0: st.y, z0: st.z, x, y, z, e, len, speed: sp, accel, jerk, feature, width: 0, height: 0, obj, ...extra };
    st.x = x; st.y = y; st.z = z;
    moves.push(m);
    return m;
  };
  const travelTo = (x: number, y: number, z: number, obj: number, note?: string) => {
    const zOnly = Math.hypot(x - st.x, y - st.y) < 1e-9;
    return push("travel", x, y, z, 0, zOnly ? Math.min(M.maxZSpeed > 0 ? M.maxZSpeed : 10, travelSpeed) : travelSpeed, tAccel, tJerk, Feature.Travel, obj, { note });
  };
  const mark = (type: "start" | "stop", obj: number) => {
    moves.push({ kind: "mark", x0: st.x, y0: st.y, z0: st.z, x: st.x, y: st.y, z: st.z, e: 0, len: 0, speed: 0, accel: 0, jerk: 0, feature: 0, width: 0, height: 0, obj, mark: type, label: obj });
  };

  /** Retract (with optional wipe along the previous path). */
  const doRetract = (obj: number) => {
    const L = M.retractLength;
    if (!(L > 0) || st.retracted) { st.retracted = st.retracted || L > 0; return; }
    const lp = st.lastPath;
    const wipeOk = M.wipe && M.wipeDistance > 0 && lp && lp.feature !== Feature.Travel && lp.xyz.length >= 6;
    if (!wipeOk) { push("retract", st.x, st.y, st.z, -L, retrSpeed, tAccel, tJerk, Feature.Travel, obj, { note: "retract" }); st.retracted = true; return; }
    const lpp = lp!;
    const n = lpp.xyz.length / 3;
    const pts: [number, number, number][] = [];
    for (let i = 0; i < n; i++) pts.push([lpp.xyz[i * 3], lpp.xyz[i * 3 + 1], lpp.xyz[i * 3 + 2]]);
    if (lpp.closed) pts.push(pts[0]);
    // walk backwards from the end of the path by wipeDistance
    const wp: [number, number, number][] = [];
    let remain = M.wipeDistance, wl = 0;
    for (let i = pts.length - 1; i > 0 && remain > 1e-6; i--) {
      const a = pts[i], b = pts[i - 1], l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (l < 1e-9) continue;
      if (l <= remain) { wp.push(b); remain -= l; wl += l; }
      else { const t = remain / l; wp.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); wl += remain; remain = 0; }
    }
    if (!wp.length || wl <= 0) { push("retract", st.x, st.y, st.z, -L, retrSpeed, tAccel, tJerk, Feature.Travel, obj, { note: "retract" }); st.retracted = true; return; }
    const pre = (L * Math.min(100, Math.max(0, M.retractBeforeWipe))) / 100;
    if (pre > 1e-9) push("retract", st.x, st.y, st.z, -pre, retrSpeed, tAccel, tJerk, Feature.Travel, obj, { note: "retract" });
    const rest = L - pre, wspeed = Math.min(lpp.speed > 0 ? lpp.speed : 60, 80);
    let prev = [st.x, st.y, st.z];
    for (const p of wp) {
      const l = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      push("wipe", p[0], p[1], p[2], -(rest * l) / wl, wspeed, accelFor(ctx, lpp.feature, first, lpp.accel), 0, Feature.Travel, obj, { note: "wipe" });
      prev = p;
    }
    st.retracted = true;
  };

  /** Travel along `route` (points with desired z), handling retraction, z-hop and detours. Returns after arriving; lowers/deretracts if `toExtrusion`. */
  const approach = (route: [number, number, number][], obj: number, nextFeature: number, toExtrusion: boolean, layerStart: boolean) => {
    const dest = route[route.length - 1];
    // decide retraction on the straight/detoured length
    let r: [number, number, number][] = route;
    if (!st.has) { st.has = true; st.x = route[0][0]; st.y = route[0][1]; st.z = route[0][2]; }
    const lenOf = (rr: [number, number, number][], sx: number, sy: number) => { let l = 0, px = sx, py = sy; for (const p of rr) { l += Math.hypot(p[0] - px, p[1] - py); px = p[0]; py = p[1]; } return l; };
    const baseLen = lenOf(r, st.x, st.y);
    let retract = false;
    const forced = (layerStart && st.printed && ((objSwitch) || M.retractOnLayerChange));
    if (!st.retracted && M.retractLength > 0 && st.printed) {
      if (forced) retract = true;
      else if (baseLen >= M.retractMinTravel) {
        retract = true;
        if (reduceInfill && isInfill(st.lastFeature) && isInfill(nextFeature) && !crosses(st.x, st.y, r[0][0], r[0][1])) retract = false;
      }
    }
    if (retract) doRetract(obj);
    // detour (after wipe the start may have moved)
    if (reduceCrossing && st.printed && toExtrusion && r.length === 1) {
      const d = detourRoute(st.x, st.y, dest[0], dest[1], getBarriers(), maxDetour);
      if (d.length > 2) r = d.slice(1).map((p, i, arr) => (i === arr.length - 1 ? dest : [p[0], p[1], dest[2]] as [number, number, number]));
    }
    const needHop = (st.retracted && M.zHop > 0 && st.hopZ === null && st.printed) || (objSwitch && layerStart && st.printed);
    if (needHop) {
      const target = objSwitch && layerStart ? st.printedTop + Math.max(1, M.zHop) : Math.max(st.z, dest[2]) + M.zHop;
      const type = objSwitch && layerStart ? "normal" : M.zHopType;
      const total = lenOf(r, st.x, st.y);
      const rise = target - st.z;
      const ramp = rise / Math.tan((30 * Math.PI) / 180);
      if (type === "slope" && total > 2 * Math.min(ramp, 3) + 0.5 && rise > 0) {
        const rl = Math.min(ramp, total / 2);
        // polyline with z profile
        const pts: [number, number][] = [[st.x, st.y], ...r.map((p) => [p[0], p[1]] as [number, number])];
        const cd = [0]; for (let i = 1; i < pts.length; i++) cd.push(cd[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const z0 = st.z, zEnd = toExtrusion ? dest[2] : target;
        const ds = new Set<number>(cd); ds.add(rl); if (toExtrusion) ds.add(total - rl);
        const at = (d: number): [number, number] => {
          let i = 1; while (i < cd.length - 1 && cd[i] < d) i++;
          const l = cd[i] - cd[i - 1], t = l > 0 ? (d - cd[i - 1]) / l : 0;
          return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
        };
        const zAt = (d: number) => d <= rl ? z0 + ((target - z0) * d) / rl : toExtrusion && d >= total - rl ? target + ((zEnd - target) * (d - (total - rl))) / rl : target;
        for (const d of [...ds].sort((a, b) => a - b)) {
          if (d < 1e-9) continue;
          const p = at(d);
          travelTo(p[0], p[1], zAt(d), obj, "z-hop slope");
        }
        st.hopZ = toExtrusion ? null : target;
        return;
      }
      if (type === "spiral" && total > 4 && rise > 0) {
        const dx = r[0][0] - st.x, dy = r[0][1] - st.y, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
        const rad = Math.min(1.5, Math.max(0.5, rise)), cx = st.x + ux * rad, cy = st.y + uy * rad, sx = st.x, sy = st.y, z0 = st.z, N = 8;
        for (let k = 1; k <= N; k++) {
          const ang = Math.PI + (2 * Math.PI * k) / N, c = Math.cos(ang), s = Math.sin(ang);
          // rotate the (−dir) start vector by the swept angle
          travelTo(cx + rad * (c * ux - s * uy), cy + rad * (s * ux + c * uy), z0 + (rise * k) / N, obj, "z-hop spiral");
        }
        st.x = sx; st.y = sy; // numerically closed loop
        st.hopZ = target;
      } else {
        travelTo(st.x, st.y, target, obj, "z-hop");
        st.hopZ = target;
      }
    }
    // route moves
    const hz = st.hopZ;
    for (let i = 0; i < r.length; i++) {
      const p = r[i], last = i === r.length - 1;
      const zt = hz !== null ? Math.max(hz, p[2]) : last ? p[2] : Math.max(st.z, p[2]);
      travelTo(p[0], p[1], zt, obj);
    }
  };

  // ---- layer body
  let labelObj = -1, firstPath = true;
  for (const path of layer.paths) {
    const n = path.xyz.length / 3;
    if (n < 1) continue;
    const isTravel = path.feature === Feature.Travel;
    if (!isTravel && pathSegCount(path) < 1) continue;
    const pobj = path.obj;
    if (label) {
      if (pobj !== labelObj) { if (labelObj >= 0) mark("stop", labelObj); if (pobj >= 0) mark("start", pobj); labelObj = pobj; }
    }
    const layerStart = firstPath; firstPath = false;
    if (isTravel) {
      const route: [number, number, number][] = [];
      for (let i = 0; i < n; i++) route.push([path.xyz[i * 3], path.xyz[i * 3 + 1], path.xyz[i * 3 + 2]]);
      if (path.closed && n > 1) route.push(route[0]);
      approach(route, pobj, Feature.Travel, false, layerStart);
      st.lastPath = null; st.lastFeature = Feature.Travel;
      continue;
    }
    const sx = path.xyz[0], sy = path.xyz[1], sz = path.xyz[2];
    approach([[sx, sy, sz]], pobj, path.feature, true, layerStart);
    // arrive: lower and de-retract
    if (st.hopZ !== null || Math.abs(st.z - sz) > 1e-9) {
      if (Math.abs(st.z - sz) > 1e-9) travelTo(st.x, st.y, sz, pobj, st.hopZ !== null ? "z-hop down" : undefined);
      st.hopZ = null;
    }
    if (st.retracted) {
      const e = M.retractLength + M.retractRestartExtra;
      push("deretract", st.x, st.y, st.z, e, deSpeed, tAccel, tJerk, Feature.Travel, pobj, { note: "deretract" });
      st.retracted = false;
    }
    // extrusion
    const area = crossSection(path.width, path.height), vpm = area * (path.flow || 1) * ctx.pfr;
    const ePerMm = (vpm * F.flowRatio) / ctx.filArea;
    const acc = accelFor(ctx, path.feature, first, path.accel), jerk = jerkFor(ctx, path.feature, first);
    let fan: number | undefined, atLeast = false;
    if (path.fan !== undefined) fan = path.fan;
    else if ((path.feature === Feature.Bridge || path.feature === Feature.OverhangWall) && F.fanOnBridges && F.fanCoolingEnabled !== false && ordinal >= F.fanOffFirstLayers) { fan = F.overhangFanSpeed; atLeast = true; }
    const segs = pathSegCount(path);
    let started = false;
    for (let k = 0; k < segs; k++) {
      const i1 = (k + 1) % n, x = path.xyz[i1 * 3], y = path.xyz[i1 * 3 + 1], z = path.xyz[i1 * 3 + 2];
      const l3 = Math.hypot(x - st.x, y - st.y, z - st.z);
      if (l3 < 1e-9) continue;
      const v = segCruise(ctx, path, k, l3, z - st.z);
      const m = push("extrude", x, y, z, l3 * ePerMm * segFlow(path, k), v, acc, jerk, path.feature, pobj, { pathStart: !started, fan, fanAtLeast: atLeast });
      m.width = path.width; m.height = path.height;
      started = true;
    }
    st.lastPath = path; st.lastFeature = path.feature; st.printed = st.printed || started;
  }
  if (label && labelObj >= 0) mark("stop", labelObj);
  if (isLastLayer && st.printed && !st.retracted && M.retractLength > 0) {
    push("retract", st.x, st.y, st.z, -M.retractLength, retrSpeed, tAccel, tJerk, Feature.Travel, -1, { note: "final retract" });
    st.retracted = true;
  }
  return moves;
}
