import { test } from "node:test";
import assert from "node:assert/strict";
import { PresetRegistry, type MachinePreset, type FilamentPreset, type ProcessPreset } from "../src/core/presets.ts";
import { resolveSettings, type SettingMap } from "../src/core/settings.ts";
import { Feature, type Path, type Layer, type PlanarPlan, type PlanarJob, type FeatureId } from "../src/core/planar/types.ts";
import { writePlanarGcode } from "../src/core/planar/gcodeWriter.ts";
import { buildPreview, sliceStatsPlanar } from "../src/core/planar/preview.ts";
import { planMoves, crossSection, chainTimes } from "../src/core/planar/motion.ts";

const reg = new PresetRegistry();
type Over = { machine?: Partial<MachinePreset>; filament?: Partial<FilamentPreset>; settings?: SettingMap };
function mkJob(machineId = "machine/bambu-x1", over: Over = {}, procId = "process/std-0.20", filId = "filament/pla"): PlanarJob {
  const machine = { ...(reg.resolve<"machine">(machineId) as MachinePreset), ...over.machine };
  const filament = { ...(reg.resolve<"filament">(filId) as FilamentPreset), ...over.filament };
  const process = reg.resolve<"process">(procId) as ProcessPreset;
  const settings = resolveSettings(process, over.settings);
  return { objects: [], machine, filament, process, settings };
}
type PathOpts = Partial<Omit<Path, "xyz">> & { z?: number };
function mkPath(feature: FeatureId, pts: number[][], o: PathOpts = {}): Path {
  const z = o.z ?? 0.2;
  const xyz = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { xyz[i * 3] = p[0]; xyz[i * 3 + 1] = p[1]; xyz[i * 3 + 2] = p[2] ?? z; });
  const { z: _z, ...rest } = o; void _z;
  return { feature, obj: 0, xyz, closed: false, width: 0.42, height: 0.2, flow: 1, speed: 100, ...rest };
}
const square = (cx: number, cy: number, s: number, o: PathOpts = {}, f: FeatureId = Feature.OuterWall) =>
  mkPath(f, [[cx - s / 2, cy - s / 2], [cx + s / 2, cy - s / 2], [cx + s / 2, cy + s / 2], [cx - s / 2, cy + s / 2]], { closed: true, ...o });
const layer = (index: number, z: number, paths: Path[], obj = -1): Layer => ({ index, obj, z, height: 0.2, paths });
const mkPlan = (layers: Layer[], sequence: "layer" | "object" = "layer", bounds: [number, number, number, number][] = [[-10, -10, 10, 10]], names = ["Cube"]): PlanarPlan =>
  ({ layers, sequence, warnings: [], objectNames: names, bounds });

// ------------------------------------------------------------ mini G-code interpreter
type Replay = { x: number; y: number; z: number; eSum: number; extruded: number; retracted: number; deret: number; maxZ: number; finite: boolean; minE: number };
function replay(text: string): Replay {
  const r: Replay = { x: 0, y: 0, z: 0, eSum: 0, extruded: 0, retracted: 0, deret: 0, maxZ: 0, finite: true, minE: 0 };
  for (const raw of text.split("\n")) {
    const line = raw.split(";")[0].trim().replace(/^N\d+\s+/, "");
    const m = /^G([01])\b(.*)$/.exec(line);
    if (!m) { assert.ok(!/^M82\b/.test(line), "absolute extrusion not expected"); continue; }
    const px = r.x, py = r.y;
    let e = 0, hasE = false;
    for (const t of m[2].trim().split(/\s+/).filter(Boolean)) {
      const v = parseFloat(t.slice(1));
      if (!Number.isFinite(v)) r.finite = false;
      if (t[0] === "X") r.x = v; else if (t[0] === "Y") r.y = v; else if (t[0] === "Z") r.z = v; else if (t[0] === "E") { e = v; hasE = true; }
    }
    if (hasE) { r.eSum += e; if (e < 0) r.retracted += e; else if (r.x !== px || r.y !== py) r.extruded += e; else r.deret += e; r.minE = Math.min(r.minE, e); }
    r.maxZ = Math.max(r.maxZ, r.z);
    if (![r.x, r.y, r.z].every(Number.isFinite)) r.finite = false;
  }
  return r;
}
const body = (text: string) => text.split("\n").filter((l) => l && !l.startsWith(";"));
const ePerMm = (j: PlanarJob, w = 0.42, h = 0.2, flow = 1) => (crossSection(w, h) * flow * (j.settings.print_flow_ratio as number) * j.filament.flowRatio) / (Math.PI * (j.filament.diameter / 2) ** 2);

