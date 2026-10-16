import { test } from "vitest";
import assert from "node:assert/strict";
import { applyBrushToPath, applyMotion, DEFAULT_OPTIONS } from "../../src/plugins/motionex/modifier";
import { PRESETS } from "../../src/plugins/motionex/presets";
import { flatCurve, type MotionApplication, type MotionBrush } from "../../src/plugins/motionex/model";
import { emptyCheck, type Layer, type Toolpath } from "../../src/plugins/motionex/core/types";
import { checkCollisions, HeightMap, type ToolheadProfile } from "../../src/plugins/motionex/core/toolhead";
import { regionFromDef, regionWeight, RegionRegistry } from "../../src/plugins/motionex/core/regions";
import { defaultApplication } from "../../src/plugins/motionex/index";
import { profiles } from "./helpers";

const flat = (): MotionBrush => ({ ...structuredClone(PRESETS.find((b) => b.id === "preset-sine")!), amplitude: 0, period_mm: 4 });
const line = (len: number, z = 1): Toolpath => ({ feature: "outer_wall", closed: false, points: [
  { x: 10, y: 10, z, f: 50, flow: 1, e: 0 }, { x: 10 + len, y: 10, z, f: 50, flow: 1, e: 0 }] });
const run = (b: MotionBrush, len = 8) => { const check = emptyCheck(); const out = applyBrushToPath(line(len), b, profiles(), DEFAULT_OPTIONS, () => 1, () => {}, 0, check); return { out, check }; };
const layerOf = (paths: Toolpath[], z = 1, index = 4): Layer => ({ index, z, height: 0.2, paths });

// ── phase 5: events ──
test("pause with blob: G4 and an extra push of plastic once per repeat", () => {
  const b = flat(); b.events = [{ at: { mode: "percent", value: 50 }, type: "dwell", params: { ms: 300, blob_mm3: 2.4 } }];
  const { out, check } = run(b, 8);
  const pauses = out.points.filter((q) => q.post?.dwell_ms === 300);
  assert.equal(pauses.length, 2); assert.equal(check.events.dwell, 2);
  assert.ok(Math.abs(pauses[0].post!.blob_mm! - 2.4 / (Math.PI * 0.875 ** 2)) < 1e-3);
  assert.ok(Math.abs(pauses[0].x - 12) < 0.21, "first pause at 50% of the first 4 mm repeat");
});

test("lift-off: retract, travel without plastic, unretract, then print again", () => {
  const b = flat(); b.events = [{ at: { mode: "mm", value: 1 }, type: "retract", params: { length: 0.6, travel_mm: 1 }, once: true }];
  const { out, check } = run(b, 6);
  const r = out.points.findIndex((q) => q.post?.retract_mm);
  const u = out.points.findIndex((q) => q.post?.unretract_mm);
  assert.ok(r > 0 && u > r); assert.equal(check.events.retract, 1);
  assert.ok(out.points.slice(r + 1, u + 1).every((q) => q.travel));
  assert.ok(out.points.slice(u + 1).every((q) => !q.travel));
});

test("plastic change event scales flow from that spot on", () => {
  const b = flat(); b.events = [{ at: { mode: "mm", value: 2 }, type: "flow_change", params: { mult: 1.4 } , once: true }];
  const { out } = run(b, 6);
  assert.ok(out.points.filter((q) => q.x < 11.9).every((q) => q.flow === 1));
  assert.ok(out.points.filter((q) => q.x > 12.1).every((q) => Math.abs(q.flow - 1.4) < 1e-9));
});

// ── phase 6: up-and-down, speed limits, collisions ──
test("up-and-down curve moves Z, records the offset and respects the printer's Z speed", () => {
  const b = flat(); b.z_amplitude = 0.4; b.curves.z_offset = structuredClone(PRESETS.find((q) => q.id === "preset-sine")!.curves.lateral_offset);
  const p = profiles("prusa-mk3s"); // 12 mm/s up/down
  const check = emptyCheck();
  const out = applyBrushToPath(line(8), b, p, DEFAULT_OPTIONS, () => 1, () => {}, 0, check);
  const zs = out.points.map((q) => q.z);
  assert.ok(Math.abs(Math.max(...zs) - 1.4) < 0.01 && Math.abs(Math.min(...zs) - 0.6) < 0.01);
  assert.ok(out.points.some((q) => q.zOff && q.zOff > 0.39));
  for (let i = 1; i < out.points.length; i++) {
    const a = out.points[i - 1], q = out.points[i], l = Math.hypot(q.x - a.x, q.y - a.y, q.z - a.z);
    assert.ok((q.f * Math.abs(q.z - a.z)) / l <= 12 + 1e-6);
  }
  assert.ok(check.zSpeedHits > 0);
});

