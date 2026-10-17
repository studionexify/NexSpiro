// Stage 4: perimeters of one island. Classic offset loops or Arachne-style variable-width beads, plus the extras
// Bambu Studio adds around them: one wall on top surfaces, detect thin wall and gap fill.
import { clipLines, difference, exToPaths, intersection, offset, opening, orientation, SCALE, union } from './clipper';
import { medialAxis, splitNarrow, type VarPath } from './arachne';
import type { ExPolygon, FeatureType, Path, Paths } from './types';

export interface WallItem {
  pts: number[];
  closed: boolean;
  feature: FeatureType;
  width: number;
  /** Wall index from the outside (0 = outer wall). */
  ring: number;
  /** Loop of a hole (clockwise) rather than of an outer contour. */
  hole: boolean;
  widths?: number[];
}

export interface WallParams {
  walls: number;
  wo: number; wi: number; so: number; si: number;
  nozzle: number;
  arachne: boolean;
  /** Arachne: narrowest bead, narrowest feature printed, two-bead margin (mm). */
  minBead: number; minFeature: number; margin: number;
  thinWalls: boolean;
  gapFill: boolean;
  /** Part of the island that is a top surface and should keep only its outer wall (null = none). */
  topOneWall: Paths | null;
}

export interface IslandWalls {
  /** Loops by depth (0 = outer). Inner walls cut by "one wall on top" become open paths. */
  loops: WallItem[][];
  /** Area left for infill and skins. */
  inner: Paths;
  /** Single variable-width beads (Arachne thin parts, detected thin walls). */
  thin: WallItem[];
  /** Gap fill between walls. */
  gaps: WallItem[];
}

const toPts = (p: Path) => { const out: number[] = []; for (const q of p) out.push(q.X / SCALE, q.Y / SCALE); return out; };
const varItem = (v: VarPath, feature: FeatureType, ring: number): WallItem => ({
  pts: v.pts, closed: false, feature, ring, hole: false, widths: v.widths,
  width: v.widths.reduce((a, b) => a + b, 0) / Math.max(1, v.widths.length),
});

export function islandWalls(ex: ExPolygon, p: WallParams): IslandWalls {
  const ip = exToPaths(ex);
  const loops: WallItem[][] = [];
  const thin: WallItem[] = [];
  const gaps: WallItem[] = [];
  if (p.walls <= 0) return { loops, inner: ip, thin, gaps };

  if (p.arachne) {
    // variable-width walls: narrow areas get one bead whose width follows the region
    let A = ip;
    for (let k = 0; k < p.walls && A.length; k++) {
      const w = k === 0 ? p.wo : p.wi, sp = k === 0 ? p.so : p.si;
      const feature: FeatureType = k === 0 ? 'outer_wall' : 'inner_wall';
      const sn = splitNarrow(A, w, p.minBead, Math.min(2 * w, p.nozzle * 2), { margin: p.margin, dropW: p.minFeature });
      for (const t of sn.thin) thin.push(varItem(t, feature, k));
      const ps = sn.wide.length ? offset(sn.wide, -w / 2).filter((q) => q.length >= 3) : [];
      if (ps.length) loops.push(ps.map((q) => ({ pts: toPts(q), closed: true, feature, width: w, ring: k, hole: !orientation(q) })));
      A = sn.wide.length ? offset(sn.wide, -sp) : [];
    }
    return { loops: cutInnerWallsOnTop(loops, ip, p), inner: topInner(A, ip, p), thin, gaps };
  }

  // classic: constant-width offset loops
  const polys: Paths[] = [];
  let boundary = 0;
  for (let k = 0; k < p.walls; k++) {
    const d = k === 0 ? p.wo / 2 : p.wo / 2 + (p.so + p.si) / 2 + (k - 1) * p.si;
    const ps = offset(ip, -d).filter((q) => q.length >= 3);
    if (!ps.length) break;
    const w = k === 0 ? p.wo : p.wi;
    polys.push(ps);
    loops.push(ps.map((q) => ({ pts: toPts(q), closed: true, feature: (k === 0 ? 'outer_wall' : 'inner_wall') as FeatureType, width: w, ring: k, hole: !orientation(q) })));
    boundary = d + (k === 0 ? p.so : p.si) / 2;
  }
  let inner = loops.length === p.walls ? offset(ip, -boundary) : [];

  if (p.thinWalls) {
    // parts of the island the outer loop cannot reach: print them as single beads
    const reach = polys.length ? offset(polys[0], p.wo / 2 + 0.01) : [];
    const narrow = opening(difference(ip, reach), p.nozzle * 0.15);
    if (narrow.length) for (const v of medialAxis(narrow, p.nozzle * 0.5, p.wo * 1.6)) {
      if (lenOf(v.pts) >= p.wo) thin.push({ ...varItem(v, 'outer_wall', 0), widths: v.widths.map((x) => Math.min(p.wo * 1.6, Math.max(p.nozzle * 0.6, x))) });
    }
  }
  if (p.gapFill && polys.length) {
    // gap fill: what neither a wall bead nor the infill area covers
    const rings: Paths = [];
    polys.forEach((ps, k) => {
      const w = k === 0 ? p.wo : p.wi;
      rings.push(...difference(offset(ps, w / 2), offset(ps, -w / 2)));
    });
    const covered = union([...rings, ...inner, ...thinCover(thin)]);
    const g = opening(difference(ip, covered), p.wo * 0.1);
    if (g.length) for (const v of medialAxis(g, p.nozzle * 0.25, p.wo * 2)) {
      if (lenOf(v.pts) >= p.wo) gaps.push({ ...varItem(v, 'gap_infill', p.walls), widths: v.widths.map((x) => Math.min(p.wo * 2, Math.max(p.nozzle * 0.25, x))) });
    }
  }
  return { loops: cutInnerWallsOnTop(loops, ip, p), inner: topInner(inner, ip, p), thin, gaps };
}