test("extrusion E totals match the geometric formula (relative E, rounded ends)", () => {
  const job = mkJob();
  const plan = mkPlan([layer(0, 0.2, [square(0, 0, 20), mkPath(Feature.SparseInfill, [[-5, -5], [5, -5]], { flow: 1 }), mkPath(Feature.Bridge, [[-5, 0], [5, 0]], { width: 0.4, height: 0.4, flow: 0.9, speed: 30 })])]);
  const res = writePlanarGcode(plan, job);
  const expected = 80 * ePerMm(job) + 10 * ePerMm(job) + 10 * ePerMm(job, 0.4, 0.4, 0.9);
  const r = replay(res.text);
  assert.ok(r.finite);
  assert.ok(Math.abs(r.extruded - expected) < 1e-3, `${r.extruded} vs ${expected}`);
  assert.ok(Math.abs(res.filamentMm - expected) < 1e-6);
  assert.ok(Math.abs(res.filamentCm3 - (expected * Math.PI * 0.875 ** 2) / 1000) < 1e-9);
  assert.ok(Math.abs(res.grams - res.filamentCm3 * job.filament.density) < 1e-9);
  assert.ok(Math.abs(res.cost - (res.grams / 1000) * job.filament.costPerKg) < 1e-9);
  // net E = extruded − retraction left at the end (the print ends retracted)
  assert.ok(Math.abs(r.eSum - (r.extruded + r.retracted + r.deret)) < 1e-9);
  assert.ok(Math.abs(r.eSum - (expected - job.machine.retractLength)) < 2e-3, `net ${r.eSum}`);
  assert.ok(res.text.includes("M83"));
  assert.equal(res.layers, 1);
});

test("closed paths write the closing segment back to the start", () => {
  const res = writePlanarGcode(mkPlan([layer(0, 0.2, [square(0, 0, 20)])]), mkJob());
  const g1 = body(res.text).filter((l) => /^G1 X.*E[0-9.]+/.test(l));
  assert.equal(g1.length, 4);
  assert.match(g1[3], /X-10 Y-10/);
});

test("header, thumbnails, offset and annotations", () => {
  const job = mkJob();
  const plan = mkPlan([layer(0, 0.2, [square(0, 0, 20)]), layer(1, 0.4, [square(0, 0, 20, { z: 0.4, feature: Feature.InnerWall })])]);
  const res = writePlanarGcode(plan, job, { offset: [100, 50], thumbnails: [{ width: 2, height: 2, pngBase64: "AAAA" }], presetNames: { machine: "M", filament: "F", process: "P" } });
  const t = res.text;
  for (const s of ["; HEADER_BLOCK_START", "; total layer number: 2", "; model printing time:", "; filament used [mm] =", "; max_z_height: 0.4", "; THUMBNAIL_BLOCK_START", "; thumbnail begin 2x2 4", "; printer_settings_id = M", "; EXECUTABLE_BLOCK_START", "; EXECUTABLE_BLOCK_END", ";LAYER_CHANGE", ";Z:0.2", ";Z:0.4", ";HEIGHT:0.2", ";TYPE:Outer wall", ";WIDTH:0.42", "; layer num/total_layer_count: 1/2", "; layer num/total_layer_count: 2/2", "M73 P0 R"])
    assert.ok(t.includes(s), s);
  assert.ok(t.includes(";TYPE:Inner wall"));
  assert.match(t, /G0 X90 Y40/);   // offset applied to the first travel
  assert.equal((t.match(/;TYPE:Outer wall/g) ?? []).length, 1);
  assert.ok(t.indexOf("HEADER_BLOCK_END") < t.indexOf("THUMBNAIL_BLOCK_START"));
});

