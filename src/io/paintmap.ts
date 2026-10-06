import type { Body } from "../core/body.ts";
import type { Mesh } from "../core/mesh.ts";
import { addRegion, sample, type PaintMask } from "../core/mask.ts";
import { dominantState, encodeState } from "./paint.ts";

/** Maps object-space points (normalized mesh / body coordinates) to the (u, t) paint parameterisation. */
export function surfaceProjector(body: Body, M = 256, R = 128) {
  const H = body.height, rings = Array.from({ length: R }, (_, j) => body.ring(((j + 0.5) / R) * H, M));
  return (x: number, y: number, z: number): [number, number, number] => {
    const t = Math.min(1, Math.max(0, z / H));
    let j = Math.min(R - 1, Math.max(0, Math.round(t * R - 0.5)));
    // nearest non-empty ring
    for (let d = 0; d < R && !rings[j]; d++) j = rings[Math.min(R - 1, j + d)] ? Math.min(R - 1, j + d) : Math.max(0, j - d);
    const ring = rings[j];
    if (!ring) return [0, t, Infinity];
    let best = 0, bd = Infinity;
    for (let k = 0; k < M; k++) { const d = (ring.x[k] - x) ** 2 + (ring.y[k] - y) ** 2; if (d < bd) { bd = d; best = k; } }
    return [best / M, t, Math.sqrt(bd)]; // third value: distance (mm) from the point to the printed wall contour
  };
}

/**
 * Bambu/Prusa `paint_color` (extruder N) → NexSpiro paint region N (index N-1). Regions 1..maxState are created
 * so the numbering matches the source file. Returns the number of painted facets mapped.
 */
export function paintMeshToMask(mesh: Mesh, body: Body, mask: PaintMask, defaultPattern = "sine"): { facets: number; maxState: number } {
  const col = mesh.paint?.color;
  if (!col?.some(Boolean)) return { facets: 0, maxState: 0 };
  const states = col.map((h) => (h ? dominantState(h) : 0));
  const maxState = Math.min(8, Math.max(...states));
  while (mask.regions.length < maxState) addRegion(mask, defaultPattern);
  const proj = surfaceProjector(body), t = mesh.tris;
  const cell = Math.min((2 * Math.PI * Math.max(body.footprintRadius, 1)) / mask.cols, body.height / mask.rows);
  let facets = 0;
  const hit = new Uint8Array(mask.cols * mask.rows); // region+1 per touched cell
  states.forEach((st, f) => {
    if (st <= 0 || st > 8) return;
    facets++;
    const o = f * 9, P = [0, 1, 2].map((c) => [t[o + c * 3], t[o + c * 3 + 1], t[o + c * 3 + 2]]);
    const edge = Math.max(...[0, 1, 2].map((c) => Math.hypot(P[c][0] - P[(c + 1) % 3][0], P[c][1] - P[(c + 1) % 3][1], P[c][2] - P[(c + 1) % 3][2])));
    const s = Math.min(24, Math.max(1, Math.ceil(edge / cell)));
    for (let i = 0; i <= s; i++) for (let j = 0; j <= s - i; j++) {
      const a = i / s, b = j / s, c = 1 - a - b;
      const [u, v] = proj(a * P[0][0] + b * P[1][0] + c * P[2][0], a * P[0][1] + b * P[1][1] + c * P[2][1], a * P[0][2] + b * P[1][2] + c * P[2][2]);
      const cx = Math.min(mask.cols - 1, Math.floor(u * mask.cols)), cy = Math.min(mask.rows - 1, Math.round(v * (mask.rows - 1)));
      hit[cy * mask.cols + cx] = st;
    }
  });
  // write with a 1-cell dilation to close sampling gaps
  for (let y = 0; y < mask.rows; y++) for (let x = 0; x < mask.cols; x++) {
    const st = hit[y * mask.cols + x];
    if (!st) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy; if (yy < 0 || yy >= mask.rows) continue;
      const xx = (x + dx + mask.cols) % mask.cols, i = yy * mask.cols + xx;
      if (hit[i] && hit[i] !== st) continue;
      mask.regions[st - 1].weight[i] = 1;
    }
  }
  return { facets, maxState };
}

