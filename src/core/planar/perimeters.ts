// Wall loops, gap fill, seams, overhang slow-down, fuzzy skin and the wall texture hook.
import { Feature, type ExPoly, type Path, type Ring, type TextureHook } from "./types.ts";
import { PolyIndex, diffPolys, offsetPolys, polysArea, polyArea, ringArea, ringLength, resampleRing, rotateRing, filterArea } from "./geom.ts";
import type { Cfg } from "./slicecfg.ts";
import { rng } from "./slicecfg.ts";

// ------------------------------------------------------------------ wall geometry
export type WallParams = { layerH: number; loops: number; wo: number; wi: number; precise: boolean };
export type WallGeom = {
  centers: ExPoly[][];          // centre-line polygons per wall level (0 = outer)
  widths: number[];             // extrusion width per level
  inner: ExPoly[];              // area inside the innermost wall (infill boundary)
  gaps: ExPoly[];               // wall-zone area no loop covers
};
/** Overlapped-rounded-rect spacing (Slic3r/Orca model). */
const spacing = (w: number, h: number) => Math.max(w * 0.6, w - h * (1 - Math.PI / 4));

/** Centre-line distance of wall level k from the outline. */
export function wallOffset(k: number, p: WallParams): number {
  if (k === 0) return p.wo / 2;
  const so = p.precise ? p.wo : spacing(p.wo, p.layerH), si = p.precise ? p.wi : spacing(p.wi, p.layerH);
  return p.wo / 2 + (so + si) / 2 + (k - 1) * si;
}
export const innerEdgeOffset = (p: WallParams) => { const k = Math.max(0, p.loops - 1); return wallOffset(k, p) + (k === 0 ? p.wo : p.wi) / 2; };

export function buildWallGeom(outline: ExPoly[], p: WallParams): WallGeom {
  const centers: ExPoly[][] = [], widths: number[] = [], gapParts: ExPoly[][] = [];
  let ended = false;
  for (let k = 0; k < p.loops; k++) {
    const w = k === 0 ? p.wo : p.wi, pos = wallOffset(k, p);
    const c = offsetPolys(outline, -pos);
    const U = k === 0 ? outline : offsetPolys(outline, -(pos - w / 2));
    if (!c.length) { if (U.length) gapParts.push(U); ended = true; break; }
    centers.push(c); widths.push(w);
    gapParts.push(diffPolys(U, offsetPolys(c, w / 2)));
  }
  void ended;
  const inner = offsetPolys(outline, -innerEdgeOffset(p));
  const gaps: ExPoly[] = [];
  for (const g of gapParts) for (const q of g) gaps.push(q);
  return { centers, widths, inner, gaps };
}

// ------------------------------------------------------------------ overhang data
export type OverhangData = { sets: PolyIndex[] };
const OVH_T = [0.1, 0.25, 0.5, 0.75];
/** Builds the 4 threshold regions; null when the layer needs no overhang handling. */
export function makeOverhang(lower: ExPoly[] | null, centerL0: ExPoly[], w: number): OverhangData | null {
  if (!lower) return null;
  const e0 = offsetPolys(lower, (OVH_T[0] - 0.5) * w);
  const d = diffPolys(centerL0, e0);
  if (polysArea(filterArea(d, 0.02)) < 0.02) return null;
  const sets = [new PolyIndex(e0)];
  for (let q = 1; q < OVH_T.length; q++) sets.push(new PolyIndex(offsetPolys(lower, (OVH_T[q] - 0.5) * w)));
  return { sets };
}
const category = (o: OverhangData, x: number, y: number) => { let c = 0; for (let q = 0; q < o.sets.length; q++) { if (o.sets[q].contains(x, y)) break; c = q + 1; } return c; };

// ------------------------------------------------------------------ seams
export type SeamState = { prev: number[]; cur: number[] };
export type WallCtx = {
  cfg: Cfg; obj: number; layerIndex: number; z: number; h: number;
  wo: number; wi: number; first: boolean;
  seams: SeamState; pos: { x: number; y: number };
  overhang: OverhangData | null; texture?: TextureHook; seedBase: number;
  speedOuter: number; speedInner: number;
};
export type WallRing = { ring: Ring; level: number; hole: boolean };

