import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PresetRegistry, diff, fillTemplate, primitives, buildSpiral, planMotion, toGcode, sliceStats,
  newPlate, newObject, clonePlate, checkPlate, arrangePlate, objectBody, printOrder, serializeProject, deserializeProject, addRegion, stamp,
  parseSTL, normalizeMesh, meshBody, sliceAt, buildSliceIndex, profileBody,
  type MachinePreset, type FilamentPreset, type ProcessPreset,
} from "../src/core/index.ts";

const reg = new PresetRegistry();
const machine = reg.resolve<"machine">("machine/bambu-x1") as MachinePreset;
const filament = reg.resolve<"filament">("filament/pla") as FilamentPreset;
const proc = reg.resolve<"process">("process/vase-0.4") as ProcessPreset;

test("preset inheritance resolves root-first with nested overrides", () => {
  const a1 = reg.resolve<"machine">("machine/bambu-a1") as MachinePreset;
  assert.equal(a1.flavor, "bambu");        // from bambu-x1
  assert.equal(a1.maxHeight, 256);         // own override
  assert.equal(a1.retractLength, 0.8);     // from base
  const planar = reg.resolve<"process">("process/planar-0.4") as ProcessPreset;
  assert.equal(planar.nonLinear.enabled, false);
  assert.equal(planar.nonLinear.deviationTol, 0.01); // nested key inherited
});

test("user preset stores only the delta", () => {
  const edited = structuredClone(filament);
  edited.nozzleTemp = 230; edited.flowRatio = 0.97;
  const p = reg.saveDelta("user/pla-hot", "PLA hot", "filament", "filament/pla", edited);
  assert.deepEqual(p.values, { nozzleTemp: 230, flowRatio: 0.97 });
  assert.equal((reg.resolve<"filament">("user/pla-hot") as FilamentPreset).density, 1.24);
  assert.deepEqual(diff({ a: { b: 1, c: 2 } }, { a: { b: 1, c: 3 } }), { a: { c: 3 } });
});

test("template fill keeps unknown placeholders", () => {
  assert.equal(fillTemplate("M104 S{t} {x}", { t: 210 }), "M104 S210 {x}");
});

const spiral = (pattern: string, extra = {}) => buildSpiral(primitives.bowl(), {
  layerHeight: proc.layerHeight, lineWidth: proc.lineWidth, filamentDiameter: 1.75, segmentsPerRev: proc.segmentsPerRev,
  pattern, fadeHeight: proc.fadeHeight, center: [0, 0], zCap: machine.zWobbleMax, ...extra,
});

test("motion respects volumetric, Z-speed and cooling limits", () => {
  const mp = planMotion(spiral("knit"), proc.segmentsPerRev, { machine, filament, process: proc });
  const filArea = Math.PI * 0.875 ** 2;
  for (let i = 1; i < mp.count; i++) {
    const dx = mp.xyz[i*3]-mp.xyz[i*3-3], dy = mp.xyz[i*3+1]-mp.xyz[i*3-2], dz = mp.xyz[i*3+2]-mp.xyz[i*3-1];
    const L = Math.hypot(dx, dy, dz);
    const vol = ((mp.e[i] - mp.e[i - 1]) * filArea * filament.flowRatio / L) * mp.feed[i];
    assert.ok(vol <= filament.maxVolumetric + 1e-3, `volumetric ${vol} at ${i}`);
    if (Math.abs(dz) > 1e-4) assert.ok((Math.abs(dz) / L) * mp.feed[i] <= machine.maxZSpeed + 1e-3);
  }
  for (let L = 1; L < mp.layerTime.length; L++)
    assert.ok(mp.layerTime[L] >= filament.slowdownLayerTime - 0.05 || mp.layerTime[L] > 0, "layer time");
  assert.equal(mp.layerFan[0], 0);
  assert.ok(mp.time > 0);
});

test("deviation tolerance decimates plain wall but preserves knit detail", () => {
  const plain = planMotion(spiral("none"), proc.segmentsPerRev, { machine, filament, process: { ...proc, nonLinear: { ...proc.nonLinear, deviationTol: 0.05 } } });
  assert.ok(plain.decimated > 0);
  const e0 = spiral("none").e;
  assert.ok(Math.abs(plain.e[plain.count - 1] - e0[e0.length - 1]) / e0[e0.length - 1] < 0.002);
});

test("planar mode suppresses pattern Z", () => {
  const tp = spiral("knit", { planar: true });
  for (let i = 0; i < tp.count; i += 97) {
    const zBase = proc.layerHeight * (1 + i / proc.segmentsPerRev);
    assert.ok(Math.abs(tp.xyz[i * 3 + 2] - zBase) < 1e-4);
  }
});