test("retract, z-hop and de-retract appear only for long travels (wipe off)", () => {
  const job = mkJob("machine/bambu-x1", { machine: { wipe: false } });
  // far apart: retract + hop; near (0.5 mm): none
  const plan = mkPlan([layer(0, 0.2, [square(-40, 0, 10), square(40, 0, 10), mkPath(Feature.OuterWall, [[35.5, -5], [40, -5]]), mkPath(Feature.OuterWall, [[40.5, -5], [45, -5]])])]);
  const res = writePlanarGcode(plan, job);
  const lines = body(res.text);
  const ri = lines.findIndex((l) => /^G1 E-0\.8 /.test(l));
  assert.ok(ri > 0);
  assert.match(lines[ri + 1], /^G1 Z0\.6 /);
  assert.match(lines[ri + 2], /^G0 X35 Y-5/);
  assert.match(lines[ri + 3], /^G1 Z0\.2 /);
  assert.match(lines[ri + 4], /^G1 E0\.8 /);
  // exactly one mid-print retraction + the final one
  assert.equal(lines.filter((l) => /^G1 E-/.test(l)).length, 2);
  assert.equal(lines.filter((l) => /^G1 E[0-9.]+ F/.test(l)).length, 1);
  // the near travel does not hop
  assert.equal(lines.filter((l) => /^G1 Z0\.6 /.test(l)).length, 1);
});

test("wipe retracts before and while wiping back along the previous path", () => {
  const job = mkJob();
  const plan = mkPlan([layer(0, 0.2, [mkPath(Feature.OuterWall, [[-40, 0], [-30, 0]]), mkPath(Feature.OuterWall, [[40, 0], [50, 0]])])]);
  const lines = body(writePlanarGcode(plan, job).text);
  const ri = lines.findIndex((l) => /^G1 E-0\.56 /.test(l));       // 70 % of 0.8
  assert.ok(ri > 0, lines.join("\n"));
  const wipes: string[] = [];
  for (let i = ri + 1; /^G1 X.* E-/.test(lines[i]); i++) wipes.push(lines[i]);
  assert.ok(wipes.length >= 1);
  const wipeE = wipes.reduce((s, l) => s + parseFloat(/E(-[0-9.]+)/.exec(l)![1]), 0);
  assert.ok(Math.abs(wipeE + 0.24) < 1e-4, `wipe E ${wipeE}`);
  assert.match(wipes[wipes.length - 1], /X-31\.2 Y0/);   // 1.2 mm back along the path
  const rr = replay(lines.join("\n"));
  assert.ok(rr.finite);
});

test("layer change retracts (retractOnLayerChange) and hops; off when disabled", () => {
  const plan = mkPlan([layer(0, 0.2, [square(0, 0, 10)]), layer(1, 0.4, [square(0, 0, 10, { z: 0.4 })]), layer(2, 0.6, [square(0, 0, 10, { z: 0.6 })])]);
  const on = body(writePlanarGcode(plan, mkJob("machine/bambu-x1", { machine: { wipe: false } })).text);
  assert.equal(on.filter((l) => /^G1 E-0\.8 /.test(l)).length, 3);  // 2 layer changes + final
  assert.ok(on.some((l) => /^G1 Z0\.8 /.test(l)));                  // hop to next layer z + 0.4
  const off = body(writePlanarGcode(plan, mkJob("machine/bambu-x1", { machine: { wipe: false, retractOnLayerChange: false } })).text);
  assert.equal(off.filter((l) => /^G1 E-0\.8 /.test(l)).length, 1);  // final only
  assert.ok(off.every((l) => !/^G1 Z0\.8 /.test(l)));
});

test("z-hop slope and spiral stay finite and land on the layer z", () => {
  for (const zHopType of ["slope", "spiral"] as const) {
    const job = mkJob("machine/bambu-x1", { machine: { wipe: false, zHopType } });
    const plan = mkPlan([layer(0, 0.2, [square(-40, 0, 10), square(40, 0, 10)])]);
    const res = writePlanarGcode(plan, job);
    const r = replay(res.text.slice(0, res.text.lastIndexOf("M107")));
    assert.ok(r.finite, zHopType);
    assert.ok(r.maxZ > 0.55, `${zHopType} max z ${r.maxZ}`);
    assert.ok(Math.abs(r.z - 0.2) < 1e-6, zHopType + " z=" + r.z + "\n" + body(res.text).slice(-30).join("\n"));
    assert.ok(Math.abs(r.extruded - 80 * ePerMm(job)) < 2e-3);
  }
});

