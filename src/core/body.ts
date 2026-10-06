import type { Profile } from "./primitives.ts";
import { buildSliceIndex, bounds, loopArea, resampleLoop, sliceAt, type Mesh, type Ring, type SliceIndex } from "./mesh.ts";

// A printable single-wall body: rings (outer contour, M points, CCW, outward normals) by height.
export type Body = {
  height: number;
  footprintRadius: number;         // max XY distance from object origin
  bbox: [number, number, number, number]; // local XY extent [minX, minY, maxX, maxY] (unscaled, unrotated)
  ring(z: number, M: number): Ring | null;
  warnings: string[];
};

export function profileBody(p: Profile): Body {
  let rMax = 0; for (let i = 0; i <= 200; i++) rMax = Math.max(rMax, p.radius(i / 200));
  let bb: [number, number, number, number] = [-rMax, -rMax, rMax, rMax];
  if (p.contour) {
    bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i <= 24; i++) { const c = p.contour(i / 24); for (let k = 0; k < c.length; k += 2) { bb[0] = Math.min(bb[0], c[k]); bb[1] = Math.min(bb[1], c[k + 1]); bb[2] = Math.max(bb[2], c[k]); bb[3] = Math.max(bb[3], c[k + 1]); } }
  }
  if (p.contour) { // explicit outline (prisms, lobed, twisted…): arc-length resampled like a mesh slice
    const outline = p.contour;
    return {
      height: p.height, footprintRadius: rMax, bbox: bb, warnings: [],
      ring: (z, M) => resampleLoop(outline(Math.min(1, Math.max(0, z / p.height))), M),
    };
  }
  return {
    height: p.height, footprintRadius: rMax, bbox: bb, warnings: [],
    ring(z, M) {
      const r = p.radius(Math.min(1, Math.max(0, z / p.height)));
      const ring: Ring = { x: new Float64Array(M), y: new Float64Array(M), nx: new Float64Array(M), ny: new Float64Array(M) };
      for (let k = 0; k < M; k++) {
        const a = (k / M) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        ring.x[k] = r * c; ring.y[k] = r * s; ring.nx[k] = c; ring.ny[k] = s;
      }
      return ring;
    },
  };
}

export function meshBody(m: Mesh): Body {
  const b = bounds(m.tris), ix: SliceIndex = buildSliceIndex(m.tris);
  let rMax = 0;
  for (let i = 0; i < m.tris.length; i += 3) rMax = Math.max(rMax, Math.hypot(m.tris[i], m.tris[i + 1]));
  const bbox: [number, number, number, number] = [b.min[0], b.min[1], b.max[0], b.max[1]];
  const warnings: string[] = [];
  let multiWarned = false;
  const height = b.max[2] - b.min[2];
  return {
    height, footprintRadius: rMax, bbox, warnings,
    ring(z, M) {
      const zq = Math.min(Math.max(z, b.min[2] + 1e-4), b.max[2] - 1e-4);
      const loops = sliceAt(ix, zq);
      if (!loops.length) return null;
      if (loops.length > 1 && !multiWarned) {
        multiWarned = true;
        warnings.push(`Mesh has ${loops.length} contours at some heights; spiral uses the largest outer contour only`);
      }
      let best = loops[0];
      for (const l of loops) if (Math.abs(loopArea(l)) > Math.abs(loopArea(best))) best = l;
      return resampleLoop(best, M);
    },
  };
}
