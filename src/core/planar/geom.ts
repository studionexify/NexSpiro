// Polygon geometry for the planar slicer: Clipper wrappers (offset / boolean / simplify), ring maths, point-in-polygon, line clipping.
import ClipperLib from "clipper-lib";
import type { ExPoly, Ring } from "./types.ts";

/** Clipper works on integers: 1 unit = 1/SCALE mm. */
export const SCALE = 1000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: any = ClipperLib;
type IP = { X: number; Y: number };
export type CPaths = IP[][];
export type Bounds4 = [number, number, number, number];
export type Join = "round" | "miter" | "square";

// ---------------------------------------------------------------- rings
/** Signed area, counter-clockwise positive. */
export function ringArea(r: ArrayLike<number>): number {
  const n = r.length >> 1; let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
  return a / 2;
}
export const isCCW = (r: ArrayLike<number>) => ringArea(r) > 0;
export function reverseRing(r: Ring): Ring {
  const n = r.length >> 1, o = new Float64Array(r.length);
  for (let i = 0; i < n; i++) { o[2 * i] = r[2 * (n - 1 - i)]; o[2 * i + 1] = r[2 * (n - 1 - i) + 1]; }
  return o;
}
export function ringLength(r: ArrayLike<number>, closed = true): number {
  const n = r.length >> 1; let l = 0;
  for (let i = 1; i < n; i++) l += Math.hypot(r[2 * i] - r[2 * i - 2], r[2 * i + 1] - r[2 * i - 1]);
  if (closed && n > 1) l += Math.hypot(r[0] - r[2 * n - 2], r[1] - r[2 * n - 1]);
  return l;
}
export function ringBounds(r: ArrayLike<number>): Bounds4 {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i + 1 < r.length; i += 2) { const x = r[i], y = r[i + 1]; if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
  return [a, b, c, d];
}
export function polysBounds(polys: ExPoly[]): Bounds4 | null {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of polys) { const q = ringBounds(p.outer); if (q[0] < a) a = q[0]; if (q[1] < b) b = q[1]; if (q[2] > c) c = q[2]; if (q[3] > d) d = q[3]; }
  return a === Infinity ? null : [a, b, c, d];
}
export const polyArea = (p: ExPoly) => { let a = Math.abs(ringArea(p.outer)); for (const h of p.holes) a -= Math.abs(ringArea(h)); return a; };
export const polysArea = (ps: ExPoly[]) => { let a = 0; for (const p of ps) a += polyArea(p); return a; };
export function ringCentroid(r: ArrayLike<number>): [number, number] {
  const n = r.length >> 1; let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) { const f = r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1]; a += f; cx += (r[2 * j] + r[2 * i]) * f; cy += (r[2 * j + 1] + r[2 * i + 1]) * f; }
  if (Math.abs(a) < 1e-12) { let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += r[2 * i]; sy += r[2 * i + 1]; } return [sx / Math.max(1, n), sy / Math.max(1, n)]; }
  return [cx / (3 * a), cy / (3 * a)];
}
/** Rotates a ring so that vertex `idx` is first. */
export function rotateRing(r: Ring, idx: number): Ring {
  const n = r.length >> 1; if (idx <= 0 || idx >= n) return r;
  const o = new Float64Array(r.length);
  for (let i = 0; i < n; i++) { const s = (i + idx) % n; o[2 * i] = r[2 * s]; o[2 * i + 1] = r[2 * s + 1]; }
  return o;
}
/** Inserts points so that no edge is longer than `maxStep`. */
export function resampleRing(r: ArrayLike<number>, maxStep: number, closed = true): Float64Array {
  const n = r.length >> 1, out: number[] = [];
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const x0 = r[2 * i], y0 = r[2 * i + 1], j = (i + 1) % n, x1 = r[2 * j], y1 = r[2 * j + 1];
    out.push(x0, y0);
    const l = Math.hypot(x1 - x0, y1 - y0), k = Math.ceil(l / maxStep);
    for (let s = 1; s < k; s++) out.push(x0 + (x1 - x0) * s / k, y0 + (y1 - y0) * s / k);
  }
  if (!closed && n) out.push(r[2 * n - 2], r[2 * n - 1]);
  return Float64Array.from(out);
}
/** Douglas-Peucker for closed rings (keeps >= 3 points). */
export function simplifyRing(r: Ring, tol: number): Ring {
  const n = r.length >> 1; if (n <= 3 || tol <= 0) return r;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = (r[2 * i] - r[0]) ** 2 + (r[2 * i + 1] - r[1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, n]]; // second chain wraps to index 0 (== n)
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!; if (b - a < 2) continue;
    const ax = r[2 * a], ay = r[2 * a + 1], bi = b % n, bx = r[2 * bi], by = r[2 * bi + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = r[2 * i] - ax, py = r[2 * i + 1] - ay;
      let d: number;
      if (l2 < 1e-18) d = px * px + py * py;
      else { const t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2)); d = (px - t * dx) ** 2 + (py - t * dy) ** 2; }
      if (d > md) { md = d; mi = i; }
    }
    if (md > t2) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  let k = 0; for (let i = 0; i < n; i++) k += keep[i];
  if (k < 3) return r;
  const o = new Float64Array(k * 2); let w = 0;
  for (let i = 0; i < n; i++) if (keep[i]) { o[w++] = r[2 * i]; o[w++] = r[2 * i + 1]; }
  return o;
}
export function simplifyPolys(polys: ExPoly[], tol: number): ExPoly[] {
  if (tol <= 0) return polys;
  const out: ExPoly[] = [];
  for (const p of polys) {
    const o = simplifyRing(p.outer, tol); if (o.length < 6) continue;
    out.push({ outer: o, holes: p.holes.map((h) => simplifyRing(h, tol)).filter((h) => h.length >= 6) });
  }
  return out;
}
/** Convex hull (Andrew monotone chain) of flat xy points; returns a CCW ring. */
export function convexHull(pts: ArrayLike<number>): Ring {
  const n = pts.length >> 1; const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1]);
  const cross = (o: number, a: number, b: number) => (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) - (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
  const h: number[] = [];
  for (const i of idx) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], i) <= 0) h.pop(); h.push(i); }
  const lo = h.length + 1;
  for (let k = idx.length - 2; k >= 0; k--) { const i = idx[k]; while (h.length >= lo && cross(h[h.length - 2], h[h.length - 1], i) <= 0) h.pop(); h.push(i); }
  h.pop();
  const o = new Float64Array(h.length * 2);
  h.forEach((i, k) => { o[2 * k] = pts[2 * i]; o[2 * k + 1] = pts[2 * i + 1]; });
  return o;
}
export function circleRing(cx: number, cy: number, r: number, segs = 24): Ring {
  const o = new Float64Array(segs * 2);
  for (let i = 0; i < segs; i++) { const a = (i / segs) * Math.PI * 2; o[2 * i] = cx + Math.cos(a) * r; o[2 * i + 1] = cy + Math.sin(a) * r; }
  return o;
}

