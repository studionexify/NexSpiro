// STL import + planar mesh slicing for spiral (vase-mode) walls.
// A mesh is a flat Float32Array of triangles: 9 floats (3 vertices × xyz) per triangle.

export type Mesh = {
  name: string;
  tris: Float32Array;            // 9 floats per triangle
  normals?: Float32Array;        // optional per-corner normals (9 per triangle), e.g. analytic normals from STEP
  colors?: Float32Array;         // optional per-corner RGB 0..1 (9 per triangle), e.g. PLY vertex colours
  triMaterial?: Uint16Array;     // optional per-triangle material index into `materials`
  materials?: string[];
  /** Bambu/Prusa TriangleSelector paint strings per triangle (hex, as stored in 3MF). Empty string = unpainted. */
  paint?: { color?: string[]; supports?: string[]; seam?: string[] };
};
export type Bounds = { min: [number, number, number]; max: [number, number, number] };

export function parseSTL(buf: ArrayBuffer, name = "mesh"): Mesh {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {        // binary STL
      const tris = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;               // skip facet normal
        for (let k = 0; k < 9; k++) tris[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return { name, tris };
    }
  }
  const text = new TextDecoder().decode(buf);    // ASCII STL
  if (!/^\s*solid/i.test(text)) throw new Error("Not a valid STL file");
  const nums: number[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)) nums.push(+m[1], +m[2], +m[3]);
  if (!nums.length || nums.length % 9 || nums.some((v) => !Number.isFinite(v))) throw new Error("Malformed ASCII STL");
  return { name, tris: new Float32Array(nums) };
}

export function bounds(tris: Float32Array): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], tris[i + k]); max[k] = Math.max(max[k], tris[i + k]);
  }
  return { min, max };
}

/** Centre the bbox on XY origin and drop onto z = 0 (in place). */
export function normalizeMesh(m: Mesh): Mesh & { offset: [number, number, number] } {
  const b = bounds(m.tris), cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  for (let i = 0; i < m.tris.length; i += 3) { m.tris[i] -= cx; m.tris[i + 1] -= cy; m.tris[i + 2] -= b.min[2]; }
  return Object.assign(m, { offset: [cx, cy, b.min[2]] as [number, number, number] });
}

/** Triangle index sorted by zmin, for fast plane queries. */
export type SliceIndex = { tris: Float32Array; order: Uint32Array; zmin: Float32Array; zmax: Float32Array; maxSpan: number };
export function buildSliceIndex(tris: Float32Array): SliceIndex {
  const n = tris.length / 9, zmin = new Float32Array(n), zmax = new Float32Array(n);
  let maxSpan = 0;
  for (let i = 0; i < n; i++) {
    const a = tris[i * 9 + 2], b = tris[i * 9 + 5], c = tris[i * 9 + 8];
    zmin[i] = Math.min(a, b, c); zmax[i] = Math.max(a, b, c); maxSpan = Math.max(maxSpan, zmax[i] - zmin[i]);
  }
  const order = new Uint32Array(n).map((_, i) => i).sort((p, q) => zmin[p] - zmin[q]);
  const sortedMin = new Float32Array(n), sortedMax = new Float32Array(n);
  order.forEach((t, k) => { sortedMin[k] = zmin[t]; sortedMax[k] = zmax[t]; });
  return { tris, order, zmin: sortedMin, zmax: sortedMax, maxSpan };
}

export type Loop = Float64Array; // x,y pairs, closed implicitly

