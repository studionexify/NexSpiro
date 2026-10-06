// Triangle mesh → per-layer closed contours (ExPoly islands).
import type { ExPoly, Ring } from "./types.ts";
import { pathsToPolys, ringToPath, dropHoles, ringArea, simplifyPolys, type CPaths } from "./geom.ts";

export type SliceOpts = {
  /** Open contours whose endpoints are closer than this (mm) are joined/closed. */
  closingRadius?: number;
  mode?: "regular" | "even_odd" | "close_holes";
  /** Douglas-Peucker tolerance applied to the result, mm (0 = off). */
  resolution?: number;
  /** Receives human readable diagnostics (open contours, ...). */
  warnings?: string[];
};

const Q = 1e4, OFF = 2 ** 25, SH = 2 ** 26;
const key = (x: number, y: number) => (Math.round(x * Q) + OFF) * SH + (Math.round(y * Q) + OFF);

type Chain = { pts: number[]; reversed: boolean };

/**
 * Slices `tris` (9 floats per triangle) at every plane height of `zList` (ascending, mm).
 * A vertex exactly on a plane counts as above it, which keeps neighbouring triangles consistent.
 */
export function sliceMesh(tris: Float32Array, zList: number[], opts: SliceOpts = {}): ExPoly[][] {
  const nl = zList.length, nt = (tris.length / 9) | 0;
  const segs: number[][] = Array.from({ length: nl }, () => []);   // x0,y0,x1,y1 per segment
  const lowerBound = (v: number) => { let lo = 0, hi = nl; while (lo < hi) { const m = (lo + hi) >> 1; if (zList[m] > v) hi = m; else lo = m + 1; } return lo; }; // first z > v
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    let ax = tris[o], ay = tris[o + 1], az = tris[o + 2], bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5], cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
    if (!(Number.isFinite(ax + ay + az + bx + by + bz + cx + cy + cz))) continue;
    const zmin = Math.min(az, bz, cz), zmax = Math.max(az, bz, cz);
    if (zmin === zmax) continue;
    const lo = lowerBound(zmin);         // first plane strictly above zmin
    for (let l = lo; l < nl; l++) {
      const z = zList[l]; if (z > zmax) break;
      const ua = az >= z, ub = bz >= z, uc = cz >= z;
      if (ua === ub && ub === uc) continue;
      // find the edge crossing below→above (end) and above→below (start) following vertex order
      const px = [ax, bx, cx], py = [ay, by, cy], pz = [az, bz, cz], up = [ua, ub, uc];
      let sx = 0, sy = 0, ex = 0, ey = 0;
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3; if (up[i] === up[j]) continue;
        // canonical edge order so that both triangles sharing the edge compute the identical point
        let i0 = i, i1 = j;
        if (pz[i0] > pz[i1] || (pz[i0] === pz[i1] && (px[i0] > px[i1] || (px[i0] === px[i1] && py[i0] > py[i1])))) { i0 = j; i1 = i; }
        const f = (z - pz[i0]) / (pz[i1] - pz[i0]);
        const x = px[i0] + (px[i1] - px[i0]) * f, y = py[i0] + (py[i1] - py[i0]) * f;
        if (up[j]) { ex = x; ey = y; } else { sx = x; sy = y; }
      }
      segs[l].push(sx, sy, ex, ey);
    }
  }
  const closeR = Math.max(0, opts.closingRadius ?? 0.049);
  let openCount = 0, badLayers = 0;
  const out: ExPoly[][] = new Array(nl);
  for (let l = 0; l < nl; l++) {
    const r = chainLayer(segs[l], closeR);
    openCount += r.open; if (r.open) badLayers++;
    if (!r.loops.length) { out[l] = []; continue; }
    const paths: CPaths = [];
    for (const lp of r.loops) { if (lp.length < 6) continue; paths.push(ringToPath(lp)); }
    const mode = opts.mode ?? "regular";
    let polys = pathsToPolys(paths, mode === "even_odd" || r.flipped ? "evenodd" : "nonzero");
    if (mode === "close_holes") polys = dropHoles(polys);
    if (opts.resolution && opts.resolution > 0) polys = simplifyPolys(polys, opts.resolution);
    out[l] = polys;
  }
  if (opts.warnings) {
    if (openCount) opts.warnings.push(`Mesh is not watertight: ${openCount} open contour${openCount > 1 ? "s" : ""} on ${badLayers} layer${badLayers > 1 ? "s" : ""} were closed or dropped.`);
  }
  return out;
}

