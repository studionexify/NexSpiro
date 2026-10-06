// Fill patterns: turn a region (ExPoly[]) into open / closed polylines.
import type { ExPoly } from "./types.ts";
import { PolyIndex, clipPolylineToIndex, offsetPolys, polysBounds, type Bounds4 } from "./geom.ts";

export type FillLine = { pts: Float64Array; closed: boolean };
export type FillOpts = {
  pattern: string;
  width: number;          // extrusion width, mm
  density: number;        // 0..1 (1 = solid)
  angle: number;          // base direction, degrees
  layer: number;          // print layer index (direction alternation)
  z: number;              // height, mm (3D patterns)
  anchor?: number;        // sparse infill anchor length, mm (0 = none)
  pitch?: number;         // explicit single-direction line pitch, overrides width/density
  maxPoints?: number;
};
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ rectilinear core
type Span = { k: number; ax: number; ay: number; bx: number; by: number };
/** Scan-lines of direction `angle` (deg) at `pitch`, phase-locked to the origin, clipped even-odd to the polys. */
export function scanSpans(polys: ExPoly[], angle: number, pitch: number, phase = 0): Span[] {
  const a = angle * D2R, ca = Math.cos(a), sa = Math.sin(a), J = 1.3e-7;
  const bb = polysBounds(polys); if (!bb || !(pitch > 1e-6)) return [];
  let ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]]) { const v = -x * sa + y * ca; if (v < ymin) ymin = v; if (v > ymax) ymax = v; }
  const k0 = Math.ceil((ymin - phase) / pitch) - 1, k1 = Math.floor((ymax - phase) / pitch) + 1;
  if (k1 - k0 > 200000) return [];
  const xs: number[][] = Array.from({ length: k1 - k0 + 1 }, () => []);
  const edges = (r: Float64Array) => {
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = r[2 * j] * ca + r[2 * j + 1] * sa, y1 = -r[2 * j] * sa + r[2 * j + 1] * ca;
      const x2 = r[2 * i] * ca + r[2 * i + 1] * sa, y2 = -r[2 * i] * sa + r[2 * i + 1] * ca;
      if (y1 === y2) continue;
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      let k = Math.ceil((lo - phase - J) / pitch);
      for (; ; k++) {
        const y = phase + k * pitch + J; if (y >= hi) break; if (y < lo) continue;
        const idx = k - k0; if (idx < 0 || idx >= xs.length) continue;
        xs[idx].push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      }
    }
  };
  for (const p of polys) { edges(p.outer); for (const h of p.holes) edges(h); }
  const out: Span[] = [];
  for (let q = 0; q < xs.length; q++) {
    const v = xs[q]; if (v.length < 2) continue; v.sort((m, n) => m - n);
    const k = q + k0, y = phase + k * pitch + J;
    for (let i = 0; i + 1 < v.length; i += 2) {
      if (v[i + 1] - v[i] < 1e-4) continue;
      out.push({ k, ax: v[i] * ca - y * sa, ay: v[i] * sa + y * ca, bx: v[i + 1] * ca - y * sa, by: v[i + 1] * sa + y * ca });
    }
  }
  return out;
}

