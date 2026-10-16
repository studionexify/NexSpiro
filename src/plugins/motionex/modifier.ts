// Motionex toolpath modifier (spec §6).
// resample → path tangent/normal → evaluate curves → offset XY and Z → flow & speed → events → limits.
// Extrusion itself is recomputed by the core from the real 3D length after all plugins run.
import { emptyCheck, type Layer, type PrintCheck, type SliceWarning, type Toolpath, type ToolpathPoint } from "./core/types";
import type { PrintProfiles } from "./core/profiles";
import { regionWeight, type PatternexRegion, type RegionRegistry } from "./core/regions";
import { evalCurve, clamp } from "./curve";
import { noise1d } from "./noise";
import { wallMatches, type MotionApplication, type MotionBrush } from "./model";

export interface ModifierOptions {
  resampleStep: number;
  /** Inner walls follow the outer wall's movement so the patterned skin stays fused to the body. */
  bondInnerWalls?: boolean;
  /** Speed for parts where loops overlap, as a share of the wall speed (spec: loops print slow and warn). */
  loopSpeedShare: number;
}
export const DEFAULT_OPTIONS: ModifierOptions = { resampleStep: 0.2, loopSpeedShare: 0.5, bondInnerWalls: true };

interface Sample { x: number; y: number; z: number; s: number; f: number; flow: number; slope: number }
export interface BrushSample { lat: number; along: number; z: number; flow: number; speed: number }

/** Resample a polyline so no segment is longer than step. Keeps original vertices (corners stay sharp). */
export function resample(points: ToolpathPoint[], step: number): Sample[] {
  const out: Sample[] = [];
  let s = 0;
  const p0 = points[0];
  out.push({ x: p0.x, y: p0.y, z: p0.z, s: 0, f: p0.f, flow: p0.flow, slope: p0.slope ?? 0 });
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step - 1e-9));
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, s: s + len * u, f: b.f, flow: b.flow,
        slope: (a.slope ?? 0) + ((b.slope ?? 0) - (a.slope ?? 0)) * u });
    }
    s += len;
  }
  return out;
}

/** Extra phase (degrees) for a layer, or null when the layer falls in an "off" band. */
export function layerPhase(b: MotionBrush, layer: number): number | null {
  const e = b.layers;
  if (!e) return 0;
  if (e.band_on > 0 && layer % (e.band_on + Math.max(0, e.band_off)) >= e.band_on) return null;
  const every = Math.max(1, Math.round(e.every));
  const k = Math.floor(layer / every);
  switch (e.mode) {
    case "steady": return k * e.shift_deg;
    case "alternate": return (k % 2) * e.shift_deg;
    case "back_and_forth": { const n = 2 * every, pos = layer % n; return (pos < every ? pos : n - pos) * e.shift_deg; }
    case "shift_hold": {
      // Rise for every layers, hold for every, fall for every, hold for every.
      const n = 4 * every, pos = layer % n;
      const steps = pos < every ? pos : pos < 2 * every ? every : pos < 3 * every ? 3 * every - pos : 0;
      return steps * e.shift_deg;
    }
  }
}

/** Repeat length actually used on a path of length L. */
export function periodFor(b: MotionBrush, L: number): number {
  return b.repeat_mode === "stretch" ? L / Math.max(1, Math.round(L / b.period_mm)) : b.period_mm;
}

/** Brush sample at arc length s along a path of total length L. Returns null where the brush does not apply. */
export function brushAt(b: MotionBrush, s: number, L: number, layer = 0, period?: number): BrushSample | null {
  const lp = layerPhase(b, layer);
  if (lp === null) return null;
  if (b.layers?.cross && lp !== 0) {
    const a = sampleAt(b, s, L, b.phase_deg + lp, period), c = sampleAt(b, s, L, b.phase_deg - lp, period);
    if (!a || !c) return a ?? c;
    // The higher of the two keeps both ridges at full height, including where they cross.
    return { lat: Math.max(a.lat, c.lat), along: (a.along + c.along) / 2, z: Math.max(a.z, c.z), flow: (a.flow + c.flow) / 2, speed: Math.min(a.speed, c.speed) };
  }
  return sampleAt(b, s, L, b.phase_deg + lp, period);
}

