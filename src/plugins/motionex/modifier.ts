// Motionex toolpath modifier (spec §6 steps 1–5; events and Z are later phases).
// resample → path tangent/normal → evaluate curves → offset XY → flow & speed multipliers.
// Extrusion itself is recomputed by the core from the real 3D length after all plugins run.
import type { Layer, SliceWarning, Toolpath, ToolpathPoint } from "../../core/types.ts";
import type { PrintProfiles } from "../../core/profiles.ts";
import { evalCurve, clamp } from "./curve.ts";
import { noise1d } from "./noise.ts";
import type { MotionApplication, MotionBrush } from "./model.ts";

export interface ModifierOptions { resampleStep: number }
export const DEFAULT_OPTIONS: ModifierOptions = { resampleStep: 0.2 };

interface Sample { x: number; y: number; z: number; s: number; f: number; flow: number }

/** Resample a polyline so no segment is longer than step. Keeps original vertices (corners stay sharp). */
export function resample(points: ToolpathPoint[], step: number): Sample[] {
  const out: Sample[] = [];
  let s = 0;
  out.push({ x: points[0].x, y: points[0].y, z: points[0].z, s: 0, f: points[0].f, flow: points[0].flow });
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step - 1e-9));
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, s: s + len * u, f: b.f, flow: b.flow });
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

/** Brush sample at arc length s along a path of total length L. Returns null where the brush does not apply. */
export function brushAt(b: MotionBrush, s: number, L: number, layer = 0): { lat: number; along: number; flow: number; speed: number } | null {
  const lp = layerPhase(b, layer);
  if (lp === null) return null;
  if (b.layers?.cross && lp !== 0) {
    const a = sampleAt(b, s, L, b.phase_deg + lp), c = sampleAt(b, s, L, b.phase_deg - lp);
    if (!a || !c) return a ?? c;
    // The higher of the two keeps both ridges at full height, including where they cross.
    return { lat: Math.max(a.lat, c.lat), along: (a.along + c.along) / 2, flow: (a.flow + c.flow) / 2, speed: Math.min(a.speed, c.speed) };
  }
  return sampleAt(b, s, L, b.phase_deg + lp);
}

function sampleAt(b: MotionBrush, s: number, L: number, phaseDeg: number): { lat: number; along: number; flow: number; speed: number } | null {
  let period = b.period_mm;
  if (b.repeat_mode === "stretch") period = L / Math.max(1, Math.round(L / b.period_mm));
  const ph = (((phaseDeg % 360) + 360) % 360 / 360) * period;
  if (b.repeat_mode === "once" && s + ph > period) return null;
  const u = (((s + ph) / period) % 1 + 1) % 1;
  let lat = evalCurve(b.curves.lateral_offset, u);
  if (b.noise?.enabled) lat += noise1d((s + ph) / (period * b.noise.scale), b.noise.seed, b.noise.octaves, b.noise.persistence);
  return {
    lat: lat * b.amplitude,
    along: evalCurve(b.curves.along_offset, u) * b.amplitude,
    flow: evalCurve(b.curves.extrusion_mult, u),
    speed: evalCurve(b.curves.speed_mult, u),
  };
}