const coneOnly: ToolheadProfile = { device_id: "t", name: "test", nozzle: { tip_len: 3, cone_angle_deg: 40, tip_diameter: 1 }, volumes: [], margin: 0 };

test("height map remembers the tallest plastic and the cone floor rises near it", () => {
  const m = new HeightMap(50, 50);
  m.stamp(10, 10, 4);
  assert.equal(m.maxIn(9, 9, 11, 11), 4);
  assert.equal(m.maxIn(20, 20, 30, 30), 0);
  const floor = m.coneFloor(11, 10, 0.5, 3, Math.tan((40 * Math.PI) / 180));
  // d = 1 from the tip centre, tip radius 0.5, half a 0.5 mm cell of contact allowance
  assert.ok(Math.abs(floor - (4 - 0.25 / Math.tan((40 * Math.PI) / 180))) < 1e-6);
});

const tallThenDip = (): Layer[] => {
  const tall: Toolpath = { feature: "outer_wall", closed: false, points: Array.from({ length: 21 }, (_, i) => ({ x: 10 + i * 0.5, y: 10, z: 4, f: 30, flow: 1, e: 0, zOff: 3 })) };
  const dip: Toolpath = { feature: "outer_wall", closed: false, points: Array.from({ length: 21 }, (_, i) => ({ x: 10 + i * 0.5, y: 11, z: 0.6, f: 30, flow: 1, e: 0, zOff: -0.4 })) };
  return [layerOf([tall, dip], 1, 4)];
};

test("collision: nozzle dipping next to a tall bump is caught; clamp lifts it clear", () => {
  const check = emptyCheck(), warns: string[] = [];
  const L = tallThenDip();
  checkCollisions(L, coneOnly, { x: 100, y: 100 }, "clamp", check, (w) => warns.push(w.code));
  assert.ok(check.collisionCount >= 15, `found ${check.collisionCount}`);
  const need = 4 - 0.25 / Math.tan((40 * Math.PI) / 180);
  assert.ok(L[0].paths[1].points.slice(2, -2).every((q) => q.z >= need - 1e-3 && q.flag === "collision"));
  assert.deepEqual(warns, ["collision_fixed"]);
  assert.equal(check.blocking, false);
});

test("collision: skip flattens, fail blocks export; the bed counts too", () => {
  const a = emptyCheck(), L1 = tallThenDip();
  checkCollisions(L1, coneOnly, { x: 100, y: 100 }, "skip", a, () => {});
  assert.ok(L1[0].paths[1].points.slice(2, -2).every((q) => q.z === 1));
  const b = emptyCheck();
  checkCollisions(tallThenDip(), coneOnly, { x: 100, y: 100 }, "fail", b, () => {});
  assert.equal(b.blocking, true); assert.ok(b.collisions.length > 0 && b.collisions[0].layer === 4);
  const c = emptyCheck();
  const low: Layer = { index: 0, z: 0.2, height: 0.2, paths: [{ feature: "outer_wall", closed: false, points: [{ x: 5, y: 5, z: 0.05, f: 20, flow: 1, e: 0, zOff: -0.15 }] }] };
  checkCollisions([low], { ...coneOnly, margin: 0.1 }, { x: 50, y: 50 }, "fail", c, () => {});
  assert.equal(c.collisionCount, 1);
});

test("heater block box counts: tall plastic under the block footprint is a collision", () => {
  const head: ToolheadProfile = { ...coneOnly, volumes: [{ name: "block", shape: "box", dims: [16, 16, 10], offset: [0, 0, 3] }] };
  const tower: Toolpath = { feature: "outer_wall", closed: false, points: [{ x: 16, y: 10, z: 8, f: 20, flow: 1, e: 0, zOff: 7 }, { x: 16.2, y: 10, z: 8, f: 20, flow: 1, e: 0, zOff: 7 }] };
  const pass: Toolpath = { feature: "outer_wall", closed: false, points: [{ x: 10, y: 10, z: 1.5, f: 20, flow: 1, e: 0, zOff: 0.5 }] };
  const check = emptyCheck();
  checkCollisions([layerOf([tower, pass])], head, { x: 50, y: 50 }, "fail", check, () => {});
  assert.ok(check.collisionCount >= 1); // tower top 8 > tip 1.5 + block bottom 3
});