function sampleAt(b: MotionBrush, s: number, L: number, phaseDeg: number, fixedPeriod?: number): BrushSample | null {
  const period = fixedPeriod ?? periodFor(b, L);
  const ph = (((phaseDeg % 360) + 360) % 360 / 360) * period;
  if (b.repeat_mode === "once" && s + ph > period) return null;
  const u = (((s + ph) / period) % 1 + 1) % 1;
  let lat = evalCurve(b.curves.lateral_offset, u);
  if (b.noise?.enabled) lat += noise1d((s + ph) / (period * b.noise.scale), b.noise.seed, b.noise.octaves, b.noise.persistence);
  return {
    lat: lat * b.amplitude,
    along: evalCurve(b.curves.along_offset, u) * b.amplitude,
    z: evalCurve(b.curves.z_offset, u) * (b.z_amplitude ?? 0),
    flow: evalCurve(b.curves.extrusion_mult, u),
    speed: evalCurve(b.curves.speed_mult, u),
  };
}

/** Arc-length positions on this path where each event fires. */
export function eventPositions(b: MotionBrush, L: number, layer: number, fixedPeriod?: number): { s: number; i: number }[] {
  if (!b.events.length) return [];
  const lp = layerPhase(b, layer);
  if (lp === null) return [];
  const period = fixedPeriod ?? periodFor(b, L);
  const ph = (((b.phase_deg + lp) % 360 + 360) % 360 / 360) * period;
  const out: { s: number; i: number }[] = [];
  b.events.forEach((e, i) => {
    const at = e.at.mode === "percent" ? (e.at.value / 100) * period : e.at.value;
    let s = at - ph;
    while (s < 0) s += period;
    for (; s < L - 1e-6; s += period) { out.push({ s, i }); if (e.once || b.repeat_mode === "once") break; }
  });
  return out.sort((a, b) => a.s - b.s || a.i - b.i);
}

export type Weight = (x: number, y: number, z: number, slope: number) => number;
/** Returns the repeat count to use for a loop centred at (x, y); the first answer for a loop sticks for the whole print. */
export type RepeatLock = (cx: number, cy: number, suggested: number) => number;

/** One pattern taking part in a path: how strongly it applies where, and how it combines with earlier ones. */
export interface PathLayer {
  brush: MotionBrush;
  weight: Weight;
  /** add: displacement adds to earlier patterns · override: cross-fades from earlier patterns to this one. */
  blend: "add" | "override";
  repeats?: RepeatLock;
}

/**
 * Where along a path a brush is sampled. Closed loops are measured from a fixed direction (+X from the
 * loop centre), not from the seam, and fit a whole number of repeats, so the pattern closes on itself at
 * the seam and lines up from one layer to the next wherever the slicer put the seam.
 */
function pathParam(samples: Sample[], closed: boolean, b: MotionBrush, repeats?: RepeatLock) {
  const L = samples[samples.length - 1].s;
  if (!closed || b.repeat_mode === "once") return { L, period: undefined as number | undefined, at: (i: number) => samples[i].s, toS: (p: number) => p };
  let cx = 0, cy = 0;
  for (const q of samples) { cx += q.x; cy += q.y; }
  cx /= samples.length; cy /= samples.length;
  const suggested = Math.max(1, Math.round(L / b.period_mm));
  const n = repeats ? repeats(cx, cy, suggested) : suggested;
  const period = L / n;
  if (repeats && b.repeat_mode === "stretch") {
    // "Fit evenly": placed by angle round the loop, so it stacks straight up when the loop grows or shrinks.
    const at = (i: number) => (((Math.atan2(samples[i].y - cy, samples[i].x - cx) / (2 * Math.PI)) % 1) + 1) % 1 * L;
    return { L, period, at: (i: number) => (i === samples.length - 1 ? at(0) : at(i)), toS: (p: number) => p };
  }
  // Start of the loop's measure: the sample nearest the +X direction from the centre.
  let s0 = 0, best = Infinity;
  for (const q of samples) { const a = Math.abs(Math.atan2(q.y - cy, q.x - cx)); if (a < best) { best = a; s0 = q.s; } }
  const wrap = (v: number) => ((v % L) + L) % L;
  return { L, period, at: (i: number) => (i === samples.length - 1 ? wrap(-s0) : wrap(samples[i].s - s0)), toS: (p: number) => wrap(p + s0) };
}

/** Apply one brush to one path, returning a new path. */
export function applyBrushToPath(path: Toolpath, b: MotionBrush, p: PrintProfiles, opt: ModifierOptions, weight: Weight, warn: (w: SliceWarning) => void, layer = 0, check: PrintCheck = emptyCheck(), source?: ToolpathPoint[], repeats?: RepeatLock): Toolpath {
  return composePath(path, [{ brush: b, weight, blend: "add", repeats }], p, opt, warn, layer, check, source);
}

