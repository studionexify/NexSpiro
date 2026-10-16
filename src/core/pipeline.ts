import { sliceObjects } from "./slicer.ts";
import { computeExtrusion } from "./extrusion.ts";
import { emitGcode } from "./gcode.ts";
import { PluginHost } from "./plugins.ts";
import type { PrintProfiles } from "./profiles.ts";
import type { SceneObject } from "./primitives.ts";
import type { Layer, SlicedPlate } from "./types.ts";

export interface PrintStats { moves: number; filamentMm: number; grams: number; seconds: number }
export interface PipelineResult extends SlicedPlate { gcode: string; stats: PrintStats }

export function runPipeline(objects: SceneObject[], profiles: PrintProfiles, host: PluginHost): PipelineResult {
  const plate = sliceObjects(objects, profiles);
  const ctx = { profiles, warnings: plate.warnings, check: plate.check };
  const layers = host.runPostToolpath(plate.layers, ctx);
  ctx.warnings.push(...computeExtrusion(layers, profiles, ctx.check));
  const gcode = emitGcode(layers, profiles, host.headerLines());
  return { layers, warnings: ctx.warnings, check: ctx.check, gcode, stats: statsOf(layers, profiles) };
}

/** The same plate with no plugins, for "how much did the patterns add" in the check report. */
export function runBaseline(objects: SceneObject[], profiles: PrintProfiles): PrintStats {
  return runPipeline(objects, profiles, new PluginHost()).stats;
}

export function statsOf(layers: Layer[], profiles: PrintProfiles): PrintStats {
  let moves = 0, fil = 0, sec = 0;
  for (const l of layers) for (const p of l.paths) {
    const p0 = p.points[0];
    fil += p0?.post?.blob_mm ?? 0; sec += (p0?.post?.dwell_ms ?? 0) / 1000;
    for (let i = 1; i < p.points.length; i++) {
    const a = p.points[i - 1], b = p.points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    moves++; fil += b.e + (b.post?.blob_mm ?? 0);
    sec += len / (b.travel ? profiles.process.travelSpeed : b.f) + (b.post?.dwell_ms ?? 0) / 1000;
    }
  }
  const grams = fil * Math.PI * (profiles.filament.diameter / 2) ** 2 / 1000 * profiles.filament.density;
  return { moves, filamentMm: fil, grams, seconds: sec };
}