function rectilinear(polys: ExPoly[], angle: number, pitch: number, phase: number, maxConn: number, infl: PolyIndex | null): FillLine[] {
  const spans = scanSpans(polys, angle, pitch, phase);
  const lines: FillLine[] = [];
  if (maxConn <= 0) {
    for (const s of spans) lines.push({ pts: (s.k & 1) ? Float64Array.of(s.bx, s.by, s.ax, s.ay) : Float64Array.of(s.ax, s.ay, s.bx, s.by), closed: false });
    return lines;
  }
  type Ch = { pts: number[]; row: number };
  const all: Ch[] = []; let active: Ch[] = [], row = Number.NaN, next: Ch[] = [];
  const inside = (x0: number, y0: number, x1: number, y1: number) => {
    if (!infl) return true;
    for (const t of [0.2, 0.4, 0.6, 0.8]) if (!infl.contains(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    return true;
  };
  for (const s of spans) {
    if (s.k !== row) { active = row === s.k - 1 ? next : []; next = []; row = s.k; }
    let best: Ch | null = null, bd = maxConn, rev = false;
    for (const c of active) {
      if (c.row !== s.k - 1) continue;
      const ex = c.pts[c.pts.length - 2], ey = c.pts[c.pts.length - 1];
      const da = Math.hypot(s.ax - ex, s.ay - ey), db = Math.hypot(s.bx - ex, s.by - ey);
      const d = Math.min(da, db); if (d > bd) continue;
      const px = da <= db ? s.ax : s.bx, py = da <= db ? s.ay : s.by;
      if (!inside(ex, ey, px, py)) continue;
      best = c; bd = d; rev = db < da;
    }
    if (best) {
      if (rev) best.pts.push(s.bx, s.by, s.ax, s.ay); else best.pts.push(s.ax, s.ay, s.bx, s.by);
      best.row = s.k; active.splice(active.indexOf(best), 1); next.push(best);
    } else {
      const c: Ch = { pts: (s.k & 1) ? [s.bx, s.by, s.ax, s.ay] : [s.ax, s.ay, s.bx, s.by], row: s.k };
      all.push(c); next.push(c);
    }
  }
  for (const c of all) lines.push({ pts: Float64Array.from(c.pts), closed: false });
  return lines;
}

// ------------------------------------------------------------------ gyroid
let gyroidC = 0;
function gyroidSegs(x0: number, y0: number, x1: number, y1: number, T: number, z: number, h: number): Float64Array[] {
  const w = 2 * Math.PI / T, gx0 = Math.floor(x0 / h) * h, gy0 = Math.floor(y0 / h) * h;
  const nx = Math.ceil((x1 - gx0) / h) + 1, ny = Math.ceil((y1 - gy0) / h) + 1; if (nx < 2 || ny < 2) return [];
  const sx = new Float64Array(nx), cx = new Float64Array(nx), sy = new Float64Array(ny), cy = new Float64Array(ny);
  for (let i = 0; i < nx; i++) { const a = (gx0 + i * h) * w; sx[i] = Math.sin(a); cx[i] = Math.cos(a); }
  for (let j = 0; j < ny; j++) { const a = (gy0 + j * h) * w; sy[j] = Math.sin(a); cy[j] = Math.cos(a); }
  const sz = Math.sin(z * w), cz = Math.cos(z * w);
  const f = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = sx[i] * cy[j] + sy[j] * cz + sz * cx[i];
  const pos = new Map<number, [number, number]>(), adj = new Map<number, number[]>();
  const ptOf = (i: number, j: number, vert: boolean): number => {
    const id = (j * nx + i) * 2 + (vert ? 1 : 0);
    if (!pos.has(id)) {
      const a = f[j * nx + i], b = vert ? f[(j + 1) * nx + i] : f[j * nx + i + 1], t = a / (a - b);
      pos.set(id, vert ? [gx0 + i * h, gy0 + (j + t) * h] : [gx0 + (i + t) * h, gy0 + j * h]);
    }
    return id;
  };
  const link = (a: number, b: number) => { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); };
  for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
    const v0 = f[j * nx + i], v1 = f[j * nx + i + 1], v2 = f[(j + 1) * nx + i + 1], v3 = f[(j + 1) * nx + i];
    const cs = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0);
    if (cs === 0 || cs === 15) continue;
    const e = [() => ptOf(i, j, false), () => ptOf(i + 1, j, true), () => ptOf(i, j + 1, false), () => ptOf(i, j, true)];
    const L = (a: number, b: number) => link(e[a](), e[b]());
    switch (cs) {
      case 1: case 14: L(3, 0); break; case 2: case 13: L(0, 1); break; case 3: case 12: L(3, 1); break;
      case 4: case 11: L(1, 2); break; case 6: case 9: L(0, 2); break; case 7: case 8: L(3, 2); break;
      case 5: if ((v0 + v1 + v2 + v3) > 0) { L(3, 2); L(0, 1); } else { L(3, 0); L(1, 2); } break;
      case 10: if ((v0 + v1 + v2 + v3) > 0) { L(3, 0); L(1, 2); } else { L(0, 1); L(2, 3); } break;
    }
  }
  const out: Float64Array[] = [];
  const walk = (start: number) => {
    const pts: number[] = []; let cur = start;
    for (;;) {
      const p = pos.get(cur)!; pts.push(p[0], p[1]);
      const nb = adj.get(cur); if (!nb || !nb.length) break;
      const nx_ = nb.pop()!; const back = adj.get(nx_)!; const bi = back.indexOf(cur); if (bi >= 0) back.splice(bi, 1);
      cur = nx_; if (cur === start) { const q = pos.get(cur)!; pts.push(q[0], q[1]); break; }
    }
    if (pts.length >= 4) out.push(Float64Array.from(pts));
  };
  for (const [id, nb] of adj) if (nb.length === 1) walk(id);
  for (const [id, nb] of adj) if (nb.length > 0) walk(id);
  return out;
}
function gyroidConst(): number {
  if (gyroidC) return gyroidC;
  let len = 0; const zs = 8;
  for (let s = 0; s < zs; s++) for (const p of gyroidSegs(0, 0, 2, 2, 1, s / zs, 1 / 16)) for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  // field covers slightly more than [0,2]^2 (grid rounding up); area of covered grid = (ceil(2*16)+... ) ≈ 4
  return (gyroidC = len / zs / 4);
}