test("reduce_infill_retraction skips retraction inside an infill region; off retracts", () => {
  const paths = () => [square(0, 0, 40), mkPath(Feature.SparseInfill, [[-15, -10], [15, -10]]), mkPath(Feature.SparseInfill, [[15, 10], [-15, 10]])];
  const mk = (rir: boolean) => body(writePlanarGcode(mkPlan([layer(0, 0.2, paths())]), mkJob("machine/bambu-x1", { machine: { wipe: false }, settings: { reduce_infill_retraction: rir } })).text);
  assert.equal(mk(true).filter((l) => /^G1 E-/.test(l)).length, 2);  // wall → infill retract + final; infill → infill none
  assert.equal(mk(false).filter((l) => /^G1 E-/.test(l)).length, 3);
});

test("reduce_crossing_wall detours along the wall when the straight travel crosses it", () => {
  const C = mkPath(Feature.OuterWall, [[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]], { closed: true });
  const make = (rcw: boolean) => {
    const plan = mkPlan([layer(0, 0.2, [C, mkPath(Feature.SparseInfill, [[5, 25], [5, 20]]), mkPath(Feature.SparseInfill, [[25, 25], [25, 20]])])]);
    const text = writePlanarGcode(plan, mkJob("machine/bambu-x1", { machine: { wipe: false, zHop: 0 }, settings: { reduce_crossing_wall: rcw } })).text;
    const lines = body(text);
    const i = lines.findIndex((l) => /^G1 X5 Y20 /.test(l));
    let j = i + 1; const route: string[] = [];
    for (; !/^G1 X25 Y20 /.test(lines[j]); j++) if (/^G0 X/.test(lines[j])) route.push(lines[j]);
    return { route, ok: replay(text).finite };
  };
  const off = make(false), on = make(true);
  assert.equal(off.route.length, 1);
  assert.ok(on.route.length >= 3, on.route.join("|"));
  assert.ok(on.ok);
  // the detour passes below the notch (y < 10 + tolerance) at some point
  assert.ok(on.route.some((l) => parseFloat(/Y(-?[0-9.]+)/.exec(l)![1]) <= 10.01));
});

test("object labels: Klipper EXCLUDE_OBJECT and Bambu/Marlin start/stop comments", () => {
  const mk = (obj: number, cx: number, z: number, idx: number) => layer(idx, z, [square(cx, 0, 10, { obj, z })], -1);
  const plan = mkPlan([mk(0, -30, 0.2, 0), mk(0, -30, 0.4, 1)].map((l, i) => ({ ...l, paths: [...l.paths, square(30, 0, 10, { obj: 1, z: 0.2 * (i + 1) })] })),
    "layer", [[-35, -5, -25, 5], [25, -5, 35, 5]], ["Part A", "Part B"]);
  const k = writePlanarGcode(plan, mkJob("machine/klipper")).text;
  assert.match(k, /EXCLUDE_OBJECT_DEFINE NAME=Part_A_id_0 CENTER=-30,0 POLYGON=\[\[-35,-5\],\[-25,-5\],\[-25,5\],\[-35,5\]\]/);
  assert.match(k, /EXCLUDE_OBJECT_DEFINE NAME=Part_B_id_1 CENTER=30,0/);
  assert.equal((k.match(/EXCLUDE_OBJECT_START NAME=Part_A_id_0/g) ?? []).length, 2);
  assert.equal((k.match(/EXCLUDE_OBJECT_END NAME=Part_B_id_1/g) ?? []).length, 2);
  assert.ok(!k.includes("M73"));
  const b = writePlanarGcode(plan, mkJob("machine/bambu-x1")).text;
  assert.equal((b.match(/; start printing object, unique label id: 1/g) ?? []).length, 2);
  assert.equal((b.match(/; stop printing object, unique label id: 0/g) ?? []).length, 2);
  assert.ok(!b.includes("EXCLUDE_OBJECT"));
  const off = writePlanarGcode(plan, mkJob("machine/bambu-x1", { settings: { gcode_label_objects: false } })).text;
  assert.ok(!off.includes("printing object"));
});

