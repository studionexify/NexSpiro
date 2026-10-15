import { sliceObjects } from "./slicer.ts";
import { computeExtrusion } from "./extrusion.ts";
import { emitGcode } from "./gcode.ts";
import type { PluginHost } from "./plugins.ts";
import type { PrintProfiles } from "./profiles.ts";
import type { SceneObject } from "./primitives.ts";
import type { SlicedPlate } from "./types.ts";

export interface PipelineResult extends SlicedPlate { gcode: string; stats: { moves: number; filamentMm: number; grams: number; seconds: number } }

export function runPipeline(objects: SceneObject[], profiles: PrintProfiles, host: PluginHost): PipelineResult {
  const plate = sliceObjects(objects, profiles);
  const ctx = { profiles, warnings: plate.warnings };
  const layers = host.runPostToolpath(plate.layers, ctx);
  ctx.warnings.push(...computeExtrusion(layers, profiles));
  const gcode = emitGcode(layers, profiles, host.headerLines());
  let moves = 0, fil = 0, sec = 0;
  for (const l of layers) for (const p of l.paths) for (let i = 1; i < p.points.length; i++) {
    const a = p.points[i - 1], b = p.points[i];
    moves++; fil += b.e; sec += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / b.f;
  }
  const grams = fil * Math.PI * (profiles.filament.diameter / 2) ** 2 / 1000 * profiles.filament.density;
  return { layers, warnings: ctx.warnings, gcode, stats: { moves, filamentMm: fil, grams, seconds: sec } };
}