// ------------------------------------------------------------------ misc generators
function hilbert(order: number): [number, number][] {
  const n = 1 << order, out: [number, number][] = [];
  for (let d = 0; d < n * n; d++) {
    let x = 0, y = 0, t = d;
    for (let s = 1; s < n; s <<= 1) {
      const rx = 1 & (t >> 1), ry = 1 & (t ^ rx);
      if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const q = x; x = y; y = q; }
      x += s * rx; y += s * ry; t >>= 2;
    }
    out.push([x, y]);
  }
  return out;
}
function honeycomb(bb: Bounds4, R: number, z3d: number | null): Float64Array[] {
  const hw = Math.sqrt(3) * R, out: Float64Array[] = [];
  const shift = z3d === null ? 0 : Math.sin(z3d * 2 * Math.PI / (R * 6)) * hw * 0.25;
  const j0 = Math.floor((bb[1] - R * 2) / (1.5 * R)), j1 = Math.ceil((bb[3] + R) / (1.5 * R));
  for (let j = j0; j <= j1; j++) {
    const cy = j * 1.5 * R, off = ((j % 2) + 2) % 2 * hw / 2 + shift;
    const m0 = Math.floor((bb[0] - off) / hw) - 1, m1 = Math.ceil((bb[2] - off) / hw) + 1;
    const zz: number[] = [];
    for (let m = m0; m <= m1; m++) {
      const xh = off + m * hw, xl = xh + hw / 2;
      zz.push(xh, cy + R, xl, cy + R / 2);
      out.push(Float64Array.of(xl, cy + R / 2, xl, cy - R / 2));
    }
    out.push(Float64Array.from(zz));
  }
  return out;
}