// ---------------------------------------------------------------- clipper conversion
export function ringToPath(r: ArrayLike<number>): IP[] {
  const n = r.length >> 1, p = new Array<IP>(n);
  for (let i = 0; i < n; i++) p[i] = { X: Math.round(r[2 * i] * SCALE), Y: Math.round(r[2 * i + 1] * SCALE) };
  return p;
}
export function pathToRing(p: IP[]): Ring {
  const o = new Float64Array(p.length * 2);
  for (let i = 0; i < p.length; i++) { o[2 * i] = p[i].X / SCALE; o[2 * i + 1] = p[i].Y / SCALE; }
  return o;
}
/** Outer rings CCW, holes CW, ready for a NonZero fill. */
export function polysToPaths(polys: ExPoly[]): CPaths {
  const out: CPaths = [];
  for (const p of polys) {
    if (p.outer.length < 6) continue;
    const o = ringToPath(p.outer); if (ringArea(p.outer) < 0) o.reverse(); out.push(o);
    for (const h of p.holes) { if (h.length < 6) continue; const q = ringToPath(h); if (ringArea(h) > 0) q.reverse(); out.push(q); }
  }
  return out;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkTree(node: any, out: ExPoly[]) {
  for (const ch of node.Childs()) {
    const c = ch.Contour(); if (c.length < 3) { for (const g of ch.Childs()) walkTree(g, out); continue; }
    if (ch.IsHole()) { walkTree(ch, out); continue; }
    let outer = pathToRing(c); if (ringArea(outer) < 0) outer = reverseRing(outer);
    if (Math.abs(ringArea(outer)) < 1e-7) continue;
    const holes: Ring[] = [];
    for (const hh of ch.Childs()) {
      const hc = hh.Contour(); if (hc.length >= 3) { let h = pathToRing(hc); if (ringArea(h) > 0) h = reverseRing(h); if (Math.abs(ringArea(h)) > 1e-7) holes.push(h); }
      for (const g of hh.Childs()) walkTree({ Childs: () => [g] }, out);
    }
    out.push({ outer, holes });
  }
}
export function treeToPolys(tree: unknown): ExPoly[] { const out: ExPoly[] = []; walkTree(tree, out); return out; }

/** Flat Clipper result → islands. Much cheaper than a PolyTree: holes (negative orientation) go to the smallest outer containing them. */
export function pathsToIslands(paths: CPaths): ExPoly[] {
  const outers: { ring: Ring; area: number; idx: PolyIndex | null; b: Bounds4; holes: Ring[] }[] = [], holes: { ring: Ring }[] = [];
  for (const p of paths) {
    if (p.length < 3) continue;
    const ring = pathToRing(p), a = ringArea(ring);
    if (Math.abs(a) < 1e-7) continue;
    if (a > 0) outers.push({ ring, area: a, idx: null, b: ringBounds(ring), holes: [] }); else holes.push({ ring });
  }
  if (holes.length) {
    outers.sort((x, y) => x.area - y.area);
    for (const h of holes) {
      const x = h.ring[0], y = h.ring[1];
      for (const o of outers) {
        if (x < o.b[0] || x > o.b[2] || y < o.b[1] || y > o.b[3]) continue;
        o.idx ??= new PolyIndex([{ outer: o.ring, holes: [] }]);
        if (o.idx.contains(x, y)) { o.holes.push(h.ring); break; }
      }
    }
  }
  return outers.map((o) => ({ outer: o.ring, holes: o.holes }));
}

type FillT = "nonzero" | "evenodd";
const fillOf = (f: FillT) => (f === "evenodd" ? C.PolyFillType.pftEvenOdd : C.PolyFillType.pftNonZero);
/** Raw clipper paths → islands (union under the given fill rule). */
export function pathsToPolys(paths: CPaths, fill: FillT = "nonzero"): ExPoly[] {
  if (!paths.length) return [];
  const c = new C.Clipper(); c.AddPaths(paths, C.PolyType.ptSubject, true);
  const t = new C.PolyTree(); c.Execute(C.ClipType.ctUnion, t, fillOf(fill), fillOf(fill));
  return treeToPolys(t);
}
function bool(type: number, a: ExPoly[], b: ExPoly[]): ExPoly[] {
  if (!a.length) return type === C.ClipType.ctUnion || type === C.ClipType.ctXor ? cloneSafe(b) : [];
  const c = new C.Clipper();
  c.AddPaths(polysToPaths(a), C.PolyType.ptSubject, true);
  if (b.length) c.AddPaths(polysToPaths(b), C.PolyType.ptClip, true);
  const out: CPaths = []; c.Execute(type, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return pathsToIslands(out);
}
const cloneSafe = (b: ExPoly[]) => (b.length ? bool(C.ClipType.ctUnion, b, []) : []);
export const unionPolys = (a: ExPoly[], b: ExPoly[] = []): ExPoly[] => bool(C.ClipType.ctUnion, a.length ? a : b, a.length ? b : []);
export const diffPolys = (a: ExPoly[], b: ExPoly[]): ExPoly[] => (b.length ? bool(C.ClipType.ctDifference, a, b) : a.length ? bool(C.ClipType.ctUnion, a, []) : []);
export const intersectPolys = (a: ExPoly[], b: ExPoly[]): ExPoly[] => (a.length && b.length ? bool(C.ClipType.ctIntersection, a, b) : []);
export const xorPolys = (a: ExPoly[], b: ExPoly[]): ExPoly[] => bool(C.ClipType.ctXor, a, b);
/** Union of many lists in one pass. */
export function unionAll(lists: ExPoly[][]): ExPoly[] {
  const all: ExPoly[] = []; for (const l of lists) for (const p of l) all.push(p);
  return all.length ? bool(C.ClipType.ctUnion, all, []) : [];
}
/** Positive delta grows, negative shrinks (mm). */
export function offsetPolys(polys: ExPoly[], delta: number, join: Join = "round", miterLimit = 2): ExPoly[] {
  if (!polys.length) return [];
  if (Math.abs(delta) < 0.5 / SCALE) return polys;
  const co = new C.ClipperOffset(miterLimit, 0.02 * SCALE);
  co.AddPaths(polysToPaths(polys), join === "round" ? C.JoinType.jtRound : join === "miter" ? C.JoinType.jtMiter : C.JoinType.jtSquare, C.EndType.etClosedPolygon);
  const out: CPaths = []; co.Execute(out, delta * SCALE);
  return pathsToIslands(out);
}
/** offset(-r) then offset(+r): removes parts thinner than 2r. */
export const openPolys = (polys: ExPoly[], r: number): ExPoly[] => offsetPolys(offsetPolys(polys, -r), r);
/** offset(+r) then offset(-r): fills gaps narrower than 2r. */
export const closePolys = (polys: ExPoly[], r: number): ExPoly[] => offsetPolys(offsetPolys(polys, r), -r);
export function dropHoles(polys: ExPoly[]): ExPoly[] { return polys.map((p) => ({ outer: p.outer, holes: [] })); }
/** Minimal-area filter. */
export const filterArea = (polys: ExPoly[], minArea: number) => polys.filter((p) => polyArea(p) >= minArea);
export function allRings(polys: ExPoly[]): Ring[] { const o: Ring[] = []; for (const p of polys) { o.push(p.outer); for (const h of p.holes) o.push(h); } return o; }
/** Rings of an ExPoly[] as a polygon (hole interiors become islands): used for inner brim. */
export function holesAsPolys(polys: ExPoly[]): ExPoly[] { const o: ExPoly[] = []; for (const p of polys) for (const h of p.holes) o.push({ outer: ringArea(h) > 0 ? h : reverseRing(h), holes: [] }); return o; }

// ---------------------------------------------------------------- point in polygon
/** Even-odd inside test over a set of islands, y-bucketed for speed. */
export class PolyIndex {
  private x1: Float64Array; private y1: Float64Array; private x2: Float64Array; private y2: Float64Array;
  private ymin = 0; private binH = 1; private nb = 1; private start: Int32Array; private ids: Int32Array;
  readonly empty: boolean;
  constructor(polys: ExPoly[]) {
    let e = 0; for (const p of polys) { e += p.outer.length >> 1; for (const h of p.holes) e += h.length >> 1; }
    this.x1 = new Float64Array(e); this.y1 = new Float64Array(e); this.x2 = new Float64Array(e); this.y2 = new Float64Array(e);
    let k = 0, ymin = Infinity, ymax = -Infinity;
    const add = (r: Ring) => {
      const n = r.length >> 1;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        this.x1[k] = r[2 * j]; this.y1[k] = r[2 * j + 1]; this.x2[k] = r[2 * i]; this.y2[k] = r[2 * i + 1];
        const a = this.y1[k], b = this.y2[k]; if (a < ymin) ymin = a; if (b < ymin) ymin = b; if (a > ymax) ymax = a; if (b > ymax) ymax = b; k++;
      }
    };
    for (const p of polys) { add(p.outer); for (const h of p.holes) add(h); }
    this.empty = k === 0;
    this.nb = Math.max(1, Math.min(1024, Math.ceil(Math.sqrt(k))));
    this.ymin = ymin; this.binH = Math.max((ymax - ymin) / this.nb, 1e-9);
    const cnt = new Int32Array(this.nb + 1);
    const span = (i: number): [number, number] => {
      const a = Math.min(this.y1[i], this.y2[i]), b = Math.max(this.y1[i], this.y2[i]);
      return [Math.max(0, Math.min(this.nb - 1, Math.floor((a - ymin) / this.binH))), Math.max(0, Math.min(this.nb - 1, Math.floor((b - ymin) / this.binH)))];
    };
    for (let i = 0; i < k; i++) { const [a, b] = span(i); for (let q = a; q <= b; q++) cnt[q + 1]++; }
    for (let q = 0; q < this.nb; q++) cnt[q + 1] += cnt[q];
    this.start = cnt; this.ids = new Int32Array(cnt[this.nb]);
    const fill = cnt.slice(0, this.nb);
    for (let i = 0; i < k; i++) { const [a, b] = span(i); for (let q = a; q <= b; q++) this.ids[fill[q]++] = i; }
  }
  contains(x: number, y: number): boolean {
    if (this.empty) return false;
    const b = Math.floor((y - this.ymin) / this.binH);
    if (b < 0 || b >= this.nb) { if (y < this.ymin || y > this.ymin + this.binH * this.nb) return false; }
    const q = Math.max(0, Math.min(this.nb - 1, b));
    let inside = false;
    for (let p = this.start[q]; p < this.start[q + 1]; p++) {
      const i = this.ids[p], ya = this.y1[i], yb = this.y2[i];
      if ((ya > y) !== (yb > y)) { const xi = this.x1[i] + (y - ya) * (this.x2[i] - this.x1[i]) / (yb - ya); if (x < xi) inside = !inside; }
    }
    return inside;
  }
}
export function pointInRing(r: ArrayLike<number>, x: number, y: number): boolean {
  const n = r.length >> 1; let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = r[2 * i + 1], yj = r[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < (r[2 * j] - r[2 * i]) * (y - yi) / (yj - yi) + r[2 * i]) inside = !inside;
  }
  return inside;
}
export function pointInPoly(p: ExPoly, x: number, y: number): boolean {
  if (!pointInRing(p.outer, x, y)) return false;
  for (const h of p.holes) if (pointInRing(h, x, y)) return false;
  return true;
}
export function pointInPolys(ps: ExPoly[], x: number, y: number): boolean { for (const p of ps) if (pointInPoly(p, x, y)) return true; return false; }
/** Index of the island whose outer ring (minus holes) contains the point, or -1. */
export function islandOf(ps: ExPoly[], x: number, y: number): number { for (let i = 0; i < ps.length; i++) if (pointInPoly(ps[i], x, y)) return i; return -1; }

