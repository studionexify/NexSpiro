// Measure tool, after Bambu Studio's GLGizmoMeasure: pick points, edges or planes on the models, read the distance
// or angle between two features, and scale an object so a measured distance becomes a given value.
import * as THREE from 'three';
import type { Vec3 } from './store';

export type MeasureMode = 'auto' | 'point' | 'edge' | 'face';
export type MeasureFeature =
  | { kind: 'point'; objId: string; p: Vec3 }
  | { kind: 'edge'; objId: string; a: Vec3; b: Vec3 }
  | { kind: 'plane'; objId: string; p: Vec3; n: Vec3 };

const V = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const arr = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

/**
 * Feature under a click on triangle `tri` (world-space corners, outward normal) at `hit`.
 * Auto mode prefers an edge when the click is within `edgeSnap` mm of a triangle edge on a sharp crease,
 * else the plane when the surface there is flat, else the point.
 */
export function pickFeature(objId: string, mode: MeasureMode, hit: THREE.Vector3, tri: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  normal: THREE.Vector3, sharpEdge: (i: number) => boolean, flat: boolean, edgeSnap = 1): MeasureFeature {
  let best = -1, bestD = Infinity;
  const line = new THREE.Line3(), q = new THREE.Vector3();
  for (let i = 0; i < 3; i++) {
    line.set(tri[i], tri[(i + 1) % 3]);
    const d = line.closestPointToPoint(hit, true, q).distanceTo(hit);
    if (d < bestD) { bestD = d; best = i; }
  }
  const edge = (): MeasureFeature => ({ kind: 'edge', objId, a: arr(tri[best]), b: arr(tri[(best + 1) % 3]) });
  if (mode === 'edge') return edge();
  if (mode === 'face') return { kind: 'plane', objId, p: arr(hit), n: arr(normal.clone().normalize()) };
  if (mode === 'point') return { kind: 'point', objId, p: arr(hit) };
  if (bestD <= edgeSnap && sharpEdge(best)) return edge();
  if (flat) return { kind: 'plane', objId, p: arr(hit), n: arr(normal.clone().normalize()) };
  return { kind: 'point', objId, p: arr(hit) };
}

export interface MeasureResult {
  /** Shortest distance between the features (null when it is not defined, e.g. intersecting planes). */
  distance: number | null;
  /** Angle between edges / planes, degrees. */
  angle: number | null;
  delta: Vec3 | null;
  /** The two points the distance is measured between (for drawing and for scaling). */
  from: Vec3 | null;
  to: Vec3 | null;
}

const closestOnFeature = (f: MeasureFeature, p: THREE.Vector3): THREE.Vector3 => {
  if (f.kind === 'point') return V(f.p);
  if (f.kind === 'edge') return new THREE.Line3(V(f.a), V(f.b)).closestPointToPoint(p, true, new THREE.Vector3());
  return new THREE.Plane().setFromNormalAndCoplanarPoint(V(f.n), V(f.p)).projectPoint(p, new THREE.Vector3());
};

const dirOf = (f: MeasureFeature) => (f.kind === 'edge' ? V(f.b).sub(V(f.a)).normalize() : f.kind === 'plane' ? V(f.n) : null);

export function measure(a: MeasureFeature, b: MeasureFeature): MeasureResult {
  const res: MeasureResult = { distance: null, angle: null, delta: null, from: null, to: null };
  const da = dirOf(a), db = dirOf(b);
  if (da && db) {
    let ang = (Math.acos(Math.min(1, Math.abs(da.dot(db)))) * 180) / Math.PI;
    if (a.kind !== b.kind) ang = 90 - ang; // edge against plane: angle to the plane, not its normal
    res.angle = ang;
  }
  // planes that are not parallel meet: no distance between them
  if (a.kind === 'plane' && b.kind === 'plane' && res.angle! > 0.01) return res;
  if ((a.kind === 'plane' && b.kind === 'edge') || (a.kind === 'edge' && b.kind === 'plane')) {
    const pl = a.kind === 'plane' ? a : (b as typeof a), ed = a.kind === 'edge' ? a : (b as Extract<MeasureFeature, { kind: 'edge' }>);
    if (res.angle! > 0.01) return res;
    const p = V(ed.a);
    const q = closestOnFeature(pl, p);
    return fill(res, a === ed ? p : q, a === ed ? q : p);
  }
  let p: THREE.Vector3, q: THREE.Vector3;
  if (a.kind === 'edge' && b.kind === 'edge') {
    [p, q] = segmentClosest(V(a.a), V(a.b), V(b.a), V(b.b));
  } else if (a.kind === 'point') { p = V(a.p); q = closestOnFeature(b, p); }
  else if (b.kind === 'point') { q = V(b.p); p = closestOnFeature(a, q); }
  else { p = a.kind === 'plane' ? V(a.p) : V((a as any).a); q = closestOnFeature(b, p); }
  return fill(res, p, q);
}

function fill(res: MeasureResult, p: THREE.Vector3, q: THREE.Vector3): MeasureResult {
  res.from = arr(p); res.to = arr(q);
  res.distance = p.distanceTo(q);
  res.delta = [Math.abs(q.x - p.x), Math.abs(q.y - p.y), Math.abs(q.z - p.z)];
  return res;
}

/** Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
function segmentClosest(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) return [p1.clone(), p2.clone()];
  if (a <= 1e-12) t = THREE.MathUtils.clamp(f / e, 0, 1);
  else {
    const c = d1.dot(r);
    if (e <= 1e-12) s = THREE.MathUtils.clamp(-c / a, 0, 1);
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-12 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  return [p1.clone().addScaledVector(d1, s), p2.clone().addScaledVector(d2, t)];
}

/** Length of a single picked edge. */
export const edgeLength = (f: MeasureFeature) => (f.kind === 'edge' ? V(f.a).distanceTo(V(f.b)) : null);