function pickSeam(r: Ring, ctx: WallCtx, rand: () => number): number {
  const n = r.length >> 1, mode = ctx.cfg.s("seam_position");
  if (n <= 3) return 0;
  const nearestTo = (x: number, y: number) => { let b = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = (r[2 * i] - x) ** 2 + (r[2 * i + 1] - y) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
  const backIdx = () => { let b = 0; for (let i = 1; i < n; i++) if (r[2 * i + 1] > r[2 * b + 1] + 1e-9 || (Math.abs(r[2 * i + 1] - r[2 * b + 1]) <= 1e-9 && r[2 * i] < r[2 * b])) b = i; return b; };
  if (mode === "nearest") return nearestTo(ctx.pos.x, ctx.pos.y);
  if (mode === "back") return backIdx();
  if (mode === "random") return Math.floor(rand() * n) % n;
  // aligned: sharpest convex corner, else keep the seam of the previous layer
  let bestTurn = 0.35; const turns = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    const ux = r[2 * i] - r[2 * a], uy = r[2 * i + 1] - r[2 * a + 1], vx = r[2 * b] - r[2 * i], vy = r[2 * b + 1] - r[2 * i + 1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy); if (lu < 1e-9 || lv < 1e-9) continue;
    const cr = (ux * vy - uy * vx) / (lu * lv), dt = (ux * vx + uy * vy) / (lu * lv);
    const ang = Math.atan2(cr, dt); // >0: left turn (convex for material on the left)
    turns[i] = ang; if (ang > bestTurn) bestTurn = ang;
  }
  let prevNear: [number, number] | null = null;
  { let bd = 64; for (let i = 0; i < ctx.seams.prev.length; i += 2) { const d = (ctx.seams.prev[i] - r[0]) ** 2 + (ctx.seams.prev[i + 1] - r[1]) ** 2; if (d < bd * 1e6) { /* placeholder */ } } }
  const near = (x: number, y: number) => { // previous-layer seam closest to (x,y) within 10 mm
    let bd = 100, res: [number, number] | null = null;
    for (let i = 0; i < ctx.seams.prev.length; i += 2) { const d = (ctx.seams.prev[i] - x) ** 2 + (ctx.seams.prev[i + 1] - y) ** 2; if (d < bd) { bd = d; res = [ctx.seams.prev[i], ctx.seams.prev[i + 1]]; } }
    return res;
  };
  void prevNear;
  if (bestTurn > 0.35) {
    // candidates: corners nearly as sharp as the sharpest; choose the one closest to the previous layer's seam, else the back-left-most
    const cand: number[] = []; for (let i = 0; i < n; i++) if (turns[i] >= bestTurn - 0.06) cand.push(i);
    let c = cand[0];
    let anyPrev = false;
    let bd = Infinity;
    for (const i of cand) { const p = near(r[2 * i], r[2 * i + 1]); if (p) { anyPrev = true; const d = (p[0] - r[2 * i]) ** 2 + (p[1] - r[2 * i + 1]) ** 2; if (d < bd) { bd = d; c = i; } } }
    if (!anyPrev) { for (const i of cand) if (r[2 * i + 1] > r[2 * c + 1] + 1e-9 || (Math.abs(r[2 * i + 1] - r[2 * c + 1]) <= 1e-9 && r[2 * i] < r[2 * c])) c = i; }
    return c;
  }
  // smooth ring: nearest vertex to the previous seam near this ring, else back
  const cx = r[0], cy = r[1]; const p = near(cx, cy);
  if (p) return nearestTo(p[0], p[1]);
  return backIdx();
}

