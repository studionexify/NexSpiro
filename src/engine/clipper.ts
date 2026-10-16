// Thin typed wrapper around clipper-lib (Angus Johnson's Clipper, JS port).
// Coordinates are scaled to integers: 1 unit = 1/SCALE mm (0.1 µm).
import ClipperLib from 'clipper-lib';
import type { ExPolygon, IntPoint, Path, Paths } from './types';

const C: any = (ClipperLib as any).default ?? ClipperLib;

export const SCALE = 10000;

export const toInt = (v: number) => Math.round(v * SCALE);
export const toMm = (v: number) => v / SCALE;

const CT = C.ClipType;
const PT = C.PolyType;
const PFT = C.PolyFillType;
const JT = C.JoinType;
const ET = C.EndType;

function exec(type: number, subj: Paths, clip: Paths, fill = PFT.pftNonZero): Paths {
  const c = new C.Clipper();
  c.AddPaths(subj, PT.ptSubject, true);
  if (clip.length) c.AddPaths(clip, PT.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, fill, fill);
  return out;
}

export const union = (a: Paths, b: Paths = [], fill = PFT.pftNonZero) => exec(CT.ctUnion, a, b, fill);
export const intersection = (a: Paths, b: Paths) => (a.length && b.length ? exec(CT.ctIntersection, a, b) : []);
export const difference = (a: Paths, b: Paths) => (!a.length ? [] : !b.length ? a : exec(CT.ctDifference, a, b));
export const unionEvenOdd = (a: Paths) => exec(CT.ctUnion, a, [], PFT.pftEvenOdd);

/** Offset closed polygons by delta (mm). Negative shrinks. */
export function offset(paths: Paths, deltaMm: number, join: 'miter' | 'round' = 'miter'): Paths {
  if (!paths.length) return [];
  if (deltaMm === 0) return paths;
  const co = new C.ClipperOffset(2, SCALE * 0.0025);
  co.AddPaths(paths, join === 'round' ? JT.jtRound : JT.jtMiter, ET.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, toInt(deltaMm));
  return out;
}

/** Morphological opening: removes features thinner than 2*r. */
export const opening = (paths: Paths, r: number) => offset(offset(paths, -r), r);

/** Clip open polylines against closed region. Returns open paths. */
export function clipLines(lines: Paths, region: Paths): Paths {
  if (!lines.length || !region.length) return [];
  const c = new C.Clipper();
  c.AddPaths(lines, PT.ptSubject, false);
  c.AddPaths(region, PT.ptClip, true);
  const tree = new C.PolyTree();
  c.Execute(CT.ctIntersection, tree, PFT.pftNonZero, PFT.pftNonZero);
  return C.Clipper.OpenPathsFromPolyTree(tree);
}

export const area = (p: Path) => C.Clipper.Area(p) / (SCALE * SCALE);
export const areaTotal = (ps: Paths) => ps.reduce((s, p) => s + area(p), 0);
export const orientation = (p: Path): boolean => C.Clipper.Orientation(p);

export function cleanPaths(paths: Paths, distMm = 0.005): Paths {
  return C.Clipper.CleanPolygons(paths, distMm * SCALE).filter((p: Path) => p.length >= 3);
}

/** Group a set of paths into ExPolygons (outer + holes). */
export function toExPolygons(paths: Paths): ExPolygon[] {
  if (!paths.length) return [];
  const c = new C.Clipper();
  c.AddPaths(paths, PT.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(CT.ctUnion, tree, PFT.pftNonZero, PFT.pftNonZero);
  const out: ExPolygon[] = [];
  const walk = (node: any) => {
    for (const child of node.Childs()) {
      // child is an outer; its children are holes; holes' children are outers again.
      const ex: ExPolygon = { contour: child.Contour(), holes: [] };
      for (const hole of child.Childs()) {
        ex.holes.push(hole.Contour());
        walk(hole);
      }
      out.push(ex);
    }
  };
  walk(tree);
  return out;
}

export const exToPaths = (ex: ExPolygon): Paths => [ex.contour, ...ex.holes];
export const exsToPaths = (exs: ExPolygon[]): Paths => exs.flatMap(exToPaths);

export function bounds(paths: Paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const q of p) {
    if (q.X < minX) minX = q.X; if (q.X > maxX) maxX = q.X;
    if (q.Y < minY) minY = q.Y; if (q.Y > maxY) maxY = q.Y;
  }
  return { minX, minY, maxX, maxY };
}

export const pt = (x: number, y: number): IntPoint => ({ X: toInt(x), Y: toInt(y) });
