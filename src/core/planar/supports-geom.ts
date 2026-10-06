// Private Clipper (v6, integer) helpers for the support generator. Everything here works on `Paths` (arrays of integer rings,
// outer = CCW / positive area, holes = CW) at 1000 units per mm, and converts to/from ExPoly only at the module boundary.
// @ts-ignore -- clipper-lib ships no typings
import ClipperLib from "clipper-lib";
import type { ExPoly, Ring } from "./types.ts";

const CL: any = ClipperLib;
export const SCALE = 1000;
export type IPt = { X: number; Y: number };
export type Paths = IPt[][];
const ARC_TOL = 8; // 0.008 mm chord error for round joins

function ringToPath(r: Ring): IPt[] {
  const n = r.length >> 1; const p: IPt[] = new Array(n);
  for (let i = 0; i < n; i++) p[i] = { X: Math.round(r[2 * i] * SCALE), Y: Math.round(r[2 * i + 1] * SCALE) };
  return p;
}
function pathToRing(p: IPt[]): Ring {
  const r = new Float64Array(p.length * 2);
  for (let i = 0; i < p.length; i++) { r[2 * i] = p[i].X / SCALE; r[2 * i + 1] = p[i].Y / SCALE; }
  return r;
}

/** ExPoly[] -> Paths with outer rings CCW and holes CW (degenerate rings dropped). */
export function toPaths(polys: ExPoly[]): Paths {
  const out: Paths = [];
  for (const poly of polys) {
    if (!poly || !poly.outer) continue;
    const o = ringToPath(poly.outer); if (o.length < 3) continue;
    if (!CL.Clipper.Orientation(o)) o.reverse();
    out.push(o);
    for (const h of poly.holes || []) { const hp = ringToPath(h); if (hp.length < 3) continue; if (CL.Clipper.Orientation(hp)) hp.reverse(); out.push(hp); }
  }
  return out;
}