/** Returns a ring that starts exactly `d` mm along the ring from vertex `idx` (negative = backwards). */
function shiftStart(r: Ring, idx: number, d: number): Ring {
  const n = r.length >> 1; const rot = rotateRing(r, idx); if (Math.abs(d) < 1e-6) return rot;
  const L = ringLength(rot); if (L < 1e-6) return rot;
  let dd = ((d % L) + L) % L; let i = 0;
  while (i < n) { const j = (i + 1) % n, l = Math.hypot(rot[2 * j] - rot[2 * i], rot[2 * j + 1] - rot[2 * i + 1]); if (dd <= l) break; dd -= l; i++; }
  if (i >= n) return rot;
  const j = (i + 1) % n, l = Math.hypot(rot[2 * j] - rot[2 * i], rot[2 * j + 1] - rot[2 * i + 1]) || 1, t = dd / l;
  const px = rot[2 * i] + (rot[2 * j] - rot[2 * i]) * t, py = rot[2 * i + 1] + (rot[2 * j + 1] - rot[2 * i + 1]) * t;
  const out: number[] = [px, py];
  for (let k = 1; k <= n - i; k++) { const s = (i + k) % n; out.push(rot[2 * s], rot[2 * s + 1]); }
  for (let k = 0; k <= i; k++) { out.push(rot[2 * k], rot[2 * k + 1]); }
  // dedupe: the sequence above walks i+1..n-1,0..i; drop duplicate of vertex i+1 wrap
  const res: number[] = [px, py];
  for (let k = 1; k <= n; k++) { const s = (i + k) % n; res.push(rot[2 * s], rot[2 * s + 1]); }
  void out;
  // res has the new point followed by all n vertices starting at i+1 ... i  (n points) => n+1 points; remove a vertex coincident with the new point
  const o: number[] = [];
  for (let k = 0; k * 2 < res.length; k++) { const x = res[2 * k], y = res[2 * k + 1]; if (k > 0 && Math.abs(x - px) < 1e-9 && Math.abs(y - py) < 1e-9) continue; o.push(x, y); }
  return Float64Array.from(o);
}

