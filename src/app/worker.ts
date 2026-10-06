import {
  buildSpiral, planMotion, sliceStats, checkPlate, objectBody, printOrder, resolveSettings, getSetting,
  type MachinePreset, type FilamentPreset, type ProcessPreset, type Plate, type Mesh, type MotionPath,
} from "../core/index.ts";
import { planPrint } from "../core/planar/plan.ts";
import { generateSupports } from "../core/planar/supports.ts";
import { crossSection } from "../core/planar/motion.ts";
import { writePlanarGcode, type PlanarGcodeOptions } from "../core/planar/gcodeWriter.ts";
import { buildPreview } from "../core/planar/preview.ts";
import type { PlanarJob, PlanarObject, PlanarPlan, PreviewSegments } from "../core/planar/types.ts";
import { solidMesh, worldTris } from "../io/planarAdapter.ts";
import { makeTextureHook } from "../io/textureHook.ts";

export type SliceRequest = {
  id: number; plate: Plate; meshes: Record<string, Mesh>;
  machine: MachinePreset; filament: FilamentPreset; process: ProcessPreset;
};
export type GcodeRequest = { type: "gcode"; id: number; opts: PlanarGcodeOptions };
export type Stats = ReturnType<typeof sliceStats>;
export type PlanarSummary = { prev: PreviewSegments; byFeature: Record<number, { timeS: number; filamentMm: number }>; warnings: string[]; objectNames: string[]; sequence: "layer" | "object" };
export type SliceResponse =
  | { id: number; ok: true; mps: MotionPath[]; order: number[]; stats: Stats; issues: ReturnType<typeof checkPlate>; zClipped: number; ms: number; planar?: PlanarSummary }
  | { id: number; ok: false; error: string };
export type GcodeResponse = { type: "gcode"; id: number; ok: true; text: string } | { type: "gcode"; id: number; ok: false; error: string };

let last: { id: number; plan: PlanarPlan; job: PlanarJob } | null = null;

function slicePlanar(req: SliceRequest): SliceResponse {
  const { id, plate, meshes, machine, filament, process } = req, t0 = performance.now();
  const bodies = plate.objects.map((o) => objectBody(o, meshes));
  const issues = checkPlate(plate, bodies, machine, process);
  const objects: PlanarObject[] = plate.objects.map((o, i) => ({
    id: o.id, name: o.name, tris: worldTris(o, solidMesh(o, meshes)), settings: resolveSettings(process, o.settings),
    texture: makeTextureHook(o, bodies[i], process, machine),
  }));
  const job: PlanarJob = { objects, machine, filament, process, settings: resolveSettings(process) };
  const plan = planPrint(job, (ctx) => generateSupports({ ...ctx, nozzle: machine.nozzle, lineWidth: Number(ctx.settings.support_line_width) || machine.nozzle }));
  const prev = buildPreview(plan, job, { travel: true });
  // estimate without writing the (large) G-code: the preview carries the look-ahead time model, E comes from the path geometry
  const flowK = (Number(job.settings.print_flow_ratio) || 1) * filament.flowRatio, byFeature: Record<number, { timeS: number; filamentMm: number }> = {};
  const filArea = Math.PI * (filament.diameter / 2) ** 2;
  let volume = 0;
  for (let i = 0; i < prev.count; i++) { const f = prev.feature[i], x = (byFeature[f] ??= { timeS: 0, filamentMm: 0 }); x.timeS += prev.order[i] - (i ? prev.order[i - 1] : 0); }
  for (const layer of plan.layers) for (const path of layer.paths) {
    if (!path.feature) continue;
    const n = path.xyz.length / 3, segs = path.closed ? n : n - 1, cs = crossSection(path.width, path.height) * path.flow * flowK; let v = 0;
    for (let k = 0; k < segs; k++) {
      const a = k * 3, b = ((k + 1) % n) * 3, len = Math.hypot(path.xyz[b] - path.xyz[a], path.xyz[b + 1] - path.xyz[a + 1], path.xyz[b + 2] - path.xyz[a + 2]);
      const fs = path.flowScale ? (path.flowScale[k] + path.flowScale[(k + 1) % n]) / 2 : 1; v += len * cs * fs;
    }
    volume += v; (byFeature[path.feature] ??= { timeS: 0, filamentMm: 0 }).filamentMm += v / filArea;
  }
  const filamentMm = volume / filArea, cm3 = volume / 1000, grams = cm3 * filament.density;
  const g = { timeS: prev.count ? prev.order[prev.count - 1] : 0, filamentMm, filamentCm3: cm3, grams, cost: (grams / 1000) * filament.costPerKg, layers: plan.layers.length, byFeature };
  last = { id, plan, job };
  let nonLinearMm = 0;
  for (let i = 0; i < prev.count; i++) if (prev.feature[i] >= 1 && prev.feature[i] <= 3 && Math.abs(prev.b[i * 3 + 2] - prev.a[i * 3 + 2]) > 1e-4) nonLinearMm += Math.hypot(prev.b[i * 3] - prev.a[i * 3], prev.b[i * 3 + 1] - prev.a[i * 3 + 1], prev.b[i * 3 + 2] - prev.a[i * 3 + 2]);
  for (const w of plan.warnings) issues.push({ level: "warn", message: w });
  const stats: Stats = { timeS: g.timeS, filamentMm: g.filamentMm, filamentCm3: g.filamentCm3, grams: g.grams, cost: g.cost, layers: g.layers, nonLinearMm };
  return { id, ok: true, mps: [], order: plate.objects.map((_, i) => i), stats, issues, zClipped: 0, ms: performance.now() - t0,
    planar: { prev, byFeature: g.byFeature, warnings: plan.warnings, objectNames: plan.objectNames, sequence: plan.sequence } };
}