test("print by object hops above everything printed and reheats", () => {
  const l = (obj: number, i: number, z: number) => layer(i, z, [square(obj ? 40 : -40, 0, 10, { obj, z })], obj);
  const plan = mkPlan([l(0, 0, 0.2), l(0, 1, 0.4), l(1, 0, 0.2), l(1, 1, 0.4)], "object", [[-45, -5, -35, 5], [35, -5, 45, 5]], ["A", "B"]);
  const res = writePlanarGcode(plan, mkJob("machine/bambu-x1", { machine: { wipe: false } }));
  const lines = body(res.text);
  const iB = lines.findIndex((l2) => /^G0 X35 Y-5/.test(l2));
  assert.ok(iB > 0);
  let sawHigh = false;
  for (let i = iB - 6; i < iB; i++) if (/^G1 Z(\d+(\.\d+)?) /.test(lines[i]) && parseFloat(/Z([\d.]+)/.exec(lines[i])![1]) > 0.4 + 0.5) sawHigh = true;
  assert.ok(sawHigh, lines.slice(iB - 6, iB + 3).join("\n"));
  // reheat for object 2's first layer, and second-layer temperature switch once per object
  assert.equal((res.text.match(/^M104 S220$/gm) ?? []).length, 2); // start gcode + reheat for object 2
  assert.equal((res.text.match(/^M104 S215$/gm) ?? []).length, 2);
  assert.equal((res.text.match(/^M140 S55$/gm) ?? []).length, 1);
  assert.ok(replay(res.text).finite);
});

test("temperatures switch to the normal values after layer 1", () => {
  const plan = mkPlan([layer(0, 0.2, [square(0, 0, 20)]), layer(1, 0.4, [square(0, 0, 20, { z: 0.4 })]), layer(2, 0.6, [square(0, 0, 20, { z: 0.6 })])]);
  const t = writePlanarGcode(plan, mkJob()).text;
  assert.equal((t.match(/^M104 S215$/gm) ?? []).length, 1);
  assert.equal((t.match(/^M140 S55$/gm) ?? []).length, 1);
  assert.ok(t.indexOf("M104 S215") > t.indexOf(";Z:0.4") && t.indexOf("M104 S215") < t.indexOf(";Z:0.6"));
  assert.ok(t.includes("M190 S60") && t.includes("M109 S220"));
});

test("fan: off on the first layers, ramp to fanMin, max for fast layers, bridges, aux, disabled", () => {
  const big = (i: number, extra: Path[] = []) => layer(i, 0.2 * (i + 1), [square(0, 0, 200, { z: 0.2 * (i + 1) }), ...extra]);
  const plan = mkPlan([0, 1, 2, 3, 4].map((i) => big(i)));
  const fans = (t: string) => t.split("\n").filter((l) => /^M106 S/.test(l));
  assert.deepEqual(fans(writePlanarGcode(plan, mkJob()).text), ["M106 S0", "M106 S51", "M106 S102", "M106 S153"]);
  // fast (small) layers use fanMax
  const small = mkPlan([0, 1, 2].map((i) => layer(i, 0.2 * (i + 1), [square(0, 0, 10, { z: 0.2 * (i + 1) })])));
  const ts = fans(writePlanarGcode(small, mkJob()).text);
  assert.deepEqual(ts, ["M106 S0", "M106 S255"]);
  // bridge fan override and restore
  const bridgePlan = mkPlan([big(0), big(1), big(2, [mkPath(Feature.Bridge, [[-50, 0], [50, 0]], { z: 0.6, speed: 30, width: 0.4, height: 0.4 })]), big(3)]);
  const bt = fans(writePlanarGcode(bridgePlan, mkJob()).text);
  assert.ok(bt.includes("M106 S255"));
  assert.equal(bt[bt.length - 1], "M106 S153");   // restored (layer 3 base 60 %)
  // explicit path.fan override
  const pf = writePlanarGcode(mkPlan([big(0), big(1, [mkPath(Feature.SparseInfill, [[0, 0], [10, 0]], { fan: 30, z: 0.4 })])]), mkJob()).text;
  assert.ok(pf.includes(`M106 S${Math.round(0.3 * 255)}`));
  // aux fan
  const aux = writePlanarGcode(plan, mkJob("machine/bambu-x1", { filament: { auxFanSpeed: 50 } })).text;
  assert.ok(aux.includes("M106 P2 S128"));
  assert.ok(!writePlanarGcode(plan, mkJob("machine/klipper", { filament: { auxFanSpeed: 50 } })).text.includes("P2"));
  // cooling disabled → stays at fanMin after the off layers
  const off = fans(writePlanarGcode(plan, mkJob("machine/bambu-x1", { filament: { fanCoolingEnabled: false } })).text);
  assert.deepEqual(off, ["M106 S0", "M106 S153"]);
});

