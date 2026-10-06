import type { PatternParams } from "./patterns.ts";

// Paint regions live in (theta, t) surface space: cols wrap around the revolution, rows span height.
export type PaintRegion = { pattern: string; params?: Partial<PatternParams>; weight: Float32Array };
export type PaintMask = { cols: number; rows: number; regions: PaintRegion[] };

export function createMask(cols = 256, rows = 256): PaintMask {
  return { cols, rows, regions: [] };
}
export function addRegion(m: PaintMask, pattern: string, params?: Partial<PatternParams>): number {
  m.regions.push({ pattern, params, weight: new Float32Array(m.cols * m.rows) });
  return m.regions.length - 1;
}

/** Soft circular brush. u ∈ [0,1) around, v ∈ [0,1] up; radius in mask cells. erase lowers weight. */
export function stamp(m: PaintMask, region: number, u: number, v: number, radius: number, erase = false) {
  const w = m.regions[region]?.weight;
  if (!w) return;
  const cu = u * m.cols, cv = v * (m.rows - 1), r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    const row = Math.round(cv) + dy;
    if (row < 0 || row >= m.rows) continue;
    for (let dx = -r; dx <= r; dx++) {
      const colF = Math.round(cu) + dx;
      const d = Math.hypot(colF - cu, row - cv) / radius;
      if (d > 1) continue;
      const col = ((colF % m.cols) + m.cols) % m.cols;
      const k = 1 - d * d; // soft falloff → blended borders
      const i = row * m.cols + col;
      w[i] = erase ? Math.max(0, w[i] - k) : Math.max(w[i], k);
      if (!erase) for (const other of m.regions) if (other.weight !== w) other.weight[i] = Math.min(other.weight[i], 1 - w[i]);
    }
  }
}

/** Bilinear weight sample with angular wrap. */
export function sample(m: PaintMask, region: number, u: number, v: number): number {
  const w = m.regions[region].weight;
  const x = (((u % 1) + 1) % 1) * m.cols, y = Math.min(Math.max(v, 0), 1) * (m.rows - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const x1 = (x0 + 1) % m.cols, y1 = Math.min(y0 + 1, m.rows - 1), xa = x0 % m.cols;
  const a = w[y0 * m.cols + xa], b = w[y0 * m.cols + x1], c = w[y1 * m.cols + xa], d = w[y1 * m.cols + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
