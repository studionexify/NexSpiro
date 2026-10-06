// Mesh editing used by the Prepare toolbar: rotate / lay flat / auto-orient / split / cut / mirror. All pure functions on triangle soups
// (9 floats per triangle). They bake into new geometry, so slicing, selection and arrangement keep working on plain meshes.
import { bounds, type Mesh } from "./mesh.ts";

export type Vec = [number, number, number];
export type Mat = [number, number, number, number, number, number, number, number, number]; // row-major 3x3

export const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul = (a: Mat, b: Mat): Mat => {
  const o = new Array(9).fill(0) as Mat;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
export function rotationAxis(axis: "x" | "y" | "z", deg: number): Mat {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return axis === "x" ? [1, 0, 0, 0, c, -s, 0, s, c] : axis === "y" ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1];
}
/** Smallest rotation taking unit vector `from` onto unit vector `to` (Rodrigues). */
export function rotationBetween(from: Vec, to: Vec): Mat {
  const [fx, fy, fz] = from, [tx, ty, tz] = to;
  const vx = fy * tz - fz * ty, vy = fz * tx - fx * tz, vz = fx * ty - fy * tx, c = fx * tx + fy * ty + fz * tz;
  if (c > 1 - 1e-9) return IDENTITY;
  if (c < -1 + 1e-9) { // opposite: 180° about any perpendicular axis
    const p: Vec = Math.abs(fx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const ax = fy * p[2] - fz * p[1], ay = fz * p[0] - fx * p[2], az = fx * p[1] - fy * p[0], l = Math.hypot(ax, ay, az), x = ax / l, y = ay / l, z = az / l;
    return [2 * x * x - 1, 2 * x * y, 2 * x * z, 2 * x * y, 2 * y * y - 1, 2 * y * z, 2 * x * z, 2 * y * z, 2 * z * z - 1];
  }
  const k = 1 / (1 + c);
  return [vx * vx * k + c, vx * vy * k - vz, vx * vz * k + vy, vx * vy * k + vz, vy * vy * k + c, vy * vz * k - vx, vx * vz * k - vy, vy * vz * k + vx, vz * vz * k + c];
}
export const compose = mul;

/** Rotate every vertex, then recentre XY on the bounding box and drop the lowest point to z = 0. Returns a new mesh. */
export function transformMeshBy(m: Mesh, R: Mat, name = m.name): Mesh {
  const src = m.tris, out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    out[i] = R[0] * x + R[1] * y + R[2] * z; out[i + 1] = R[3] * x + R[4] * y + R[5] * z; out[i + 2] = R[6] * x + R[7] * y + R[8] * z;
  }
  const b = bounds(out), cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  for (let i = 0; i < out.length; i += 3) { out[i] -= cx; out[i + 1] -= cy; out[i + 2] -= b.min[2]; }
  return { name, tris: out };
}
/** Mirror along an axis (flips triangle winding so normals stay outward). */
export function mirrorMesh(m: Mesh, axis: "x" | "y" | "z"): Mesh {
  const k = axis === "x" ? 0 : axis === "y" ? 1 : 2, src = m.tris, out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 9) {
    for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) out[i + v * 3 + c] = src[i + v * 3 + c] * (c === k ? -1 : 1);
    for (let c = 0; c < 3; c++) { const t = out[i + 3 + c]; out[i + 3 + c] = out[i + 6 + c]; out[i + 6 + c] = t; } // swap vertices 1,2
  }
  return transformMeshBy({ name: m.name, tris: out }, IDENTITY, m.name);
}

/** Unit normal and area of triangle i. */
export function triNormal(t: Float32Array, i: number): { n: Vec; area: number } {
  const o = i * 9, ax = t[o + 3] - t[o], ay = t[o + 4] - t[o + 1], az = t[o + 5] - t[o + 2], bx = t[o + 6] - t[o], by = t[o + 7] - t[o + 1], bz = t[o + 8] - t[o + 2];
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz);
  return l < 1e-12 ? { n: [0, 0, 1], area: 0 } : { n: [nx / l, ny / l, nz / l], area: l / 2 };
}

/** Rotation that puts the surface with outward normal `n` flat on the bed. */
export const layFlatRotation = (n: Vec): Mat => rotationBetween(n, [0, 0, -1]);