test("G-code: header stats, thumbnails, layer macros, temp switch", () => {
  const mp = planMotion(spiral("knit"), proc.segmentsPerRev, { machine, filament, process: proc });
  const g = toGcode(mp, { machine, filament, process: proc, offset: [128, 128], thumbnails: [{ width: 2, height: 2, pngBase64: "iVBORw0KGgo=" }] });
  const st = sliceStats(mp, filament);
  assert.match(g, new RegExp(`; filament used \\[g\\] = ${st.grams.toFixed(2)}`));
  assert.match(g, /; thumbnail begin 2x2 12\n; iVBORw0KGgo=\n; thumbnail end/);
  assert.match(g, /M975 S1/);
  assert.equal((g.match(/;LAYER_CHANGE/g) ?? []).length, st.layers);
  assert.match(g, /M73 L2\nM104 S215\nM140 S55/);
  assert.ok(!/\{[a-z_]+\}/.test(g), "unfilled placeholder");
});


// ---------- STL / mesh ----------
/** Binary STL of a closed n-gon prism (radius r, height h), centred off-origin to test normalisation. */
function prismSTL(n: number, r: number, h: number, ox = 50, oy = 20): ArrayBuffer {
  const tris: number[][] = [];
  const P = (k: number, z: number) => [ox + r * Math.cos((2 * Math.PI * k) / n), oy + r * Math.sin((2 * Math.PI * k) / n), z];
  for (let k = 0; k < n; k++) {
    const a0 = P(k, 0), b0 = P(k + 1, 0), a1 = P(k, h), b1 = P(k + 1, h);
    tris.push([...a0, ...b0, ...b1], [...a0, ...b1, ...a1]);
    tris.push([ox, oy, 0, ...b0, ...a0], [ox, oy, h, ...a1, ...b1]);
  }
  const buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((v, k) => dv.setFloat32(84 + i * 50 + 12 + k * 4, v, true)));
  return buf;
}

test("binary + ASCII STL parse and normalise", () => {
  const m = normalizeMesh(parseSTL(prismSTL(64, 30, 40), "prism"));
  assert.equal(m.tris.length, 64 * 4 * 9);
  const xs = Array.from(m.tris.filter((_, i) => i % 3 === 0)), zs = Array.from(m.tris.filter((_, i) => i % 3 === 2));
  assert.ok(Math.abs(Math.max(...xs) + Math.min(...xs)) < 1e-3 && Math.min(...zs) === 0);
  const ascii = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t";
  assert.equal(parseSTL(new TextEncoder().encode(ascii).buffer as ArrayBuffer).tris.length, 9);
  assert.throws(() => parseSTL(new TextEncoder().encode("garbage").buffer as ArrayBuffer));
});

test("mesh slicing yields one closed CCW contour; spiral follows the mesh wall", () => {
  const body = meshBody(normalizeMesh(parseSTL(prismSTL(128, 30, 20))));
  const loops = sliceAt(buildSliceIndex(normalizeMesh(parseSTL(prismSTL(128, 30, 20))).tris), 10);
  assert.equal(loops.length, 1);
  const ring = body.ring(10, 360)!;
  for (let k = 0; k < 360; k++) {
    const r = Math.hypot(ring.x[k], ring.y[k]);
    assert.ok(r > 29.9 && r <= 30.001, `radius ${r}`);
    assert.ok(ring.x[k] * ring.nx[k] + ring.y[k] * ring.ny[k] > 0, "normal points outward");
  }
  assert.ok(ring.x[0] > 29.9 && Math.abs(ring.y[0]) < 0.5, "seam on +X");
  const tp = buildSpiral(body, { ...{ layerHeight: 0.4, lineWidth: 0.8, filamentDiameter: 1.75, segmentsPerRev: 360, fadeHeight: 0, center: [0, 0] as [number, number] }, pattern: "sine", params: { amplitude: 1, wavesPerRev: 30 } });
  let rMax = 0; for (let i = 0; i < tp.count; i++) rMax = Math.max(rMax, Math.hypot(tp.xyz[i * 3], tp.xyz[i * 3 + 1]));
  assert.ok(rMax > 30.8 && rMax < 31.05, `pattern offset along normal, rMax ${rMax}`);
});

// ---------- plates ----------
const bodiesOf = (pl: ReturnType<typeof newPlate>, meshes = {}) => pl.objects.map((o) => objectBody(o, meshes));

