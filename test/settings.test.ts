import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTING_DEFS, SETTING_BY_KEY, getSetting, resolveSettings, visible, PresetRegistry, isSequential } from "../src/core/index.ts";

test("settings schema: unique keys, valid defaults, enum defaults in options, showIf targets exist", () => {
  const seen = new Set<string>();
  for (const d of SETTING_DEFS) {
    assert.ok(!seen.has(d.key), `duplicate ${d.key}`); seen.add(d.key);
    if (d.kind === "enum") assert.ok(d.options!.some(([v]) => v === String(d.def)), `${d.key} default not in options`);
    if (d.kind === "num") { assert.equal(typeof d.def, "number"); if (d.min !== undefined) assert.ok((d.def as number) >= d.min, `${d.key} below min`); if (d.max !== undefined) assert.ok((d.def as number) <= d.max, `${d.key} above max`); }
    if (d.showIf) { const m = /^(\w+)!?=/.exec(d.showIf)!; assert.ok(m[1] in SETTING_BY_KEY, `${d.key} showIf → unknown ${m[1]}`); }
  }
  assert.ok(SETTING_DEFS.length > 150);
});
test("settings resolve: preset delta + alias fields + per-object override", () => {
  const reg = new PresetRegistry(), p = reg.resolve<"process">("process/strength-0.20");
  assert.equal(getSetting(p, "wall_loops"), 6);
  assert.equal(getSetting(p, "layer_height"), 0.2, "alias to layerHeight");
  assert.equal(getSetting(p, "wall_loops", { wall_loops: 3 }), 3, "object override wins");
  assert.equal(getSetting(p, "spiral_mode"), false);
  assert.equal(getSetting(reg.resolve<"process">("process/vase-0.4"), "spiral_mode"), true);
  assert.equal(isSequential(reg.resolve<"process">("process/vase-0.4")), true);
  assert.equal(isSequential(p), false);
  const all = resolveSettings(p); assert.equal(all.sparse_infill_pattern, "gyroid");
  const brim = SETTING_BY_KEY.brim_width; assert.equal(visible(brim, (k) => (k === "brim_type" ? "no_brim" : "")), false);
});