/** Intersect mesh with plane z and chain segments into closed loops. */
export function sliceAt(ix: SliceIndex, z: number): Loop[] {
  const { tris, order, zmin, zmax, maxSpan } = ix;
  // binary search: first triangle with zmin > z - maxSpan
  let lo = 0, hi = order.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (zmin[m] < z - maxSpan) lo = m + 1; else hi = m; }
  const segs: number[] = [];
  for (let k = lo; k < order.length && zmin[k] <= z; k++) {
    if (zmax[k] < z) continue;
    const o = order[k] * 9, pts: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = o + e * 3, b = o + ((e + 1) % 3) * 3;
      const za = tris[a + 2], zb = tris[b + 2];
      if ((za < z && zb >= z) || (zb < z && za >= z)) {
        const t = (z - za) / (zb - za);
        pts.push(tris[a] + t * (tris[b] - tris[a]), tris[a + 1] + t * (tris[b + 1] - tris[a + 1]));
      }
    }
    if (pts.length === 4) segs.push(...pts);
  }
  // chain by quantised endpoints
  const key = (x: number, y: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
  const adj = new Map<string, number[]>();
  const nSeg = segs.length / 4;
  for (let s = 0; s < nSeg; s++) for (const end of [0, 1]) {
    const k = key(segs[s * 4 + end * 2], segs[s * 4 + end * 2 + 1]);
    (adj.get(k) ?? adj.set(k, []).get(k)!).push(s * 2 + end);
  }
  const used = new Uint8Array(nSeg), loops: Loop[] = [];
  for (let s0 = 0; s0 < nSeg; s0++) {
    if (used[s0]) continue;
    const pts: number[] = [];
    let s = s0, end = 0;
    while (!used[s]) {
      used[s] = 1;
      pts.push(segs[s * 4 + end * 2], segs[s * 4 + end * 2 + 1]);
      const ox = segs[s * 4 + (1 - end) * 2], oy = segs[s * 4 + (1 - end) * 2 + 1];
      const next = (adj.get(key(ox, oy)) ?? []).find((c) => !used[c >> 1]);
      if (next === undefined) break;
      s = next >> 1; end = next & 1;
    }
    if (pts.length >= 6) loops.push(new Float64Array(pts));
  }
  return loops;
}

export const loopArea = (l: Loop) => {
  let a = 0; const n = l.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += l[i * 2] * l[j * 2 + 1] - l[j * 2] * l[i * 2 + 1]; }
  return a / 2;
};

/** Ring of M points resampled by arc length: CCW, seam at the point closest to +X from the centroid. */
export type Ring = { x: Float64Array; y: Float64Array; nx: Float64Array; ny: Float64Array };
export function resampleLoop(loop: Loop, M: number): Ring {
  let l = loop;
  if (loopArea(l) < 0) { // make CCW
    const r = new Float64Array(l.length), n = l.length / 2;
    for (let i = 0; i < n; i++) { r[i * 2] = l[(n - 1 - i) * 2]; r[i * 2 + 1] = l[(n - 1 - i) * 2 + 1]; }
    l = r;
  }
  const n = l.length / 2;
  let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += l[i * 2]; cy += l[i * 2 + 1]; } cx /= n; cy /= n;
  // seam: crossing of the +X ray from the centroid (stable across layers → no spiral twist)
  let seamI = 0, seamT = 0, bestX = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ya = l[i * 2 + 1] - cy, yb = l[j * 2 + 1] - cy;
    if (ya <= 0 && yb > 0) {
      const t = -ya / (yb - ya), x = l[i * 2] + t * (l[j * 2] - l[i * 2]) - cx;
      if (x > bestX) { bestX = x; seamI = i; seamT = t; }
    }
  }
  // cumulative arc length starting from the seam
  const px: number[] = [], py: number[] = [];
  px.push(l[seamI * 2] + seamT * (l[((seamI + 1) % n) * 2] - l[seamI * 2]));
  py.push(l[seamI * 2 + 1] + seamT * (l[((seamI + 1) % n) * 2 + 1] - l[seamI * 2 + 1]));
  for (let k = 1; k <= n; k++) { const i = (seamI + k) % n; px.push(l[i * 2]); py.push(l[i * 2 + 1]); }
  px.push(px[0]); py.push(py[0]);
  const cum = [0]; for (let i = 1; i < px.length; i++) cum.push(cum[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]));
  const total = cum[cum.length - 1];
  const ring: Ring = { x: new Float64Array(M), y: new Float64Array(M), nx: new Float64Array(M), ny: new Float64Array(M) };
  let seg = 0;
  for (let k = 0; k < M; k++) {
    const s = (k / M) * total;
    while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
    const t = cum[seg + 1] > cum[seg] ? (s - cum[seg]) / (cum[seg + 1] - cum[seg]) : 0;
    ring.x[k] = px[seg] + t * (px[seg + 1] - px[seg]); ring.y[k] = py[seg] + t * (py[seg + 1] - py[seg]);
  }
  for (let k = 0; k < M; k++) { // outward normal of CCW ring = tangent rotated −90°
    const a = (k - 1 + M) % M, b = (k + 1) % M;
    const tx = ring.x[b] - ring.x[a], ty = ring.y[b] - ring.y[a], L = Math.hypot(tx, ty) || 1;
    ring.nx[k] = ty / L; ring.ny[k] = -tx / L;
  }
  return ring;
}