function exec(ct: number, subj: Paths, clip: Paths): Paths {
  const c = new CL.Clipper();
  if (subj.length) c.AddPaths(subj, CL.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, CL.PolyType.ptClip, true);
  const sol: Paths = [];
  c.Execute(ct, sol, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return sol;
}
export function union(a: Paths, b: Paths): Paths {
  if (!a.length) return b; if (!b.length) return a;
  return exec(CL.ClipType.ctUnion, a, b);
}
export function unionAll(list: Paths[]): Paths {
  const c = new CL.Clipper(); let any = 0;
  for (const p of list) if (p.length) { c.AddPaths(p, CL.PolyType.ptSubject, true); any++; }
  if (!any) return [];
  const sol: Paths = []; c.Execute(CL.ClipType.ctUnion, sol, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero); return sol;
}
export function diff(a: Paths, b: Paths): Paths { if (!a.length || !b.length) return a; return exec(CL.ClipType.ctDifference, a, b); }
export function inter(a: Paths, b: Paths): Paths { if (!a.length || !b.length) return []; return exec(CL.ClipType.ctIntersection, a, b); }
export function offset(p: Paths, mm: number): Paths {
  if (!p.length || mm === 0) return p;
  const co = new CL.ClipperOffset(2, ARC_TOL);
  co.AddPaths(p, CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
  const sol: Paths = []; co.Execute(sol, mm * SCALE); return sol;
}
export const opening = (p: Paths, r: number): Paths => (r > 0 && p.length ? offset(offset(p, -r), r) : p);
export const closing = (p: Paths, r: number): Paths => (r > 0 && p.length ? offset(offset(p, r), -r) : p);

/** Net area in mm² of a clipper result (holes subtract). */
export function area(p: Paths): number { let a = 0; for (const r of p) a += CL.Clipper.Area(r); return a / (SCALE * SCALE); }

/** Split a region into islands; each island is [outer, ...holes]. */
export function islands(p: Paths): Paths[] {
  if (!p.length) return [];
  const c = new CL.Clipper(); c.AddPaths(p, CL.PolyType.ptSubject, true);
  const tree = new CL.PolyTree(); c.Execute(CL.ClipType.ctUnion, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  const out: Paths[] = [];
  const visit = (node: any) => {
    for (const ch of node.Childs()) {
      if (ch.IsHole()) { visit(ch); continue; }
      const isl: Paths = [ch.Contour()];
      for (const h of ch.Childs()) { isl.push(h.Contour()); visit(h); }
      out.push(isl);
    }
  };
  visit(tree);
  return out;
}
/** Drop islands whose net area is below `minMM2`. */
export function filterSmall(p: Paths, minMM2: number): Paths {
  if (!p.length || minMM2 <= 0) return p;
  const out: Paths = [];
  for (const isl of islands(p)) if (area(isl) >= minMM2) for (const r of isl) out.push(r);
  return out;
}
export function fromPaths(p: Paths): ExPoly[] {
  const out: ExPoly[] = [];
  for (const isl of islands(p)) {
    const o = isl[0]; if (!CL.Clipper.Orientation(o)) o.reverse();
    const holes: Ring[] = [];
    for (let i = 1; i < isl.length; i++) { const h = isl[i]; if (CL.Clipper.Orientation(h)) h.reverse(); holes.push(pathToRing(h)); }
    out.push({ outer: pathToRing(o), holes });
  }
  return out;
}
/** Even-odd point-in-region test (mm). */
export function contains(p: Paths, x: number, y: number): boolean {
  const pt = { X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }; let n = 0;
  for (const r of p) if (CL.Clipper.PointInPolygon(pt, r) !== 0) n++;
  return (n & 1) === 1;
}
export function bounds(p: Paths): [number, number, number, number] | null {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of p) for (const q of r) { if (q.X < a) a = q.X; if (q.X > c) c = q.X; if (q.Y < b) b = q.Y; if (q.Y > d) d = q.Y; }
  return a === Infinity ? null : [a / SCALE, b / SCALE, c / SCALE, d / SCALE];
}
/** Regular polygon approximating a circle (CCW), mm in, scaled out. */
export function circle(x: number, y: number, r: number, seg = 0): IPt[] {
  const n = seg || Math.max(10, Math.min(28, Math.ceil(r * 8)));
  const out: IPt[] = new Array(n);
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out[i] = { X: Math.round((x + Math.cos(a) * r) * SCALE), Y: Math.round((y + Math.sin(a) * r) * SCALE) }; }
  return out;
}
/** Points spaced `step` mm along every ring of a region (first vertex of each ring included). */
export function walkRings(p: Paths, step: number): [number, number][] {
  const pts: [number, number][] = [];
  for (const ring of p) {
    const n = ring.length; let carry = 0; let first = true;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const ax = a.X / SCALE, ay = a.Y / SCALE, bx = b.X / SCALE, by = b.Y / SCALE;
      if (first) { pts.push([ax, ay]); first = false; }
      const len = Math.hypot(bx - ax, by - ay); let t = step - carry;
      while (t <= len) { const f = t / len; pts.push([ax + (bx - ax) * f, ay + (by - ay) * f]); t += step; }
      carry = len - (t - step);
    }
  }
  return pts;
}

