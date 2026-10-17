import { test } from "vitest";
import assert from "node:assert/strict";
import { applyBrushToPath, brushAt, resample, DEFAULT_OPTIONS } from "../../src/plugins/motionex/modifier";
import { PRESETS } from "../../src/plugins/motionex/presets";
import type { Toolpath } from "../../src/plugins/motionex/core/types";
import { profiles } from "./helpers";

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

import { layerPhase, applyMotion } from "../../src/plugins/motionex/modifier";
import type { MotionBrush } from "../../src/plugins/motionex/model";

test("layer effects: twist, swap, shift-and-back and on/off bands", () => {
  const withL = (layers: MotionBrush["layers"]) => ({ ...sine, layers });
  assert.deepEqual([0, 1, 2, 3].map((l) => layerPhase(withL({ shift_deg: 10, mode: "steady", every: 1, band_on: 0, band_off: 0 }), l)), [0, 10, 20, 30]);
  assert.deepEqual([0, 1, 2, 3, 4].map((l) => layerPhase(withL({ shift_deg: 180, mode: "alternate", every: 2, band_on: 0, band_off: 0 }), l)), [0, 0, 180, 180, 0]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((l) => layerPhase(withL({ shift_deg: 5, mode: "back_and_forth", every: 3, band_on: 0, band_off: 0 }), l)), [0, 5, 10, 15, 10, 5, 0]);
  assert.deepEqual([0, 1, 2, 3, 4].map((l) => layerPhase(withL({ shift_deg: 0, mode: "steady", every: 1, band_on: 2, band_off: 1 }), l)), [0, 0, null, 0, 0]);
});

test("size slider scales wave height and length together", () => {
  const p = profiles();
  const mk = () => [{ index: 3, z: 1, height: 0.2, paths: [line(16)] }];
  const run = (scale: number) => applyMotion(mk(), [{ brush_id: "preset-sine", target: { type: "body" as const, walls: "outer" as const }, mask: { z_start: 0, z_end: 99, fade_in_mm: 0, fade_out_mm: 0 }, order: 0, blend: "add" as const, enabled: true, scale }],
    (id) => PRESETS.find((b) => b.id === id), p).layers[0].paths[0].points;
  const big = run(2), normal = run(1);
  const maxY = (pts: { y: number }[]) => Math.max(...pts.map((q) => Math.abs(q.y)));
  assert.ok(Math.abs(maxY(big) - 2 * maxY(normal)) < 0.02);
  // Twice the wave length: the first peak moves from 1 mm to 2 mm along the line.
  assert.ok(Math.abs(Math.abs(big.find((q) => Math.abs(q.x - 2) < 1e-9)!.y) - 1.2) < 0.02);
});

const square = (h: number): Toolpath => ({ feature: "outer_wall", closed: true, points: [
  [0, 0], [h, 0], [h, h], [0, h], [0, 0]].map(([x, y]) => ({ x, y, z: 1, f: 60, flow: 1, e: 0 })) });

test("small loops scale the motion down instead of folding over (pyramid tip)", () => {
  const out = applyBrushToPath(square(2), { ...sine, amplitude: 1, period_mm: 1 }, profiles(), DEFAULT_OPTIONS, () => 1, () => {});
  const base = resample(square(2).points, DEFAULT_OPTIONS.resampleStep);
  const worst = Math.max(...out.points.map((p, i) => Math.hypot(p.x - base[i].x, p.y - base[i].y)));
  assert.ok(worst <= 0.3 * 1 + 1e-6, `offset ${worst} exceeds 30% of the 1 mm inradius`);
});

test("offsets turn smoothly through sharp corners: no segment runs backwards", () => {
  const out = applyBrushToPath(square(40), { ...sine, amplitude: 0.6, period_mm: 2 }, profiles(), DEFAULT_OPTIONS, () => 1, () => {});
  const base = resample(square(40).points, DEFAULT_OPTIONS.resampleStep);
  for (let i = 1; i < out.points.length; i++) {
    const a = out.points[i - 1], b = out.points[i], bx = base[i].x - base[i - 1].x, by = base[i].y - base[i - 1].y;
    if (Math.hypot(bx, by) < 1e-9) continue;
    assert.ok((b.x - a.x) * bx + (b.y - a.y) * by > -1e-9, `backwards move at ${i}`);
  }
});

test("teeth slow into their corners and speed up within the printer's acceleration", () => {
  const teeth = structuredClone(PRESETS.find((b) => /square/i.test(b.name)) ?? sine);
  const out = applyBrushToPath(line(20), { ...teeth, amplitude: 0.5, period_mm: 2 }, profiles(), DEFAULT_OPTIONS, () => 1, () => {});
  const acc = profiles().machine.maxAccel.x;
  for (let i = 2; i < out.points.length; i++) {
    const a = out.points[i - 1], b = out.points[i], l = Math.hypot(b.x - a.x, b.y - a.y);
    assert.ok(b.f ** 2 <= a.f ** 2 + 2 * acc * l + 1, `speed jump at ${i}`);
  }
});
