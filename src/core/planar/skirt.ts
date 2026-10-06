// Skirt and brim loops (first-layer footprint helpers).
import type { ExPoly, Ring } from "./types.ts";
import { convexHull, diffPolys, dropHoles, holesAsPolys, offsetPolys, polysArea, unionAll, circleRing, ringArea } from "./geom.ts";
import type { Cfg } from "./slicecfg.ts";

/** Concentric loops filling `region`, starting half a line inside its boundary. */
export function concentricRings(region: ExPoly[], w: number, count: number): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i < count; i++) {
    const c = offsetPolys(region, -(w / 2 + i * w)); if (!c.length) break;
    for (const p of c) { out.push(p.outer); for (const h of p.holes) out.push(h); }
  }
  return out;
}

/** Skirt loops around the convex hull of `footprint`, `dist` mm away (outermost last). */
export function skirtRings(footprint: ExPoly[], loops: number, dist: number, w: number): Ring[] {
  const pts: number[] = []; for (const p of footprint) for (let i = 0; i < p.outer.length; i++) pts.push(p.outer[i]);
  if (pts.length < 6 || loops <= 0) return [];
  const hull = convexHull(pts); if (hull.length < 6) return [];
  const out: Ring[] = [];
  for (let i = 0; i < loops; i++) {
    const r = offsetPolys([{ outer: hull, holes: [] }], dist + w / 2 + i * w);
    if (r.length) out.push(r[0].outer);
  }
  return out;
}

export type BrimResult = { rings: Ring[]; area: ExPoly[] };
/**
 * Brim loops for one object's first-layer outline. `others` are the other objects' outlines the brim must not touch.
 */
export function makeBrim(sil: ExPoly[], others: ExPoly[], cfg: Cfg, objHeight: number, w: number): BrimResult {
  let type = cfg.s("brim_type"); const W = cfg.n("brim_width"), gap = cfg.n("brim_object_gap");
  if (type === "auto_brim") {
    const a = polysArea(sil);
    type = a < 3 * objHeight && a > 0 ? "outer_only" : "no_brim";
  }
  if (type === "no_brim" || W <= 0 || !sil.length) return { rings: [], area: [] };
  const n = Math.max(1, Math.round(W / w));
  const rings: Ring[] = []; let area: ExPoly[] = [];
  const keepOut = others.length ? offsetPolys(others, gap + 0.01) : [];
  if (type === "outer_only" || type === "outer_and_inner") {
    const solid = dropHoles(unionAll([sil]));
    let reg = diffPolys(offsetPolys(solid, gap + n * w), offsetPolys(solid, gap));
    if (keepOut.length) reg = diffPolys(reg, keepOut);
    reg = dropHolesOfOuterOnly(reg, solid);
    rings.push(...concentricRings(reg, w, n)); area.push(...reg);
  }
  if (type === "inner_only" || type === "outer_and_inner") {
    const holes = holesAsPolys(sil);
    if (holes.length) {
      const reg = diffPolys(holes, offsetPolys(holes, -(gap + n * w)));
      const inner = diffPolys(reg, offsetPolys(holes, -gap));
      void inner;
      for (let i = 0; i < n; i++) { const c = offsetPolys(holes, -(gap + w / 2 + i * w)); for (const p of c) { rings.push(p.outer); for (const h of p.holes) rings.push(h); } }
      area.push(...reg);
    }
  }
  if (type === "brim_ears") {
    const maxA = cfg.n("brim_ears_max_angle") * Math.PI / 180, discs: ExPoly[] = [];
    for (const p of sil) {
      const r = p.outer, m = r.length >> 1; if (m < 3) continue;
      for (let i = 0; i < m; i++) {
        const a = (i + m - 1) % m, b = (i + 1) % m;
        const ux = r[2 * a] - r[2 * i], uy = r[2 * a + 1] - r[2 * i + 1], vx = r[2 * b] - r[2 * i], vy = r[2 * b + 1] - r[2 * i + 1];
        const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy); if (lu < 0.5 || lv < 0.5) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
        const cross = ux * vy - uy * vx; // CCW outer: convex corner has cross < 0 here
        if (ang < maxA && (ringArea(r) > 0 ? cross < 0 : cross > 0)) discs.push({ outer: circleRing(r[2 * i], r[2 * i + 1], W, 28), holes: [] });
      }
    }
    if (discs.length) {
      let reg = diffPolys(unionAll([discs]), offsetPolys(sil, gap)); if (keepOut.length) reg = diffPolys(reg, keepOut);
      rings.push(...concentricRings(reg, w, n)); area = reg;
    }
  }
  return { rings, area };
}
function dropHolesOfOuterOnly(reg: ExPoly[], solid: ExPoly[]): ExPoly[] { void solid; return reg; }
