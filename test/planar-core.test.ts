import { test } from "node:test";
import assert from "node:assert/strict";
import { PresetRegistry, type MachinePreset, type FilamentPreset, type ProcessPreset } from "../src/core/presets.ts";
import { resolveSettings, type SettingMap } from "../src/core/settings.ts";
import { Feature, type Path, type PlanarJob, type PlanarPlan, type SupportResult } from "../src/core/planar/types.ts";
import { planPrint } from "../src/core/planar/plan.ts";
import { sliceMesh } from "../src/core/planar/slice.ts";
import { ringArea, polysArea } from "../src/core/planar/geom.ts";

const reg = new PresetRegistry();
// ---- mesh builders (CCW outward triangles, bed space, min z = 0)
const quad = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const p = (x: number, y: number, z: number) => [x, y, z];
  return [
    ...quad(p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)),  // bottom (-z)
    ...quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)),  // top
    ...quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)),  // -y
    ...quad(p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)),  // +x
    ...quad(p(x1, y1, z0), p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1)),  // +y
    ...quad(p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1)),  // -x
  ];
}
function cylinder(cx: number, cy: number, r: number, z0: number, z1: number, n = 64): number[] {
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    t.push(x0, y0, z0, x1, y1, z0, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y0, z1);
    t.push(cx, cy, z1, x0, y0, z1, x1, y1, z1);
    t.push(cx, cy, z0, x1, y1, z0, x0, y0, z0);
  }
  return t;
}
function torus(R: number, r: number, nu = 48, nv = 16, zc = r): number[] {
  const P = (u: number, v: number) => [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), zc + r * Math.sin(v)];
  const t: number[] = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u0 = (i / nu) * Math.PI * 2, u1 = ((i + 1) / nu) * Math.PI * 2, v0 = (j / nv) * Math.PI * 2, v1 = ((j + 1) / nv) * Math.PI * 2;
    t.push(...P(u0, v0), ...P(u1, v0), ...P(u1, v1), ...P(u0, v0), ...P(u1, v1), ...P(u0, v1));
  }
  return t;
}
/** Box with a square through-hole (inner faces inverted). */
function hollowBox(s: number, hole: number, h: number): number[] {
  const t = box(-s / 2, -s / 2, 0, s / 2, s / 2, h);
  // remove top & bottom, rebuild as frames: simpler: 4 slabs around the hole
  void t;
  const a = s / 2, b = hole / 2;
  return [...box(-a, -a, 0, a, -b, h), ...box(-a, b, 0, a, a, h), ...box(-a, -b, 0, -b, b, h), ...box(b, -b, 0, a, b, h)];
}
const f32 = (a: number[]) => Float32Array.from(a);

type Over = { settings?: SettingMap; machine?: Partial<MachinePreset> };
function job(objects: { name?: string; tris: number[]; settings?: SettingMap; texture?: PlanarJob["objects"][0]["texture"] }[], over: Over = {}): PlanarJob {
  const machine = { ...(reg.resolve<"machine">("machine/bambu-x1") as MachinePreset), ...over.machine };
  const filament = reg.resolve<"filament">("filament/pla") as FilamentPreset;
  const process = reg.resolve<"process">("process/std-0.20") as ProcessPreset;
  const settings = resolveSettings(process, over.settings);
  return {
    machine, filament, process, settings,
    objects: objects.map((o, i) => ({ id: "o" + i, name: o.name ?? "obj" + i, tris: f32(o.tris), settings: resolveSettings(process, { ...over.settings, ...o.settings }), ...(o.texture ? { texture: o.texture } : {}) })),
  };
}
const len = (p: Path) => { let l = 0; const n = p.xyz.length / 3; for (let i = 1; i < n; i++) l += Math.hypot(p.xyz[3 * i] - p.xyz[3 * i - 3], p.xyz[3 * i + 1] - p.xyz[3 * i - 2]); if (p.closed && n > 1) l += Math.hypot(p.xyz[0] - p.xyz[3 * n - 3], p.xyz[1] - p.xyz[3 * n - 2]); return l; };
const area2 = (p: Path) => { const n = p.xyz.length / 3, r = new Float64Array(n * 2); for (let i = 0; i < n; i++) { r[2 * i] = p.xyz[3 * i]; r[2 * i + 1] = p.xyz[3 * i + 1]; } return ringArea(r); };
const featPaths = (plan: PlanarPlan, li: number, f: number) => plan.layers[li].paths.filter((p) => p.feature === f);
const finite = (plan: PlanarPlan) => { for (const l of plan.layers) for (const p of l.paths) { assert.ok(p.xyz.length >= 6, "path has points"); for (const v of p.xyz) assert.ok(Number.isFinite(v)); assert.ok(p.width > 0 && p.height > 0 && p.speed > 0 && Number.isFinite(p.flow)); } };

