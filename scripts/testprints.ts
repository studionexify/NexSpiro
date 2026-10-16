// Builds the three Motionex test prints (spec §9) for each printer and writes G-code to out/test-prints/.
// Run: npm run testprints
import { mkdirSync, writeFileSync } from "node:fs";
import { PluginHost } from "../src/core/plugins.ts";
import { runPipeline, runBaseline, type PipelineResult } from "../src/core/pipeline.ts";
import { makeObject, type SceneObject } from "../src/core/primitives.ts";
import { MACHINES, FILAMENTS, PROCESSES, type PrintProfiles } from "../src/core/profiles.ts";
import { createMotionex, defaultApplication } from "../src/plugins/motionex/index.ts";
import type { MotionApplication } from "../src/plugins/motionex/model.ts";

export interface TestPrint { id: string; title: string; objects: (bed: { x: number; y: number }) => SceneObject[]; apps: (top: number) => MotionApplication[]; process: string }

export const TEST_PRINTS: TestPrint[] = [
  { id: "cube-sine", title: "20 mm cube with a wave wall", process: "std-020",
    objects: (bed) => [{ ...makeObject("cube", bed.x / 2, bed.y / 2), id: "cube", name: "Cube" }],
    apps: () => [defaultApplication("preset-sine")] },
  { id: "vase-z-rim", title: "Vase with a rolling top rim", process: "tex-030",
    objects: (bed) => [{ ...makeObject("vase", bed.x / 2, bed.y / 2), id: "vase", name: "Vase", size: { x: 60, y: 60, z: 80 } }],
    apps: (top) => [{ ...defaultApplication("preset-z-wave"), mask: { z_start: top - 10, z_end: top, fade_in_mm: 3, fade_out_mm: 0 } }] },
  { id: "dot-panel", title: "Dot pattern panel", process: "std-020",
    objects: (bed) => [{ ...makeObject("cube", bed.x / 2, bed.y / 2), id: "panel", name: "Panel", size: { x: 60, y: 4, z: 30 } }],
    apps: () => [{ ...defaultApplication("preset-dots"), mask: { z_start: 2, z_end: 1e4, fade_in_mm: 0, fade_out_mm: 0 } }] },
];

export function buildTestPrint(t: TestPrint, machineId: string): { result: PipelineResult; baseSeconds: number; profiles: PrintProfiles } {
  const machine = MACHINES.find((m) => m.id === machineId)!;
  const profiles: PrintProfiles = { machine, filament: FILAMENTS[0], process: PROCESSES.find((p) => p.id === t.process)! };
  const objects = t.objects(machine.bed);
  const host = new PluginHost(), mx = createMotionex(null);
  mx.state.applications.push(...t.apps(Math.max(...objects.map((o) => o.size.z))));
  host.register(mx.plugin);
  return { result: runPipeline(objects, profiles, host), baseSeconds: runBaseline(objects, profiles).seconds, profiles };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync("out/test-prints", { recursive: true });
  for (const t of TEST_PRINTS) for (const m of MACHINES) {
    const { result, baseSeconds } = buildTestPrint(t, m.id);
    const file = `out/test-prints/${t.id}-${m.id}.gcode`;
    writeFileSync(file, result.gcode);
    const c = result.check;
    console.log(`${file}: ${result.layers.length} layers, +${Math.round(result.stats.seconds - baseSeconds)} s, ${c.collisionCount} head hits, ${c.events.dwell} pauses, warnings: ${result.warnings.map((w) => w.code).join(", ") || "none"}`);
  }
}
