import { test } from "node:test";
import assert from "node:assert/strict";
import { materialOf, statusBadge, slicingKind, pct, rangeRow, rampGradient, slug, esc } from "../src/app/components.ts";
import { ICON_NAMES, icon } from "../src/app/icons.ts";
import { PALETTE_3D, REGION_COLORS, hex } from "../src/app/theme/theme.ts";

test("materialOf recognises common filament families", () => {
  assert.equal(materialOf("Generic PETG"), "PETG");
  assert.equal(materialOf("Matte PLA"), "PLA");
  assert.equal(materialOf("Bambu TPU 95A"), "TPU");
  assert.equal(materialOf("Mystery spool"), "Custom");
});
test("statusBadge reflects the slicing lifecycle", () => {
  assert.equal(statusBadge("idle", false, []).text, "Draft");
  assert.equal(statusBadge("slicing", false, []).text, "Slicing…");
  assert.equal(statusBadge("done", false, []).text, "Draft"); // stale result
  assert.deepEqual(statusBadge("done", true, []), { text: "Ready", tone: "sage" });
  assert.equal(statusBadge("done", true, [{ level: "warn" }]).tone, "amber");
  assert.equal(statusBadge("done", true, [{ level: "error" }]).tone, "coral");
  assert.equal(statusBadge("error", false, []).text, "Error");
});
test("slicingKind distinguishes planar from non-linear plates", () => {
  assert.equal(slicingKind(undefined), "none");
  assert.equal(slicingKind(0), "planar");
  assert.equal(slicingKind(12.5), "nonlinear");
});
test("pct clamps and rangeRow embeds the fill position", () => {
  assert.equal(pct(5, 0, 10), 50);
  assert.equal(pct(-3, 0, 10), 0);
  assert.equal(pct(30, 0, 10), 100);
  assert.equal(pct(1, 1, 1), 0);
  assert.match(rangeRow("Tilt", 'data-in="x"', 25, 0, 100, 1, { unit: "°" }), /--p:25\.0%/);
});
test("helpers: gradient, slug, escaping", () => {
  assert.match(rampGradient(70, 50, 4), /^linear-gradient\(90deg, hsl\(240 70% 50%\).*hsl\(0 70% 50%\)\)$/);
  assert.equal(slug("  My <vase> v2! "), "My_vase_v2");
  assert.equal(slug("***"), "project");
  assert.equal(esc('<a "b">'), "&lt;a &quot;b&quot;&gt;");
});
test("every dock/UI icon used exists and renders", () => {
  for (const n of ["select", "move", "rotate", "scale", "layflat", "cut", "texture", "paint", "erase", "text", "arrange", "support", "seam", "planar", "nonlinear", "printer", "spool", "cube", "cylinder", "play", "pause", "export", "sun", "moon"])
    assert.ok(ICON_NAMES.includes(n), n);
  assert.match(icon("move"), /<svg[^>]*viewBox="0 0 24 24"/);
});
test("3D palettes cover both themes with the accent region colours", () => {
  assert.deepEqual(Object.keys(PALETTE_3D.light).sort(), Object.keys(PALETTE_3D.dark).sort());
  assert.equal(hex(REGION_COLORS[0]), "#7ea8be");
  assert.equal(REGION_COLORS.length, 7);
});

import { primitiveDefs, buildPrimitive, primitiveDefaults, profileBody, buildSpiral, roundCorners, type PrimitiveName } from "../src/core/index.ts";
test("every primitive builds a printable single-wall body at defaults and at param extremes", () => {
  const names = Object.keys(primitiveDefs) as PrimitiveName[];
  assert.ok(names.length >= 35, `expected a rich catalogue, got ${names.length}`);
  for (const n of names) {
    const def = primitiveDefs[n] as (typeof primitiveDefs)[PrimitiveName];
    for (const params of [primitiveDefaults(n), Object.fromEntries(def.params.map((p) => [p.key, p.min])), Object.fromEntries(def.params.map((p) => [p.key, p.max]))]) {
      const body = profileBody(buildPrimitive(n, params));
      assert.ok(body.height > 0 && body.footprintRadius > 0, `${n}: bad extents`);
      for (const t of [0.001, 0.25, 0.5, 0.75, 0.999]) {
        const ring = body.ring(t * body.height, 64);
        assert.ok(ring && ring.x.every(Number.isFinite) && ring.nx.every(Number.isFinite), `${n}: bad ring at t=${t}`);
        assert.ok(Math.max(...ring.x.map((x, i) => Math.hypot(x, ring.y[i]))) <= body.footprintRadius * 1.02 + 0.5, `${n}: ring exceeds footprint`);
      }
    }
  }
});
test("prism primitives are really polygonal and slice end-to-end", () => {
  const cube = profileBody(buildPrimitive("cube", { s: 40, r: 0 }));
  const ring = cube.ring(10, 400);
  assert.ok(ring);
  const xs = Array.from(ring.x), ys = Array.from(ring.y);
  assert.ok(Math.abs(Math.max(...xs) - 20) < 0.5 && Math.abs(Math.min(...ys) + 20) < 0.5, "cube spans ±20");
  const tp = buildSpiral(cube, { layerHeight: 0.4, lineWidth: 0.8, filamentDiameter: 1.75, segmentsPerRev: 360, pattern: "none", fadeHeight: 0, center: [0, 0] });
  assert.ok(tp.count > 360 && Number.isFinite(tp.e[tp.count - 1]));
  assert.equal(roundCorners([0, 0, 10, 0, 10, 10, 0, 10], 0).length, 8);
  assert.ok(roundCorners([0, 0, 10, 0, 10, 10, 0, 10], 3).length > 8);
});