test("sliceMesh: cube contours", () => {
  const r = sliceMesh(f32(box(-5, -5, 0, 5, 5, 10)), [0.1, 5, 9.9]);
  assert.equal(r.length, 3);
  for (const l of r) { assert.equal(l.length, 1); assert.ok(Math.abs(polysArea(l) - 100) < 0.01); assert.ok(ringArea(l[0].outer) > 0); }
});
test("sliceMesh: hollow box has holes, torus slice has a hole", () => {
  const h = sliceMesh(f32(hollowBox(20, 10, 10)), [5])[0];
  assert.equal(h.length, 1); assert.equal(h[0].holes.length, 1); assert.ok(Math.abs(polysArea(h) - 300) < 0.01);
  assert.ok(ringArea(h[0].holes[0]) < 0);
  const t = sliceMesh(f32(torus(20, 5)), [5])[0];
  assert.equal(t.length, 1); assert.equal(t[0].holes.length, 1);
});
test("sliceMesh: open mesh does not throw and warns", () => {
  const tris = box(-5, -5, 0, 5, 5, 10).slice(18); // drop 2 triangles (bottom face)
  const w: string[] = [];
  const r = sliceMesh(f32(tris), [0.1, 5], { warnings: w });
  assert.equal(r.length, 2);
  assert.ok(r[1].length >= 1);
});

test("cube: layer count, walls, closedness, orientation, shells", () => {
  const plan = planPrint(job([{ tris: box(-10, -10, 0, 10, 10, 20) }], { settings: { sparse_infill_density: 15, sparse_infill_pattern: "grid", top_shell_layers: 4, bottom_shell_layers: 3, top_shell_thickness: 0, brim_type: "no_brim", skirt_loops: 0 } }));
  assert.equal(plan.layers.length, 100);
  assert.equal(plan.sequence, "layer");
  finite(plan);
  const mid = 50;
  const outer = featPaths(plan, mid, Feature.OuterWall), inner = featPaths(plan, mid, Feature.InnerWall);
  assert.equal(outer.length, 1); assert.equal(inner.length, 1);
  assert.ok(outer[0].closed && inner[0].closed);
  assert.ok(area2(outer[0]) > 0, "outer wall CCW");
  assert.ok(Math.abs(Math.abs(area2(outer[0])) - (20 - 0.42) ** 2) < 3);
  assert.ok(Math.abs(plan.layers[99].z - 20) < 1e-6);
  // bottom layers 0..2 solid, 3 sparse
  for (let l = 0; l < 3; l++) assert.ok(plan.layers[l].paths.some((p) => p.feature === Feature.BottomSurface || p.feature === Feature.InternalSolid), "solid bottom " + l);
  assert.ok(featPaths(plan, 0, Feature.BottomSurface).length > 0);
  assert.ok(featPaths(plan, 3, Feature.SparseInfill).length > 0);
  assert.equal(featPaths(plan, 3, Feature.BottomSurface).length, 0);
  // top: 4 layers solid
  assert.ok(featPaths(plan, 99, Feature.TopSurface).length > 0);
  for (let l = 96; l < 100; l++) assert.equal(featPaths(plan, l, Feature.SparseInfill).length, 0, "no sparse in top shell " + l);
  assert.ok(featPaths(plan, 95, Feature.SparseInfill).length > 0);
  assert.ok(featPaths(plan, 97, Feature.InternalSolid).length > 0);
});

test("infill density is close to the request", () => {
  for (const [pat, dens] of [["grid", 20], ["line", 15], ["gyroid", 15], ["honeycomb", 20], ["triangles", 20], ["cubic", 20]] as const) {
    const plan = planPrint(job([{ tris: box(-15, -15, 0, 15, 15, 10) }], { settings: { sparse_infill_density: dens, sparse_infill_pattern: pat, brim_type: "no_brim", skirt_loops: 0 } }));
    const ps = featPaths(plan, 25, Feature.SparseInfill); // layer 25 has sparse
    const L = ps.reduce((s, p) => s + len(p), 0), w = ps[0]?.width ?? 0.45;
    // infill region ≈ inside two walls
    const side = 30 - 2 * (0.42 + 0.45) ; const A = side * side;
    const got = (L * w) / A * 100;
    assert.ok(Math.abs(got - dens) < dens * 0.35, `${pat}: density ${got.toFixed(1)} vs ${dens}`);
  }
});