test("slowdown below slowdownLayerTime stretches the layer toward it, not below minSpeed", () => {
  const plan = mkPlan([layer(0, 0.2, [square(0, 0, 20)]), layer(1, 0.4, [square(0, 0, 20, { z: 0.4 })])]);
  const slow = writePlanarGcode(plan, mkJob());
  const free = writePlanarGcode(plan, mkJob("machine/bambu-x1", { filament: { slowdownLayerTime: 0 } }));
  assert.ok(free.timeS < 5, `${free.timeS}`);
  assert.ok(slow.timeS > 11 && slow.timeS < 14, `${slow.timeS}`);
  const F = body(slow.text).filter((l) => /^G1 X.* E[0-9.]+ F/.test(l)).map((l) => parseInt(/ F(\d+)/.exec(l)![1]));
  assert.ok(F.every((v) => v >= 600 - 1), "never below minSpeed 10 mm/s");
  assert.ok(Math.max(...F) < 6000);
  const floor = writePlanarGcode(plan, mkJob("machine/bambu-x1", { filament: { minSpeed: 90 } }));
  assert.ok(floor.timeS < slow.timeS);
});

test("time estimate: 100 mm at 100 mm/s with high accel is about one second; accel limits matter", () => {
  const fil = { slowdownLayerTime: 0 };
  const line = (accel?: number) => mkPlan([layer(0, 0.2, [mkPath(Feature.OuterWall, [[-50, 0], [50, 0]], { accel })])]);
  const fast = writePlanarGcode(line(100000), mkJob("machine/bambu-x1", { filament: fil }));
  assert.ok(Math.abs(fast.timeS - 1.0) < 0.05, `${fast.timeS}`);
  const slowAcc = writePlanarGcode(line(500), mkJob("machine/bambu-x1", { filament: fil }));
  assert.ok(Math.abs(slowAcc.timeS - (1 + 100 / 500)) < 0.05, `${slowAcc.timeS}`);
  assert.ok(Math.abs(sliceStatsPlanar(line(100000), mkJob("machine/bambu-x1", { filament: fil })).timeS - fast.timeS) < 1e-9);
  assert.ok(fast.byFeature[Feature.OuterWall].timeS > 0.99);
  // volumetric clamp: 0.42×0.2 at 100 mm/s = 7.5 mm³/s fine; a 1.2×0.6 line is clamped to 15 mm³/s → ~20 mm/s
  const wide = mkPlan([layer(0, 0.2, [mkPath(Feature.SparseInfill, [[-50, 0], [50, 0]], { width: 1.2, height: 0.6, accel: 100000 })])]);
  const wt = writePlanarGcode(wide, mkJob("machine/bambu-x1", { filament: fil })).timeS;
  assert.ok(wt > 4 && wt < 6, `${wt}`);
});

test("chainTimes: sharp corners slow the chain, collinear moves do not", () => {
  const run = (corner: boolean) => {
    const n = 2, len = new Float64Array([50, 50]), ux = new Float64Array([1, corner ? 0 : 1]), uy = new Float64Array([0, corner ? 1 : 0]), uz = new Float64Array(2);
    const v = new Float64Array([100, 100]), a = new Float64Array([500, 500]), j = new Float64Array([9, 9]), out = new Float64Array(2);
    chainTimes(n, len, ux, uy, uz, v, a, j, new Float64Array(2), out);
    return out[0] + out[1];
  };
  assert.ok(run(true) > run(false) + 0.01);
});