import { buildSelMesh, fillFaces, pickEdge, trianglesNearSegments, createMask, addRegion } from "../src/core/index.ts";
import { profileMesh } from "../src/io/exporters/mesh.ts";
import { surfaceProjector, paintTriangles } from "../src/io/paintmap.ts";
test("face fill selects one cube face; smooth fill wraps a cylinder wall; single is one triangle", () => {
  const cube = buildSelMesh(profileMesh(buildPrimitive("cube", { s: 40, r: 0 })));
  assert.equal(cube.count, 4 * 2 + 2 * 4, "4 sides ×2 + caps (4 fan tris each)");
  // find a triangle on the +X side
  const side = [...Array(cube.count).keys()].find((f) => cube.normal[f * 3] > 0.99)!;
  const face = fillFaces(cube, side, "flat", 20);
  assert.equal(face.length, 2, "a flat cube face is two triangles");
  assert.ok(face.every((f) => cube.normal[f * 3] > 0.99));
  assert.equal(fillFaces(cube, side, "single", 20).length, 1);
  const cyl = buildSelMesh(profileMesh(buildPrimitive("cylinder", { h: 30, r: 20 })));
  const w = [...Array(cyl.count).keys()].find((f) => Math.abs(cyl.normal[f * 3 + 2]) < 0.1)!;
  const wall = fillFaces(cyl, w, "smooth", 20);
  assert.ok(wall.length >= 96 * 2 * 0.9 && wall.every((f) => Math.abs(cyl.normal[f * 3 + 2]) < 0.1), "smooth fill stays on the wall");
});
test("edge pick finds a single cube edge and a whole cylinder rim", () => {
  const cube = buildSelMesh(profileMesh(buildPrimitive("cube", { s: 40, r: 0 })));
  const near = [...Array(cube.count).keys()].find((f) => cube.normal[f * 3] > 0.99)!;
  const e = pickEdge(cube, near, [20, 0, 40], 35, 4, true);
  assert.ok(e && e.length === 1, `top-right cube edge is one segment (got ${e?.length})`);
  assert.ok(Math.abs(e![0][2] - 40) < 1e-3 && Math.abs(e![0][5] - 40) < 1e-3, "edge lies on the top face");
  assert.equal(pickEdge(cube, near, [0, 0, 20], 35, 4, true), null, "centre of a face has no edge nearby");
  const cyl = buildSelMesh(profileMesh(buildPrimitive("cylinder", { h: 30, r: 20 })));
  const w = [...Array(cyl.count).keys()].find((f) => Math.abs(cyl.normal[f * 3 + 2]) < 0.1 && Math.max(cyl.tris[f * 9 + 2], cyl.tris[f * 9 + 5], cyl.tris[f * 9 + 8]) > 29.9)!;
  const rim = pickEdge(cyl, w, [cyl.tris[w * 9], cyl.tris[w * 9 + 1], 30], 35, 3, true)!;
  assert.ok(rim.length >= 90, `rim should loop around (got ${rim.length})`);
  const band = trianglesNearSegments(cyl, rim, 2);
  assert.ok(band.length > 90);
});
test("painting selected faces writes only wall cells that face the selection", () => {
  const prof = buildPrimitive("cube", { s: 40, r: 0 }), body = profileBody(prof), mesh = profileMesh(prof), sel = buildSelMesh(mesh);
  const mask = createMask(128, 64), reg = addRegion(mask, "knit");
  const side = [...Array(sel.count).keys()].find((f) => sel.normal[f * 3] > 0.99)!;
  const used = paintTriangles(mesh.tris, fillFaces(sel, side, "flat", 20), surfaceProjector(body), mask, reg, { height: body.height, radius: body.footprintRadius });
  assert.ok(used > 50);
  const w = mask.regions[reg].weight; let painted = 0, other = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) if (w[y * 128 + x] > 0) { painted++; const u = x / 128; if (u > 0.3 && u < 0.7) other++; }
  assert.ok(painted > 0 && painted < 128 * 64 * 0.5, `painted ${painted}`);
  assert.equal(other, 0, "the opposite half of the wall stays untouched");
});