/** Uniform-grid index over the edges of a region for nearest-edge and inside queries (mm). */
export class EdgeGrid {
  segs: number[] = [];
  cell: number;
  cells = new Map<number, number[]>();
  rows = new Map<number, number[]>();
  constructor(paths: Paths, cell = 2) {
    this.cell = cell;
    for (const path of paths) {
      const n = path.length;
      for (let i = 0; i < n; i++) { const a = path[i], b = path[(i + 1) % n]; this.add(a.X / SCALE, a.Y / SCALE, b.X / SCALE, b.Y / SCALE); }
    }
  }
  private key(cx: number, cy: number): number { return (cx + 8192) * 16384 + (cy + 8192); }
  private add(x1: number, y1: number, x2: number, y2: number): void {
    const id = this.segs.length >> 2; this.segs.push(x1, y1, x2, y2);
    const c = this.cell;
    const r0 = Math.floor(Math.min(y1, y2) / c), r1 = Math.floor(Math.max(y1, y2) / c);
    for (let r = r0; r <= r1; r++) { let l = this.rows.get(r); if (!l) { l = []; this.rows.set(r, l); } l.push(id); }
    const len = Math.hypot(x2 - x1, y2 - y1); const steps = Math.max(1, Math.ceil(len / (c * 0.5)));
    let last = NaN;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps; const k = this.key(Math.floor((x1 + (x2 - x1) * f) / c), Math.floor((y1 + (y2 - y1) * f) / c));
      if (k === last) continue; last = k;
      let l = this.cells.get(k); if (!l) { l = []; this.cells.set(k, l); }
      if (l[l.length - 1] !== id) l.push(id);
    }
  }
  /** Nearest edge point within roughly R mm (searches R + 1 cell); d = Infinity when nothing was found. */
  nearest(px: number, py: number, R: number): { d: number; qx: number; qy: number } {
    const c = this.cell; const span = Math.ceil(R / c) + 1; const cx = Math.floor(px / c), cy = Math.floor(py / c);
    let best = Infinity, bx = 0, by = 0; const s = this.segs;
    for (let ix = cx - span; ix <= cx + span; ix++) for (let iy = cy - span; iy <= cy + span; iy++) {
      const l = this.cells.get(this.key(ix, iy)); if (!l) continue;
      for (const id of l) {
        const o = id * 4; const x1 = s[o], y1 = s[o + 1], dx = s[o + 2] - x1, dy = s[o + 3] - y1;
        const L = dx * dx + dy * dy; let t = L > 0 ? ((px - x1) * dx + (py - y1) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = x1 + dx * t, qy = y1 + dy * t; const d = Math.hypot(px - qx, py - qy);
        if (d < best) { best = d; bx = qx; by = qy; }
      }
    }
    return { d: best, qx: bx, qy: by };
  }
  /** Brute-force nearest over all edges (fallback for points deep inside / far from everything). */
  nearestAll(px: number, py: number): { d: number; qx: number; qy: number } {
    let best = Infinity, bx = 0, by = 0; const s = this.segs;
    for (let o = 0; o < s.length; o += 4) {
      const x1 = s[o], y1 = s[o + 1], dx = s[o + 2] - x1, dy = s[o + 3] - y1;
      const L = dx * dx + dy * dy; let t = L > 0 ? ((px - x1) * dx + (py - y1) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = x1 + dx * t, qy = y1 + dy * t; const d = Math.hypot(px - qx, py - qy);
      if (d < best) { best = d; bx = qx; by = qy; }
    }
    return { d: best, qx: bx, qy: by };
  }
  inside(px: number, py: number): boolean {
    const l = this.rows.get(Math.floor(py / this.cell)); if (!l) return false;
    let ins = false; const s = this.segs;
    for (const id of l) {
      const o = id * 4; const x1 = s[o], y1 = s[o + 1], x2 = s[o + 2], y2 = s[o + 3];
      if ((y1 > py) !== (y2 > py) && px < x1 + ((py - y1) * (x2 - x1)) / (y2 - y1)) ins = !ins;
    }
    return ins;
  }
  /** Signed clearance: >0 outside, <0 inside; magnitude is capped at about R when nothing is nearby. */
  clearance(px: number, py: number, R: number): number {
    const ins = this.inside(px, py); const n = this.nearest(px, py, R);
    const d = n.d === Infinity ? R : n.d;
    return ins ? -d : d;
  }
  get empty(): boolean { return this.segs.length === 0; }
}
