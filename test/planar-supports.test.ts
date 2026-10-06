import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSupports } from "../src/core/planar/supports.ts";
import type { SupportInput } from "../src/core/planar/supports.ts";
import * as G from "../src/core/planar/supports-geom.ts";
import type { ExPoly } from "../src/core/planar/types.ts";
import type { SettingMap } from "../src/core/settings.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): ExPoly => ({ outer: Float64Array.of(x0, y0, x1, y0, x1, y1, x0, y1), holes: [] });
const H = 0.2;
const zs = (n: number) => Array.from({ length: n }, (_, i) => +(H * (i + 1)).toFixed(6));
const hs = (n: number) => new Array(n).fill(H);
const SET: SettingMap = {
  enable_support: true, support_type: "normal(auto)", support_style: "default", support_threshold_angle: 30, support_on_build_plate_only: false,
  support_remove_small_overhang: true, raft_layers: 0, raft_expansion: 1.5, support_top_z_distance: 0.2, support_bottom_z_distance: 0.2,
  support_object_xy_distance: 0.35, support_object_first_layer_gap: 0.2, support_expansion: 0, support_interface_top_layers: 2,
  support_interface_bottom_layers: 0, tree_support_branch_distance: 5, tree_support_branch_diameter: 5, tree_support_branch_angle: 40,
  tree_support_tip_diameter: 0.8, tree_support_wall_count: 0,
};
function mk(outlines: ExPoly[][], over: SettingMap = {}, extra: Partial<SupportInput> = {}): SupportInput {
  const n = outlines.length;
  return { layerZ: zs(n), layerHeights: hs(n), outlines, settings: { ...SET, ...over }, nozzle: 0.4, lineWidth: 0.42, ...extra };
}
const all = (l: { base: ExPoly[]; topInterface: ExPoly[]; bottomInterface: ExPoly[] }) => G.unionAll([G.toPaths(l.base), G.toPaths(l.topInterface), G.toPaths(l.bottomInterface)]);
const bbox = (p: ExPoly[]) => G.bounds(G.toPaths(p));
const areaOf = (p: ExPoly[]) => G.area(G.unionAll([G.toPaths(p)]));

// 20 mm cube (x -10..10, 10 mm = 50 layers) with a 5-layer plate reaching to x=20.
function cantilever(): ExPoly[][] {
  const out: ExPoly[][] = [];
  for (let i = 0; i < 55; i++) out.push([i < 50 ? rect(-10, -10, 10, 10) : rect(-10, -10, 20, 10)]);
  return out;
}

test("cantilever plate: support reaches the plate with correct z and xy gaps", () => {
  const o = cantilever(); const inp = mk(o);
  const r = generateSupports(inp);
  assert.equal(r.layers.length, 55);
  assert.equal(r.raftLayers.length, 0);
  // plate bottom is layer 50 (z 10.0); support top must be layer 48 (z 9.8) -> gap 0.2
  let top = -1; for (let i = 0; i < 55; i++) if (all(r.layers[i]).length) top = i;
  assert.equal(top, 48);
  assert.ok(Math.abs((inp.layerZ[50] - H) - inp.layerZ[top] - 0.2) < 1e-6);
  for (let i = 0; i <= 48; i++) assert.ok(all(r.layers[i]).length > 0, `layer ${i} has support`);
  // xy gap: layer 0 uses the first-layer gap (0.2), the rest 0.35
  const strip = G.toPaths([rect(-30, -9, 30, 9)]); // beside the cube's +x wall (the support also wraps the y sides)
  const b0 = G.bounds(G.inter(all(r.layers[0]), strip))!; assert.ok(b0[0] >= 10.2 - 0.002 && b0[0] < 10.4, `layer0 minX ${b0[0]}`);
  const b10 = G.bounds(G.inter(all(r.layers[10]), strip))!; assert.ok(b10[0] >= 10.35 - 0.002 && b10[0] < 10.4, `layer10 minX ${b10[0]}`);
  assert.ok(b10[2] >= 20, "support covers the whole overhang");
  // roof: two top interface layers directly under the gap
  assert.ok(r.layers[48].topInterface.length > 0 && r.layers[47].topInterface.length > 0);
  assert.equal(r.layers[46].topInterface.length, 0);
  assert.equal(r.layers[0].bottomInterface.length, 0);
  // never overlaps the model
  for (let i = 0; i < 55; i++) assert.ok(G.area(G.inter(all(r.layers[i]), G.toPaths(o[i]))) < 1e-6);
});