function lenOf(pts: number[]) {
  let s = 0;
  for (let k = 2; k < pts.length; k += 2) s += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
  return s;
}
/** Area covered by variable-width beads (approximated by their mean width). */
function thinCover(items: WallItem[]): Paths {
  const out: Paths = [];
  for (const t of items) {
    const path: Path = [];
    for (let k = 0; k < t.pts.length; k += 2) path.push({ X: Math.round(t.pts[k] * SCALE), Y: Math.round(t.pts[k + 1] * SCALE) });
    out.push(...strokeOpen(path, t.width / 2));
  }
  return out;
}
/** Offset an open polyline into a polygon (round ends). */
function strokeOpen(path: Path, r: number): Paths {
  // approximate with a chain of small square segments, enough for coverage tests
  const out: Paths = [];
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k];
    const dx = b.X - a.X, dy = b.Y - a.Y, L = Math.hypot(dx, dy);
    if (L < 1) continue;
    const nx = (-dy / L) * r * SCALE, ny = (dx / L) * r * SCALE;
    out.push([
      { X: Math.round(a.X + nx), Y: Math.round(a.Y + ny) }, { X: Math.round(b.X + nx), Y: Math.round(b.Y + ny) },
      { X: Math.round(b.X - nx), Y: Math.round(b.Y - ny) }, { X: Math.round(a.X - nx), Y: Math.round(a.Y - ny) },
    ]);
  }
  return out.length ? union(out) : [];
}

/** One wall on top surfaces: inner walls stop where the island is a top surface. */
function cutInnerWallsOnTop(loops: WallItem[][], ip: Paths, p: WallParams): WallItem[][] {
  if (!p.topOneWall?.length || loops.length < 2) return loops;
  const keep = difference(ip, p.topOneWall);
  return loops.map((ring, k) => {
    if (k === 0) return ring;
    const out: WallItem[] = [];
    for (const l of ring) {
      const path: Path = [];
      for (let i = 0; i < l.pts.length; i += 2) path.push({ X: Math.round(l.pts[i] * SCALE), Y: Math.round(l.pts[i + 1] * SCALE) });
      path.push(path[0]);
      const pieces = keep.length ? clipLines([path], keep) : [];
      if (pieces.length === 1 && pieces[0].length >= path.length - 1) { out.push(l); continue; }
      for (const pc of pieces) if (pc.length >= 2) out.push({ ...l, pts: toPts(pc), closed: false });
    }
    return out;
  });
}
/** With one wall on top, the infill area reaches the outer wall under the top surface (filled as top skin). */
function topInner(inner: Paths, ip: Paths, p: WallParams): Paths {
  if (!p.topOneWall?.length || p.walls < 2) return inner;
  const insideOuter = offset(ip, -(p.wo / 2 + p.so / 2));
  const freed = intersection(insideOuter, p.topOneWall);
  return freed.length ? union(inner, freed) : inner;
}
