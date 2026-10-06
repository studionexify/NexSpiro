// Usage: npm run generate -- <primitive> <pattern> <machine-id> [out.gcode]
// e.g.   npm run generate -- bowl knit machine/voron-24 bowl.gcode
import { writeFileSync } from "node:fs";
import {
  buildPrimitive, buildSpiral, planMotion, toGcode, sliceStats, formatDuration, PresetRegistry,
  type PrimitiveName, type MachinePreset, type FilamentPreset, type ProcessPreset,
} from "../src/core/index.ts";

const [prim = "bowl", pattern = "knit", machineId = "machine/bambu-x1", out = `${prim}-${pattern}.gcode`] = process.argv.slice(2);
const reg = new PresetRegistry();
const machine = reg.resolve<"machine">(machineId) as MachinePreset;
const filament = reg.resolve<"filament">("filament/pla") as FilamentPreset;
const proc = reg.resolve<"process">("process/vase-0.4") as ProcessPreset;
const tp = buildSpiral(buildPrimitive(prim as PrimitiveName), {
  layerHeight: proc.layerHeight, firstLayerHeight: proc.firstLayerHeight, lineWidth: proc.lineWidth,
  filamentDiameter: filament.diameter, segmentsPerRev: proc.segmentsPerRev, pattern, fadeHeight: proc.fadeHeight,
  center: [0, 0], zCap: machine.zWobbleMax, planar: !proc.nonLinear.enabled,
});
const mp = planMotion(tp, proc.segmentsPerRev, { machine, filament, process: proc });
writeFileSync(out, toGcode(mp, { machine, filament, process: proc, offset: [machine.bed[0] / 2, machine.bed[1] / 2] }));
const st = sliceStats(mp, filament);
console.log(`${out}: ${mp.count} moves (${mp.decimated} decimated), ${formatDuration(st.timeS)}, ${st.grams.toFixed(1)} g, ${(st.filamentMm / 1000).toFixed(2)} m`);