test("every support area is supported from below (monotone connected)", () => {
  const o = cantilever(); const r = generateSupports(mk(o));
  for (let i = 1; i < 55; i++) {
    const cur = all(r.layers[i]); if (!cur.length) continue;
    const below = G.union(all(r.layers[i - 1]), i - 2 >= 0 ? G.toPaths(o[i - 2]) : []);
    const unsup = G.area(G.diff(cur, G.offset(below, 0.37)));
    assert.ok(unsup < 1e-3, `layer ${i}: ${unsup} mm2 unsupported`);
  }
});

test("T shape: two support islands at the arms, none under walls steeper than the threshold", () => {
  const o: ExPoly[][] = [];
  for (let i = 0; i < 60; i++) o.push([i < 55 ? rect(-3, -3, 3, 3) : rect(-15, -3, 15, 3)]);
  const r = generateSupports(mk(o));
  assert.equal(r.layers[10].base.length, 2);
  const b = G.bounds(all(r.layers[10]))!; assert.ok(Math.abs(b[0] + b[2]) < 0.01, "symmetric");
  // plain cube: vertical walls -> nothing
  const cube = generateSupports(mk(Array.from({ length: 40 }, () => [rect(-10, -10, 10, 10)])));
  for (const l of cube.layers) assert.equal(l.base.length + l.topInterface.length + l.bottomInterface.length, 0);
});

test("slope below the threshold needs no support, above it does", () => {
  const pyr = (g: number) => Array.from({ length: 40 }, (_, i) => [rect(-(5 + g * i), -(5 + g * i), 5 + g * i, 5 + g * i)]);
  const gentle = generateSupports(mk(pyr(Math.tan((20 * Math.PI) / 180) * H)));
  assert.equal(gentle.layers.filter((l) => l.base.length).length, 0);
  const steep = generateSupports(mk(pyr(Math.tan((45 * Math.PI) / 180) * H)));
  assert.ok(steep.layers[0].base.length > 0, "45deg overhang is supported down to the plate");
  assert.ok(steep.layers[0].base.length > 0 && areaOf(steep.layers[0].base) > 5);
  // threshold 0 means auto = 30deg: same as explicit 30; raising the threshold above 45 removes the support
  const auto = generateSupports(mk(pyr(Math.tan((45 * Math.PI) / 180) * H), { support_threshold_angle: 0 }));
  assert.equal(auto.layers.filter((l) => l.base.length).length, steep.layers.filter((l) => l.base.length).length);
  const lax = generateSupports(mk(pyr(Math.tan((45 * Math.PI) / 180) * H), { support_threshold_angle: 60 }));
  assert.equal(lax.layers.filter((l) => l.base.length).length, 0);
});

