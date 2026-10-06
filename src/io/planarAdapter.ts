// Turns plate objects into the solid, bed-space triangle meshes the planar slicer consumes.
import { profileBody, buildPrimitive, type Body, type Mesh, type PlateObject, type Profile } from "../core/index.ts";
import { profileMesh } from "./exporters/mesh.ts";

/** Closed hollow solid from a body's outline: outer wall, rim, inner wall (offset along the outline normals) and inner floor. */
export function hollowMesh(body: Body, wall: number, floor: number, name: string, rows = 120, cols = 160): Mesh {
  const H = body.height, f = Math.min(Math.max(floor, wall), H * 0.5), rings: { x: Float64Array; y: Float64Array; nx: Float64Array; ny: Float64Array; z: number }[] = [];
  for (let j = 0; j <= rows; j++) {
    const z = (j / rows) * H, r = body.ring(Math.min(H - 1e-4, Math.max(1e-4, z)), cols);
    if (r) rings.push({ ...r, z });
  }
  if (rings.length < 2) throw new Error(`${name}: not enough contours to hollow`);
  const t: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => t.push(...a, ...b, ...c, ...a, ...c, ...d);
  const O = (j: number, k: number) => [rings[j].x[k % cols], rings[j].y[k % cols], rings[j].z];
  const I = (j: number, k: number) => { const r = rings[j], q = k % cols; return [r.x[q] - r.nx[q] * wall, r.y[q] - r.ny[q] * wall, r.z]; };
  const jf = rings.findIndex((r) => r.z >= f - 1e-6), j0 = Math.max(0, jf), top = rings.length - 1;
  for (let j = 0; j < top; j++) for (let k = 0; k < cols; k++) quad(O(j, k), O(j, k + 1), O(j + 1, k + 1), O(j + 1, k)); // outer, faces out
  for (let j = j0; j < top; j++) for (let k = 0; k < cols; k++) quad(I(j, k + 1), I(j, k), I(j + 1, k), I(j + 1, k + 1)); // inner, faces the cavity
  for (let k = 0; k < cols; k++) quad(O(top, k), O(top, k + 1), I(top, k + 1), I(top, k)); // rim, faces up
  const fan = (pt: (k: number) => number[], z: number, up: boolean) => {
    let cx = 0, cy = 0; for (let k = 0; k < cols; k++) { const p = pt(k); cx += p[0]; cy += p[1]; } cx /= cols; cy /= cols;
    for (let k = 0; k < cols; k++) { const a = pt(k), b = pt(k + 1); t.push(cx, cy, z, ...(up ? a : b), ...(up ? b : a)); }
  };
  fan((k) => O(0, k), 0, false);                       // bottom, faces down
  fan((k) => I(j0, k), rings[j0].z, true);            // cavity floor, faces up
  return { name, tris: new Float32Array(t) };
}

/** Local-space solid mesh of an object: the imported mesh, or the primitive tessellated (hollowed when `hollow` > 0). */
export function solidMesh(o: PlateObject, meshes: Record<string, Mesh>): Mesh {
  if (o.source.kind === "mesh") { const m = meshes[o.source.meshId]; if (!m) throw new Error(`Missing mesh ${o.source.meshId}`); return m; }
  const prof: Profile = buildPrimitive(o.source.primitive, o.source.params);
  if (o.hollow && o.hollow > 0 && !prof.contour) return hollowMesh(profileBody(prof), o.hollow, o.hollow, o.name);
  if (o.hollow && o.hollow > 0 && prof.contour) return hollowMesh(profileBody(prof), o.hollow, o.hollow, o.name);
  return profileMesh(prof, o.name);
}

/** Apply scale, Z rotation and position; the lowest point sits on the plate (z = 0). */
export function worldTris(o: PlateObject, m: Mesh): Float32Array {
  const t = o.transform, a = (t.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), src = m.tris, out = new Float32Array(src.length);
  let zmin = Infinity;
  for (let i = 2; i < src.length; i += 3) zmin = Math.min(zmin, src[i]);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i] * t.scaleXY, y = src[i + 1] * t.scaleXY;
    out[i] = x * c - y * s + t.x; out[i + 1] = x * s + y * c + t.y; out[i + 2] = (src[i + 2] - zmin) * t.scaleZ;
  }
  return out;
}
