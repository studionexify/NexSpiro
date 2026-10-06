import type { Body } from "../core/body.ts";
import type { Mesh } from "../core/mesh.ts";
import { addRegion, sample, type PaintMask } from "../core/mask.ts";
import { dominantState, encodeState } from "./paint.ts";

/** Maps object-space points (normalized mesh / body coordinates) to the (u, t) paint parameterisation. */
export function surfaceProjector(body: Body, M = 256, R = 128) {
  const H = body.height, rings = Array.from({ length: R }, (_, j) => body.ring(((j + 0.5) / R) * H, M));
  return (x: number, y: number, z: number): [number, number] => {
    const t = Math.min(1, Math.max(0, z / H));
    let j = Math.min(R - 1, Math.max(0, Math.round(t * R - 0.5)));
    // nearest non-empty ring
    for (let d = 0; d < R && !rings[j]; d++) j = rings[Math.min(R - 1, j + d)] ? Math.min(R - 1, j + d) : Math.max(0, j - d);
    const ring = rings[j];
    if (!ring) return [0, t];
    let best = 0, bd = Infinity;
    for (let k = 0; k < M; k++) { const d = (ring.x[k] - x) ** 2 + (ring.y[k] - y) ** 2; if (d < bd) { bd = d; best = k; } }
    return [best / M, t];
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
