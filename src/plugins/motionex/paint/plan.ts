// Velocity painting before slicing: print settings it needs and what it costs in time.
import type { PaintSettings } from './model';
import { paintLevels, speedOfLevel } from './model';

/**
 * Print settings for velocity painting: an aligned seam (out of the picture, at the back), and no
 * pressure equalizer (it smooths speed steps into blurs). Everything else stays as the print has it;
 * painted lines are already kept out of arc fitting and the cooling slowdown.
 */
export function paintPrintSettings(_p: PaintSettings): Record<string, string | number | boolean> {
  return { seam_position: 'aligned', seam_slope_type: 'none', max_volumetric_extrusion_rate_slope_positive: 0, max_volumetric_extrusion_rate_slope_negative: 0 };
}

/** Mean outer wall speed of the picture (mm/s): the share of each level times its speed, by time. */
export function meanPaintSpeed(p: PaintSettings): number {
  const n = paintLevels(p);
  const count = new Array<number>(n).fill(0);
  const px = p.calibration ? Array.from({ length: n }, (_, k) => k) : p.image.px;
  for (const v of px) count[Math.min(n - 1, v)]++;
  const total = px.length || 1;
  // time per mm is 1/v: the mean speed over a length is the harmonic mean weighted by share
  let tPerMm = 0;
  count.forEach((c, k) => { tPerMm += c / total / Math.max(1, speedOfLevel(p, k, n)); });
  return 1 / Math.max(1e-9, tPerMm);
}

/** Head travel (mm) to change between two speeds at an acceleration: |v1² − v0²| / 2a. */
export const rampMm = (v0: number, v1: number, accel: number) => Math.abs(v1 * v1 - v0 * v0) / (2 * Math.max(1, accel));