/** Apply one brush to one path, in place semantics returning a new path. */
export function applyBrushToPath(path: Toolpath, b: MotionBrush, p: PrintProfiles, opt: ModifierOptions, fade: (z: number, s: number) => number, warn: (w: SliceWarning) => void, layer = 0): Toolpath {
  const samples = resample(path.points, opt.resampleStep);
  const L = samples[samples.length - 1].s;
  if (L <= 0) return path;
  const maxXY = Math.min(p.machine.maxSpeed.x, p.machine.maxSpeed.y);
  const out: ToolpathPoint[] = [];
  let flowClamps = 0, speedClamps = 0;
  for (let i = 0; i < samples.length; i++) {
    const c = samples[i];
    // Tangent from neighbours; for closed paths wrap around so the seam has no kink.
    const prev = samples[i > 0 ? i - 1 : path.closed ? samples.length - 2 : 0];
    const next = samples[i < samples.length - 1 ? i + 1 : path.closed ? 1 : samples.length - 1];
    let tx = next.x - prev.x, ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    // Outward normal: walls are CCW, so outward is the right-hand normal.
    const nx = ty, ny = -tx;
    const w = fade(c.z, c.s);
    const s = path.closed && i === samples.length - 1 ? 0 : c.s; // seam closes onto its own start
    const m = w > 0 ? brushAt(b, s, L, layer) : null;
    if (!m) { out.push({ x: c.x, y: c.y, z: c.z, f: c.f, flow: c.flow, e: 0 }); continue; }
    let flow = c.flow * (1 + (m.flow - 1) * w);
    const fc = clamp(flow, b.limits.min_flow_mult, b.limits.max_flow_mult);
    if (fc !== flow) flowClamps++;
    flow = fc;
    let f = c.f * (1 + (m.speed - 1) * w);
    if (f > maxXY) { f = maxXY; speedClamps++; }
    out.push({
      x: c.x + (nx * m.lat + tx * m.along) * w,
      y: c.y + (ny * m.lat + ty * m.along) * w,
      z: c.z, f, flow, e: 0,
    });
  }
  if (flowClamps) warn({ code: "motionex_flow_limit", message: `${flowClamps} spots hit this pattern's plastic limit` });
  if (speedClamps) warn({ code: "motionex_speed_limit", message: `${speedClamps} spots were slowed to your printer's top speed (${maxXY} mm/s)` });
  return { ...path, points: out, modifiedBy: "motionex" };
}

function matchesTarget(app: MotionApplication, path: Toolpath): boolean {
  switch (app.target.type) {
    case "model": return true;
    case "feature": return path.feature === app.target.ref;
    case "height_range": return true; // z handled by the mask
    case "patternex_region": return false; // phase 8
  }
}

/** Run all enabled applications in order over the layers. */
export function applyMotion(layers: Layer[], apps: MotionApplication[], brushes: (id: string) => MotionBrush | undefined, p: PrintProfiles, opt: ModifierOptions = DEFAULT_OPTIONS): { layers: Layer[]; warnings: SliceWarning[] } {
  const warnings: SliceWarning[] = [];
  const seen = new Set<string>();
  const warn = (w: SliceWarning) => { if (!seen.has(w.code)) { seen.add(w.code); warnings.push(w); } };
  const sorted = apps.filter((a) => a.enabled).sort((a, b) => a.order - b.order);
  for (const app of sorted) {
    const found = brushes(app.brush_id);
    const k = app.scale ?? 1;
    const brush = found && k !== 1 ? { ...found, amplitude: found.amplitude * k, period_mm: found.period_mm * k } : found;
    if (!brush) { warn({ code: "motionex_missing_brush", message: `Pattern ${app.brush_id} was not found` }); continue; }
    if (app.target.type === "patternex_region") { warn({ code: "motionex_patternex", message: "Region patterns are coming soon, so this one was skipped" }); continue; }
    if (brush.curves.z_offset.points.some((q) => Math.abs(q.v) > 1e-9)) warn({ code: "motionex_z_pending", message: `${brush.name}: the up-and-down part is coming soon and was skipped` });
    const { z_start, z_end, fade_in_mm, fade_out_mm } = app.mask;
    const fade = (z: number) => {
      if (z < z_start || z > z_end) return 0;
      const a = fade_in_mm > 0 ? clamp((z - z_start) / fade_in_mm, 0, 1) : 1;
      const b = fade_out_mm > 0 ? clamp((z_end - z) / fade_out_mm, 0, 1) : 1;
      return Math.min(a, b);
    };
    for (const layer of layers) {
      if (fade(layer.z) <= 0) continue;
      layer.paths = layer.paths.map((path) => matchesTarget(app, path) ? applyBrushToPath(path, brush, p, opt, fade, warn, layer.index) : path);
    }
  }
  return { layers, warnings };
}
