import type { Mesh } from "./mesh.ts";

// Face / edge picking on a triangle mesh (welded adjacency, region growing, sharp-edge chains).
// Everything is in the mesh's own coordinates; indices refer to triangles in `tris` order (9 floats each).
export type SelMesh = {
  tris: Float32Array; count: number;
  normal: Float32Array;          // unit normal per triangle
  adj: Int32Array;               // 3 per triangle: neighbour across edge e (v_e → v_e+1), -1 = open boundary, -2 = non-manifold
  vid: Uint32Array;              // welded vertex id per corner (3 per triangle)
};
export type FillMode = "flat" | "smooth" | "single";
export type Seg = [number, number, number, number, number, number];

export function buildSelMesh(m: Pick<Mesh, "tris">): SelMesh {
  const t = m.tris, n = t.length / 9, normal = new Float32Array(n * 3), vid = new Uint32Array(n * 3), adj = new Int32Array(n * 3).fill(-1);
  const verts = new Map<string, number>();
  for (let i = 0; i < n * 3; i++) {
    const k = `${Math.round(t[i * 3] * 1000)},${Math.round(t[i * 3 + 1] * 1000)},${Math.round(t[i * 3 + 2] * 1000)}`;
    let id = verts.get(k); if (id === undefined) { id = verts.size; verts.set(k, id); }
    vid[i] = id;
  }
  for (let f = 0; f < n; f++) {
    const o = f * 9, ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2], vx = t[o + 6] - t[o], vy = t[o + 7] - t[o + 1], vz = t[o + 8] - t[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz) || 1;
    normal[f * 3] = nx / L; normal[f * 3 + 1] = ny / L; normal[f * 3 + 2] = nz / L;
  }
  const edges = new Map<number, number>(); // (min,max) vertex pair → first (tri*3+edge); second sighting links both
  const nv = verts.size;
  for (let f = 0; f < n; f++) for (let e = 0; e < 3; e++) {
    const a = vid[f * 3 + e], b = vid[f * 3 + ((e + 1) % 3)];
    if (a === b) continue;
    const key = Math.min(a, b) * nv + Math.max(a, b), other = edges.get(key);
    if (other === undefined) edges.set(key, f * 3 + e);
    else if (other >= 0) { adj[f * 3 + e] = other / 3 | 0; adj[other] = f; edges.set(key, -1); } // `other` encodes tri*3+edge
    else { adj[f * 3 + e] = -2; }
  }
  return { tris: t, count: n, normal, adj, vid };
}

const dot = (m: SelMesh, a: number, b: number) => m.normal[a * 3] * m.normal[b * 3] + m.normal[a * 3 + 1] * m.normal[b * 3 + 1] + m.normal[a * 3 + 2] * m.normal[b * 3 + 2];

/** Region-grow from a seed triangle. flat: every triangle within `angle` of the seed normal; smooth: neighbour-to-neighbour. */
export function fillFaces(m: SelMesh, seed: number, mode: FillMode, angleDeg: number, limit = 400_000): number[] {
  if (mode === "single") return [seed];
  const c = Math.cos((angleDeg * Math.PI) / 180), seen = new Uint8Array(m.count), out = [seed], q = [seed];
  seen[seed] = 1;
  for (let h = 0; h < q.length && out.length < limit; h++) {
    const f = q[h];
    for (let e = 0; e < 3; e++) {
      const g = m.adj[f * 3 + e];
      if (g < 0 || seen[g]) continue;
      if (dot(m, mode === "flat" ? seed : f, g) < c) continue;
      seen[g] = 1; out.push(g); q.push(g);
    }
  }
  return out;
}

/** Triangles within `depth` edge-hops of `seed` (local search neighbourhood). */
export function neighbourhood(m: SelMesh, seed: number, depth: number): number[] {
  const seen = new Set([seed]); let ring = [seed];
  for (let d = 0; d < depth; d++) {
    const next: number[] = [];
    for (const f of ring) for (let e = 0; e < 3; e++) { const g = m.adj[f * 3 + e]; if (g >= 0 && !seen.has(g)) { seen.add(g); next.push(g); } }
    ring = next;
  }
  return [...seen];
}