/**
 * Apply several patterns to one path at once. Every pattern is worked out on the slicer's own path and
 * the movements are combined (added, or cross-faded for "replace"), so where one pattern hands over to
 * another, or fades out into the plain wall, the line stays one continuous line with no step.
 */
export function composePath(path: Toolpath, layers: PathLayer[], p: PrintProfiles, opt: ModifierOptions, warn: (w: SliceWarning) => void, layer = 0, check: PrintCheck = emptyCheck(), source?: ToolpathPoint[]): Toolpath {
  const samples = resample(source ?? path.base ?? path.points, opt.resampleStep);
  const N = samples.length;
  const L = samples[N - 1].s;
  if (L <= 0 || !layers.length) return path;
  const { machine, process, filament } = p;
  const maxXY = Math.min(machine.maxSpeed.x, machine.maxSpeed.y);
  const filArea = Math.PI * (filament.diameter / 2) ** 2;
  // Tangent and outward normal of the slicer's path (walls are CCW, so outward is the right-hand normal).
  const tx = new Float64Array(N), ty = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    // for closed paths wrap around so the seam has no kink
    const prev = samples[i > 0 ? i - 1 : path.closed ? N - 2 : 0];
    const next = samples[i < N - 1 ? i + 1 : path.closed ? 1 : N - 1];
    const dx = next.x - prev.x, dy = next.y - prev.y, l = Math.hypot(dx, dy) || 1;
    tx[i] = dx / l; ty[i] = dy / l;
  }
  const lat = new Float64Array(N), along = new Float64Array(N), dz = new Float64Array(N);
  const flow = new Float64Array(N).fill(1), speed = new Float64Array(N).fill(1), total = new Float64Array(N);
  const lo = new Float64Array(N).fill(-Infinity), hi = new Float64Array(N).fill(Infinity);
  const post: (ToolpathPoint["post"] | undefined)[] = new Array(N);
  const travel = new Uint8Array(N);
  let flowClamps = 0, canLoop = false;
  for (const { brush: b, weight, blend, repeats } of layers) {
    const w = new Float64Array(N);
    let any = false;
    for (let i = 0; i < N; i++) { const c = samples[i]; w[i] = clamp(weight(c.x, c.y, c.z, c.slope), 0, 1); if (w[i] > 0) any = true; }
    if (!any) continue;
    const prm = pathParam(samples, path.closed, b, repeats);
    if (b.curves.along_offset.points.some((q) => Math.abs(q.v) > 1e-9) && b.amplitude > 0) canLoop = true;
    // Events: positions are found in the same measure as the pattern, then mapped back onto the path.
    const evs = eventPositions(b, prm.L, layer, prm.period).map((e) => ({ s: prm.toS(e.s), i: e.i })).sort((a, c) => a.s - c.s || a.i - c.i);
    let ev = 0, flowState = 1, travelUntil = -1, pendingUnretract = 0, lastPrinted = 0;
    for (let i = 0; i < N; i++) {
      const c = samples[i], wi = w[i];
      const m = wi > 0 ? brushAt(b, prm.at(i), prm.L, layer, prm.period) : null;
      const mLat = m ? m.lat : 0, mAlong = m ? m.along : 0, mZ = m ? m.z : 0;
      const mFlow = m ? m.flow * flowState : 1, mSpeed = m ? m.speed : 1;
      if (blend === "override") {
        lat[i] = lat[i] * (1 - wi) + mLat * wi; along[i] = along[i] * (1 - wi) + mAlong * wi; dz[i] = dz[i] * (1 - wi) + mZ * wi;
        flow[i] = flow[i] * (1 - wi) + mFlow * wi; speed[i] = speed[i] * (1 - wi) + mSpeed * wi;
      } else if (m) {
        lat[i] += mLat * wi; along[i] += mAlong * wi; dz[i] += mZ * wi;
        flow[i] *= 1 + (mFlow - 1) * wi; speed[i] *= 1 + (mSpeed - 1) * wi;
      }
      if (m) { total[i] = Math.max(total[i], wi); lo[i] = Math.max(lo[i], b.limits.min_flow_mult); hi[i] = Math.min(hi[i], b.limits.max_flow_mult); }
      // Events land on the first sample at or past their position.
      let retractedHere = false;
      while (ev < evs.length && evs[ev].s <= c.s + 1e-9) {
        const e = b.events[evs[ev++].i];
        if (wi < 0.5) continue;
        if (e.type === "dwell") {
          post[i] = { ...post[i], dwell_ms: Math.max(0, e.params.ms ?? 200) };
          if ((e.params.blob_mm3 ?? 0) > 0) post[i]!.blob_mm = round(e.params.blob_mm3 / filArea);
          check.events.dwell++;
        } else if (e.type === "flow_change") {
          flowState = Math.max(0, e.params.mult ?? 1);
          check.events.flow++;
        } else if (e.type === "retract" && pendingUnretract === 0) {
          const len = (e.params.length ?? 0) > 0 ? e.params.length : process.retractLength;
          post[i] = { ...post[i], retract_mm: len };
          pendingUnretract = len;
          travelUntil = c.s + Math.max(0.2, e.params.travel_mm ?? 1);
          check.events.retract++;
          retractedHere = true;
        }
      }
      if (retractedHere) { lastPrinted = i; continue; }
      if (pendingUnretract > 0) {
        if (c.s <= travelUntil + 1e-9) travel[i] = 1;
        else { post[lastPrinted] = { ...post[lastPrinted], unretract_mm: pendingUnretract }; pendingUnretract = 0; }
      }
      lastPrinted = i;
    }
    if (pendingUnretract > 0) post[N - 1] = { ...post[N - 1], unretract_mm: pendingUnretract };
  }
  const out: ToolpathPoint[] = [];
  for (let i = 0; i < N; i++) {
    const c = samples[i];
    const q: ToolpathPoint = { x: c.x, y: c.y, z: c.z, f: c.f, flow: c.flow, e: 0, slope: c.slope };
    if (total[i] > 0) {
      const nx = ty[i], ny = -tx[i];
      q.x += nx * lat[i] + tx[i] * along[i];
      q.y += ny * lat[i] + ty[i] * along[i];
      if (dz[i] !== 0) { q.z = round(c.z + dz[i]); q.zOff = round(dz[i]); }
      const f = c.flow * flow[i];
      const fc = clamp(f, lo[i], hi[i]);
      if (fc !== f) flowClamps++;
      q.flow = fc;
      q.f = c.f * speed[i];
    }
    if (post[i]) q.post = post[i];
    if (travel[i]) q.travel = true;
    out.push(q);
  }

  // Second pass: loops, speed limits, up-and-down speed and corner hardness, using the final positions.
  const loopSpeed = process.wallSpeed * opt.loopSpeedShare;
  let loops = 0, accel = 0, speedClamps = 0, zClamps = 0;
  // Only forward-and-back movement can make the nozzle run backwards over its own plastic.
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], q = out[i], sa = samples[i - 1], sb = samples[i];
    if (q.travel) continue;
    const bx = sb.x - sa.x, by = sb.y - sa.y, bl = Math.hypot(bx, by) || 1;
    const fwd = ((q.x - a.x) * bx + (q.y - a.y) * by) / bl;
    if (canLoop && fwd < 0.1 * bl) { // the nozzle is going backwards: loops lay plastic over itself
      if (q.f > loopSpeed) { q.f = loopSpeed; loops++; }
      q.flag ??= "loop";
    }
    if (q.f > maxXY) { q.f = maxXY; speedClamps++; }
    const len3 = Math.hypot(q.x - a.x, q.y - a.y, q.z - a.z), ddz = Math.abs(q.z - a.z);
    if (ddz > 1e-6 && len3 > 0 && (q.f * ddz) / len3 > machine.maxSpeed.z) { q.f = (machine.maxSpeed.z * len3) / ddz; zClamps++; }
    if (i > 1) {
      const z0 = out[i - 2];
      const v1x = a.x - z0.x, v1y = a.y - z0.y, v2x = q.x - a.x, v2y = q.y - a.y;
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (l1 > 1e-6 && l2 > 1e-6) {
        const turn = Math.acos(clamp((v1x * v2x + v1y * v2y) / (l1 * l2), -1, 1));
        if ((q.f * q.f * turn) / ((l1 + l2) / 2) > machine.maxAccel.x) accel++;
      }
    }
  }
  check.speedHits += speedClamps; check.zSpeedHits += zClamps; check.accelHits += accel; check.loopSlowed += loops;
  const name = layers.length === 1 ? layers[0].brush.name : "Patterns";
  if (flowClamps) warn({ code: "motionex_flow_limit", message: `${flowClamps} spots hit this pattern's plastic limit` });
  if (speedClamps) warn({ code: "motionex_speed_limit", message: `Some spots were slowed to your printer's top speed (${maxXY} mm/s)` });
  if (loops) warn({ code: "motionex_loops", message: `${name}: loops lay plastic over itself, so those parts print slower (${Math.round(loopSpeed)} mm/s)` });
  if (zClamps) warn({ code: "motionex_z_speed", message: `Up-and-down moves slowed to your printer's top up/down speed (${machine.maxSpeed.z} mm/s)` });
  if (accel) warn({ code: "motionex_accel", message: "Some tight turns are sharper than your printer can follow at full speed; it will round them off slightly" });
  return { ...path, points: out, modifiedBy: "motionex", base: path.base ?? path.points };
}

