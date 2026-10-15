// Turn per-triangle paint into per-layer geometry (support/seam enforcers & blockers, colour regions).
import { intersection, offset, SCALE, union } from './clipper';
import type { Path, Paths } from './types';
import type { IndexedMesh } from './mesh';
import ClipperLib from 'clipper-lib';

const C: any = (ClipperLib as any).default ?? ClipperLib;

export interface PaintedTri { t: number; zmin: number; zmax: number; value: number }

export function paintedTris(mesh: IndexedMesh, flags: Uint8Array | undefined): PaintedTri[] {
  if (!flags) return [];
  const v = mesh.vertices, ix = mesh.indices;
  const out: PaintedTri[] = [];
  for (let t = 0; t < flags.length && t * 3 < ix.length; t++) {
    if (!flags[t]) continue;
    const za = v[ix[t * 3] * 3 + 2], zb = v[ix[t * 3 + 1] * 3 + 2], zc = v[ix[t * 3 + 2] * 3 + 2];
    out.push({ t, zmin: Math.min(za, zb, zc), zmax: Math.max(za, zb, zc), value: flags[t] });
  }
  return out;
}

/** XY projection of a triangle as a positive Clipper path (empty if degenerate). */
export function triFootprint(mesh: IndexedMesh, t: number): Path {
  const v = mesh.vertices, ix = mesh.indices;
  const p: Path = [];
  for (let k = 0; k < 3; k++) {
    const i = ix[t * 3 + k] * 3;
    p.push({ X: Math.round(v[i] * SCALE), Y: Math.round(v[i + 1] * SCALE) });
  }
  if (!C.Clipper.Orientation(p)) p.reverse();
  return Math.abs(C.Clipper.Area(p)) < 1 ? [] : p;
}

/** Plane intersection segment of triangle t at height z (null if it does not cross). */
export function triSegment(mesh: IndexedMesh, t: number, z: number): [number, number, number, number] | null {
  const v = mesh.vertices, ix = mesh.indices;
  const pts: number[] = [];
  for (let e = 0; e < 3; e++) {
    const a = ix[t * 3 + e] * 3, b = ix[t * 3 + ((e + 1) % 3)] * 3;
    const za = v[a + 2], zb = v[b + 2];
    if ((za >= z) === (zb >= z)) continue;
    const s = (z - za) / (zb - za);
    pts.push(v[a] + s * (v[b] - v[a]), v[a + 1] + s * (v[b + 1] - v[a + 1]));
  }
  return pts.length === 4 ? [pts[0], pts[1], pts[2], pts[3]] : null;
}

/** Footprints of painted triangles (with the given value) whose z-range overlaps [z0, z1]. */
export function footprintsInBand(mesh: IndexedMesh, tris: PaintedTri[], value: number, z0: number, z1: number, grow = 0): Paths {
  const out: Paths = [];
  for (const p of tris) {
    if (p.value !== value || p.zmax < z0 || p.zmin > z1) continue;
    const f = triFootprint(mesh, p.t);
    if (f.length) out.push(f);
  }
  if (!out.length) return [];
  return grow ? offset(union(out), grow) : union(out);
}

/** Midpoints of painted triangles crossing plane z (seam hints). */
export function pointsAtZ(mesh: IndexedMesh, tris: PaintedTri[], value: number, z: number): [number, number][] {
  const out: [number, number][] = [];
  for (const p of tris) {
    if (p.value !== value || p.zmin > z || p.zmax < z) continue;
    const s = triSegment(mesh, p.t, z);
    if (s) out.push([(s[0] + s[2]) / 2, (s[1] + s[3]) / 2]);
  }
  return out;
}

/**
 * Colour regions of one object layer. Painted side walls are extruded inward by `depth`
 * from the slice outline; painted near-horizontal faces within ±depth of the layer project down/up.
 * Returns region paths keyed by 1-based colour value; the caller assigns the remainder to the base filament.
 */
export function colorRegionsAtZ(mesh: IndexedMesh, tris: PaintedTri[], slice: Paths, z: number, depth: number): Map<number, Paths> {
  const byColor = new Map<number, { lines: Paths; flats: Paths }>();
  const get = (c: number) => { let e = byColor.get(c); if (!e) byColor.set(c, (e = { lines: [], flats: [] })); return e; };
  const v = mesh.vertices, ix = mesh.indices;
  for (const p of tris) {
    if (p.zmax < z - depth || p.zmin > z + depth) continue;
    const s = p.zmin <= z && p.zmax >= z ? triSegment(mesh, p.t, z) : null;
    if (s) get(p.value).lines.push([{ X: Math.round(s[0] * SCALE), Y: Math.round(s[1] * SCALE) }, { X: Math.round(s[2] * SCALE), Y: Math.round(s[3] * SCALE) }]);
    // near-horizontal faces close to this layer paint the whole footprint
    const a = ix[p.t * 3] * 3, b = ix[p.t * 3 + 1] * 3, c = ix[p.t * 3 + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    const nz = ux * wy - uy * wx, len = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, nz);
    if (len > 0 && Math.abs(nz / len) > 0.7) {
      const f = triFootprint(mesh, p.t);
      if (f.length) get(p.value).flats.push(f);
    }
  }
  const out = new Map<number, Paths>();
  for (const [color, e] of byColor) {
    let region: Paths = [];
    if (e.lines.length) {
      const co = new C.ClipperOffset(2, SCALE * 0.0025);
      co.AddPaths(e.lines, C.JoinType.jtRound, C.EndType.etOpenRound);
      const strip: Paths = [];
      co.Execute(strip, Math.round(depth * SCALE));
      region = region.concat(strip);
    }
    if (e.flats.length) region = region.concat(offset(union(e.flats), 0.05));
    const r = intersection(union(region), slice);
    if (r.length) out.set(color, r);
  }
  return out;
}