test("cylinder and torus plan", () => {
  const c = planPrint(job([{ tris: cylinder(0, 0, 10, 0, 6) }], { settings: { brim_type: "no_brim" } }));
  finite(c); assert.equal(c.layers.length, 30);
  assert.ok(featPaths(c, 15, Feature.OuterWall).length === 1);
  const t = planPrint(job([{ tris: torus(20, 5) }]));
  finite(t);
  const mid = t.layers.findIndex((l) => Math.abs(l.z - 5) < 0.11);
  const o = featPaths(t, mid, Feature.OuterWall);
  assert.equal(o.length, 2, "torus mid slice has outer and hole wall");
  assert.ok(o.some((p) => area2(p) < 0) && o.some((p) => area2(p) > 0), "hole wall is clockwise");
});

test("hollow box walls", () => {
  const p = planPrint(job([{ tris: hollowBox(30, 10, 10) }], { settings: { wall_loops: 3, brim_type: "no_brim", skirt_loops: 0 } }));
  finite(p);
  assert.equal(featPaths(p, 20, Feature.OuterWall).length, 2);
  assert.equal(featPaths(p, 20, Feature.InnerWall).length, 4);
});

test("bridge over a gap and overhang flagged", () => {
  const tris = [...box(-15, -10, 0, -5, 10, 10), ...box(5, -10, 0, 15, 10, 10), ...box(-15, -10, 10, 15, 10, 12)];
  const p = planPrint(job([{ tris }], { settings: { brim_type: "no_brim", skirt_loops: 0 } }));
  finite(p);
  const bl = p.layers.findIndex((l) => l.paths.some((q) => q.feature === Feature.Bridge));
  assert.ok(bl >= 49 && bl <= 51, "bridge at the first slab layer, got " + bl);
  const b = featPaths(p, bl, Feature.Bridge);
  // bridging lines run across the gap (along x) → mostly horizontal
  const dx = b.reduce((s, q) => s + Math.abs(q.xyz[q.xyz.length - 3] - q.xyz[0]), 0), dy = b.reduce((s, q) => s + Math.abs(q.xyz[q.xyz.length - 2] - q.xyz[1]), 0);
  assert.ok(dx > dy, "bridge across the gap");
  assert.ok(b[0].height >= 0.39, "thick bridge");
  assert.ok(p.layers[bl].paths.some((q) => q.feature === Feature.OverhangWall), "overhang wall flagged over the gap");
  const ov = featPaths(p, bl, Feature.OverhangWall)[0];
  assert.ok(ov.speedScale === undefined || ov.speedScale.length === ov.xyz.length / 3);
});

test("overhang slow-down applies speed scale", () => {
  // cone-ish: two boxes, upper shifted sideways by 3 mm
  const tris = [...box(-10, -10, 0, 10, 10, 10), ...box(-7, -10, 10, 13, 10, 20)];
  const p = planPrint(job([{ tris }], { settings: { overhang_4_4_speed: 10, overhang_3_4_speed: 20, overhang_2_4_speed: 30, overhang_1_4_speed: 40, brim_type: "no_brim", skirt_loops: 0 } }));
  const l = p.layers.findIndex((q) => q.z > 10.05);
  const ov = featPaths(p, l, Feature.OverhangWall);
  assert.ok(ov.length > 0);
  assert.ok(ov.some((q) => q.speedScale && Math.min(...q.speedScale) < 0.5));
});

