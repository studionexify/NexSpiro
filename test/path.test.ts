import { test } from "node:test";
import assert from "node:assert/strict";
import { primitives, buildSpiral, toGcode, patterns } from "../src/core/index.ts";

const base = { layerHeight: 0.4, lineWidth: 0.8, filamentDiameter: 1.75, segmentsPerRev: 360, fadeHeight: 0, center: [0, 0] as [number, number] };

test("plain cylinder spiral: monotonic Z, correct radius and extrusion volume", () => {
  const tp = buildSpiral(primitives.cylinder(10, 20), { ...base, pattern: "none" });
  for (let i = 1; i < tp.count; i++) assert.ok(tp.xyz[i * 3 + 2] >= tp.xyz[(i - 1) * 3 + 2]);
  assert.ok(Math.abs(Math.hypot(tp.xyz[0], tp.xyz[1]) - 20) < 1e-3);
  const layers = 25, pathLen = layers * 2 * Math.PI * 20;
  const expected = (pathLen * 0.8 * 0.4) / (Math.PI * 0.875 ** 2);
  assert.ok(Math.abs(tp.e[tp.count - 1] - expected) / expected < 0.01);
});

test("every pattern produces finite, continuous paths", () => {
  for (const name of Object.keys(patterns)) {
    const tp = buildSpiral(primitives.bowl(), { ...base, pattern: name });
    for (let i = 1; i < tp.count; i++) {
      const d = Math.hypot(tp.xyz[i*3]-tp.xyz[i*3-3], tp.xyz[i*3+1]-tp.xyz[i*3-2], tp.xyz[i*3+2]-tp.xyz[i*3-1]);
      assert.ok(Number.isFinite(d) && d < 10, `${name} jump at ${i}`);
    }
  }
});

test("perforated alternates phase 180° between layers", () => {
  const p = patterns.perforated;
  const a = p.fn(0.1, 0, p.defaults).dr, b = p.fn(0.1, 1, p.defaults).dr;
  assert.ok(Math.abs(a + b) < 1e-9);
});

test("gcode flavors emit header and moves", () => {
  const tp = buildSpiral(primitives.cylinder(2, 10), { ...base, pattern: "knit" });
  for (const flavor of ["marlin", "klipper", "bambu"] as const) {
    const g = toGcode(tp, { flavor, nozzleTemp: 210, bedTemp: 60, speed: 20, fan: 1 });
    assert.match(g, /M83/);
    assert.equal(g.split("\n").filter((l) => l.startsWith("G1 X")).length, tp.count - 1);
  }
});