function sliceSpiral(req: SliceRequest): SliceResponse {
  const { id, plate, meshes, machine, filament, process } = req, t0 = performance.now();
  const bodies = plate.objects.map((o) => objectBody(o, meshes));
  const issues = checkPlate(plate, bodies, machine, process);
  let zClipped = 0;
  // mps[i] belongs to plate.objects[i]; `order` is the sequential print order.
  const mps = plate.objects.map((o, i) => {
    const tp = buildSpiral(bodies[i], {
      layerHeight: process.layerHeight, firstLayerHeight: process.firstLayerHeight, lineWidth: process.lineWidth,
      filamentDiameter: filament.diameter, segmentsPerRev: process.segmentsPerRev,
      pattern: o.base.pattern, params: o.base.params, fadeHeight: process.fadeHeight,
      center: [o.transform.x, o.transform.y], zCap: machine.zWobbleMax, planar: !process.nonLinear.enabled,
      scaleXY: o.transform.scaleXY, scaleZ: o.transform.scaleZ, rotation: o.transform.rotation,
      paint: { ...o.mask, regions: o.mask.regions.map((r, k) => ({ ...r, params: o.regionParams[k] })) },
    });
    zClipped += tp.zClipped;
    return planMotion(tp, process.segmentsPerRev, { machine, filament, process });
  });
  const order = printOrder(plate, bodies, machine, process);
  return { id, ok: true, mps, order, stats: sliceStats(mps, filament), issues, zClipped, ms: performance.now() - t0 };
}

self.onmessage = (ev: MessageEvent<SliceRequest | GcodeRequest>) => {
  const d = ev.data;
  if ("type" in d && d.type === "gcode") {
    try {
      if (!last) throw new Error("Nothing sliced yet");
      (self as unknown as Worker).postMessage({ type: "gcode", id: d.id, ok: true, text: writePlanarGcode(last.plan, last.job, d.opts).text } satisfies GcodeResponse);
    } catch (err) { (self as unknown as Worker).postMessage({ type: "gcode", id: d.id, ok: false, error: String(err instanceof Error ? err.message : err) } satisfies GcodeResponse); }
    return;
  }
  const req = d as SliceRequest;
  try {
    const res = getSetting(req.process, "spiral_mode") === true ? sliceSpiral(req) : slicePlanar(req);
    const xfer: ArrayBuffer[] = [];
    if (res.ok) {
      for (const m of res.mps) xfer.push(...([m.xyz, m.e, m.tag, m.normal, m.zOff, m.layer, m.feed, m.curvature, m.layerTime, m.layerFan].map((a) => a.buffer) as ArrayBuffer[]));
      const p = res.planar?.prev; if (p) xfer.push(...([p.a, p.b, p.feature, p.layer, p.obj, p.speed, p.width, p.zone, p.order].map((a) => a.buffer) as ArrayBuffer[]));
    }
    (self as unknown as Worker).postMessage(res, xfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: req.id, ok: false, error: String(err instanceof Error ? err.message : err) } satisfies SliceResponse);
  }
};