/** Chains directed segments into rings; joins/closes open chains within `closeR`. */
function chainLayer(seg: number[], closeR: number): { loops: Ring[]; open: number; flipped: boolean } {
  const n = seg.length >> 2; if (!n) return { loops: [], open: 0, flipped: false };
  const startMap = new Map<number, number>(), nextSame = new Int32Array(n).fill(-1);
  const sk = new Float64Array(n), ek = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sk[i] = key(seg[4 * i], seg[4 * i + 1]); ek[i] = key(seg[4 * i + 2], seg[4 * i + 3]);
    const h = startMap.get(sk[i]); if (h !== undefined) nextSame[i] = h; startMap.set(sk[i], i);
  }
  const used = new Uint8Array(n), loops: Ring[] = [], chains: Chain[] = [];
  const take = (k: number): number => { // pop an unused segment starting at k
    let h = startMap.get(k);
    while (h !== undefined && h >= 0) { if (!used[h]) return h; h = nextSame[h]; if (h < 0) break; }
    return -1;
  };
  for (let i = 0; i < n; i++) {
    if (used[i] || sk[i] === ek[i]) { used[i] = 1; continue; }
    used[i] = 1;
    const pts = [seg[4 * i], seg[4 * i + 1], seg[4 * i + 2], seg[4 * i + 3]];
    const first = sk[i]; let cur = ek[i], closed = false;
    for (;;) {
      if (cur === first) { closed = true; break; }
      const j = take(cur); if (j < 0) break;
      used[j] = 1; if (sk[j] === ek[j]) continue;
      pts.push(seg[4 * j + 2], seg[4 * j + 3]); cur = ek[j];
    }
    if (closed) { pts.length -= 2; if (pts.length >= 6) loops.push(Float64Array.from(pts)); }
    else chains.push({ pts, reversed: false });
  }
  let open = 0, flipped = false;
  if (chains.length) {
    open = chains.length;
    // join chains: any endpoint to any endpoint within closeR (reversal ⇒ inconsistent winding)
    const maxC = 600;
    if (chains.length <= maxC && closeR > 0) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let a = 0; a < chains.length && !changed; a++) {
          const A = chains[a]; const ax = A.pts[A.pts.length - 2], ay = A.pts[A.pts.length - 1];
          let best = -1, bestD = closeR * closeR, bestRev = false;
          for (let b = 0; b < chains.length; b++) {
            if (b === a) continue; const B = chains[b];
            const d1 = (B.pts[0] - ax) ** 2 + (B.pts[1] - ay) ** 2, d2 = (B.pts[B.pts.length - 2] - ax) ** 2 + (B.pts[B.pts.length - 1] - ay) ** 2;
            if (d1 <= bestD) { bestD = d1; best = b; bestRev = false; }
            if (d2 < bestD) { bestD = d2; best = b; bestRev = true; }
          }
          if (best >= 0) {
            const B = chains[best];
            let bp = B.pts; if (bestRev) { const r: number[] = []; for (let k = bp.length - 2; k >= 0; k -= 2) r.push(bp[k], bp[k + 1]); bp = r; flipped = true; }
            A.pts = A.pts.concat(bp); chains.splice(best, 1); changed = true;
          }
        }
      }
    }
    for (const c of chains) {
      const p = c.pts; const gap = Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]);
      if (p.length >= 8 && gap <= Math.max(closeR, 1e-6) * 1.0) { loops.push(Float64Array.from(p)); }
      else if (p.length >= 8 && Math.abs(ringArea(p)) > 0.01 && gap < 5) loops.push(Float64Array.from(p)); // dirty mesh: implicit closing
    }
    open = chains.length;
  }
  return { loops, open, flipped };
}