// ------------------------------------------------------------------ public
const frac = (v: number) => v - Math.floor(v);
export function fillPolys(polys: ExPoly[], o: FillOpts): FillLine[] {
  if (!polys.length) return [];
  const bb = polysBounds(polys); if (!bb) return [];
  const dens = Math.min(1, Math.max(0.005, o.density)), solid = dens >= 0.99;
  const pitch = o.pitch ?? (solid ? o.width : o.width / dens);
  const anchor = o.anchor ?? 0, idx = new PolyIndex(polys);
  let infl: PolyIndex | null = null;
  const inflated = () => infl ?? (infl = new PolyIndex(offsetPolys(polys, 0.06)));
  const alt = 90 * (o.layer & 1);
  const clip = (lines: Float64Array[]): FillLine[] => { const out: FillLine[] = []; for (const l of lines) for (const c of clipPolylineToIndex(idx, l)) out.push({ pts: c, closed: false }); return out; };
  let pat = o.pattern;
  if (pat === "adaptivecubic" || pat === "supportcubic") pat = "cubic";
  if (pat === "lightning") pat = "line";
  if (solid && (pat === "grid" || pat === "triangles" || pat === "tri-hexagon" || pat === "cubic" || pat === "crosshatch" || pat === "gyroid" || pat === "honeycomb" || pat === "3dhoneycomb" || pat === "line")) pat = "zig-zag";
  const conn = (p: number) => (anchor > 0 ? Math.min(2 * anchor, p * 1.2) : 0);
  switch (pat) {
    case "line": return rectilinear(polys, o.angle + alt, pitch, 0, conn(pitch), anchor > 0 ? inflated() : null);
    case "alignedrectilinear": return rectilinear(polys, o.angle, pitch, 0, solid ? pitch * 6 : conn(pitch), solid || anchor > 0 ? inflated() : null);
    case "monotonicline": return rectilinear(polys, o.angle + alt, pitch, 0, 0, null);
    case "zig-zag": case "monotonic": return rectilinear(polys, o.angle + alt, pitch, 0, solid ? pitch * 6 : pitch * 1.6, inflated());
    case "grid": { const p = pitch * 2; return [...rectilinear(polys, o.angle, p, 0, conn(p), anchor > 0 ? inflated() : null), ...rectilinear(polys, o.angle + 90, p, 0, conn(p), anchor > 0 ? inflated() : null)]; }
    case "crosshatch": return rectilinear(polys, o.angle + [0, 45, 90, 135][o.layer & 3], pitch, 0, conn(pitch), anchor > 0 ? inflated() : null);
    case "triangles": case "tri-hexagon": case "cubic": {
      const p = pitch * 3, out: FillLine[] = [];
      for (let i = 0; i < 3; i++) {
        const phase = pat === "triangles" ? 0 : pat === "tri-hexagon" ? i * p / 2.9 : frac(o.z / (p * 1.35) + i / 3) * p;
        out.push(...rectilinear(polys, o.angle + i * 60, p, phase, 0, null));
      }
      return out;
    }
    case "gyroid": {
      const T = gyroidConst() * o.width / dens, h = Math.max(T / 14, 0.18);
      const need = Math.ceil((bb[2] - bb[0]) / h) * Math.ceil((bb[3] - bb[1]) / h);
      const hh = need > 400000 ? h * Math.sqrt(need / 400000) : h;
      return clip(gyroidSegs(bb[0] - 1, bb[1] - 1, bb[2] + 1, bb[3] + 1, T, o.z, hh));
    }
    case "honeycomb": case "3dhoneycomb": return clip(honeycomb(bb, 2 * o.width / (Math.sqrt(3) * dens), pat === "3dhoneycomb" ? o.z : null));
    case "concentric": {
      const out: FillLine[] = []; let cur = offsetPolys(polys, -pitch / 2);
      for (let it = 0; it < 500 && cur.length; it++) {
        for (const p of cur) { out.push({ pts: p.outer, closed: true }); for (const h of p.holes) out.push({ pts: h, closed: true }); }
        cur = offsetPolys(cur, -pitch);
      }
      return out;
    }
    case "hilbertcurve": {
      const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2, size = Math.max(bb[2] - bb[0], bb[3] - bb[1], pitch);
      const order = Math.max(1, Math.min(9, Math.ceil(Math.log2(size / pitch)))), n = 1 << order, c = size / n;
      const pts = new Float64Array(n * n * 2), cells = hilbert(order);
      for (let i = 0; i < cells.length; i++) { pts[2 * i] = cx - size / 2 + (cells[i][0] + 0.5) * c; pts[2 * i + 1] = cy - size / 2 + (cells[i][1] + 0.5) * c; }
      return clip([pts]);
    }
    case "archimedeanchords": case "octagramspiral": {
      const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2, rmax = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2 + pitch;
      const pts: number[] = [];
      if (pat === "archimedeanchords") {
        for (let th = 0; ;) { const r = pitch * th / (2 * Math.PI); if (r > rmax) break; pts.push(cx + r * Math.cos(th), cy + r * Math.sin(th)); th += Math.min(0.5, 0.4 / Math.max(r, 0.4)); }
      } else {
        const k = Math.cos(Math.PI / 8);
        for (let s = 0; ; s++) { const th = s * Math.PI / 4, r = pitch * th / (2 * Math.PI) / k * (s % 2 ? 1 : 1.0); if (r > rmax) break; pts.push(cx + r * Math.cos(th), cy + r * Math.sin(th)); }
      }
      return clip([Float64Array.from(pts)]);
    }
    default: return rectilinear(polys, o.angle + alt, pitch, 0, 0, null);
  }
}