// ---------------------------------------------------------------- line clipping
/** Exact clip of segment (x0,y0)-(x1,y1) against islands; returns inside parameter intervals [t0,t1] along the segment. */
export function clipSegmentToPolys(polys: ExPoly[], x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const ts: number[] = [0, 1], dx = x1 - x0, dy = y1 - y0;
  const edge = (r: Ring) => {
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = r[2 * j], ay = r[2 * j + 1], ex = r[2 * i] - ax, ey = r[2 * i + 1] - ay;
      const den = dx * ey - dy * ex; if (Math.abs(den) < 1e-14) continue;
      const t = ((ax - x0) * ey - (ay - y0) * ex) / den, u = ((ax - x0) * dy - (ay - y0) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u < 1) ts.push(t);
    }
  };
  for (const p of polys) { edge(p.outer); for (const h of p.holes) edge(h); }
  ts.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const a = ts[i], b = ts[i + 1]; if (b - a < 1e-9) continue;
    const m = (a + b) / 2;
    if (pointInPolys(polys, x0 + dx * m, y0 + dy * m)) { const l = out[out.length - 1]; if (l && Math.abs(l[1] - a) < 1e-9) l[1] = b; else out.push([a, b]); }
  }
  return out;
}
/** Clips a polyline (xy pairs) to a region, returning the inside pieces. Boundary crossings are refined by bisection. */
export function clipPolylineToIndex(idx: PolyIndex, pts: ArrayLike<number>): Float64Array[] {
  const n = pts.length >> 1, out: Float64Array[] = []; let cur: number[] = [];
  const flush = () => { if (cur.length >= 4) out.push(Float64Array.from(cur)); cur = []; };
  let pin = n ? idx.contains(pts[0], pts[1]) : false;
  if (pin) cur.push(pts[0], pts[1]);
  for (let i = 1; i < n; i++) {
    const ax = pts[2 * i - 2], ay = pts[2 * i - 1], bx = pts[2 * i], by = pts[2 * i + 1], bin = idx.contains(bx, by);
    if (pin && bin) cur.push(bx, by);
    else if (pin !== bin) {
      let lo = 0, hi = 1; // bisection on the inside/outside flip
      for (let k = 0; k < 9; k++) { const m = (lo + hi) / 2; if (idx.contains(ax + (bx - ax) * m, ay + (by - ay) * m) === pin) lo = m; else hi = m; }
      const t = pin ? lo : hi, px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
      if (pin) { cur.push(px, py); flush(); } else { cur = [px, py, bx, by]; }
    }
    pin = bin;
  }
  flush();
  return out;
}
export function clipPolylineToPolys(polys: ExPoly[], pts: ArrayLike<number>): Float64Array[] { return clipPolylineToIndex(new PolyIndex(polys), pts); }

/** Cheap structural equality (identical rings) used to skip work on prismatic stacks. */
export function samePolys(a: ExPoly[], b: ExPoly[]): boolean {
  if (a === b) return true; if (a.length !== b.length) return false;
  const eq = (x: Ring, y: Ring) => { if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
  for (let i = 0; i < a.length; i++) {
    if (!eq(a[i].outer, b[i].outer) || a[i].holes.length !== b[i].holes.length) return false;
    for (let h = 0; h < a[i].holes.length; h++) if (!eq(a[i].holes[h], b[i].holes[h])) return false;
  }
  return true;
}
