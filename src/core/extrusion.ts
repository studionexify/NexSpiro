// Extrusion is always derived from the actual 3D move length, so any plugin that changes
// geometry gets correct E for free.
import type { Layer, SliceWarning } from "./types.ts";
import { flowCap, type PrintProfiles } from "./profiles.ts";

/** Filament mm for a bead of given 3D length. Cross-section: rectangle with semicircular ends (Slic3r model). */
export function filamentForBead(length: number, lineWidth: number, layerHeight: number, flowMult: number, filamentDiameter: number): number {
  const area = (lineWidth - layerHeight) * layerHeight + Math.PI * (layerHeight / 2) ** 2;
  const filArea = Math.PI * (filamentDiameter / 2) ** 2;
  return (length * area * flowMult) / filArea;
}

export function beadArea(lineWidth: number, layerHeight: number): number {
  return (lineWidth - layerHeight) * layerHeight + Math.PI * (layerHeight / 2) ** 2;
}

/** Fill in e on every point and enforce the volumetric flow cap by lowering feedrate. */
export function computeExtrusion(layers: Layer[], p: PrintProfiles): SliceWarning[] {
  const warnings: SliceWarning[] = [], cap = flowCap(p);
  let capHits = 0;
  for (const layer of layers) for (const path of layer.paths) {
    path.points[0].e = 0;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      b.e = filamentForBead(len, p.process.lineWidth, layer.height, b.flow, p.filament.diameter);
      const vol = beadArea(p.process.lineWidth, layer.height) * b.flow * b.f;
      if (vol > cap) { b.f = cap / (beadArea(p.process.lineWidth, layer.height) * b.flow); capHits++; }
    }
  }
  if (capHits) warnings.push({ code: "flow_cap", message: `Slowed ${capHits} spots down so the nozzle can melt plastic fast enough` });
  return warnings;
}
