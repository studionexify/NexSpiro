import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBrushToPath, brushAt, resample, DEFAULT_OPTIONS } from "../src/plugins/motionex/modifier.ts";
import { PRESETS } from "../src/plugins/motionex/presets.ts";
import type { Toolpath } from "../src/core/types.ts";
import { profiles } from "./helpers.ts";

const sine = structuredClone(PRESETS.find((b) => b.id === "preset-sine")!);
const line = (len: number): Toolpath => ({ feature: "outer_wall", closed: false, points: [
  { x: 0, y: 0, z: 1, f: 50, flow: 1, e: 0 }, { x: len, y: 0, z: 1, f: 50, flow: 1, e: 0 }] });

test("resample caps segment length and keeps endpoints", () => {
  const s = resample(line(1).points, 0.2);
  assert.equal(s.length, 6);
  assert.equal(s.at(-1)!.x, 1);
});

test("sine brush offsets a straight line by ±amplitude along the normal", () => {
  const out = applyBrushToPath(line(8), { ...sine, amplitude: 0.5, period_mm: 4 }, profiles(), DEFAULT_OPTIONS, () => 1, () => {});
  const ys = out.points.map((p) => p.y);
  assert.ok(Math.abs(Math.max(...ys) - 0.5) < 0.01 && Math.abs(Math.min(...ys) + 0.5) < 0.01);
  // Travelling +X, the outward (right-hand) normal is −Y, so the first quarter period goes to −Y.
  const q = out.points.find((p) => Math.abs(p.x - 1) < 1e-9)!;
  assert.ok(Math.abs(q.y + 0.5) < 0.01);
  assert.ok(out.points.every((p) => p.z === 1));
});

test("repeat modes: once applies a single period, stretch fits a whole number", () => {
  const once = { ...sine, repeat_mode: "once" as const, period_mm: 4 };
  assert.ok(brushAt(once, 1, 10));
  assert.equal(brushAt(once, 5, 10), null);
  const st = { ...sine, repeat_mode: "stretch" as const, period_mm: 4 };
  // L=10 → round(2.5)=3 periods of 3.333 mm; s = L lands on phase 0 again.
  assert.ok(Math.abs(brushAt(st, 10, 10)!.lat) < 1e-6);
  assert.ok(Math.abs(brushAt(st, 10 / 12, 10)!.lat - sine.amplitude) < 0.01);
});

test("fade weight 0 leaves the path untouched", () => {
  const out = applyBrushToPath(line(4), sine, profiles(), DEFAULT_OPTIONS, () => 0, () => {});
  assert.ok(out.points.every((p) => p.y === 0 && p.flow === 1));
});

test("flow curve is clamped to brush limits", () => {
  const b = structuredClone(sine);
  b.curves.extrusion_mult = { interpolation: "linear", points: [{ t: 0, v: 5, in_handle: [0, 0], out_handle: [0, 0] }] };
  const warns: string[] = [];
  const out = applyBrushToPath(line(2), b, profiles(), DEFAULT_OPTIONS, () => 1, (w) => warns.push(w.code));
  assert.ok(out.points.slice(1).every((p) => p.flow === b.limits.max_flow_mult));
  assert.deepEqual(warns, ["motionex_flow_limit"]);
});

test("noise brush is deterministic for a stored seed", () => {
  const n = PRESETS.find((b) => b.id === "preset-noise")!;
  const a = applyBrushToPath(line(10), n, profiles(), DEFAULT_OPTIONS, () => 1, () => {});
  const b = applyBrushToPath(line(10), n, profiles(), DEFAULT_OPTIONS, () => 1, () => {});
  assert.deepEqual(a, b);
  assert.ok(a.points.some((p) => Math.abs(p.y) > 0.05));
});
