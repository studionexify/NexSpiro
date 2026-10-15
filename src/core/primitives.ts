// Parametric primitives. Each one reports its outer contour (a closed polygon) at any height,
// which is all the wall slicer needs.

export type PrimitiveKind = "cube" | "cylinder" | "vase";

export interface SceneObject {
  id: string; name: string; kind: PrimitiveKind;
  x: number; y: number; rotation: number;  // mm, mm, degrees about Z
  size: { x: number; y: number; z: number };
}

export function objectHeight(o: SceneObject): number { return o.size.z; }

/** Outer contour at height z (0 ≤ z ≤ height), counter-clockwise, in plate coordinates. */
export function contourAt(o: SceneObject, z: number, segments = 128): [number, number][] {
  const rot = (o.rotation * Math.PI) / 180, c = Math.cos(rot), s = Math.sin(rot);
  const place = (px: number, py: number): [number, number] => [o.x + px * c - py * s, o.y + px * s + py * c];
  if (o.kind === "cube") {
    const hx = o.size.x / 2, hy = o.size.y / 2;
    return [place(-hx, -hy), place(hx, -hy), place(hx, hy), place(-hx, hy)];
  }
  let rx = o.size.x / 2, ry = o.size.y / 2;
  if (o.kind === "vase") {
    // Bulb profile: narrow foot, belly at 40% height, flared rim.
    const t = Math.min(1, Math.max(0, z / o.size.z));
    const k = 0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, t / 0.8)) - 0.12 * t + 0.2 * Math.max(0, t - 0.8) / 0.2;
    rx *= k; ry *= k;
  }
  const pts: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(place(rx * Math.cos(a), ry * Math.sin(a)));
  }
  return pts;
}

let counter = 0;
export function makeObject(kind: PrimitiveKind, x = 0, y = 0): SceneObject {
  counter++;
  const size = kind === "cube" ? { x: 20, y: 20, z: 20 } : kind === "cylinder" ? { x: 40, y: 40, z: 50 } : { x: 70, y: 70, z: 110 };
  const label = kind[0].toUpperCase() + kind.slice(1);
  return { id: `${kind}-${counter}`, name: `${label} ${counter}`, kind, x, y, rotation: 0, size };
}
