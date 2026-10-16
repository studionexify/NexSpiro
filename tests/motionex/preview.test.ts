import { test } from "vitest";
import assert from "node:assert/strict";
import { weld } from "../../src/engine/mesh";
import { buildPreview } from "../../src/plugins/motionex/preview";
import { PRESETS } from "../../src/plugins/motionex/presets";
import { defaultApplication } from "../../src/plugins/motionex/index";
import { cylinder } from "../fixtures";
import { profiles } from "./helpers";

const sine = PRESETS.find((b) => b.id === "preset-sine")!;
const mesh = () => weld(cylinder(50, 50, 20, 60, 96));

test("pattern preview draws the patterned walls quickly, without slicing", () => {
  const app = { ...defaultApplication(sine.id), target: { type: "body" as const, walls: "outer" as const } };
  const t0 = performance.now();
  const out = buildPreview([{ id: "c", mesh: mesh() }], [{ app, brush: sine, surface: 1, color: [1, 0.5, 0.2] }], profiles());
  assert.ok(performance.now() - t0 < 3000);
  assert.ok(out.layers > 50 && out.layers <= 140, `layers ${out.layers}`);
  // the waves push the wall in and out of the 20 mm radius
  let rMax = 0, rMin = Infinity;
  for (let i = 0; i < out.positions.length; i += 3) { const r = Math.hypot(out.positions[i] - 50, out.positions[i + 1] - 50); rMax = Math.max(rMax, r); rMin = Math.min(rMin, r); }
  assert.ok(rMax > 20.4 && rMin < 19.6, `r ${rMin}..${rMax}`);
});

test("pattern preview only covers the picked faces (plus a little plain wall around them)", () => {
  const m = mesh();
  const motion = new Uint8Array(m.indices.length / 3);
  // pick the side triangles facing +X
  for (let t = 0; t < motion.length; t++) {
    let cx = 0;
    for (let k = 0; k < 3; k++) cx += m.vertices[m.indices[t * 3 + k] * 3] / 3;
    if (cx > 65) motion[t] = 1;
  }
  const app = { ...defaultApplication(sine.id), target: { type: "faces" as const, walls: "outer" as const, faces: ["1"] } };
  const out = buildPreview([{ id: "c", mesh: m, motion }], [{ app, brush: sine, surface: 1, color: [1, 0.5, 0.2] }], profiles());
  assert.ok(out.positions.length > 0);
  for (let i = 0; i < out.positions.length; i += 3) assert.ok(out.positions[i] > 50, `x ${out.positions[i]}`);
});