/** Greedy nearest-neighbour ordering (reverses open lines / rotates closed ones as needed). Returns lines + final position. */
export function orderLines(lines: FillLine[], sx: number, sy: number): { lines: FillLine[]; x: number; y: number } {
  if (lines.length > 3500) { const l = lines[lines.length - 1]; return { lines, x: l.pts[l.pts.length - 2], y: l.pts[l.pts.length - 1] }; }
  const left = lines.slice(), out: FillLine[] = []; let x = sx, y = sy;
  while (left.length) {
    let bi = 0, bd = Infinity, brev = false, bv = 0;
    for (let i = 0; i < left.length; i++) {
      const p = left[i].pts, n = p.length >> 1;
      if (left[i].closed) {
        for (let v = 0; v < n; v += Math.max(1, n >> 5)) { const d = (p[2 * v] - x) ** 2 + (p[2 * v + 1] - y) ** 2; if (d < bd) { bd = d; bi = i; bv = v; brev = false; } }
      } else {
        const d0 = (p[0] - x) ** 2 + (p[1] - y) ** 2, d1 = (p[2 * n - 2] - x) ** 2 + (p[2 * n - 1] - y) ** 2;
        if (d0 < bd) { bd = d0; bi = i; brev = false; } if (d1 < bd) { bd = d1; bi = i; brev = true; }
      }
    }
    let l = left.splice(bi, 1)[0];
    if (l.closed) { const n = l.pts.length >> 1, o = new Float64Array(l.pts.length); for (let i = 0; i < n; i++) { const s = (i + bv) % n; o[2 * i] = l.pts[2 * s]; o[2 * i + 1] = l.pts[2 * s + 1]; } l = { pts: o, closed: true }; }
    else if (brev) { const n = l.pts.length >> 1, o = new Float64Array(l.pts.length); for (let i = 0; i < n; i++) { o[2 * i] = l.pts[2 * (n - 1 - i)]; o[2 * i + 1] = l.pts[2 * (n - 1 - i) + 1]; } l = { pts: o, closed: false }; }
    out.push(l); x = l.pts[l.closed ? 0 : l.pts.length - 2]; y = l.pts[l.closed ? 1 : l.pts.length - 1];
  }
  return { lines: out, x, y };
}

/** Automatic bridge direction (degrees): the line direction whose longest free span is shortest. */
export function bridgeAngle(region: ExPoly[]): number {
  let best = 0, bm = Infinity;
  for (let a = 0; a < 180; a += 10) {
    let m = 0; for (const s of scanSpans(region, a, 1.0)) m = Math.max(m, Math.hypot(s.bx - s.ax, s.by - s.ay));
    if (m < bm - 1e-6) { bm = m; best = a; }
  }
  return best;
}