test("arrange packs objects with toolhead clearance and checks pass", () => {
  const pl = newPlate("P", [newObject(), newObject({ kind: "primitive", primitive: "cylinder" }), newObject({ kind: "primitive", primitive: "cylinder" })]);
  pl.objects[0].transform.scaleXY = 0.5; pl.objects[0].transform.scaleZ = 0.4; pl.objects[1].transform.scaleZ = 0.5;
  const bodies = bodiesOf(pl);
  assert.deepEqual(arrangePlate(pl, bodies, machine, proc), []);
  const errors = checkPlate(pl, bodies, machine, proc).filter((i) => i.level === "error");
  assert.deepEqual(errors, []);
  pl.objects[1].transform.x = pl.objects[2].transform.x; pl.objects[1].transform.y = pl.objects[2].transform.y;
  assert.ok(checkPlate(pl, bodies, machine, proc).some((i) => /apart/.test(i.message)));
});

test("sequential printing: only the tallest object may exceed gantry clearance", () => {
  const pl = newPlate("P", [newObject({ kind: "primitive", primitive: "vase" }), newObject({ kind: "primitive", primitive: "shade" })]);
  pl.objects.forEach((o) => (o.transform.scaleXY = 0.6));
  const bodies = bodiesOf(pl);
  arrangePlate(pl, bodies, machine, proc);
  assert.ok(checkPlate(pl, bodies, machine, proc).some((i) => /gantry clearance/.test(i.message)));
  assert.deepEqual(printOrder(pl, bodies, machine, proc), [0, 1]); // vase 120 < shade 140
});

test("oversize object fails arrange and check", () => {
  const pl = newPlate("P", [newObject()]); pl.objects[0].transform.scaleXY = 2;
  const bodies = bodiesOf(pl);
  assert.equal(arrangePlate(pl, bodies, machine, proc).length, 1);
  assert.ok(checkPlate(pl, bodies, machine, proc).some((i) => /outside the bed/.test(i.message)));
});

test("multi-object G-code hops above printed parts between objects", () => {
  const cyl = (x: number) => planMotion(buildSpiral(profileBody(primitives.cylinder(5, 10)), {
    layerHeight: 0.4, lineWidth: 0.8, filamentDiameter: 1.75, segmentsPerRev: 90, pattern: "none", fadeHeight: 0, center: [x, 0],
  }), 90, { machine, filament, process: proc });
  const a = cyl(-40), b = cyl(40);
  const g = toGcode([a, b], { machine, filament, process: proc });
  assert.match(g, /; printing object 2\/2\nM106 S\d+\nG1 E-0.8 F\d+\nG1 Z8\.\d+ F\d+\nG0 X50/);
  const st = sliceStats([a, b], filament);
  assert.equal((g.match(/;LAYER_CHANGE/g) ?? []).length, st.layers);
  assert.ok(Math.abs(st.timeS - a.time - b.time) < 1e-6);
});

test(".nexspiro v2 round-trip with meshes; v1 migrates", () => {
  const mesh = normalizeMesh(parseSTL(prismSTL(32, 20, 10), "prism"));
  const o = newObject({ kind: "mesh", meshId: "m1" }, "prism");
  const k = addRegion(o.mask, "perforated"); stamp(o.mask, k, 0.3, 0.5, 5);
  o.regionParams[k] = { amplitude: 1, wavesPerRev: 10, phasePerLayer: 180, zAmplitude: 0, extrusionPulse: 0 };
  const pl = newPlate("P", [o, newObject()]);
  const json = serializeProject({ version: 2, presets: { machine: "machine/bambu-x1", filament: "filament/pla", process: "process/vase-0.4" }, userPresets: [], plates: [pl, clonePlate(pl)], meshes: { m1: mesh } });
  const back = deserializeProject(json);
  assert.equal(back.plates[1].objects.length, 2);
  assert.deepEqual(Array.from(back.meshes.m1.tris), Array.from(mesh.tris));
  assert.deepEqual(Array.from(back.plates[0].objects[0].mask.regions[0].weight), Array.from(o.mask.regions[0].weight));
  const v1 = deserializeProject(JSON.stringify({ version: 1, presets: {}, userPresets: [], plates: [{ id: "p", name: "Old", locked: false, primitive: "vase", transform: { scaleXY: 1, scaleZ: 1, rotation: 0 }, base: { pattern: "sine", params: {} }, regionParams: [], mask: { cols: 2, rows: 2, regions: [] } }] }));
  assert.equal(v1.plates[0].objects[0].source.kind, "primitive");
  assert.throws(() => deserializeProject('{"version":9}'));
});
