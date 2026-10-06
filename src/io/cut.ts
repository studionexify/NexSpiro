// Cutting a mesh with a horizontal plane: clip the triangles (core/orient.clipMeshZ) and close the open face with a triangulated cap.
import { ShapeUtils, Vector2 } from "three";
import { clipMeshZ, bounds, transformMeshBy, IDENTITY, rotationAxis, type Mesh } from "../core/index.ts";

type Loop = Vector2[];
function chain(edges: number[]): Loop[] {
  const key = (x: number, y: number) => `${Math.round(x * 1e3)},${Math.round(y * 1e3)}`;
  const next = new Map<string, number[]>(); // start point → segment indices
  const n = edges.length / 4;
  for (let i = 0; i < n; i++) { const k = key(edges[i * 4], edges[i * 4 + 1]); (next.get(k) ?? next.set(k, []).get(k)!).push(i); }
  const used = new Uint8Array(n), loops: Loop[] = [];
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const loop: Loop = []; let s = i;
    for (let guard = 0; guard < n + 1; guard++) {
      used[s] = 1; loop.push(new Vector2(edges[s * 4], edges[s * 4 + 1]));
      const cand = next.get(key(edges[s * 4 + 2], edges[s * 4 + 3]))?.find((q) => !used[q]);
      if (cand === undefined) break; s = cand;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
const inside = (p: Vector2, poly: Loop) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c; return c; };

/** Triangles closing the cut outline at z = h. `up` = the cap faces +Z (it closes the part below the plane). */
export function capTriangles(edges: number[], h: number, up: boolean): number[] {
  const loops = chain(edges), area = (l: Loop) => ShapeUtils.area(l), out: number[] = [];
  const depth = loops.map((l, i) => loops.reduce((d, o, j) => (j !== i && inside(l[0], o) ? d + 1 : d), 0));
  loops.forEach((outer, i) => {
    if (depth[i] % 2) return;
    const holes = loops.filter((l, j) => depth[j] === depth[i] + 1 && inside(l[0], outer));
    const o = area(outer) < 0 ? [...outer].reverse() : outer, hs = holes.map((l) => (area(l) > 0 ? [...l].reverse() : l));
    const pts = [...o, ...hs.flat()], faces = ShapeUtils.triangulateShape(o, hs);
    for (const [a, b, c] of faces) { const A = pts[a], B = pts[b], C = pts[c]; out.push(A.x, A.y, h, ...(up ? [B.x, B.y, h, C.x, C.y, h] : [C.x, C.y, h, B.x, B.y, h])); }
  });
  return out;
}
export type CutResult = { upper: Mesh | null; lower: Mesh | null };
/** Cut `m` at height h (mesh coordinates). Parts are returned recentred and resting on z = 0; the upper part is flipped (cut face down) when `flipUpper`. */
export function cutMesh(m: Mesh, h: number, flipUpper = true): CutResult {
  const b = bounds(m.tris);
  if (!(h > b.min[2] + 1e-3 && h < b.max[2] - 1e-3)) return { upper: null, lower: null };
  const { above, below, edges } = clipMeshZ(m, h);
  const up = new Float32Array([...above, ...capTriangles(edges, h, false)]), lo = new Float32Array([...below, ...capTriangles(edges, h, true)]);
  const upper = up.length ? transformMeshBy({ name: `${m.name} (upper)`, tris: up }, flipUpper ? rotationAxis("x", 180) : IDENTITY) : null;
  const lower = lo.length ? transformMeshBy({ name: `${m.name} (lower)`, tris: lo }, IDENTITY) : null;
  return { upper, lower };
}
