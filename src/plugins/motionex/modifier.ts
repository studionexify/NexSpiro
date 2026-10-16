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
  /** Speed for parts where loops overlap, as a share of the wall speed (spec: loops print slow and warn). */
  loopSpeedShare: number;
}
export const DEFAULT_OPTIONS: ModifierOptions = { resampleStep: 0.2, loopSpeedShare: 0.5 };

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
export function eventPositions(b: MotionBrush, L: number, layer: number): { s: number; i: number }[] {
  if (!b.events.length) return [];
  const lp = layerPhase(b, layer);
  if (lp === null) return [];
  const period = periodFor(b, L);
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

/** Apply one brush to one path, returning a new path. */
export function applyBrushToPath(path: Toolpath, b: MotionBrush, p: PrintProfiles, opt: ModifierOptions, weight: Weight, warn: (w: SliceWarning) => void, layer = 0, check: PrintCheck = emptyCheck(), source?: ToolpathPoint[], repeats?: RepeatLock): Toolpath {
  const samples = resample(source ?? path.points, opt.resampleStep);
  const L = samples[samples.length - 1].s;
  if (L <= 0) return path;
  // "Fit evenly" on a closed loop: the same number of repeats every layer, placed by angle round the
  // loop, so the pattern stacks straight up even when the loop grows or shrinks (vases, cones).
  let lockPeriod: number | undefined, cx = 0, cy = 0;
  if (repeats && path.closed && b.repeat_mode === "stretch") {
    for (const q of samples) { cx += q.x; cy += q.y; }
    cx /= samples.length; cy /= samples.length;
    const n = repeats(cx, cy, Math.max(1, Math.round(L / b.period_mm)));
    lockPeriod = L / n;
  }
  const posAt = (c: Sample) => lockPeriod === undefined ? c.s : ((((Math.atan2(c.y - cy, c.x - cx) / (2 * Math.PI)) % 1) + 1) % 1) * L;
  const { machine, process, filament } = p;
  const maxXY = Math.min(machine.maxSpeed.x, machine.maxSpeed.y);
  const filArea = Math.PI * (filament.diameter / 2) ** 2;
  const events = eventPositions(b, L, layer);
  let ev = 0, flowState = 1, travelUntil = -1, pendingUnretract = 0;
  const out: ToolpathPoint[] = [];
  let flowClamps = 0, speedClamps = 0, zClamps = 0;
  for (let i = 0; i < samples.length; i++) {
    const c = samples[i];
    // Tangent from neighbours; for closed paths wrap around so the seam has no kink.
    const prev = samples[i > 0 ? i - 1 : path.closed ? samples.length - 2 : 0];
    const next = samples[i < samples.length - 1 ? i + 1 : path.closed ? 1 : samples.length - 1];
    let tx = next.x - prev.x, ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    // Outward normal: walls are CCW, so outward is the right-hand normal.
    const nx = ty, ny = -tx;
    const w = clamp(weight(c.x, c.y, c.z, c.slope), 0, 1);
    const s = path.closed && i === samples.length - 1 ? posAt(samples[0]) : posAt(c); // seam closes onto its own start
    const m = w > 0 ? brushAt(b, s, L, layer, lockPeriod) : null;
    const q: ToolpathPoint = { x: c.x, y: c.y, z: c.z, f: c.f, flow: c.flow, e: 0, slope: c.slope };
    if (m) {
      q.x += (nx * m.lat + tx * m.along) * w;
      q.y += (ny * m.lat + ty * m.along) * w;
      const dz = m.z * w;
      if (dz !== 0) { q.z = round(c.z + dz); q.zOff = round(dz); }
      let flow = c.flow * (1 + (m.flow * flowState - 1) * w);
      const fc = clamp(flow, b.limits.min_flow_mult, b.limits.max_flow_mult);
      if (fc !== flow) flowClamps++;
      q.flow = fc;
      q.f = c.f * (1 + (m.speed - 1) * w);
    }
    // Events land on the first sample at or past their position.
    let retractedHere = false;
    while (ev < events.length && events[ev].s <= c.s + 1e-9) {
      const e = b.events[events[ev++].i];
      if (w < 0.5) continue;
      if (e.type === "dwell") {
        q.post = { ...q.post, dwell_ms: Math.max(0, e.params.ms ?? 200) };
        if ((e.params.blob_mm3 ?? 0) > 0) q.post.blob_mm = round(e.params.blob_mm3 / filArea);
        check.events.dwell++;
      } else if (e.type === "flow_change") {
        flowState = Math.max(0, e.params.mult ?? 1);
        check.events.flow++;
      } else if (e.type === "retract" && pendingUnretract === 0) {
        const len = (e.params.length ?? 0) > 0 ? e.params.length : process.retractLength;
        q.post = { ...q.post, retract_mm: len };
        pendingUnretract = len;
        travelUntil = c.s + Math.max(0.2, e.params.travel_mm ?? 1);
        check.events.retract++;
        retractedHere = true;
      }
    }
    if (retractedHere) { out.push(q); continue; }
    if (pendingUnretract > 0) {
      if (c.s <= travelUntil + 1e-9) q.travel = true;
      else { const last = out[out.length - 1]; last.post = { ...last.post, unretract_mm: pendingUnretract }; pendingUnretract = 0; }
    }
    out.push(q);
  }
  if (pendingUnretract > 0) { const last = out[out.length - 1]; last.post = { ...last.post, unretract_mm: pendingUnretract }; }

  // Second pass: loops, speed limits, up-and-down speed and corner hardness, using the final positions.
  const loopSpeed = process.wallSpeed * opt.loopSpeedShare;
  let loops = 0, accel = 0;
  // Only forward-and-back movement can make the nozzle run backwards over its own plastic.
  const canLoop = b.curves.along_offset.points.some((q) => Math.abs(q.v) > 1e-9) && b.amplitude > 0;
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
    const len3 = Math.hypot(q.x - a.x, q.y - a.y, q.z - a.z), dz = Math.abs(q.z - a.z);
    if (dz > 1e-6 && len3 > 0 && (q.f * dz) / len3 > machine.maxSpeed.z) { q.f = (machine.maxSpeed.z * len3) / dz; zClamps++; }
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
  if (flowClamps) warn({ code: "motionex_flow_limit", message: `${flowClamps} spots hit this pattern's plastic limit` });
  if (speedClamps) warn({ code: "motionex_speed_limit", message: `Some spots were slowed to your printer's top speed (${maxXY} mm/s)` });
  if (loops) warn({ code: "motionex_loops", message: `${b.name}: loops lay plastic over itself, so those parts print slower (${Math.round(loopSpeed)} mm/s)` });
  if (zClamps) warn({ code: "motionex_z_speed", message: `Up-and-down moves slowed to your printer's top up/down speed (${machine.maxSpeed.z} mm/s)` });
  if (accel) warn({ code: "motionex_accel", message: "Some tight turns are sharper than your printer can follow at full speed; it will round them off slightly" });
  return { ...path, points: out, modifiedBy: "motionex", base: path.base ?? path.points };
}

/** Run all enabled applications in order over the layers. */
export function applyMotion(layers: Layer[], apps: MotionApplication[], brushes: (id: string) => MotionBrush | undefined, p: PrintProfiles, opt: ModifierOptions = DEFAULT_OPTIONS, check: PrintCheck = emptyCheck(), regions?: RegionRegistry): { layers: Layer[]; warnings: SliceWarning[] } {
  const warnings: SliceWarning[] = [];
  const seen = new Set<string>();
  const warn = (w: SliceWarning) => { if (!seen.has(w.code)) { seen.add(w.code); warnings.push(w); } };
  const sorted = apps.filter((a) => a.enabled).sort((a, b) => a.order - b.order);
  for (const app of sorted) {
    const found = brushes(app.brush_id);
    const k = app.scale ?? 1;
    const brush = found && k !== 1 ? { ...found, amplitude: found.amplitude * k, period_mm: found.period_mm * k, z_amplitude: (found.z_amplitude ?? 0) * k } : found;
    if (!brush) { warn({ code: "motionex_missing_brush", message: `Pattern ${app.brush_id} was not found` }); continue; }
    const faces = app.target.type === "faces" ? (app.target.faces ?? []).map((id) => regions?.get(id)).filter((r): r is PatternexRegion => !!r) : [];
    if (app.target.type === "faces" && !faces.length) { warn({ code: "motionex_faces_missing", message: "A pattern is set to picked surfaces but none are picked, so it was skipped" }); continue; }
    if ((brush.z_amplitude ?? 0) > 0 && p.machine.firmware !== "klipper" && !check.notes.includes("slow-z"))
      check.notes.push("slow-z");
    const { z_start, z_end, fade_in_mm, fade_out_mm, angle_min, angle_max } = app.mask;
    const blend = app.mask.blend_mm ?? 0;
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
    for (const layer of layers) {
      if (zWeight(layer.z) <= 0) continue;
      const weight: Weight = (x, y, z, slope) => {
        let w = zWeight(z);
        if (angle_min !== undefined && slope < angle_min) return 0;
        if (angle_max !== undefined && slope > angle_max) return 0;
        if (faces.length) {
          let f = 0;
          for (const r of faces) { f = Math.max(f, regionWeight(r, layer.index, x, y, blend)); if (f >= 1) break; }
          w *= f;
        }
        return w;
      };
      layer.paths = layer.paths.map((path) => {
        const hit = wallMatches(app.target.walls ?? "outer", path.feature);
        if (!hit) return path;
        // Leave paths the mask never reaches untouched (keeps G-code small and exact there).
        if (faces.length && !resample(path.points, 1).some((q) => weight(q.x, q.y, layer.z, 0) > 0)) return path;
        // "Replace" starts again from the slicer's path; "add" builds on whatever earlier patterns did.
        const source = app.blend === "override" ? path.base ?? path.points : undefined;
        return applyBrushToPath(path, brush, p, opt, weight, warn, layer.index, check, source, lockFor(path.feature));
      });
    }
  }
  if (check.notes.includes("slow-z")) warn({ code: "motionex_slow_z", message: `${p.machine.name} moves up and down slowly (${p.machine.maxSpeed.z} mm/s), so up-and-down patterns will print slower` });
  return { layers, warnings };
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