type SharpEdge = { a: number; b: number; tri: number; p: [number, number, number]; q: [number, number, number] };
/** Sharp (dihedral > angle) and open-boundary edges among the given triangles; each shared edge is reported once. */
export function sharpEdgesOf(m: SelMesh, tris: Iterable<number>, angleDeg: number): SharpEdge[] {
  const c = Math.cos((angleDeg * Math.PI) / 180), out: SharpEdge[] = [], t = m.tris, set = new Set(tris);
  for (const f of set) for (let e = 0; e < 3; e++) {
    const g = m.adj[f * 3 + e];
    if (g >= 0 && dot(m, f, g) >= c) continue;       // smooth
    if (g >= 0 && g < f && set.has(g)) continue;       // already reported from the neighbour
    const o = f * 9 + e * 3, o2 = f * 9 + ((e + 1) % 3) * 3;
    out.push({ a: m.vid[f * 3 + e], b: m.vid[f * 3 + ((e + 1) % 3)], tri: f, p: [t[o], t[o + 1], t[o + 2]], q: [t[o2], t[o2 + 1], t[o2 + 2]] });
  }
  return out;
}

const segDist = (x: number, y: number, z: number, s: SharpEdge | Seg) => {
  const [ax, ay, az, bx, by, bz] = Array.isArray(s) ? s : [...s.p, ...s.q];
  const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz;
  const u = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2)) : 0;
  return Math.hypot(x - ax - u * dx, y - ay - u * dy, z - az - u * dz);
};

/**
 * Pick the sharp edge nearest to a surface point (near triangle `hit`) and, if `chain`, follow it through
 * vertices where it keeps going roughly straight (turn < `turnMaxDeg`) — so a cube edge stays one edge while a
 * tessellated rim circle is selected whole. Returns line segments (6 floats each) or null when no edge is within `reach`.
 */
export function pickEdge(m: SelMesh, hit: number, point: [number, number, number], angleDeg: number, reach: number, chain: boolean, turnMaxDeg = 40): Seg[] | null {
  const local = sharpEdgesOf(m, neighbourhood(m, hit, 4), angleDeg);
  let best: SharpEdge | null = null, bd = reach;
  for (const e of local) { const d = segDist(point[0], point[1], point[2], e); if (d < bd) { bd = d; best = e; } }
  if (!best) return null;
  if (!chain) return [[...best.p, ...best.q]];
  const dir = (e: SharpEdge) => { const d = [e.q[0] - e.p[0], e.q[1] - e.p[1], e.q[2] - e.p[2]], L = Math.hypot(...d) || 1; return d.map((v) => v / L); };
  const pool = new Map<number, SharpEdge[]>(), seenTri = new Set<number>(), seenEdge = new Set<string>();
  const key = (e: SharpEdge) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`;
  const grow = (around: number, depth: number) => {
    const fresh = neighbourhood(m, around, depth).filter((f) => !seenTri.has(f));
    fresh.forEach((f) => seenTri.add(f));
    for (const e of sharpEdgesOf(m, fresh, angleDeg)) for (const v of [e.a, e.b]) { const l = pool.get(v) ?? []; if (!l.some((x) => key(x) === key(e))) l.push(e); pool.set(v, l); }
  };
  grow(hit, 4);
  const result: SharpEdge[] = [best]; seenEdge.add(key(best));
  const cosMax = Math.cos((turnMaxDeg * Math.PI) / 180);
  for (const [startV, outward] of [[best.b, 1], [best.a, -1]] as const) {
    let cur = best, v = startV, sign: number = outward;
    for (let guard = 0; guard < 6000; guard++) {
      grow(cur.tri, 3);
      const d0 = dir(cur).map((x) => x * sign);
      let nxt: SharpEdge | null = null, bc = cosMax;
      for (const e of pool.get(v) ?? []) {
        if (seenEdge.has(key(e))) continue;
        const along = e.a === v ? 1 : -1, d1 = dir(e).map((x) => x * along), c = d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2];
        if (c > bc) { bc = c; nxt = e; }
      }
      if (!nxt) break;
      seenEdge.add(key(nxt)); result.push(nxt);
      sign = nxt.a === v ? 1 : -1; v = sign === 1 ? nxt.b : nxt.a; cur = nxt;
    }
  }
  return result.map((e) => [...e.p, ...e.q] as Seg);
}

/** Triangles whose centroid lies within `width` mm of any segment (the "edge band"). */
export function trianglesNearSegments(m: SelMesh, segs: Seg[], width: number): number[] {
  const out: number[] = [], t = m.tris;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of segs) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s[k], s[k + 3]) - width; hi[k] = Math.max(hi[k], s[k], s[k + 3]) + width; }
  for (let f = 0; f < m.count; f++) {
    const o = f * 9, cx = (t[o] + t[o + 3] + t[o + 6]) / 3, cy = (t[o + 1] + t[o + 4] + t[o + 7]) / 3, cz = (t[o + 2] + t[o + 5] + t[o + 8]) / 3;
    if (cx < lo[0] || cx > hi[0] || cy < lo[1] || cy > hi[1] || cz < lo[2] || cz > hi[2]) continue;
    for (const s of segs) if (segDist(cx, cy, cz, s) <= width) { out.push(f); break; }
  }
  return out;
}
