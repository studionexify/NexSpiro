import {
  buildSpiral, planMotion, sliceStats, checkPlate, objectBody, printOrder,
  type MachinePreset, type FilamentPreset, type ProcessPreset, type Plate, type Mesh, type MotionPath,
} from "../core/index.ts";

export type SliceRequest = {
  id: number; plate: Plate; meshes: Record<string, Mesh>;
  machine: MachinePreset; filament: FilamentPreset; process: ProcessPreset;
};
export type SliceResponse =
  | { id: number; ok: true; mps: MotionPath[]; order: number[]; stats: ReturnType<typeof sliceStats>; issues: ReturnType<typeof checkPlate>; zClipped: number; ms: number }
  | { id: number; ok: false; error: string };

self.onmessage = (ev: MessageEvent<SliceRequest>) => {
  const { id, plate, meshes, machine, filament, process } = ev.data;
  try {
    const t0 = performance.now();
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
    const res: SliceResponse = { id, ok: true, mps, order, stats: sliceStats(mps, filament), issues, zClipped, ms: performance.now() - t0 };
    (self as unknown as Worker).postMessage(res, mps.flatMap((m) => [m.xyz.buffer, m.e.buffer, m.tag.buffer, m.layer.buffer, m.feed.buffer, m.curvature.buffer, m.layerTime.buffer, m.layerFan.buffer]));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err instanceof Error ? err.message : err) } satisfies SliceResponse);
  }
};
