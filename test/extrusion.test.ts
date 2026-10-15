import { test } from "node:test";
import assert from "node:assert/strict";
import { filamentForBead, computeExtrusion } from "../src/core/extrusion.ts";
import type { Layer } from "../src/core/types.ts";
import { profiles } from "./helpers.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("E for a 10 mm bead matches the hand calculation", () => {
  // w=0.45, h=0.2: area = (0.45-0.2)·0.2 + π·0.1² = 0.05 + 0.0314159265 = 0.0814159265 mm²
  // filament area = π·0.875² = 2.4052818754 mm²  →  E = 10·0.0814159265/2.4052818754 = 0.33848809
  near(filamentForBead(10, 0.45, 0.2, 1, 1.75), 0.33848809, 1e-7);
  near(filamentForBead(10, 0.45, 0.2, 1.5, 1.75), 0.33848809 * 1.5, 1e-7);
});

test("E uses true 3D length, not XY length", () => {
  const p = profiles();
  const layer: Layer = { index: 1, z: 0.4, height: 0.2, paths: [{ feature: "outer_wall", closed: false, points: [
    { x: 0, y: 0, z: 0.4, f: 10, flow: 1, e: 0 }, { x: 3, y: 4, z: 0.4, f: 10, flow: 1, e: 0 }, // 5 mm flat
    { x: 3, y: 4, z: 0.4 + 12, f: 10, flow: 1, e: 0 },                                       // 12 mm vertical
  ] }] };
  computeExtrusion([layer], p);
  near(layer.paths[0].points[1].e, filamentForBead(5, 0.45, 0.2, 1, 1.75));
  near(layer.paths[0].points[2].e, filamentForBead(12, 0.45, 0.2, 1, 1.75));
});

test("volumetric cap slows moves instead of under-extruding", () => {
  const p = profiles(); // cap = min(24, 21) = 21 mm³/s
  const layer: Layer = { index: 1, z: 0.4, height: 0.2, paths: [{ feature: "outer_wall", closed: false, points: [
    { x: 0, y: 0, z: 0.4, f: 400, flow: 1, e: 0 }, { x: 50, y: 0, z: 0.4, f: 400, flow: 1, e: 0 }] }] };
  const w = computeExtrusion([layer], p);
  near(layer.paths[0].points[1].f, 21 / 0.0814159265, 1e-6);
  assert.equal(w[0].code, "flow_cap");
});