/** NexSpiro paint masks → per-facet `paint_color` strings (dominant region at the facet centroid). */
export function maskToPaintColor(mesh: Mesh, body: Body, mask: PaintMask): string[] {
  const proj = surfaceProjector(body), t = mesh.tris, out: string[] = [];
  for (let f = 0; f < t.length / 9; f++) {
    const o = f * 9;
    const [u, v] = proj((t[o] + t[o + 3] + t[o + 6]) / 3, (t[o + 1] + t[o + 4] + t[o + 7]) / 3, (t[o + 2] + t[o + 5] + t[o + 8]) / 3);
    let best = -1, bw = 0.5;
    mask.regions.forEach((_, k) => { const w = sample(mask, k, u, v); if (w > bw) { bw = w; best = k; } });
    out.push(best >= 0 ? encodeState(best + 1) : "");
  }
  return out;
}

/**
 * Paint (or erase) a set of display-mesh triangles into a mask region. Triangles are sampled on a barycentric grid
 * and each sample is projected onto the printed wall; samples farther than `maxDist` from the wall (caps, interior
 * faces) are ignored, so only faces that actually become spiral wall can carry a texture.
 */
export function paintTriangles(
  tris: Float32Array, selected: Iterable<number>, project: ReturnType<typeof surfaceProjector>, mask: PaintMask, region: number,
  opts: { erase?: boolean; height: number; radius: number; maxDist?: number } = { height: 1, radius: 1 },
): number {
  const w = mask.regions[region]?.weight; if (!w) return 0;
  const cell = Math.min((2 * Math.PI * Math.max(opts.radius, 1)) / mask.cols, opts.height / mask.rows), maxDist = opts.maxDist ?? 1 + cell;
  const hit = new Uint8Array(mask.cols * mask.rows); let used = 0;
  // sample spacing must be finer than one mask cell or large flat triangles (a cube face is two) leave gaps
  const list = [...selected], subdiv = (f: number) => {
    const o = f * 9;
    return Math.max(...[0, 1, 2].map((c) => Math.hypot(tris[o + c * 3] - tris[o + ((c + 1) % 3) * 3], tris[o + c * 3 + 1] - tris[o + ((c + 1) % 3) * 3 + 1], tris[o + c * 3 + 2] - tris[o + ((c + 1) % 3) * 3 + 2]))) / cell;
  };
  let total = 0; for (const f of list) total += Math.ceil(subdiv(f)) ** 2 / 2;
  const shrink = Math.max(1, Math.sqrt(total / 3_000_000));
  for (const f of list) {
    const o = f * 9, P = [0, 1, 2].map((c) => [tris[o + c * 3], tris[o + c * 3 + 1], tris[o + c * 3 + 2]]);
    const s = Math.min(900, Math.max(1, Math.ceil(subdiv(f) / shrink)));
    for (let i = 0; i <= s; i++) for (let j = 0; j <= s - i; j++) {
      const a = i / s, b = j / s, c = 1 - a - b;
      const [u, v, d] = project(a * P[0][0] + b * P[1][0] + c * P[2][0], a * P[0][1] + b * P[1][1] + c * P[2][1], a * P[0][2] + b * P[1][2] + c * P[2][2]);
      if (d > maxDist) continue;
      const cx = Math.min(mask.cols - 1, Math.floor(u * mask.cols)), cy = Math.min(mask.rows - 1, Math.round(v * (mask.rows - 1)));
      if (!hit[cy * mask.cols + cx]) used++;
      hit[cy * mask.cols + cx] = 1;
    }
  }
  for (let y = 0; y < mask.rows; y++) for (let x = 0; x < mask.cols; x++) {
    if (!hit[y * mask.cols + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy; if (yy < 0 || yy >= mask.rows) continue;
      const i = yy * mask.cols + ((x + dx + mask.cols) % mask.cols);
      if (opts.erase) w[i] = 0;
      else { w[i] = 1; for (const other of mask.regions) if (other.weight !== w) other.weight[i] = 0; }
    }
  }
  return used;
}
