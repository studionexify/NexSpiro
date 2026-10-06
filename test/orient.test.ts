import { test } from "node:test";
import assert from "node:assert/strict";
import { transformMeshBy, rotationBetween, layFlatRotation, autoOrientRotation, orientationCost, splitComponents, clipMeshZ, mirrorMesh, rotationAxis, bounds, type Mesh } from "../src/core/index.ts";

function box(w: number, d: number, h: number, ox = 0): Mesh {
  const v = (x: number, y: number, z: number): [number, number, number] => [x * w + ox, y * d, z * h];
  const q = (a: number[], b: number[], c: number[], e: number[]) => [...a, ...b, ...c, ...a, ...c, ...e];
  const p000 = v(0, 0, 0), p100 = v(1, 0, 0), p110 = v(1, 1, 0), p010 = v(0, 1, 0), p001 = v(0, 0, 1), p101 = v(1, 0, 1), p111 = v(1, 1, 1), p011 = v(0, 1, 1);
  return { name: "box", tris: new Float32Array([...q(p000, p010, p110, p100), ...q(p001, p101, p111, p011), ...q(p000, p100, p101, p001), ...q(p100, p110, p111, p101), ...q(p110, p010, p011, p111), ...q(p010, p000, p001, p011)]) };
}
test("rotationBetween maps one vector onto another", () => {
  const R = rotationBetween([0, 0, 1], [1, 0, 0]);
  assert.ok(Math.abs(R[0] * 0 + R[1] * 0 + R[2] * 1 - 1) < 1e-9 && Math.abs(R[8]) < 1e-9);
  const flip = rotationBetween([0, 0, 1], [0, 0, -1]); assert.ok(Math.abs(flip[8] + 1) < 1e-9);
});
test("lay flat: a tall box tipped on its side rests on its largest-contact face and stays on z = 0", () => {
  const m = box(10, 10, 40), tipped = transformMeshBy(m, rotationAxis("x", 90)), b = bounds(tipped.tris);
  assert.ok(Math.abs(b.min[2]) < 1e-6 && Math.abs(b.min[0] + b.max[0]) < 1e-6);
  const flat = transformMeshBy(m, layFlatRotation([1, 0, 0])); assert.ok(Math.abs(bounds(flat.tris).max[2] - 10) < 1e-4);
});
test("auto-orient prefers the wide base of a plate-like part over standing it on edge", () => {
  const plate = transformMeshBy(box(60, 40, 5), rotationAxis("y", 90)); // stood on its edge
  const R = autoOrientRotation(plate), oriented = transformMeshBy(plate, R);
  assert.ok(bounds(oriented.tris).max[2] <= 5.01, "lies flat");
  assert.ok(orientationCost(oriented, [1, 0, 0, 0, 1, 0, 0, 0, 1]).cost < orientationCost(plate, [1, 0, 0, 0, 1, 0, 0, 0, 1]).cost);
});
test("split separates disconnected shells", () => {
  const a = box(10, 10, 10), b = box(10, 10, 10, 40), tris = new Float32Array([...a.tris, ...b.tris]);
  const parts = splitComponents({ name: "two", tris });
  assert.equal(parts.length, 2); assert.equal(parts[0].tris.length, a.tris.length);
});
test("clip at a height splits triangles and keeps the area balance", () => {
  const { above, below, edges } = clipMeshZ(box(10, 10, 20), 8);
  const bA = bounds(above), bB = bounds(below);
  assert.ok(Math.abs(bA.min[2] - 8) < 1e-5 && Math.abs(bA.max[2] - 20) < 1e-5 && Math.abs(bB.max[2] - 8) < 1e-5 && Math.abs(bB.min[2]) < 1e-5);
  assert.ok(edges.length >= 16, "cut outline recorded");
});
test("mirror keeps outward-facing winding (positive volume)", () => {
  const vol = (t: Float32Array) => { let v = 0; for (let i = 0; i < t.length; i += 9) v += (t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) - t[i + 1] * (t[i + 3] * t[i + 8] - t[i + 5] * t[i + 6]) + t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6])) / 6; return v; };
  const m = box(10, 20, 30); assert.ok(vol(m.tris) > 0); assert.ok(Math.abs(vol(mirrorMesh(m, "x").tris) - vol(m.tris)) < 1e-3);
});

import { cutMesh } from "../src/io/cut.ts";
test("cut closes both halves with caps (watertight volume adds up)", () => {
  const vol = (t: Float32Array) => { let v = 0; for (let i = 0; i < t.length; i += 9) v += (t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) - t[i + 1] * (t[i + 3] * t[i + 8] - t[i + 5] * t[i + 6]) + t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6])) / 6; return v; };
  const m = box(10, 10, 20), r = cutMesh(m, 8);
  assert.ok(r.upper && r.lower);
  assert.ok(Math.abs(vol(r.lower!.tris) - 800) < 1, `lower ${vol(r.lower!.tris)}`); assert.ok(Math.abs(vol(r.upper!.tris) - 1200) < 1, `upper ${vol(r.upper!.tris)}`);
  assert.ok(Math.abs(bounds(r.upper!.tris).min[2]) < 1e-5);
  assert.equal(cutMesh(m, 25).upper, null);
});

import { extrudePolygons } from "../src/io/textMesh.ts";
test("extrude polygons: a square ring (outer + hole) has the right volume and is watertight-oriented", () => {
  const outer: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]], hole: [number, number][] = [[3, 3], [3, 7], [7, 7], [7, 3]];
  const m = extrudePolygons([{ outer, holes: [hole] }], 2, "ring");
  let v = 0; const t = m.tris; for (let i = 0; i < t.length; i += 9) v += (t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) - t[i + 1] * (t[i + 3] * t[i + 8] - t[i + 5] * t[i + 6]) + t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6])) / 6;
  assert.ok(Math.abs(v - (100 - 16) * 2) < 1e-3, `volume ${v}`);
});