test("time is monotonic over layers and the preview order is non-decreasing", () => {
  const plan = mkPlan([0, 1, 2].map((i) => layer(i, 0.2 * (i + 1), [square(0, 0, 30, { z: 0.2 * (i + 1) }), mkPath(Feature.SparseInfill, [[-10, -10], [10, -10], [10, 0], [-10, 0]], { z: 0.2 * (i + 1) })])));
  const job = mkJob();
  const mp = planMoves(plan, job);
  assert.equal(mp.layers.length, 3);
  assert.ok(mp.layers.every((l) => l.time > 0));
  const total = mp.layers.reduce((s, l) => s + l.time, 0);
  assert.ok(Math.abs(total - mp.timeS) < 1e-9);
  const pv = buildPreview(plan, job);
  for (let i = 1; i < pv.count; i++) assert.ok(pv.order[i] >= pv.order[i - 1]);
  assert.ok(pv.order[pv.count - 1] > 0 && pv.order[pv.count - 1] <= mp.timeS * 1.02 + 0.05);
  // byFeature sums to the total
  const bf = Object.values(mp.byFeature).reduce((s, v) => s + v.timeS, 0);
  assert.ok(Math.abs(bf - mp.timeS) < 1e-6);
});

test("preview: one entry per path segment, travel flagged 0, speeds and zones", () => {
  const zone = new Uint8Array([0, 1, 1, 0]);
  const plan = mkPlan([
    layer(0, 0.2, [square(0, 0, 20, { zone }), mkPath(Feature.SparseInfill, [[-5, -5], [5, -5], [5, 5]]), mkPath(Feature.Bridge, [[-5, 0], [5, 0]], { speed: 30 }), mkPath(Feature.Travel, [[0, 0], [10, 10]], { speed: 200 })]),
    layer(1, 0.4, [mkPath(Feature.InnerWall, [[0, 0], [20, 0], [20, 20]], { z: 0.4, speedScale: new Float32Array([1, 1, 0.5]) })]),
  ]);
  const job = mkJob();
  const pv = buildPreview(plan, job);
  assert.equal(pv.count, 4 + 2 + 1 + 1 + 2);
  assert.equal(pv.a.length, pv.count * 3);
  assert.equal(pv.feature[7], Feature.Travel);
  assert.equal(pv.feature[0], Feature.OuterWall);
  assert.equal(pv.layer[pv.count - 1], 1);
  assert.deepEqual([...pv.zone.slice(0, 4)], [1, 1, 0, 0]);
  assert.ok(pv.speed[6] <= 30 + 1e-3 && pv.speed[6] > 0);
  assert.ok(Math.abs(pv.width[0] - 0.42) < 1e-6 && pv.width[7] === Math.fround(0.42));
  for (let i = 0; i < pv.count; i++) assert.ok(Number.isFinite(pv.speed[i]) && pv.speed[i] > 0);
  assert.ok(pv.speed[pv.count - 1] < pv.speed[pv.count - 2] || pv.speed[pv.count - 1] <= 100);   // scaled segment not faster
  // optional implicit travel
  const withTravel = buildPreview(plan, job, { travel: true });
  assert.ok(withTravel.count > pv.count);
  assert.ok(withTravel.feature.slice(0, withTravel.count).filter((f) => f === Feature.Travel).length > 1);
});

test("preview handles about two million segments with typed arrays only", () => {
  const nLayers = 20, perLayer = 100000, ptsN = perLayer + 1;
  const layers: Layer[] = [];
  for (let l = 0; l < nLayers; l++) {
    const xyz = new Float32Array(ptsN * 3);
    for (let i = 0; i < ptsN; i++) { xyz[i * 3] = 50 * Math.cos(i * 0.01); xyz[i * 3 + 1] = 50 * Math.sin(i * 0.01); xyz[i * 3 + 2] = 0.2 * (l + 1); }
    layers.push(layer(l, 0.2 * (l + 1), [{ feature: Feature.InnerWall, obj: 0, xyz, closed: false, width: 0.45, height: 0.2, flow: 1, speed: 120 }]));
  }
  const t0 = Date.now();
  const pv = buildPreview(mkPlan(layers), mkJob());
  assert.equal(pv.count, nLayers * perLayer);
  assert.ok(Date.now() - t0 < 15000, `${Date.now() - t0} ms`);
});

