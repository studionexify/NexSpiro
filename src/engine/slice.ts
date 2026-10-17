// Stage 2: Z-plane mesh intersection + topological loop chaining.
import { cleanPaths, SCALE, union, unionEvenOdd } from './clipper';
import type { Paths } from './types';
import type { IndexedMesh } from './mesh';
import ClipperLib from 'clipper-lib';

const C: any = (ClipperLib as any).default ?? ClipperLib;

/**
 * Slice an indexed mesh at each given plane height.
 * Intersection points are keyed by the mesh edge they lie on, so loops chain
 * by topology rather than float comparison.
 *
 * Modes (Bambu Studio's "Slicing mode"):
 *  - 'even_odd' (default here): every nested loop toggles inside/outside; robust to bad triangle winding.
 *  - 'regular': loops are oriented by the triangle normals and merged with non-zero winding, so overlapping
 *    shells of one mesh are unioned instead of cancelling each other.
 *  - 'close_holes': like regular, then every hole is filled.
 */
export type SlicingMode = 'regular' | 'even_odd' | 'close_holes';

export function sliceMesh(mesh: IndexedMesh, planes: number[], mode: SlicingMode = 'even_odd'): Paths[] {
  const v = mesh.vertices, ix = mesh.indices;
  const nV = v.length / 3;
  const triCount = ix.length / 3;

  // Sort triangles by min Z for a sweep.
  const tmin = new Float64Array(triCount), tmax = new Float64Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const za = v[ix[t * 3] * 3 + 2], zb = v[ix[t * 3 + 1] * 3 + 2], zc = v[ix[t * 3 + 2] * 3 + 2];
    tmin[t] = Math.min(za, zb, zc); tmax[t] = Math.max(za, zb, zc);
  }
  const order = Array.from({ length: triCount }, (_, i) => i).sort((a, b) => tmin[a] - tmin[b]);

  const result: Paths[] = [];
  let active: number[] = [];
  let next = 0;

  for (const z of planes) {
    while (next < order.length && tmin[order[next]] <= z) active.push(order[next++]);
    active = active.filter((t) => tmax[t] >= z);

    // edgeKey -> intersection point
    const ptX = new Map<number, number>(), ptY = new Map<number, number>();
    const segA: number[] = [], segB: number[] = [];
    // per segment: true when going segA → segB keeps the solid on the left (counter-clockwise outer loops)
    const segDir: boolean[] = [];

    for (const t of active) {
      const i0 = ix[t * 3], i1 = ix[t * 3 + 1], i2 = ix[t * 3 + 2];
      const tri = [i0, i1, i2];
      const keys: number[] = [];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const za = v[a * 3 + 2], zb = v[b * 3 + 2];
        const aAbove = za >= z, bAbove = zb >= z;
        if (aAbove === bAbove) continue;
        const lo = a < b ? a : b, hi = a < b ? b : a;
        const key = lo * nV + hi;
        if (!ptX.has(key)) {
          const zl = v[lo * 3 + 2], zh = v[hi * 3 + 2];
          const s = (z - zl) / (zh - zl);
          ptX.set(key, v[lo * 3] + s * (v[hi * 3] - v[lo * 3]));
          ptY.set(key, v[lo * 3 + 1] + s * (v[hi * 3 + 1] - v[lo * 3 + 1]));
        }
        keys.push(key);
      }
      if (keys.length === 2) {
        segA.push(keys[0]); segB.push(keys[1]);
        if (mode !== 'even_odd') {
          // face normal (from the winding) projected on XY: the solid lies opposite to it
          const ax = v[i0 * 3], ay = v[i0 * 3 + 1], az = v[i0 * 3 + 2];
          const ux = v[i1 * 3] - ax, uy = v[i1 * 3 + 1] - ay, uz = v[i1 * 3 + 2] - az;
          const wx = v[i2 * 3] - ax, wy = v[i2 * 3 + 1] - ay, wz = v[i2 * 3 + 2] - az;
          const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz;
          const dx = ptX.get(keys[1])! - ptX.get(keys[0])!, dy = ptY.get(keys[1])! - ptY.get(keys[0])!;
          // CCW around the solid: the outward normal is on the right of the direction of travel, right(d) = (dy, -dx)
          segDir.push(nx * dy - ny * dx > 0);
        }
      }
    }

    // adjacency: point key -> segment ids
    const adj = new Map<number, number[]>();
    for (let s = 0; s < segA.length; s++) {
      for (const k of [segA[s], segB[s]]) {
        const l = adj.get(k);
        if (l) l.push(s); else adj.set(k, [s]);
      }
    }
    const used = new Uint8Array(segA.length);
    const loops: Paths = [];
    for (let s0 = 0; s0 < segA.length; s0++) {
      if (used[s0]) continue;
      used[s0] = 1;
      const keys = [segA[s0], segB[s0]];
      // orientation vote: segments walked in their solid-on-the-left direction
      let vote = mode === 'even_odd' ? 0 : segDir[s0] ? 1 : -1;
      let cur = segB[s0];
      for (;;) {
        const cand = adj.get(cur);
        let nextSeg = -1;
        if (cand) for (const s of cand) if (!used[s]) { nextSeg = s; break; }
        if (nextSeg < 0) break;
        used[nextSeg] = 1;
        const forward = segA[nextSeg] === cur;
        if (mode !== 'even_odd') vote += forward === segDir[nextSeg] ? 1 : -1;
        cur = forward ? segB[nextSeg] : segA[nextSeg];
        if (cur === keys[0]) break;
        keys.push(cur);
      }
      if (keys.length >= 3) {
        const loop = keys.map((k) => ({ X: Math.round(ptX.get(k)! * SCALE), Y: Math.round(ptY.get(k)! * SCALE) }));
        if (vote < 0) loop.reverse();
        loops.push(loop);
      }
    }
    if (!loops.length) { result.push([]); continue; }
    if (mode === 'even_odd') { result.push(cleanPaths(unionEvenOdd(loops))); continue; }
    let r = union(loops); // non-zero winding: overlapping shells merge
    if (mode === 'close_holes') r = r.filter((p) => C.Clipper.Orientation(p));
    result.push(cleanPaths(r));
  }
  return result;
}