type Cand = { n: Vec; area: number };
/** Groups triangles by (quantised) normal: the dominant flat faces are the natural resting positions. */
function faceCandidates(m: Mesh, limit = 24): Cand[] {
  const t = m.tris, n = t.length / 9, bins = new Map<string, { n: Vec; area: number }>();
  for (let i = 0; i < n; i++) {
    const { n: v, area } = triNormal(t, i); if (area <= 0) continue;
    const key = `${Math.round(v[0] * 12)},${Math.round(v[1] * 12)},${Math.round(v[2] * 12)}`, b = bins.get(key);
    if (b) { b.n = [b.n[0] + v[0] * area, b.n[1] + v[1] * area, b.n[2] + v[2] * area]; b.area += area; } else bins.set(key, { n: [v[0] * area, v[1] * area, v[2] * area], area });
  }
  return [...bins.values()].map((b) => { const l = Math.hypot(...b.n) || 1; return { n: [b.n[0] / l, b.n[1] / l, b.n[2] / l] as Vec, area: b.area }; })
    .sort((a, b) => b.area - a.area).slice(0, limit);
}
/** Cost of printing in orientation R: overhang area needing support (faces tilted past `overhangDeg` from vertical) minus contact area, plus height. */
export function orientationCost(m: Mesh, R: Mat, overhangDeg = 45): { cost: number; overhang: number; contact: number; height: number } {
  const t = m.tris, n = t.length / 9, down = -Math.cos(((90 - overhangDeg) * Math.PI) / 180);
  const z = new Float32Array(t.length / 3);
  for (let i = 0; i < z.length; i++) z[i] = R[6] * t[i * 3] + R[7] * t[i * 3 + 1] + R[8] * t[i * 3 + 2];
  let zmin = Infinity, zmax = -Infinity; for (const v of z) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
  let overhang = 0, contact = 0;
  for (let i = 0; i < n; i++) {
    const { n: v, area } = triNormal(t, i); if (!area) continue;
    const nz = R[6] * v[0] + R[7] * v[1] + R[8] * v[2];
    const lowZ = Math.min(z[i * 3], z[i * 3 + 1], z[i * 3 + 2]);
    if (nz < -0.999 && lowZ - zmin < 0.05) contact += area; else if (nz < down) overhang += area * -nz;
  }
  const height = zmax - zmin;
  return { cost: overhang * 1.0 - contact * 0.6 + height * 4, overhang, contact, height };
}
/** Best of: the current orientation and every large flat face resting on the bed. Returns the rotation to apply. */
export function autoOrientRotation(m: Mesh): Mat {
  let best = { R: IDENTITY, cost: orientationCost(m, IDENTITY).cost };
  for (const c of faceCandidates(m)) {
    const R = layFlatRotation(c.n), cost = orientationCost(m, R).cost;
    if (cost < best.cost - 1e-6) best = { R, cost };
  }
  return best.R;
}

/** Disconnected shells of a mesh (vertices welded at 1e-4 mm). */
export function splitComponents(m: Mesh, minTris = 4): Mesh[] {
  const t = m.tris, n = t.length / 9, id = new Map<string, number>(), parent: number[] = [];
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const vid = (x: number, y: number, z: number) => { const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`; let v = id.get(k); if (v === undefined) { v = parent.length; parent.push(v); id.set(k, v); } return v; };
  const tv: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = vid(t[i * 9], t[i * 9 + 1], t[i * 9 + 2]), b = vid(t[i * 9 + 3], t[i * 9 + 4], t[i * 9 + 5]), c = vid(t[i * 9 + 6], t[i * 9 + 7], t[i * 9 + 8]);
    tv.push(a); parent[find(a)] = find(b); parent[find(b)] = find(c);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const r = find(tv[i]); (groups.get(r) ?? groups.set(r, []).get(r)!).push(i); }
  const parts = [...groups.values()].filter((g) => g.length >= minTris).sort((a, b) => b.length - a.length);
  return parts.map((g, k) => {
    const out = new Float32Array(g.length * 9); g.forEach((ti, j) => out.set(t.subarray(ti * 9, ti * 9 + 9), j * 9));
    return transformMeshBy({ name: `${m.name} ${k + 1}`, tris: out }, IDENTITY);
  });
}

/**
 * Cut by the horizontal plane z = h (mesh coordinates, z up). Returns the part above and below with triangles clipped; the
 * cut faces are left open unless `cap` supplies triangulated cap triangles (see capLoops in the UI layer).
 */
export function clipMeshZ(m: Mesh, h: number): { above: Float32Array; below: Float32Array; edges: number[] } {
  const t = m.tris, A: number[] = [], B: number[] = [], edges: number[] = [];
  const lerp = (p: Vec, q: Vec): Vec => { const f = (h - p[2]) / (q[2] - p[2]); return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, h]; };
  const push = (dst: number[], ...v: Vec[]) => { for (let i = 1; i + 1 < v.length; i++) dst.push(...v[0], ...v[i], ...v[i + 1]); };
  for (let i = 0; i < t.length; i += 9) {
    const P: Vec[] = [[t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]]];
    const up = P.map((p) => p[2] >= h);
    const nUp = up.filter(Boolean).length;
    if (nUp === 3) { A.push(...P[0], ...P[1], ...P[2]); continue; }
    if (nUp === 0) { B.push(...P[0], ...P[1], ...P[2]); continue; }
    // rotate so the lone vertex (on its own side) is first
    const lone = nUp === 1 ? up.indexOf(true) : up.indexOf(false), a = P[lone], b = P[(lone + 1) % 3], c = P[(lone + 2) % 3];
    const ab = lerp(a, b), ac = lerp(a, c);
    if (nUp === 1) { push(A, a, ab, ac); push(B, ab, b, c, ac); edges.push(ab[0], ab[1], ac[0], ac[1]); }
    else { push(B, a, ab, ac); push(A, ab, b, c, ac); edges.push(ac[0], ac[1], ab[0], ab[1]); }
  }
  return { above: new Float32Array(A), below: new Float32Array(B), edges };
}

/** Outward normal of the largest flat face (area-weighted), or null for an empty mesh. */
export function largestFaceNormal(m: Mesh): Vec | null { return faceCandidates(m, 1)[0]?.n ?? null; }