test("skirt and brim", () => {
  const a = planPrint(job([{ tris: box(-10, -10, 0, 10, 10, 10) }], { settings: { skirt_loops: 2, skirt_height: 2, brim_type: "no_brim" } }));
  assert.equal(featPaths(a, 0, Feature.Skirt).length, 2); assert.equal(featPaths(a, 1, Feature.Skirt).length, 2); assert.equal(featPaths(a, 2, Feature.Skirt).length, 0);
  assert.equal(featPaths(a, 0, Feature.Skirt)[0].obj, -1);
  const b = planPrint(job([{ tris: box(-10, -10, 0, 10, 10, 10) }], { settings: { skirt_loops: 0, brim_type: "outer_only", brim_width: 4 } }));
  assert.ok(featPaths(b, 0, Feature.Brim).length >= 8); assert.equal(featPaths(b, 1, Feature.Brim).length, 0);
  const c = planPrint(job([{ tris: box(-2, -2, 0, 2, 2, 40) }], { settings: { skirt_loops: 0, brim_type: "auto_brim" } }));
  assert.ok(featPaths(c, 0, Feature.Brim).length > 0, "tall thin object gets an auto brim");
  const d = planPrint(job([{ tris: box(-20, -20, 0, 20, 20, 10) }], { settings: { skirt_loops: 0, brim_type: "auto_brim" } }));
  assert.equal(featPaths(d, 0, Feature.Brim).length, 0);
  const e = planPrint(job([{ tris: box(-10, -10, 0, 10, 10, 10) }], { settings: { skirt_loops: 0, brim_type: "brim_ears", brim_width: 5 } }));
  assert.ok(featPaths(e, 0, Feature.Brim).length > 0);
});

test("print sequence", () => {
  const objs = [{ tris: box(-30, -5, 0, -20, 5, 6) }, { tris: box(20, -5, 0, 30, 5, 4) }];
  const byLayer = planPrint(job(objs, { settings: { brim_type: "no_brim", skirt_loops: 1 } }));
  assert.equal(byLayer.sequence, "layer"); assert.equal(byLayer.layers.length, 30);
  assert.ok(byLayer.layers.every((l) => l.obj === -1));
  const l0 = byLayer.layers[0].paths.filter((p) => p.obj >= 0).map((p) => p.obj);
  assert.ok(l0.indexOf(1) > l0.lastIndexOf(0), "object by object within a layer");
  assert.ok(byLayer.layers[25].paths.every((p) => p.obj !== 1), "short object stopped contributing");
  const byObj = planPrint(job(objs, { settings: { print_sequence: "by object", brim_type: "no_brim", skirt_loops: 1 } }));
  assert.equal(byObj.sequence, "object"); assert.equal(byObj.layers.length, 50);
  assert.deepEqual(byObj.layers.map((l) => l.obj).filter((v, i, a) => a.indexOf(v) === i), [0, 1]);
  assert.ok(byObj.layers[0].paths.some((p) => p.feature === Feature.Skirt && p.obj === 0));
  assert.deepEqual(byObj.layers.map((l) => l.index), byObj.layers.map((_, i) => i));
  finite(byObj);
});

test("supports callback is used, raft lifts the object", () => {
  const sq = (s: number) => [{ outer: Float64Array.of(-s, -s, s, -s, s, s, -s, s), holes: [] }];
  const j = job([{ tris: box(-10, -10, 0, 10, 10, 4) }], { settings: { enable_support: true, brim_type: "no_brim", skirt_loops: 0 } });
  const res: SupportResult = { layers: Array.from({ length: 20 }, (_, i) => ({ base: i < 3 ? sq(3) : [], topInterface: i === 3 ? sq(3) : [], bottomInterface: [] })), raftLayers: [sq(12), sq(12)], warnings: [] };
  const p = planPrint(j, () => res);
  assert.ok(p.layers[0].isRaft && p.layers[1].isRaft);
  assert.ok(featPaths(p, 0, Feature.Raft).length > 0);
  assert.ok(p.layers[2].z > 0.4 + 0.1);
  assert.ok(p.layers.some((l) => l.paths.some((q) => q.feature === Feature.Support)));
  assert.ok(p.layers.some((l) => l.paths.some((q) => q.feature === Feature.SupportInterface)));
  const none = planPrint(j, () => null); finite(none);
  const thr = planPrint(j, () => { throw new Error("boom"); }); assert.ok(thr.warnings.some((w) => /boom/.test(w)));
});

