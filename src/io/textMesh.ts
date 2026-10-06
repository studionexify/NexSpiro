// Text → solid mesh. The browser rasterises the glyphs (any installed font), the bitmap outline is traced into polygons, simplified,
// triangulated (holes handled) and extruded. Runs on the main thread (needs a canvas).
import { ShapeUtils, Vector2 } from "three";
import type { Mesh } from "../core/index.ts";

export type TextSpec = { text: string; sizeMm: number; heightMm: number; bold: boolean; family: string };
const PX_PER_MM = 14;

type Pt = [number, number];
function traceLoops(mask: Uint8Array, w: number, h: number): Pt[][] {
  const out = new Map<number, number[][]>(); // vertex key → outgoing edges [x1,y1]
  const key = (x: number, y: number) => y * (w + 2) + x;
  const add = (x0: number, y0: number, x1: number, y1: number) => { const k = key(x0, y0); (out.get(k) ?? out.set(k, []).get(k)!).push([x1, y1]); };
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // interior on the left while walking, y down: top edge goes right→left? choose: clockwise in image space == CCW after y flip
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on(x, y)) continue;
    if (!on(x, y - 1)) add(x, y, x + 1, y);         // top    →
    if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1); // right  ↓
    if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1); // bottom ←
    if (!on(x - 1, y)) add(x, y + 1, x, y);         // left   ↑
  }
  const loops: Pt[][] = [];
  for (const [k0, list] of out) {
    while (list.length) {
      const sx = k0 % (w + 2), sy = Math.floor(k0 / (w + 2)), loop: Pt[] = [[sx, sy]];
      let [cx, cy] = list.pop()!, px = sx, py = sy;
      for (let guard = 0; guard < 4_000_000; guard++) {
        loop.push([cx, cy]);
        if (cx === sx && cy === sy) break;
        const cand = out.get(key(cx, cy)); if (!cand?.length) break;
        let pick = 0;
        if (cand.length > 1) { // keep turning the same way at pinch points
          const dx = cx - px, dy = cy - py; let best = Infinity;
          cand.forEach((c, i) => { const ex = c[0] - cx, ey = c[1] - cy, cross = dx * ey - dy * ex; if (cross < best) { best = cross; pick = i; } });
        }
        const [nx, ny] = cand.splice(pick, 1)[0]; px = cx; py = cy; cx = nx; cy = ny;
      }
      loop.pop(); if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}
function simplify(loop: Pt[], eps: number): Pt[] {
  const n = loop.length; if (n < 8) return loop;
  const rdp = (a: number, b: number, pts: Pt[], keep: boolean[]) => {
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1; let m = -1, md = 0;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; m = i; } }
    if (md > eps && m > 0) { keep[m] = true; rdp(a, m, pts, keep); rdp(m, b, pts, keep); }
  };
  const half = n >> 1, pts = [...loop, loop[0]], keep = new Array(pts.length).fill(false); keep[0] = keep[half] = keep[n] = true;
  rdp(0, half, pts, keep); rdp(half, n, pts, keep);
  return pts.slice(0, n).filter((_, i) => keep[i]);
}
const area2 = (l: Pt[]) => { let a = 0; for (let i = 0; i < l.length; i++) { const j = (i + 1) % l.length; a += l[i][0] * l[j][1] - l[j][0] * l[i][1]; } return a; };
const inside = (p: Pt, poly: Pt[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c; };

/** Extrude closed polygons (outer CCW, holes CW; mm) into a watertight prism of the given height. */
export function extrudePolygons(shapes: { outer: Pt[]; holes: Pt[][] }[], height: number, name: string): Mesh {
  const t: number[] = [];
  for (const { outer, holes } of shapes) {
    const v2 = (l: Pt[]) => l.map((p) => new Vector2(p[0], p[1])), o2 = v2(outer), h2 = holes.map(v2), all = [...outer, ...holes.flat()];
    for (const [a, b, c] of ShapeUtils.triangulateShape(o2, h2)) {
      t.push(all[a][0], all[a][1], height, all[b][0], all[b][1], height, all[c][0], all[c][1], height);   // top, +Z
      t.push(all[a][0], all[a][1], 0, all[c][0], all[c][1], 0, all[b][0], all[b][1], 0);                  // bottom, -Z
    }
    for (const loop of [outer, ...holes]) for (let i = 0; i < loop.length; i++) {
      const p = loop[i], q = loop[(i + 1) % loop.length];
      t.push(p[0], p[1], 0, q[0], q[1], 0, q[0], q[1], height, p[0], p[1], 0, q[0], q[1], height, p[0], p[1], height);
    }
  }
  return { name, tris: new Float32Array(t) };
}

export function textMesh(spec: TextSpec): Mesh {
  const text = spec.text.trim(); if (!text) throw new Error("Enter some text");
  const fontPx = Math.max(8, Math.round(spec.sizeMm * PX_PER_MM)), font = `${spec.bold ? "700 " : ""}${fontPx}px ${spec.family}`;
  const cv = document.createElement("canvas"), g = cv.getContext("2d", { willReadFrequently: true })!;
  g.font = font; const lines = text.split(/\n/), widths = lines.map((l) => g.measureText(l).width), pad = 4, lh = Math.round(fontPx * 1.25);
  cv.width = Math.min(4096, Math.ceil(Math.max(...widths)) + pad * 2); cv.height = Math.min(4096, lh * lines.length + pad * 2);
  g.font = font; g.textBaseline = "alphabetic"; g.fillStyle = "#000";
  lines.forEach((l, i) => g.fillText(l, pad, pad + lh * i + fontPx * 0.95));
  const img = g.getImageData(0, 0, cv.width, cv.height), mask = new Uint8Array(cv.width * cv.height);
  for (let i = 0; i < mask.length; i++) mask[i] = img.data[i * 4 + 3] > 127 ? 1 : 0;
  const loops = traceLoops(mask, cv.width, cv.height).map((l) => simplify(l, 0.6));
  if (!loops.length) throw new Error("The text produced no outline (is the font available?)");
  // image y runs down; flip to y-up, convert to mm and centre
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const mm = loops.map((l) => l.map(([x, y]): Pt => { const X = x / PX_PER_MM, Y = -y / PX_PER_MM; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); return [X, Y]; }));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, L = mm.map((l) => l.map(([x, y]): Pt => [x - cx, y - cy]));
  const outers = L.filter((l) => area2(l) > 0), holes = L.filter((l) => area2(l) < 0);
  const shapes = outers.map((o) => ({ outer: o, holes: [] as Pt[][] }));
  for (const h of holes) { const host = shapes.filter((s) => inside(h[0], s.outer)).sort((a, b) => Math.abs(area2(a.outer)) - Math.abs(area2(b.outer)))[0]; host?.holes.push(h); }
  return extrudePolygons(shapes, spec.heightMm, `Text "${text.slice(0, 18)}"`);
}