// ── loops: slow and warn ──
test("loop patterns print slower where the nozzle runs backwards, and say so", () => {
  const loop = PRESETS.find((b) => b.id === "preset-loop")!;
  const warns: string[] = [], check = emptyCheck();
  const out = applyBrushToPath(line(12), loop, profiles(), DEFAULT_OPTIONS, () => 1, (w) => warns.push(w.message), 0, check);
  const slow = profiles().process.wallSpeed * DEFAULT_OPTIONS.loopSpeedShare;
  const flagged = out.points.filter((q) => q.flag === "loop");
  assert.ok(flagged.length > 5 && flagged.every((q) => q.f <= slow + 1e-9));
  assert.ok(check.loopSlowed > 0);
  assert.ok(warns.some((m) => /loops lay plastic over itself/.test(m)));
  const sine = applyBrushToPath(line(12), PRESETS.find((b) => b.id === "preset-sine")!, profiles(), DEFAULT_OPTIONS, () => 1, () => {});
  assert.ok(sine.points.every((q) => q.flag !== "loop"));
});

// ── phase 8: masks, stacking, regions ──
const app = (brush_id: string, over: Partial<MotionApplication> = {}): MotionApplication => ({ ...defaultApplication(brush_id), target: { type: "body", walls: "outer" }, mask: { z_start: 0, z_end: 99, fade_in_mm: 0, fade_out_mm: 0 }, ...over });
const maxY = (t: Toolpath) => Math.max(...t.points.map((q) => Math.abs(q.y - 10)));
const brushes = (id: string) => PRESETS.find((b) => b.id === id);

test("stacking: add builds on the earlier pattern, replace starts over", () => {
  const twice = applyMotion([layerOf([line(16)])], [app("preset-sine", { order: 0 }), app("preset-sine", { order: 1 })], brushes, profiles()).layers[0].paths[0];
  const replace = applyMotion([layerOf([line(16)])], [app("preset-sine", { order: 0 }), app("preset-sine", { order: 1, blend: "override", scale: 0.5 })], brushes, profiles()).layers[0].paths[0];
  assert.ok(Math.abs(maxY(twice) - 1.2) < 0.03, `add gave ${maxY(twice)}`);
  assert.ok(Math.abs(maxY(replace) - 0.3) < 0.03, `replace gave ${maxY(replace)}`);
});

test("fade out and wall-slope masks", () => {
  const fade = applyMotion([layerOf([line(16, 9.5)], 9.5)], [app("preset-sine", { mask: { z_start: 0, z_end: 10, fade_in_mm: 0, fade_out_mm: 1 } })], brushes, profiles()).layers[0].paths[0];
  assert.ok(Math.abs(maxY(fade) - 0.3) < 0.02, `half-faded gave ${maxY(fade)}`);
  const steep = line(16); steep.points.forEach((q) => { q.slope = 35; });
  const masked = applyMotion([layerOf([steep])], [app("preset-sine", { mask: { z_start: 0, z_end: 99, fade_in_mm: 0, fade_out_mm: 0, angle_min: -20, angle_max: 20 } })], brushes, profiles()).layers[0].paths[0];
  assert.ok(maxY(masked) < 1e-9);
});

test("picked-surface target: pattern only inside the box, with a soft edge", () => {
  const reg = new RegionRegistry();
  reg.set(regionFromDef({ id: "logo", name: "Logo", kind: "box", x: 18, y: 10, w: 8, d: 10, z_from: 0, z_to: 50 }, 0.2, 0.2, { x: 100, y: 100 }));
  const r = reg.get("logo")!;
  assert.equal(regionWeight(r, 4, 18, 10, 0), 1);
  assert.equal(regionWeight(r, 4, 30, 10, 0), 0);
  assert.ok(Math.abs(regionWeight(r, 4, 22, 10, 2) - 0.5) < 1e-9);
  assert.equal(regionWeight(r, 999, 18, 10, 0), 0);
  const out = applyMotion([layerOf([line(20)])], [app("preset-sine", { target: { type: "faces", walls: "outer", faces: ["logo"] } })], brushes, profiles(), DEFAULT_OPTIONS, emptyCheck(), reg).layers[0].paths[0];
  const inside = out.points.filter((q) => q.x > 15 && q.x < 21), outside = out.points.filter((q) => q.x < 13 || q.x > 23);
  assert.ok(Math.max(...inside.map((q) => Math.abs(q.y - 10))) > 0.5);
  assert.ok(outside.every((q) => Math.abs(q.y - 10) < 1e-9));
});

