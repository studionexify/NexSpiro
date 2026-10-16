// Minimal planar wall slicer: one closed perimeter loop per wall per layer, inset by line width.
// Infill and shells are out of scope for this build; the walls are what Motionex modifies.
import { emptyCheck, type Layer, type SlicedPlate, type Toolpath, type ToolpathPoint } from "./types.ts";
import type { PrintProfiles } from "./profiles.ts";
import { contourAt, objectHeight, type SceneObject } from "./primitives.ts";

/** Offset a closed CCW polygon inward by d (miter at corners). */
export function insetPolygon(poly: [number, number][], d: number): [number, number][] {
  const n = poly.length, out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const n1 = leftNormal(p0, p1), n2 = leftNormal(p1, p2);
    let bx = n1[0] + n2[0], by = n1[1] + n2[1];
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    const cosHalf = bx * n1[0] + by * n1[1];
    const m = d / Math.max(cosHalf, 0.2);
    out.push([p1[0] + bx * m, p1[1] + by * m]);
  }
  return out;
}

function leftNormal(a: [number, number], b: [number, number]): [number, number] {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
}

export function sliceObjects(objects: SceneObject[], p: PrintProfiles): SlicedPlate {
  const { process } = p;
  const maxH = Math.max(0, ...objects.map(objectHeight));
  const layers: Layer[] = [];
  let z = process.firstLayerHeight, index = 0;
  while (z <= maxH + 1e-6) {
    const height = index === 0 ? process.firstLayerHeight : process.layerHeight;
    const speed = index === 0 ? process.firstLayerSpeed : process.wallSpeed;
    const paths: Toolpath[] = [];
    for (const o of objects) {
      if (z > objectHeight(o) + 1e-6) continue;
      const contour = contourAt(o, z - height / 2);
      // Wall slope from the contour a little below and above (same point count and order).
      const dz = 0.5, below = contourAt(o, Math.max(0, z - height / 2 - dz)), above = contourAt(o, Math.min(objectHeight(o), z - height / 2 + dz));
      const slopes = contour.map((_, i) => {
        const r0 = Math.hypot(below[i][0] - o.x, below[i][1] - o.y), r1 = Math.hypot(above[i][0] - o.x, above[i][1] - o.y);
        const span = Math.max(1e-6, Math.min(objectHeight(o), z - height / 2 + dz) - Math.max(0, z - height / 2 - dz));
        return round((Math.atan2(r1 - r0, span) * 180) / Math.PI, 2);
      });
      // Walls print inside-out so the outer wall lands on a supported inner wall.
      for (let w = process.walls - 1; w >= 0; w--) {
        const ring = insetPolygon(contour, process.lineWidth * (w + 0.5));
        const points: ToolpathPoint[] = ring.map(([x, y], i) => ({ x, y, z: round(z), f: speed, flow: 1, e: 0, slope: slopes[i] }));
        points.push({ ...points[0] });
        paths.push({ feature: w === 0 ? "outer_wall" : "inner_wall", closed: true, points });
      }
    }
    layers.push({ index, z: round(z), height, paths });
    index++; z += process.layerHeight;
  }
  return { layers, warnings: [], check: emptyCheck() };
}

export const round = (v: number, d = 5) => Math.round(v * 10 ** d) / 10 ** d;