// pedestal (half 6, layers 0..24) topped by a pyramid widening at 45deg from half 4.
function pedestalCone(): ExPoly[][] {
  const o: ExPoly[][] = [];
  for (let i = 0; i < 85; i++) o.push([i < 25 ? rect(-6, -6, 6, 6) : (() => { const w = 4 + 0.2 * (i - 25); return rect(-w, -w, w, w); })()]);
  return o;
}
test("cone over a pedestal: with and without build-plate-only", () => {
  const o = pedestalCone();
  const ped = G.toPaths([rect(-6, -6, 6, 6)]);
  const rest = generateSupports(mk(o, { support_on_build_plate_only: false, support_interface_bottom_layers: 2 }));
  assert.ok(G.area(G.inter(all(rest.layers[30]), ped)) > 0.1, "support rests on the pedestal top");
  assert.ok(rest.layers[26].bottomInterface.length > 0, "floor interface above the model surface");
  assert.equal(G.area(G.inter(all(rest.layers[25]), ped)), 0);
  const plate = generateSupports(mk(o, { support_on_build_plate_only: true }));
  for (let i = 0; i < 85; i++) assert.ok(G.area(G.inter(all(plate.layers[i]), ped)) < 0.01, `layer ${i} keeps off the pedestal`);
  assert.ok(plate.layers[0].base.length > 0 && plate.layers[0].base.length <= rest.layers[0].base.length + 5);
  assert.ok(G.area(G.inter(all(plate.layers[30]), ped)) < G.area(G.inter(all(rest.layers[30]), ped)));
  // supported from below, also when resting on the model
  for (const r of [rest, plate]) for (let i = 1; i < 85; i++) {
    const cur = all(r.layers[i]); if (!cur.length) continue;
    const jj = i - 2; const below = G.union(all(r.layers[i - 1]), jj >= 0 ? G.toPaths(o[jj]) : []);
    assert.ok(G.area(G.diff(cur, G.offset(below, 0.37))) < 1e-3, `layer ${i}`);
  }
});

test("tree support reaches the plate and keeps away from the model", () => {
  const o = cantilever();
  const r = generateSupports(mk(o, { support_type: "tree(auto)", support_style: "tree_hybrid" }));
  for (let i = 0; i <= 48; i++) assert.ok(r.layers[i].base.length + r.layers[i].topInterface.length > 0, `tree present on layer ${i}`);
  assert.ok(r.layers[48].topInterface.length > 0, "roof at the contact");
  assert.equal(r.layers[49].base.length + r.layers[49].topInterface.length, 0, "z gap");
  assert.ok(r.layers[0].base.length > 0);
  for (let i = 0; i < 55; i++) assert.ok(G.area(G.inter(all(r.layers[i]), G.offset(G.toPaths(o[i]), 0.3))) < 1e-3, `layer ${i} clear of the model`);
  // branches converge: fewer islands at the bottom than at the top
  assert.ok(r.layers[0].base.length <= r.layers[44].base.length + 1);
});

test("tree support: plate-only steers around a pedestal, otherwise it may rest on it", () => {
  const o: ExPoly[][] = [];
  for (let i = 0; i < 50; i++) o.push([i < 25 ? rect(-6, -6, 6, 6) : i < 40 ? rect(-3, -3, 3, 3) : rect(-12, -12, 12, 12)]);
  const ped = G.toPaths([rect(-6, -6, 6, 6)]);
  const plate = generateSupports(mk(o, { support_type: "tree(auto)", support_on_build_plate_only: true }));
  for (let i = 0; i <= 26; i++) assert.ok(G.area(G.inter(all(plate.layers[i]), ped)) < 1e-3, `layer ${i}`);
  assert.ok(plate.warnings.length > 0, "branches that cannot escape are reported");
  assert.ok(plate.layers[0].base.length > 0);
  const rest = generateSupports(mk(o, { support_type: "tree(auto)", support_on_build_plate_only: false }));
  assert.ok(G.area(G.inter(all(rest.layers[30]), ped)) > 0.05);
});