/** Smooth 0..1 step over the soft band around a slope limit (degrees). */
const SLOPE_SOFT = 4;
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

/** Run all enabled applications in order over the layers. */
export function applyMotion(layers: Layer[], apps: MotionApplication[], brushes: (id: string) => MotionBrush | undefined, p: PrintProfiles, opt: ModifierOptions = DEFAULT_OPTIONS, check: PrintCheck = emptyCheck(), regions?: RegionRegistry): { layers: Layer[]; warnings: SliceWarning[] } {
  const warnings: SliceWarning[] = [];
  const seen = new Set<string>();
  const warn = (w: SliceWarning) => { if (!seen.has(w.code)) { seen.add(w.code); warnings.push(w); } };
  const sorted = apps.filter((a) => a.enabled).sort((a, b) => a.order - b.order);
  interface Prepared { app: MotionApplication; brush: MotionBrush; faces: PatternexRegion[]; zWeight: (z: number) => number; lockFor: (feature: string) => RepeatLock }
  const prepared: Prepared[] = [];
  for (const app of sorted) {
    const found = app.brush ?? brushes(app.brush_id);
    const k = app.scale ?? 1;
    const brush = found && k !== 1 ? { ...found, amplitude: found.amplitude * k, period_mm: found.period_mm * k, z_amplitude: (found.z_amplitude ?? 0) * k } : found;
    if (!brush) { warn({ code: "motionex_missing_brush", message: `Pattern ${app.brush_id} was not found` }); continue; }
    const faces = app.target.type === "faces" ? (app.target.faces ?? []).map((id) => regions?.get(id)).filter((r): r is PatternexRegion => !!r) : [];
    if (app.target.type === "faces" && !faces.length) { warn({ code: "motionex_faces_missing", message: "A pattern is set to picked surfaces but none are picked, so it was skipped" }); continue; }
    if ((brush.z_amplitude ?? 0) > 0 && p.machine.firmware !== "klipper" && !check.notes.includes("slow-z"))
      check.notes.push("slow-z");
    const { z_start, z_end, fade_in_mm, fade_out_mm } = app.mask;
    const zWeight = (z: number) => {
      if (z < z_start || z > z_end) return 0;
      const a = fade_in_mm > 0 ? clamp((z - z_start) / fade_in_mm, 0, 1) : 1;
      const b = fade_out_mm > 0 ? clamp((z_end - z) / fade_out_mm, 0, 1) : 1;
      return Math.min(a, b);
    };
    const locked = new Map<string, number>();
    const lockFor = (feature: string): RepeatLock => (x, y, suggested) => {
      const key = `${feature}|${Math.round(x / 2)}|${Math.round(y / 2)}`;
      if (!locked.has(key)) locked.set(key, suggested);
      return locked.get(key)!;
    };
    prepared.push({ app, brush, faces, zWeight, lockFor });
  }
  for (const layer of layers) {
    const active = prepared.filter((a) => a.zWeight(layer.z) > 0);
    if (!active.length) continue;
    const weights = active.map(({ app, faces, zWeight }): Weight => {
      const { angle_min, angle_max } = app.mask;
      const blend = app.mask.blend_mm ?? 1.5;
      return (x, y, z, slope) => {
        let w = zWeight(z);
        // Slope limits fade over a few degrees instead of cutting off.
        if (angle_min !== undefined) w *= smooth((slope - angle_min) / SLOPE_SOFT + 1);
        if (angle_max !== undefined) w *= smooth((angle_max - slope) / SLOPE_SOFT + 1);
        if (w <= 0) return 0;
        if (faces.length) {
          let f = 0;
          for (const r of faces) { f = Math.max(f, regionWeight(r, layer.index, x, y, blend)); if (f >= 1) break; }
          w *= f;
        }
        return w;
      };
    });
    layer.paths = layer.paths.map((path) => {
      const parts: PathLayer[] = [];
      active.forEach((a, k) => {
        if (!wallMatches(a.app.target.walls ?? "outer", path.feature)) return;
        // Leave paths the mask never reaches untouched (keeps G-code small and exact there).
        if ((a.faces.length || a.app.mask.angle_min !== undefined || a.app.mask.angle_max !== undefined)
          && !resample(path.points, 1).some((q) => weights[k](q.x, q.y, layer.z, q.slope) > 0)) return;
        parts.push({ brush: a.brush, weight: weights[k], blend: a.app.blend, repeats: a.lockFor(path.feature) });
      });
      return parts.length ? composePath(path, parts, p, opt, warn, layer.index, check) : path;
    });
    if (opt.bondInnerWalls !== false) bondInnerWalls(layer, p, opt);
  }
  if (check.notes.includes("slow-z")) warn({ code: "motionex_slow_z", message: `${p.machine.name} moves up and down slowly (${p.machine.maxSpeed.z} mm/s), so up-and-down patterns will print slower` });
  return { layers, warnings };
}