test("klipper / marlin command dialects: accel, jerk, pressure advance, line numbers, comments", () => {
  const plan = mkPlan([layer(0, 0.2, [square(0, 0, 30), mkPath(Feature.SparseInfill, [[-5, 0], [5, 0]])]), layer(1, 0.4, [square(0, 0, 30, { z: 0.4 })])]);
  const kl = writePlanarGcode(plan, mkJob("machine/klipper")).text;
  assert.match(kl, /^SET_PRESSURE_ADVANCE ADVANCE=0\.02$/m);
  assert.match(kl, /^SET_VELOCITY_LIMIT ACCEL=500$/m);               // initial layer acceleration
  assert.match(kl, /^SET_VELOCITY_LIMIT ACCEL=10000$/m);             // travel / default on layer 2
  assert.match(kl, /^SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=9$/m);
  assert.ok(!/^M204|^M205|^M900|^M73/m.test(kl));
  const bb = writePlanarGcode(plan, mkJob("machine/bambu-x1")).text;
  assert.match(bb, /^M900 K0\.02$/m);
  assert.match(bb, /^M204 P500 T10000$/m);
  assert.match(bb, /^M204 P5000 T10000$/m);                           // outer wall on layer 2
  assert.match(bb, /^M205 X9 Y9$/m);
  // accel emitted only when the value changes
  const m204 = bb.split("\n").filter((l) => l.startsWith("M204"));
  for (let i = 1; i < m204.length; i++) assert.notEqual(m204[i], m204[i - 1]);
  // process pressure_advance_override wins
  assert.match(writePlanarGcode(plan, mkJob("machine/bambu-x1", { settings: { pressure_advance_override: 0.05 } })).text, /^M900 K0\.05$/m);
  // line numbers and comments
  const ln = writePlanarGcode(plan, mkJob("machine/bambu-x1", { settings: { gcode_add_line_number: true, gcode_comments: true } })).text;
  assert.match(ln, /^N1 /m);
  const nums = ln.split("\n").filter((l) => /^N\d+ /.test(l)).map((l) => parseInt(l.slice(1)));
  nums.forEach((n, i) => assert.equal(n, i + 1));
  assert.ok(ln.includes("; retract"));
  assert.ok(replay(ln).finite);
});

test("replay of a multi-layer stack keeps positions finite and E conserved", () => {
  const layers: Layer[] = [];
  for (let i = 0; i < 6; i++) layers.push(layer(i, 0.2 * (i + 1), [square(0, 0, 40, { z: 0.2 * (i + 1) }), square(0, 0, 36, { z: 0.2 * (i + 1), feature: Feature.InnerWall }),
    mkPath(Feature.SparseInfill, [[-10, -10], [10, -10], [10, -5], [-10, -5]], { z: 0.2 * (i + 1) }), mkPath(Feature.TopSurface, [[-12, 12], [12, 12]], { z: 0.2 * (i + 1) })]));
  const job = mkJob("machine/bambu-x1");
  const res = writePlanarGcode(mkPlan(layers), job, { offset: [128, 128] });
  const r = replay(res.text);
  assert.ok(r.finite);
  assert.ok(Math.abs(r.extruded - res.filamentMm) < 5e-3, `${r.extruded} vs ${res.filamentMm}`);
  assert.ok(Math.abs(r.eSum - (r.extruded + r.retracted + r.deret)) < 1e-9);
  assert.ok(Math.abs(r.eSum + job.machine.retractLength - res.filamentMm) < 5e-3 || Math.abs(r.eSum - (res.filamentMm - job.machine.retractLength)) < 5e-3);
  assert.ok(r.x >= 0 && r.x <= 256 && r.y >= 0 && r.y <= 256);
  assert.ok(r.maxZ >= 1.2);
});

test("Path.flowScale multiplies extrusion per segment (mean of end points)", () => {
  const job = mkJob();
  const p = mkPath(Feature.OuterWall, [[0, 0], [10, 0], [20, 0]], { flowScale: new Float32Array([1, 0.5, 0]) });
  const res = writePlanarGcode(mkPlan([layer(0, 0.2, [p])]), job);
  assert.ok(Math.abs(res.filamentMm - 10 * ePerMm(job) * (0.75 + 0.25)) < 1e-6);
});