test("enforcers and blockers", () => {
  const o = cantilever();
  const zone = (z0: number, z1: number) => Array.from({ length: 55 }, (_, i) => (i >= z0 && i <= z1 ? [rect(9, -11, 21, 11)] : []));
  // blocker over the whole column removes the support
  const blocked = generateSupports(mk(o, {}, { blockers: zone(0, 54) }));
  for (const l of blocked.layers) assert.equal(l.base.length + l.topInterface.length, 0);
  // blocker on the lower half only: support survives above
  const half = generateSupports(mk(o, {}, { blockers: o.map(() => [rect(15, -11, 21, 11)]) }));
  const hb = G.bounds(all(half.layers[10]))!;
  assert.ok(hb[2] <= 15.01 && hb[2] > 14, `blocked half removed (maxX ${hb[2]})`);
  // a blocker in the lower half leaves nothing floating above it
  const low = generateSupports(mk(o, {}, { blockers: zone(0, 20) }));
  assert.equal(low.layers[40].base.length, 0);
  // manual: nothing without enforcers, support with them
  const none = generateSupports(mk(o, { support_type: "normal(manual)" }));
  for (const l of none.layers) assert.equal(l.base.length + l.topInterface.length, 0);
  const enf = generateSupports(mk(o, { support_type: "normal(manual)" }, { enforcers: zone(0, 54) }));
  assert.ok(enf.layers[0].base.length > 0 && enf.layers[48].topInterface.length > 0);
  // an enforcer adds support for a shallow overhang that auto ignores (15deg < 30deg threshold)
  const shallow = Array.from({ length: 40 }, (_, i) => [rect(-5 - Math.tan((15 * Math.PI) / 180) * H * i, -5, 5, 5)]);
  assert.equal(generateSupports(mk(shallow)).layers.filter((l) => l.base.length).length, 0);
  const sEnf = generateSupports(mk(shallow, {}, { enforcers: shallow.map(() => [rect(-20, -20, 20, 20)]) }));
  assert.ok(sEnf.layers[0].base.length > 0);
});

test("raft layers", () => {
  const cube = Array.from({ length: 10 }, () => [rect(-10, -10, 10, 10)]);
  const r = generateSupports(mk(cube, { raft_layers: 3, raft_expansion: 1.5, enable_support: false }));
  assert.equal(r.raftLayers.length, 3);
  const b = bbox(r.raftLayers[0])!; assert.ok(Math.abs(b[0] + 11.5) < 0.01 && Math.abs(b[2] - 11.5) < 0.01);
  assert.ok(areaOf(r.raftLayers[2]) > 22.9 * 22.9 - 5);
  assert.equal(generateSupports(mk(cube)).raftLayers.length, 0);
  const sup = generateSupports(mk(cantilever(), { raft_layers: 2 }));
  assert.ok(bbox(sup.raftLayers[0])![2] > 20, "raft extends under the support");
});

test("snug vs grid style and expansion", () => {
  const o = cantilever();
  const snug = generateSupports(mk(o, { support_style: "snug" }));
  const grid = generateSupports(mk(o, { support_style: "grid" }));
  assert.ok(areaOf(snug.layers[10].base) < areaOf(grid.layers[10].base));
  const exp = generateSupports(mk(o, { support_style: "snug", support_expansion: 2 }));
  assert.ok(areaOf(exp.layers[10].base) > areaOf(snug.layers[10].base));
});

test("never throws on odd input", () => {
  assert.doesNotThrow(() => generateSupports(mk([])));
  assert.doesNotThrow(() => generateSupports({ layerZ: [], layerHeights: [], outlines: [[], []], settings: {}, nozzle: 0, lineWidth: 0 }));
  const r = generateSupports({ layerZ: [NaN], layerHeights: [], outlines: [[rect(0, 0, 1, 1)], [{ outer: new Float64Array(2), holes: [] }]], settings: { enable_support: true, support_threshold_angle: "x" }, nozzle: NaN, lineWidth: -1 });
  assert.equal(r.layers.length, 2);
  const bad = generateSupports(mk([[rect(0, 0, 5, 5)], [rect(0, 0, 5, 5)]], { support_type: "tree(auto)" }, { enforcers: [[], [rect(-1, -1, 1, 1)]] }));
  assert.equal(bad.layers.length, 2);
});

test("performance: 100 mm / 500 layers", () => {
  const n = 500; const o: ExPoly[][] = [];
  for (let i = 0; i < n; i++) o.push([i < 480 ? rect(-10, -10, 10, 10) : rect(-10, -10, 20, 10)]);
  for (const type of ["normal(auto)", "tree(auto)"]) {
    const t0 = performance.now(); const r = generateSupports(mk(o, { support_type: type })); const dt = performance.now() - t0;
    assert.ok(r.layers[0].base.length > 0);
    assert.ok(dt < 8000, `${type} took ${dt.toFixed(0)} ms`);
  }
});