/**
 * Inner walls follow the outer wall's movement, fading out over the wall stack, so the patterned skin
 * stays fused to the body: no gap opens behind an outward bump and no double plastic piles up behind an
 * inward dent. Only the side-to-side movement is followed; up-and-down movement stays on the outer wall.
 */
export function bondInnerWalls(layer: Layer, p: PrintProfiles, opt: ModifierOptions): number {
  const lw = p.process.lineWidth || 0.42;
  const reach = Math.max(1, p.process.walls) * lw;
  const cell = Math.max(0.5, lw * 2);
  const grid = new Map<string, { x: number; y: number; dx: number; dy: number }[]>();
  let any = false;
  for (const path of layer.paths) {
    if (path.modifiedBy !== "motionex" || !wallMatches("outer", path.feature) || !path.base) continue;
    const base = resample(path.base, opt.resampleStep);
    if (base.length !== path.points.length) continue;
    for (let i = 0; i < base.length; i++) {
      const q = path.points[i];
      if (q.travel) continue;
      // zero movement is kept too: an inner point behind a still part of the wall must stay still
      const dx = q.x - base[i].x, dy = q.y - base[i].y;
      if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) any = true;
      const key = `${Math.floor(base[i].x / cell)}|${Math.floor(base[i].y / cell)}`;
      const l = grid.get(key);
      const e = { x: base[i].x, y: base[i].y, dx, dy };
      if (l) l.push(e); else grid.set(key, [e]);
    }
  }
  if (!any) return 0;
  const span = Math.ceil((reach + lw) / cell);
  // cap so a big pattern doesn't drag the inner walls into the infill
  const cap = reach;
  let moved = 0;
  layer.paths = layer.paths.map((path) => {
    if (path.feature !== "inner_wall" || path.modifiedBy === "motionex") return path;
    const pts = resample(path.points, opt.resampleStep);
    let touched = false;
    const out: ToolpathPoint[] = pts.map((c) => {
      const gx = Math.floor(c.x / cell), gy = Math.floor(c.y / cell);
      let best: { x: number; y: number; dx: number; dy: number } | null = null, bd = Infinity;
      for (let ix = gx - span; ix <= gx + span; ix++) for (let iy = gy - span; iy <= gy + span; iy++) {
        for (const e of grid.get(`${ix}|${iy}`) ?? []) { const d = Math.hypot(e.x - c.x, e.y - c.y); if (d < bd) { bd = d; best = e; } }
      }
      const q: ToolpathPoint = { x: c.x, y: c.y, z: c.z, f: c.f, flow: c.flow, e: 0, slope: c.slope };
      if (!best) return q;
      // full follow for the wall right behind the outer one, fading to nothing at the inside of the stack
      const f = 1 - smooth((bd - lw) / reach);
      if (f <= 0) return q;
      let dx = best.dx * f, dy = best.dy * f;
      const m = Math.hypot(dx, dy);
      if (m > cap) { dx *= cap / m; dy *= cap / m; }
      q.x += dx; q.y += dy;
      touched = true;
      return q;
    });
    if (!touched) return path;
    moved++;
    return { ...path, points: out, modifiedBy: "motionex", base: path.base ?? path.points };
  });
  return moved;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
