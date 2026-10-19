// Flenex placement helpers: where a cut goes on an imported model, and whether the result fits the printer.
import type { IndexedMesh } from '../../engine/mesh';
import { bounds, type V3 } from './csg';
import { defaultJoint, type JointKind } from './joints';
import { newCut, type Cut } from './flexi';

/** Direction of the limb around a point: the main axis of the surface points within `radius` (power iteration on the covariance). */
export function localAxis(m: IndexedMesh, p: V3, radius: number): V3 {
  const v = m.vertices, pts: V3[] = [];
  for (let i = 0; i < v.length; i += 3) if ((v[i] - p[0]) ** 2 + (v[i + 1] - p[1]) ** 2 + (v[i + 2] - p[2]) ** 2 <= radius * radius) pts.push([v[i], v[i + 1], v[i + 2]]);
  if (pts.length < 8) return [1, 0, 0];
  const c: V3 = [0, 0, 0];
  for (const q of pts) for (let k = 0; k < 3; k++) c[k] += q[k] / pts.length;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of pts) { const d = [q[0] - c[0], q[1] - c[1], q[2] - c[2]]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b]; }
  let x: V3 = [0.577, 0.577, 0.577];
  for (let it = 0; it < 30; it++) {
    const y: V3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) y[a] = C[a][0] * x[0] + C[a][1] * x[1] + C[a][2] * x[2];
    const l = Math.hypot(...y) || 1; x = [y[0] / l, y[1] / l, y[2] / l];
  }
  return x;
}

export type CutOrientation = 'limb' | 'surface' | 'x' | 'y' | 'z';
export const ORIENTATIONS: { id: CutOrientation; name: string }[] = [
  { id: 'limb', name: 'Along the limb (automatic)' }, { id: 'surface', name: 'Straight into the surface' },
  { id: 'x', name: 'Across X' }, { id: 'y', name: 'Across Y' }, { id: 'z', name: 'Across Z (horizontal slice)' },
];

/** The cut a click would create: plane at the hit point, normal chosen by the orientation mode. */
export function cutAt(m: IndexedMesh, id: string, hit: V3, surfaceNormal: V3, mode: CutOrientation, kind: JointKind, radius = 14): Cut {
  let n: V3;
  switch (mode) {
    case 'x': n = [1, 0, 0]; break;
    case 'y': n = [0, 1, 0]; break;
    case 'z': n = [0, 0, 1]; break;
    case 'surface': n = [-surfaceNormal[0], -surfaceNormal[1], -surfaceNormal[2]]; break;
    default: n = localAxis(m, hit, radius);
  }
  // keep the normal pointing the same general way for every cut (towards +x, then +y) so A → B is consistent along a chain
  if (n[0] < -1e-6 || (Math.abs(n[0]) < 1e-6 && n[1] < 0)) n = [-n[0], -n[1], -n[2]];
  // a click lands on the skin: step a little into the model so the cut starts inside it (it is re-centred on the section when built)
  const inside: V3 = [hit[0] - surfaceNormal[0] * 1.5, hit[1] - surfaceNormal[1] * 1.5, hit[2] - surfaceNormal[2] * 1.5];
  const c = newCut(id, inside, n, defaultJoint(kind));
  c.name = `Cut ${id}`;
  return c;
}

/** Turn a mesh by quarter turns about x, y and z (in that order). */
export const rotateQuarters = (m: IndexedMesh, q: [number, number, number]): IndexedMesh => {
  if (!q[0] && !q[1] && !q[2]) return m;
  const v = new Float32Array(m.vertices.length);
  const cs = (n: number) => { const a = (n * Math.PI) / 2; return [Math.round(Math.cos(a)), Math.round(Math.sin(a))]; };
  const [cx, sx] = cs(q[0]), [cy, sy] = cs(q[1]), [cz, sz] = cs(q[2]);
  for (let i = 0; i < v.length; i += 3) {
    let x = m.vertices[i], y = m.vertices[i + 1], z = m.vertices[i + 2], t;
    t = y * cx - z * sx; z = y * sx + z * cx; y = t;
    t = z * cy - x * sy; x = z * sy + x * cy; z = t;
    t = x * cz - y * sz; y = x * sz + y * cz; x = t;
    v[i] = x; v[i + 1] = y; v[i + 2] = z;
  }
  return { vertices: v, indices: m.indices };
};

export interface BedFit { size: V3; fits: boolean; /** footprint rotation (°) that fits best, and the uniform scale still needed (1 = none) */ angle: number; scale: number; margin: number }

/** Does a model fit the bed, trying turns of the footprint? Plates keep a margin. */
export function fitToBed(m: IndexedMesh, bed: { x: number; y: number; z: number }, margin = 4): BedFit {
  const b = bounds(m), size: V3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  let best = { angle: 0, scale: Infinity };
  const v = m.vertices;
  for (let deg = 0; deg < 180; deg += 5) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < v.length; i += 3) { const x = v[i] * c - v[i + 1] * s, y = v[i] * s + v[i + 1] * c; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const sc = Math.min((bed.x - 2 * margin) / (x1 - x0), (bed.y - 2 * margin) / (y1 - y0), bed.z / Math.max(1e-6, size[2]));
    if (best.scale === Infinity || sc > best.scale) best = { angle: deg, scale: sc };
  }
  return { size, fits: best.scale >= 1, angle: best.angle, scale: Math.min(1, best.scale), margin };
}
