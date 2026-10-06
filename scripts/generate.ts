// Usage: npm run generate -- <primitive> <pattern> <flavor> [out.gcode]
import { writeFileSync } from "node:fs";
import { primitives, buildSpiral, toGcode, type PrimitiveName, type Flavor } from "../src/core/index.ts";

const [prim = "bowl", pattern = "knit", flavor = "marlin", out = `${prim}-${pattern}.gcode`] = process.argv.slice(2);
const profile = primitives[prim as PrimitiveName]();
const tp = buildSpiral(profile, {
  layerHeight: 0.4, lineWidth: 0.8, filamentDiameter: 1.75, segmentsPerRev: 720,
  pattern, fadeHeight: 2, center: [128, 128],
});
writeFileSync(out, toGcode(tp, { flavor: flavor as Flavor, nozzleTemp: 220, bedTemp: 60, speed: 25, fan: 1 }));
console.log(`${out}: ${tp.count} points, ${(tp.e[tp.count - 1] / 1000).toFixed(2)} m filament`);