function fuzz(r: Ring, thickness: number, dist: number, rand: () => number): Ring {
  const pts = resampleRing(r, dist);
  // resampling keeps vertices; re-space uniformly by walking the ring at `dist` steps
  const L = ringLength(pts), n0 = pts.length >> 1; if (L < dist * 3) return pts;
  const k = Math.max(3, Math.round(L / dist)), step = L / k, out = new Float64Array(k * 2);
  let seg = 0, acc = 0;
  for (let i = 0; i < k; i++) {
    const target = i * step;
    while (seg < n0 && acc + Math.hypot(pts[2 * ((seg + 1) % n0)] - pts[2 * seg], pts[2 * ((seg + 1) % n0) + 1] - pts[2 * seg + 1]) < target) {
      acc += Math.hypot(pts[2 * ((seg + 1) % n0)] - pts[2 * seg], pts[2 * ((seg + 1) % n0) + 1] - pts[2 * seg + 1]); seg++;
    }
    const a = seg % n0, b = (seg + 1) % n0, l = Math.hypot(pts[2 * b] - pts[2 * a], pts[2 * b + 1] - pts[2 * a + 1]) || 1, t = (target - acc) / l;
    out[2 * i] = pts[2 * a] + (pts[2 * b] - pts[2 * a]) * t; out[2 * i + 1] = pts[2 * a + 1] + (pts[2 * b + 1] - pts[2 * a + 1]) * t;
  }
  const res = new Float64Array(k * 2);
  for (let i = 0; i < k; i++) {
    const a = (i + k - 1) % k, b = (i + 1) % k;
    let tx = out[2 * b] - out[2 * a], ty = out[2 * b + 1] - out[2 * a + 1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const d = (rand() - 0.5) * thickness; // right-hand normal of travel = outward for material on the left
    res[2 * i] = out[2 * i] + ty * d; res[2 * i + 1] = out[2 * i + 1] - tx * d;
  }
  return res;
}

// ------------------------------------------------------------------ wall paths
const f32 = (r: ArrayLike<number>, z: number, from = 0, to = r.length >> 1): Float32Array => {
  const o = new Float32Array((to - from) * 3);
  for (let i = from; i < to; i++) { o[(i - from) * 3] = r[2 * i]; o[(i - from) * 3 + 1] = r[2 * i + 1]; o[(i - from) * 3 + 2] = z; }
  return o;
};

/** Turns one wall ring into 1..n Paths (several when overhang runs split it). Updates ctx.pos / ctx.seams. */
export function wallRingPaths(wr: WallRing, ctx: WallCtx): Path[] {
  const { cfg } = ctx, level = wr.level;
  const rand = rng(ctx.seedBase * 7919 + level * 131 + (wr.ring.length >> 1));
  let ring = wr.ring;
  const si = pickSeam(ring, ctx, rand);
  if (level >= 1 && cfg.b("staggered_inner_seams")) ring = shiftStart(ring, si, -level * ctx.wi * 0.6);
  else ring = rotateRing(ring, si);
  ctx.seams.cur.push(ring[0], ring[1]);
  const feature = level === 0 ? Feature.OuterWall : Feature.InnerWall;
  const width = level === 0 ? ctx.wo : ctx.wi;
  let speed = ctx.first ? cfg.n("initial_layer_speed") : level === 0 ? ctx.speedOuter : ctx.speedInner;
  const thr = cfg.n("small_perimeter_threshold");
  if (thr > 0 && ringLength(ring) < thr) speed *= Math.max(0.1, cfg.n("small_perimeter_speed") / 100);
  if (!(speed > 0)) speed = 30;
  const base = { obj: ctx.obj, width, height: ctx.h, flow: 1, speed } as const;
  const endAt = (r: ArrayLike<number>, i: number) => { ctx.pos.x = r[2 * i]; ctx.pos.y = r[2 * i + 1]; };

  // texture hook (outer wall only)
  if (ctx.texture && level === 0 && !cfg.b("spiral_mode")) {
    const rs = resampleRing(ring, 0.5);
    const res = ctx.texture(rs, ctx.z, ctx.layerIndex, ctx.h, true);
    if (res && res.xyz.length >= 9) {
      const p: Path = { feature, ...base, xyz: res.xyz, closed: true };
      if (res.zone) p.zone = res.zone;
      if (res.flow) p.flowScale = res.flow;
      endAt(rs, 0); return [p];
    }
  }
  const fz = cfg.s("fuzzy_skin");
  if ((fz === "all" || (fz === "external" && level === 0)) && cfg.n("fuzzy_skin_thickness") > 0) {
    ring = fuzz(ring, cfg.n("fuzzy_skin_thickness"), Math.max(0.1, cfg.n("fuzzy_skin_point_distance")), rand);
  }
  // overhang
  const ov = ctx.overhang && cfg.b("detect_overhang_wall") ? ctx.overhang : null;
  if (ov) {
    if (fz === "none") ring = resampleRing(ring, 0.8);
    const n = ring.length >> 1, cat = new Uint8Array(n); let any = false, all = true;
    for (let i = 0; i < n; i++) { cat[i] = category(ov, ring[2 * i], ring[2 * i + 1]); if (cat[i]) any = true; else all = false; }
    if (any) {
      const slow = cfg.s("enable_overhang_speed") === "true" || cfg.b("enable_overhang_speed");
      const sp = [0, cfg.n("overhang_1_4_speed"), cfg.n("overhang_2_4_speed"), cfg.n("overhang_3_4_speed"), cfg.n("overhang_4_4_speed")];
      const scale = (c: number) => (slow && c > 0 && sp[c] > 0 ? Math.min(1, sp[c] / speed) : 1);
      const mk = (a: number, b: number, ov_: boolean, closed: boolean): Path => {
        // points a..b inclusive (wrapping); closed => all n points
        const cnt = closed ? n : b - a + 1, pts = new Float64Array(cnt * 2), sc = new Float32Array(cnt);
        for (let k = 0; k < cnt; k++) { const s = (a + k) % n; pts[2 * k] = ring[2 * s]; pts[2 * k + 1] = ring[2 * s + 1]; sc[k] = scale(cat[s]); }
        const p: Path = { feature: ov_ ? Feature.OverhangWall : feature, ...base, xyz: f32(pts, ctx.z), closed };
        if (ov_) p.speedScale = sc;
        return p;
      };
      if (all) { const p = mk(0, n - 1, true, true); endAt(ring, 0); return [p]; }
      const segCat = (i: number) => Math.max(cat[i], cat[(i + 1) % n]) > 0;
      const out: Path[] = []; let a = 0;
      for (let i = 1; i <= n; i++) {
        if (i === n || segCat(i) !== segCat(a)) {
          out.push(mk(a, i, segCat(a), false)); // segments a..i-1 → points a..i (i wraps to 0)
          a = i;
        }
      }
      endAt(ring, 0); return out;
    }
  }
  const n = ring.length >> 1;
  if (cfg.b("wipe_on_loops") && n >= 3) {
    const pts = new Float64Array((n + 2) * 2); pts.set(ring); pts[2 * n] = ring[0]; pts[2 * n + 1] = ring[1];
    const dx = ring[2] - ring[0], dy = ring[3] - ring[1], l = Math.hypot(dx, dy) || 1, wl = Math.min(l, width * 1.2);
    const nx = -dy / l, ny = dx / l; // left normal = into the material
    const ux = (dx / l + nx) * 0.7071, uy = (dy / l + ny) * 0.7071;
    pts[2 * n + 2] = ring[0] + ux * wl; pts[2 * n + 3] = ring[1] + uy * wl;
    endAt(pts, n + 1);
    return [{ feature, ...base, xyz: f32(pts, ctx.z), closed: false }];
  }
  endAt(ring, 0);
  return [{ feature, ...base, xyz: f32(ring, ctx.z), closed: true }];
}

// ------------------------------------------------------------------ gap fill
export type GapOpts = { wi: number; h: number; speed: number; detectThin: boolean; filterTiny: boolean; obj: number };
export function gapFillPaths(gaps: ExPoly[], z: number, o: GapOpts): Path[] {
  const out: Path[] = [];
  const tMin = (o.detectThin ? 0.12 : 0.22) * o.wi, lenMin = o.filterTiny ? 3 : o.detectThin ? 0.8 : 1.5;
  for (const g of gaps) {
    const a = polyArea(g); if (a < 0.02) continue;
    const per = ringLength(g.outer) + g.holes.reduce((s, h) => s + ringLength(h), 0);
    const t = (2 * a) / per; if (t < tMin || t > o.wi * 2.2) continue;
    const line = medialLine(g, t); if (!line) continue;
    if (ringLength(line, false) < lenMin) continue;
    out.push({ feature: Feature.GapFill, obj: o.obj, xyz: f32(line, z), closed: false, width: Math.min(o.wi, Math.max(0.4 * o.wi, t)), height: o.h, flow: 1, speed: o.speed });
  }
  return out;
}
function medialLine(p: ExPoly, t: number): Float64Array | null {
  const r = p.outer, n = r.length >> 1; if (n < 3) return null;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += r[2 * i]; my += r[2 * i + 1]; } mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < n; i++) { const x = r[2 * i] - mx, y = r[2 * i + 1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(th), dy = Math.sin(th);
  const proj = (rr: ArrayLike<number>, i: number) => (rr[2 * i] - mx) * dx + (rr[2 * i + 1] - my) * dy;
  const sh = offsetPolys([{ outer: r, holes: p.holes }], -t * 0.42);
  if (sh.length) {
    let best = sh[0]; for (const s of sh) if (polyArea(s) > polyArea(best)) best = s;
    const q = best.outer, m = q.length >> 1; let imin = 0, imax = 0, pmin = Infinity, pmax = -Infinity;
    for (let i = 0; i < m; i++) { const v = proj(q, i); if (v < pmin) { pmin = v; imin = i; } if (v > pmax) { pmax = v; imax = i; } }
    const o: number[] = []; let i = imin; for (let k = 0; k <= m; k++) { o.push(q[2 * i], q[2 * i + 1]); if (i === imax) break; i = (i + 1) % m; }
    if (o.length >= 4) return Float64Array.from(o);
  }
  let pmin = Infinity, pmax = -Infinity; for (let i = 0; i < n; i++) { const v = proj(r, i); if (v < pmin) pmin = v; if (v > pmax) pmax = v; }
  return Float64Array.of(mx + dx * pmin, my + dy * pmin, mx + dx * pmax, my + dy * pmax);
}
export { ringArea };