test("settings: seams, fuzzy, wipe, thin walls, ironing, combination", () => {
  const base = { brim_type: "no_brim", skirt_loops: 0 };
  for (const s of [
    { seam_position: "nearest" }, { seam_position: "back" }, { seam_position: "random" }, { staggered_inner_seams: true },
    { fuzzy_skin: "external" }, { fuzzy_skin: "all" }, { wipe_on_loops: true }, { detect_thin_wall: true },
    { ironing_type: "top" }, { ironing_type: "topmost" }, { ironing_type: "solid", ironing_pattern: "concentric" }, { infill_combination: true },
    { wall_sequence: "outer wall/inner wall" }, { wall_sequence: "inner-outer-inner wall", wall_loops: 4 }, { alternate_extra_wall: true },
    { only_one_wall_top: true, only_one_wall_first_layer: true }, { precise_outer_wall: true }, { slicing_mode: "even_odd" }, { slicing_mode: "close_holes" },
  ] as SettingMap[]) {
    const p = planPrint(job([{ tris: [...cylinder(0, 0, 8, 0, 3, 40)] }], { settings: { ...base, ...s } }));
    assert.ok(p.layers.length === 15, JSON.stringify(s)); finite(p);
  }
  const ir = planPrint(job([{ tris: box(-8, -8, 0, 8, 8, 3) }], { settings: { ...base, ironing_type: "top" } }));
  assert.ok(featPaths(ir, 14, Feature.Ironing).length > 0 && featPaths(ir, 14, Feature.Ironing)[0].flow < 0.5);
  const comb = planPrint(job([{ tris: box(-15, -15, 0, 15, 15, 12) }], { settings: { ...base, infill_combination: true } }));
  assert.ok(comb.layers.some((l) => l.paths.some((q) => q.feature === Feature.SparseInfill && q.height > 0.35)));
  const thin = planPrint(job([{ tris: box(-10, -0.5, 0, 10, 0.5, 3) }], { settings: { ...base, detect_thin_wall: true } }));
  assert.ok(thin.layers[5].paths.length > 0, "thin wall printed");
  for (const pat of ["zig-zag", "crosshatch", "tri-hexagon", "3dhoneycomb", "concentric", "alignedrectilinear", "adaptivecubic", "lightning", "supportcubic", "hilbertcurve", "archimedeanchords", "octagramspiral"]) {
    const p = planPrint(job([{ tris: box(-15, -15, 0, 15, 15, 6) }], { settings: { ...base, sparse_infill_pattern: pat, top_surface_pattern: pat === "zig-zag" ? "monotonic" : pat === "concentric" ? "concentric" : pat } }));
    finite(p); assert.ok(featPaths(p, 15, Feature.SparseInfill).length > 0, pat);
  }
});

test("texture hook is applied to outer walls", () => {
  let calls = 0;
  const p = planPrint(job([{ tris: cylinder(0, 0, 5, 0, 1, 24), texture: (ring, z) => { calls++; const n = ring.length / 2, xyz = new Float32Array(n * 3); for (let i = 0; i < n; i++) { xyz[3 * i] = ring[2 * i]; xyz[3 * i + 1] = ring[2 * i + 1]; xyz[3 * i + 2] = z + 0.05; } return { xyz, zone: new Uint8Array(n).fill(1), flow: new Float32Array(n).fill(1.1) }; } }]));
  assert.ok(calls >= 5);
  const o = featPaths(p, 2, Feature.OuterWall)[0];
  assert.ok(o.zone && o.flowScale && o.xyz.length / 3 > 40);
});

test("garbage input never throws", () => {
  const p = planPrint(job([{ tris: [] }, { tris: [0, 0, 0, 1, 0, 0, 0, 1, 0] }, { tris: [NaN, 0, 0, 1, 0, 0, 0, 1, 5] }]));
  assert.ok(p.warnings.length > 0);
});

test("performance: 100 mm cube, and a 20k triangle sphere", () => {
  let t = Date.now();
  const cube = planPrint(job([{ tris: box(-50, -50, 0, 50, 50, 100) }]));
  const tc = Date.now() - t; assert.equal(cube.layers.length, 500);
  assert.ok(tc < 6000, "cube took " + tc + " ms");
  const R = 25, nu = 100, nv = 100, tr: number[] = [];
  const P = (u: number, v: number) => [R * Math.sin(v) * Math.cos(u), R * Math.sin(v) * Math.sin(u), R - R * Math.cos(v)];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u0 = (i / nu) * Math.PI * 2, u1 = ((i + 1) / nu) * Math.PI * 2, v0 = (j / nv) * Math.PI, v1 = ((j + 1) / nv) * Math.PI;
    tr.push(...P(u0, v0), ...P(u1, v0), ...P(u1, v1), ...P(u0, v0), ...P(u1, v1), ...P(u0, v1));
  }
  t = Date.now();
  const sph = planPrint(job([{ tris: tr }]));
  const ts = Date.now() - t; finite(sph);
  assert.ok(ts < 15000, "sphere took " + ts + " ms");
  console.log(`      cube ${tc} ms, sphere(${tr.length / 9} tris) ${ts} ms`);
});
