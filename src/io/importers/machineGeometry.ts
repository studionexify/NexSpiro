import { XMLParser } from "fast-xml-parser";
import type { Mesh } from "../../core/mesh.ts";

export type ToolheadEnvelope = {
  clearanceRadius: number;   // max XY distance from the nozzle axis of geometry below gantryZ
  clearanceHeight: number;   // gantryZ (or mesh height when not given)
  profile: { z: number; r: number }[]; // radius envelope per 2 mm band, for display / diagnostics
};

/**
 * Toolhead collision mesh → clearance envelope. The nozzle tip is the lowest vertex; the axis passes through it.
 * `gantryZ` (mm above the tip) separates the hotend/carriage from the gantry; geometry above it is ignored for
 * the radius (the gantry itself is covered by clearanceHeight in sequential printing).
 */
export function toolheadEnvelope(mesh: Mesh, gantryZ?: number): ToolheadEnvelope {
  const t = mesh.tris;
  if (!t.length) throw new Error("Toolhead mesh is empty");
  // nozzle tip = centroid of the lowest vertices (the orifice ring / flat), which defines the nozzle axis
  let tz = Infinity; for (let i = 2; i < t.length; i += 3) tz = Math.min(tz, t[i]);
  let tx = 0, ty = 0, nTip = 0;
  for (let i = 0; i < t.length; i += 3) if (t[i + 2] - tz < 1e-3) { tx += t[i]; ty += t[i + 1]; nTip++; }
  tx /= nTip; ty /= nTip;
  let top = 0; for (let i = 2; i < t.length; i += 3) top = Math.max(top, t[i] - tz);
  const limit = gantryZ ?? top;
  const bands = new Map<number, number>();
  let r = 0;
  for (let i = 0; i < t.length; i += 3) {
    const z = t[i + 2] - tz;
    if (z > limit + 1e-6) continue;
    const d = Math.hypot(t[i] - tx, t[i + 1] - ty);
    r = Math.max(r, d);
    const b = Math.floor(z / 2) * 2;
    bands.set(b, Math.max(bands.get(b) ?? 0, d));
  }
  return {
    clearanceRadius: Math.round(r * 10) / 10, clearanceHeight: Math.round(limit * 10) / 10,
    profile: [...bands].sort((a, b) => a[0] - b[0]).map(([z, rr]) => ({ z, r: rr })),
  };
}

/**
 * Bed exclusion SVG → polygons in bed coordinates (mm, origin at bed front-left, Y up).
 * Supports <polygon>, <polyline>, <rect>, and <path> with M/L/H/V/Z (absolute + relative). The SVG user unit is
 * taken as 1 mm unless width/height carry "mm" with a viewBox, in which case the viewBox is scaled.
 */
export function parseBedExclusionSVG(text: string): { polygons: [number, number][][]; warnings: string[] } {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", removeNSPrefix: true, preserveOrder: true }).parse(text);
  const warnings: string[] = [];
  const svgNode = doc.find((n: Record<string, unknown>) => "svg" in n);
  if (!svgNode) throw new Error("Not an SVG file");
  const attrs = svgNode[":@"] ?? {};
  const vb = String(attrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  const hasVB = vb.length === 4 && vb.every(Number.isFinite);
  const mm = (s: unknown) => { const m = String(s ?? "").match(/^([\d.]+)\s*mm$/); return m ? Number(m[1]) : null; };
  const W = mm(attrs.width), H = mm(attrs.height);
  const sx = hasVB && W ? W / vb[2] : 1, sy = hasVB && H ? H / vb[3] : 1;
  const ox = hasVB ? vb[0] : 0, oy = hasVB ? vb[1] : 0;
  const height = hasVB ? vb[3] * sy : H ?? Number(attrs.height);
  if (!Number.isFinite(height)) throw new Error("SVG needs a viewBox or a height to flip the Y axis");
  const toBed = (x: number, y: number): [number, number] => [(x - ox) * sx, height - (y - oy) * sy];

  const polygons: [number, number][][] = [];
  const walk = (nodes: Record<string, unknown>[]) => {
    for (const n of nodes) {
      const tag = Object.keys(n).find((k) => k !== ":@")!;
      const a = (n[":@"] ?? {}) as Record<string, string>;
      if (a.transform) warnings.push(`<${tag}> transform ignored`);
      if (tag === "polygon" || tag === "polyline") {
        const v = a.points.trim().split(/[\s,]+/).map(Number), pts: [number, number][] = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push(toBed(v[i], v[i + 1]));
        if (pts.length >= 3) polygons.push(pts);
      } else if (tag === "rect") {
        const x = +a.x || 0, y = +a.y || 0, w = +a.width, h = +a.height;
        polygons.push([toBed(x, y), toBed(x + w, y), toBed(x + w, y + h), toBed(x, y + h)]);
      } else if (tag === "path") {
        const toks = a.d.match(/[MmLlHhVvZzCcSsQqTtAa]|-?[\d.]+(?:e-?\d+)?/g) ?? [];
        let cx = 0, cy = 0, cmd = "", pts: [number, number][] = [];
        const flush = () => { if (pts.length >= 3) polygons.push(pts.map(([x, y]) => toBed(x, y))); pts = []; };
        for (let i = 0; i < toks.length;) {
          if (/[A-Za-z]/.test(toks[i])) { cmd = toks[i++]; if (/[Zz]/.test(cmd)) { flush(); continue; } if (/[CcSsQqTtAa]/.test(cmd)) throw new Error("Curved SVG paths are not supported in bed exclusions; use straight segments"); }
          const num = () => Number(toks[i++]);
          switch (cmd) {
            case "M": flush(); cx = num(); cy = num(); pts.push([cx, cy]); cmd = "L"; break;
            case "m": flush(); cx += num(); cy += num(); pts.push([cx, cy]); cmd = "l"; break;
            case "L": cx = num(); cy = num(); pts.push([cx, cy]); break;
            case "l": cx += num(); cy += num(); pts.push([cx, cy]); break;
            case "H": cx = num(); pts.push([cx, cy]); break;
            case "h": cx += num(); pts.push([cx, cy]); break;
            case "V": cy = num(); pts.push([cx, cy]); break;
            case "v": cy += num(); pts.push([cx, cy]); break;
            default: i++;
          }
        }
        flush();
      }
      const kids = n[tag];
      if (Array.isArray(kids)) walk(kids as Record<string, unknown>[]);
    }
  };
  walk(svgNode.svg);
  if (!polygons.length) throw new Error("SVG contains no polygon, rect or straight path shapes");
  return { polygons, warnings };
}
