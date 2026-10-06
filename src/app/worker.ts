import {
  buildSpiral, planMotion, sliceStats, checkPlate,
  type MachinePreset, type FilamentPreset, type ProcessPreset, type Plate,
} from "../core/index.ts";
import { primitives } from "../core/primitives.ts";

export type SliceRequest = { id: number; plateId: string; plate: Plate; machine: MachinePreset; filament: FilamentPreset; process: ProcessPreset };

self.onmessage = (ev: MessageEvent<SliceRequest>) => {
  const { id, plateId, plate, machine, filament, process } = ev.data;
  try {
    const t0 = performance.now();
    const profile = primitives[plate.primitive]();
    const tp = buildSpiral(profile, {
      layerHeight: process.layerHeight, firstLayerHeight: process.firstLayerHeight, lineWidth: process.lineWidth,
      filamentDiameter: filament.diameter, segmentsPerRev: process.segmentsPerRev,
      pattern: plate.base.pattern, params: plate.base.params, fadeHeight: process.fadeHeight, center: [0, 0],
      zCap: machine.zWobbleMax, planar: !process.nonLinear.enabled,
      scaleXY: plate.transform.scaleXY, scaleZ: plate.transform.scaleZ, rotation: plate.transform.rotation,
      paint: { ...plate.mask, regions: plate.mask.regions.map((r, k) => ({ ...r, params: plate.regionParams[k] })) },
    });
    const mp = planMotion(tp, process.segmentsPerRev, { machine, filament, process });
    const stats = sliceStats(mp, filament);
    const issues = checkPlate(plate, machine, process);
    const ms = performance.now() - t0;
    (self as unknown as Worker).postMessage(
      { id, plateId, ok: true, mp, stats, issues, zClipped: tp.zClipped, ms },
      [mp.xyz.buffer, mp.e.buffer, mp.tag.buffer, mp.layer.buffer, mp.feed.buffer, mp.curvature.buffer, mp.layerTime.buffer, mp.layerFan.buffer],
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, plateId, ok: false, error: String(err) });
  }
};
