import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import {
  PresetRegistry, primitives, buildSpiral, planMotion, toGcode, sliceStats, profileBody, meshBody, normalizeMesh, parseSTL,
  newPlate, newObject, arrangePlate, checkPlate, objectBody, addRegion, stamp, sample,
  type MachinePreset, type FilamentPreset, type ProcessPreset, type Mesh, type Project,
} from "../src/core/index.ts";
import { parseOBJ } from "../src/io/importers/obj.ts";
import { parsePLY } from "../src/io/importers/ply.ts";
import { importSTEP } from "../src/io/importers/step.ts";
import { import3MF } from "../src/io/importers/threemf.ts";
import { importProfileJSON, importPrusaINI, convertGcodeTemplate, toBambuSettings } from "../src/io/importers/profiles.ts";
import { toolheadEnvelope, parseBedExclusionSVG } from "../src/io/importers/machineGeometry.ts";
import { importFile } from "../src/io/importers/index.ts";
import { decodeTriangleSelector, dominantState, encodeState } from "../src/io/paint.ts";
import { paintMeshToMask } from "../src/io/paintmap.ts";
import { export3MF } from "../src/io/exporters/threemf.ts";
import { writeProjectArchive, readProjectArchive } from "../src/io/exporters/project.ts";
import { writeSTL, writeOBJ, bakeToolpath, tessellateBody, transformMesh } from "../src/io/exporters/mesh.ts";
import { trajectoryCSV, trajectoryJSON } from "../src/io/exporters/trajectory.ts";

const reg = new PresetRegistry();
const machine = reg.resolve<"machine">("machine/bambu-x1") as MachinePreset;
const filament = reg.resolve<"filament">("filament/pla") as FilamentPreset;
const proc = reg.resolve<"process">("process/vase-0.4") as ProcessPreset;

/** Closed n-gon prism, radius r, height h, as triangle soup. */
function prism(n: number, r: number, h: number, ox = 0, oy = 0): Float32Array {
  const t: number[] = [], P = (k: number, z: number) => [ox + r * Math.cos((2 * Math.PI * k) / n), oy + r * Math.sin((2 * Math.PI * k) / n), z];
  for (let k = 0; k < n; k++) {
    t.push(...P(k, 0), ...P(k + 1, 0), ...P(k + 1, h), ...P(k, 0), ...P(k + 1, h), ...P(k, h));
    t.push(ox, oy, 0, ...P(k + 1, 0), ...P(k, 0), ox, oy, h, ...P(k, h), ...P(k + 1, h));
  }
  return new Float32Array(t);
}
const signedVolume = (t: Float32Array) => {
  let v = 0;
  for (let f = 0; f < t.length; f += 9) v += (t[f] * (t[f + 4] * t[f + 8] - t[f + 5] * t[f + 7]) - t[f + 1] * (t[f + 3] * t[f + 8] - t[f + 5] * t[f + 6]) + t[f + 2] * (t[f + 3] * t[f + 7] - t[f + 4] * t[f + 6])) / 6;
  return v;
};

// ---------------- polygon formats ----------------
test("OBJ: quads, groups, negative indices, normals, materials", () => {
  const obj = `# cube-ish
v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvn 0 0 1
o first
usemtl red
f 1/1/1 2/1/1 3/1/1 4/1/1
g second
usemtl blue
f -4//1 -3//1 -2//1`;
  const ms = parseOBJ(obj, "t");
  assert.equal(ms.length, 2);
  assert.equal(ms[0].name, "first"); assert.equal(ms[0].tris.length, 18); // quad → 2 tris
  assert.ok(ms[0].normals && ms[0].normals[2] === 1);
  assert.deepEqual(ms[1].materials, ["red", "blue"]); assert.equal(ms[1].triMaterial![0], 1);
  assert.deepEqual(Array.from(ms[1].tris.slice(0, 3)), [0, 0, 0]);
  assert.throws(() => parseOBJ("v 0 0 0\nf 1 2 3"), /out of range/);
});

test("PLY: ascii and binary (LE + BE) with vertex colours", () => {
  const ascii = `ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 255 0 0\n1 0 0 0 255 0\n0 1 0 0 0 255\n3 0 1 2\n`;
  const a = parsePLY(strToU8(ascii).buffer as ArrayBuffer);
  assert.equal(a.tris.length, 9); assert.deepEqual(Array.from(a.colors!.slice(0, 3)), [1, 0, 0]);
  for (const le of [true, false]) {
    const head = strToU8(`ply\nformat binary_${le ? "little" : "big"}_endian 1.0\nelement vertex 3\nproperty double x\nproperty double y\nproperty double z\nelement face 1\nproperty list uchar uint vertex_indices\nend_header\n`);
    const body = new DataView(new ArrayBuffer(3 * 24 + 1 + 12));
    [[0, 0, 0], [2, 0, 0], [0, 2, 1]].forEach((p, i) => p.forEach((v, k) => body.setFloat64(i * 24 + k * 8, v, le)));
    body.setUint8(72, 3); [0, 1, 2].forEach((v, k) => body.setUint32(73 + k * 4, v, le));
    const buf = new Uint8Array(head.length + body.byteLength); buf.set(head); buf.set(new Uint8Array(body.buffer), head.length);
    const m = parsePLY(buf.buffer);
    assert.deepEqual(Array.from(m.tris), [0, 0, 0, 2, 0, 0, 0, 2, 1], le ? "LE" : "BE");
  }
  assert.throws(() => parsePLY(strToU8("ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n0\n").buffer as ArrayBuffer), /x\/y\/z/);
});

test("STEP via OpenCASCADE: analytic normals and deflection control", async () => {
  const require = createRequire(import.meta.url);
  const occt = await require("occt-import-js")();
  const bytes = readFileSync(require.resolve("occt-import-js/test/testfiles/rounded-cube/rounded-cube.step"));
  const coarse = importSTEP(occt, bytes, "rc", { linearDeflection: 0.1, angularDeflection: 0.5 });
  const fine = importSTEP(occt, bytes, "rc", { linearDeflection: 0.001, angularDeflection: 0.05 });
  assert.ok(fine[0].tris.length > coarse[0].tris.length, "finer deflection → more triangles");
  const n = fine[0].normals!;
  for (let i = 0; i < n.length; i += 3) assert.ok(Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) < 1e-3);
  // and it slices: 10 mm cube with rounded edges
  const body = meshBody(normalizeMesh({ ...fine[0], tris: fine[0].tris.slice() }));
  assert.ok(Math.abs(body.height - 10) < 0.01);
  const r = await importFile("cube.step", new Uint8Array(bytes), { loadOcct: async () => occt });
  assert.equal(r.kind, "meshes");
  await assert.rejects(importFile("x.step", strToU8("hello")), /not a STEP/);
});

// ---------------- paint codec ----------------
test("TriangleSelector paint strings decode/encode", () => {
  assert.deepEqual(decodeTriangleSelector("4"), [{ state: 1, area: 1 }]);
  assert.equal(dominantState("8"), 2);
  assert.equal(dominantState("2C"), 5);                       // extended state 3 + 2
  assert.equal(dominantState("80443"), 1);                    // 4-way split: [1, 1, 0, 2] → 1 covers ½
  assert.deepEqual(decodeTriangleSelector("80443").map((l) => l.state), [1, 1, 0, 2]);
  for (const s of [1, 2, 3, 4, 9, 18]) assert.equal(dominantState(encodeState(s)), s);
  assert.equal(encodeState(0), "");
  assert.throws(() => decodeTriangleSelector("3"), /Truncated/);
});

// ---------------- 3MF ----------------
function bambuFixture(): Uint8Array {
  // Bambu-style: geometry in 3D/Objects/*.model referenced through components; 2 plates; project settings; paint.
  const tris = prism(32, 20, 30);
  const verts: string[] = [], tri: string[] = [];
  for (let i = 0; i < tris.length; i += 3) verts.push(`<vertex x="${tris[i]}" y="${tris[i + 1]}" z="${tris[i + 2]}"/>`);
  for (let f = 0; f < tris.length / 9; f++) {
    const cx = (tris[f * 9] + tris[f * 9 + 3] + tris[f * 9 + 6]) / 3, cz = (tris[f * 9 + 2] + tris[f * 9 + 5] + tris[f * 9 + 8]) / 3;
    const paint = cx > 15 && cz > 1 && cz < 29 ? ` paint_color="8"` : f === 2 ? ` paint_supports="4"` : ""; // f=2: a bottom-cap facet // +X side → extruder 2
    tri.push(`<triangle v1="${f * 3}" v2="${f * 3 + 1}" v3="${f * 3 + 2}"${paint}/>`);
  }
  const objModel = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${verts.join("")}</vertices><triangles>${tri.join("")}</triangles></mesh></object></resources><build/></model>`;
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources>
    <object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>
    <object id="4" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="0.5 0 0 0 0.5 0 0 0 0.5 0 0 0"/></components></object>
  </resources><build>
    <item objectid="2" transform="1 0 0 0 1 0 0 0 1 100 120 0"/>
    <item objectid="4" transform="1 0 0 0 1 0 0 0 1 ${256 * 1.2 + 128} 128 0"/>
  </build></model>`;
  const cfg = `<?xml version="1.0"?><config>
    <object id="2"><metadata key="name" value="Vase A"/></object><object id="4"><metadata key="name" value="Vase B"/></object>
    <plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="Main"/><metadata key="locked" value="false"/><model_instance><metadata key="object_id" value="2"/></model_instance></plate>
    <plate><metadata key="plater_id" value="2"/><metadata key="locked" value="true"/><model_instance><metadata key="object_id" value="4"/></model_instance></plate>
  </config>`;
  const settings = {
    printer_settings_id: "Bambu Lab X1 Carbon 0.4 nozzle", printer_model: "Bambu Lab X1 Carbon", gcode_flavor: "marlin",
    printable_area: ["0x0", "256x0", "256x256", "0x256"], printable_height: "250", nozzle_diameter: ["0.4"],
    filament_settings_id: ["Bambu PLA Basic"], nozzle_temperature: ["220"], nozzle_temperature_initial_layer: ["225"], hot_plate_temp: ["55"],
    filament_max_volumetric_speed: ["21"], print_settings_id: "0.20mm Standard", layer_height: "0.2", outer_wall_speed: "200", spiral_mode: "0",
    machine_start_gcode: "M140 S[bed_temperature_initial_layer_single]\nM104 S[nozzle_temperature_initial_layer]\n{if curr_bed_type==\"Textured PEI Plate\"}G29.1 Z{-0.04}{endif}",
  };
  return zipSync({
    "[Content_Types].xml": strToU8(`<Types/>`),
    "_rels/.rels": strToU8(`<Relationships><Relationship Target="/3D/3dmodel.model" Id="r0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    "3D/3dmodel.model": strToU8(root), "3D/Objects/object_1.model": strToU8(objModel),
    "Metadata/model_settings.config": strToU8(cfg), "Metadata/project_settings.config": strToU8(JSON.stringify(settings)),
  });
}

test("3MF import: Bambu components, plates, positions, presets, paint", () => {
  const r = import3MF(bambuFixture());
  assert.equal(r.objects.length, 2);
  assert.deepEqual(r.plates, [{ name: "Main", locked: false }, { name: "Plate 2", locked: true }]);
  const [a, b] = r.objects;
  assert.equal(a.name, "Vase A"); assert.equal(a.plate, 0);
  assert.ok(Math.abs(a.x - (100 - 128)) < 1e-3 && Math.abs(a.y - (120 - 128)) < 1e-3, `A at ${a.x},${a.y}`);
  assert.equal(b.plate, 1);
  assert.ok(Math.abs(b.x) < 1e-3 && Math.abs(b.y) < 1e-3, `B centred on plate 2: ${b.x},${b.y}`);
  assert.ok(Math.abs(meshBody(b.mesh).height - 15) < 1e-3, "component scale applied");
  assert.ok(a.mesh.paint?.color?.filter(Boolean).length! > 0);
  // presets
  const machineP = r.presets.find((p) => p.kind === "machine")!;
  assert.equal((machineP.values as MachinePreset).flavor, "bambu");
  assert.deepEqual((machineP.values as MachinePreset).bed, [256, 256]);
  assert.match((machineP.values as MachinePreset).startGcode!, /M140 S\{bed_temperature_initial_layer\}\nM104 S\{nozzle_temperature_initial_layer\}/);
  assert.ok(r.warnings.some((w) => /conditional/.test(w)), "Bambu {if} expressions flagged");
  assert.ok(r.warnings.some((w) => /spiral/.test(w)));
  assert.ok(r.warnings.some((w) => /support\/seam/.test(w)));
  // paint → region 2 (index 1) on the +X side, nothing on −X
  const o = newObject({ kind: "mesh", meshId: "a" });
  const res = paintMeshToMask(a.mesh, meshBody(a.mesh), o.mask);
  assert.equal(res.maxState, 2); assert.equal(o.mask.regions.length, 2);
  assert.ok(sample(o.mask, 1, 0.0, 0.5) > 0.9, "+X painted");
  assert.equal(sample(o.mask, 1, 0.5, 0.5), 0, "−X not painted");
  assert.equal(o.mask.regions[0].weight.reduce((s, w) => s + w, 0), 0, "extruder 1 unused");
});

test("3MF export → import round trip (plates, transforms, paint, NexSpiro extension)", () => {
  const mesh = normalizeMesh({ name: "prism", tris: prism(48, 15, 20) });
  const meshes: Record<string, Mesh> = { m1: mesh };
  const o1 = newObject({ kind: "mesh", meshId: "m1" }, "prism"); o1.transform = { x: -40, y: 10, scaleXY: 1.5, scaleZ: 0.5, rotation: 30 };
  const k = addRegion(o1.mask, "ribbed"); stamp(o1.mask, k, 0.25, 0.5, 90); // tall side facets: centroids at t = ⅓, ⅔ must get weight > ½
  const o2 = newObject({ kind: "primitive", primitive: "cylinder" }); o2.transform.x = 50;
  const plates = [newPlate("One", [o1]), newPlate("Two", [o2])];
  const settings = toBambuSettings({ machine, filament: filament as never, process: proc as never }, { machine: "M", filament: "F", process: "P" });
  const bytes = export3MF({ plates, meshes, bed: machine.bed, projectSettings: settings, nexspiroArchive: writeProjectArchive({ version: 2, presets: { machine: "machine/bambu-x1", filament: "filament/pla", process: "process/vase-0.4" }, userPresets: [], plates, meshes }), thumbnails: [new Uint8Array([137, 80, 78, 71])] });
  const files = unzipSync(bytes);
  assert.ok(files["Metadata/plate_1.png"] && files["Metadata/model_settings.config"] && files["[Content_Types].xml"]);
  const back = import3MF(bytes, machine.bed);
  assert.equal(back.objects.length, 2); assert.equal(back.plates[1].name, "Two");
  const [a, b] = back.objects;
  assert.ok(Math.abs(a.x + 40) < 0.05 && Math.abs(a.y - 10) < 0.05, `${a.x},${a.y}`);
  assert.ok(Math.abs(meshBody(a.mesh).height - 10) < 1e-3, "scaleZ baked");
  assert.ok(Math.abs(b.x - 50) < 0.05 && b.plate === 1);
  assert.equal(back.project!.plates[0].objects[0].transform.rotation, 30, "embedded project is lossless");
  assert.equal(back.project!.plates[0].objects[0].mask.regions[0].pattern, "ribbed");
  const painted = a.mesh.paint!.color!.filter(Boolean).length;
  assert.ok(painted > 0 && painted < a.mesh.tris.length / 9, "only the painted patch carries paint_color");
  assert.equal((back.presets.find((p) => p.kind === "filament")!.values as FilamentPreset).nozzleTemp, filament.nozzleTemp);
});

// ---------------- profiles ----------------
test("Orca/Bambu JSON profile and PrusaSlicer INI bundle import", () => {
  const j = importProfileJSON(JSON.stringify({ type: "filament", name: "My PETG", inherits: "Generic PETG @base", nozzle_temperature: ["245"], filament_flow_ratio: ["0.96"], hot_plate_temp: ["80"] }));
  assert.equal(j.presets[0].kind, "filament"); assert.equal(j.presets[0].inherits, "filament/pla");
  assert.deepEqual(j.presets[0].values, { flowRatio: 0.96, nozzleTemp: 245, bedTemp: 80 });
  assert.ok(j.warnings.some((w) => /Parent/.test(w)));
  const r = new PresetRegistry(); for (const p of j.presets) r.add(p);
  assert.equal((r.resolve<"filament">(j.presets[0].id) as FilamentPreset).density, 1.24); // falls back to base
  const ini = `[print:Vase 0.3]\nlayer_height = 0.3\nfirst_layer_height = 0.35\nexternal_perimeter_speed = 50%\nperimeter_speed = 40\n[filament:PLA hot]\ntemperature = 215\nfirst_layer_temperature = 220\nextrusion_multiplier = 0.97\n[printer:MK3S]\nbed_shape = 0x0,250x0,250x210,0x210\nmax_print_height = 210\ngcode_flavor = marlin2\nstart_gcode = M104 S[first_layer_temperature]\\nM140 S[first_layer_bed_temperature]\n[presets]\nprint = Vase 0.3\n`;
  const p = importPrusaINI(ini);
  assert.deepEqual(p.presets.map((x) => x.kind).sort(), ["filament", "machine", "process"]);
  const m = p.presets.find((x) => x.kind === "machine")!.values as MachinePreset;
  assert.deepEqual(m.bed, [250, 210]); assert.equal(m.flavor, "marlin");
  assert.equal(m.startGcode, "M104 S{nozzle_temperature_initial_layer}\nM140 S{bed_temperature_initial_layer}");
  assert.equal((p.presets.find((x) => x.kind === "process")!.values as ProcessPreset).wallSpeed, 40); // % skipped → fallback key
  assert.deepEqual(convertGcodeTemplate("[foo] {layer_z}").unknown, ["foo"]);
  // export direction: our end G-code becomes Bambu syntax with machine constants filled in, and re-imports cleanly
  const bambu = toBambuSettings({ machine, filament: filament as never, process: proc as never }, { machine: "M", filament: "F", process: "P" });
  assert.match(String(bambu.machine_end_gcode), /G1 X0 Y256 F30000/);
  assert.match(String(bambu.machine_start_gcode), /M140 S\[bed_temperature_initial_layer_single\]/);
  assert.deepEqual(convertGcodeTemplate(String(bambu.machine_start_gcode)).unknown, []);
});

// ---------------- machine geometry ----------------
test("toolhead mesh → clearance envelope; SVG exclusion blocks arrange", () => {
  const nozzle = prism(16, 3, 10, 5, 5);                      // tip at z=0, r=3 around (5,5)
  const carriage = prism(4, 30, 20, 5, 5).map((v, i) => (i % 3 === 2 ? v + 10 : v)); // r≈30 from 10..30
  const gantry = prism(4, 200, 5, 5, 5).map((v, i) => (i % 3 === 2 ? v + 40 : v));  // way wider, above 40
  const env = toolheadEnvelope({ name: "th", tris: new Float32Array([...nozzle, ...carriage, ...gantry]) }, 35);
  assert.ok(Math.abs(env.clearanceRadius - 30) < 0.2, `radius ${env.clearanceRadius}`);
  assert.equal(env.clearanceHeight, 35);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256mm" height="256mm" viewBox="0 0 256 256"><g><rect x="0" y="0" width="40" height="256"/><path d="M 200 256 l 56 0 v -30 h -56 Z"/></g></svg>`;
  const { polygons } = parseBedExclusionSVG(svg);
  assert.equal(polygons.length, 2);
  assert.deepEqual(polygons[0][0], [0, 256]); // SVG top-left → bed back-left
  const m2 = { ...machine, bedExclude: polygons };
  const pl = newPlate("P", [newObject({ kind: "primitive", primitive: "cylinder" })]);
  pl.objects[0].transform.x = -110; // centre at bed x=18: inside the left keep-out
  const bodies = pl.objects.map((o) => objectBody(o, {}));
  assert.ok(checkPlate(pl, bodies, m2, proc).some((i) => /exclusion/.test(i.message)));
  assert.deepEqual(arrangePlate(pl, bodies, m2, proc), []);
  assert.ok(!checkPlate(pl, bodies, m2, proc).some((i) => /exclusion/.test(i.message)), "arranged out of the zone");
});

// ---------------- exports ----------------
const cylMotion = (pattern: string, p = proc) => planMotion(buildSpiral(profileBody(primitives.cylinder(10, 25)), {
  layerHeight: p.layerHeight, lineWidth: p.lineWidth, filamentDiameter: 1.75, segmentsPerRev: 360, pattern, fadeHeight: 0, center: [0, 0], zCap: machine.zWobbleMax,
}), 360, { machine, filament, process: p });

test("G-code: helical arc fitting on plain walls, none on non-planar knit; E preserved", () => {
  const P = { ...proc, arcFitting: true, arcTolerance: 0.02, nonLinear: { ...proc.nonLinear, deviationTol: 0 } };
  const plain = cylMotion("none", P), g = toGcode(plain, { machine, filament, process: P });
  const arcs = g.split("\n").filter((l) => /^G[23] /.test(l));
  assert.ok(arcs.length > 10, `arcs: ${arcs.length}`);
  for (const l of arcs.slice(0, 20)) assert.match(l, /^G3 X[\d.-]+ Y[\d.-]+ Z[\d.]+ I[\d.-]+ J[\d.-]+ E[\d.]+ F\d+$/);
  const sumE = (s: string) => s.split("\n").filter((l) => /^G[123] .*E[\d.]+/.test(l) && !/E-/.test(l)).reduce((a, l) => a + Number(l.match(/E([\d.]+)/)![1]), 0);
  assert.ok(Math.abs(sumE(g) - plain.e[plain.count - 1] * filament.flowRatio) < 0.01);
  const knit = cylMotion("knit", P);
  assert.equal(toGcode(knit, { machine, filament, process: P }).split("\n").filter((l) => /^G[23] /.test(l)).length, 0);
});

test("G-code: Z-speed guard, 3 thumbnail sizes, non-linear distance header", () => {
  const knit = cylMotion("knit");
  assert.throws(() => toGcode(knit, { machine: { ...machine, maxZSpeed: 0.5 }, filament, process: proc }), /Z speed/);
  const thumbs = [32, 300, 600].map((s) => ({ width: s, height: s, pngBase64: "iVBORw0KGgo=" }));
  const g = toGcode(knit, { machine, filament, process: proc, thumbnails: thumbs });
  for (const s of [32, 300, 600]) assert.match(g, new RegExp(`; thumbnail begin ${s}x${s} 12`));
  const st = sliceStats(knit, filament);
  assert.ok(st.nonLinearMm > 0);
  assert.match(g, new RegExp(`; nonlinear motion distance \\[mm\\] = ${st.nonLinearMm.toFixed(1)}`));
  assert.equal(sliceStats(cylMotion("sine"), filament).nonLinearMm, 0);
});

test("trajectory CSV/JSON: one row per move, unit normals", () => {
  const mp = cylMotion("knit"), csv = trajectoryCSV([mp]).trim().split("\n");
  assert.equal(csv.length, mp.count + 1);
  assert.equal(csv[0], "object,i,x,y,z,e,f,nx,ny,nz,curvature,layer,tag,z_offset");
  for (const row of csv.slice(1, 200)) { const c = row.split(",").map(Number); assert.ok(Math.abs(Math.hypot(c[7], c[8], c[9]) - 1) < 1e-3); }
  const j = JSON.parse(trajectoryJSON([mp]));
  assert.equal(j.objects[0].x.length, mp.count);
  // bowl walls lean outward → normals tilt downward
  const bowl = planMotion(buildSpiral(profileBody(primitives.bowl()), { layerHeight: 0.4, lineWidth: 0.8, filamentDiameter: 1.75, segmentsPerRev: 360, pattern: "none", fadeHeight: 0, center: [0, 0] }), 360, { machine, filament, process: proc });
  assert.ok(bowl.normal[300 * 3 + 2] < -0.1);
});

test("mesh export: STL/OBJ, closed tessellation, baked textured wall", () => {
  const body = profileBody(primitives.vase());
  const tess = tessellateBody(body, "vase", 48, 96);
  assert.ok(signedVolume(tess.tris) > 0, "outward winding");
  const stl = writeSTL([transformMesh(tess, { x: 10, y: 0, scaleXY: 1, scaleZ: 1, rotation: 0 })]);
  const back = parseSTL(stl.buffer as ArrayBuffer);
  assert.equal(back.tris.length, tess.tris.length);
  assert.ok(Math.abs(back.tris[0] - tess.tris[0] - 10) < 1e-4);
  const obj = writeOBJ([tess]); const ms = parseOBJ(obj);
  assert.equal(ms[0].tris.length, tess.tris.length);
  // one revolution (no stacked layers touching), so the swept bead must be a closed solid on its own
  const mp = planMotion(buildSpiral(profileBody(primitives.cylinder(0.4, 25)), { layerHeight: 0.4, lineWidth: 0.8, filamentDiameter: 1.75, segmentsPerRev: 360, pattern: "knit", fadeHeight: 0, center: [0, 0], zCap: machine.zWobbleMax }), 360, { machine, filament, process: proc });
  // trim to 300° so the spiral's end does not sit on its own start (beads that touch share edges legitimately)
  const n = 300, cut = { ...mp, count: n, xyz: mp.xyz.slice(0, n * 3), normal: mp.normal.slice(0, n * 3) };
  const baked = bakeToolpath(cut, 0.8, 0.4);
  // closed: every edge shared by exactly two faces
  const edges = new Map<string, number>(), key = (i: number) => `${baked.tris[i].toFixed(4)},${baked.tris[i + 1].toFixed(4)},${baked.tris[i + 2].toFixed(4)}`;
  for (let f = 0; f < baked.tris.length; f += 9) for (let e = 0; e < 3; e++) {
    const a = key(f + e * 3), b = key(f + ((e + 1) % 3) * 3), k = a < b ? a + b : b + a;
    edges.set(k, (edges.get(k) ?? 0) + 1);
  }
  assert.ok([...edges.values()].every((c) => c === 2), "watertight");
  let len = 0; for (let i = 1; i < n; i++) len += Math.hypot(mp.xyz[i * 3] - mp.xyz[i * 3 - 3], mp.xyz[i * 3 + 1] - mp.xyz[i * 3 - 2], mp.xyz[i * 3 + 2] - mp.xyz[i * 3 - 1]);
  // knit zig-zags tighter than the bead width, so beads overlap on inner corners: volume is positive but below len·w·h.
  assert.ok(signedVolume(baked.tris) > 0);
  // plain wall: swept volume ≈ path length × bead cross-section
  const plain = planMotion(buildSpiral(profileBody(primitives.cylinder(0.4, 25)), { layerHeight: 0.4, lineWidth: 0.8, filamentDiameter: 1.75, segmentsPerRev: 360, pattern: "none", fadeHeight: 0, center: [0, 0] }), 360, { machine, filament, process: { ...proc, nonLinear: { ...proc.nonLinear, deviationTol: 0 } } });
  const pc = { ...plain, count: n, xyz: plain.xyz.slice(0, n * 3), normal: plain.normal.slice(0, n * 3) };
  let plen = 0; for (let i = 1; i < n; i++) plen += Math.hypot(pc.xyz[i * 3] - pc.xyz[i * 3 - 3], pc.xyz[i * 3 + 1] - pc.xyz[i * 3 - 2], pc.xyz[i * 3 + 2] - pc.xyz[i * 3 - 1]);
  const vol = signedVolume(bakeToolpath(pc, 0.8, 0.4).tris);
  assert.ok(Math.abs(vol - plen * 0.32) / (plen * 0.32) < 0.01, `volume ${vol} vs ${plen * 0.32}`);
  void len;
});

test(".nexspiro v3 archive round trip; legacy JSON still opens", async () => {
  const mesh: Mesh = { ...normalizeMesh({ name: "p", tris: prism(16, 10, 10) }), paint: { color: [], supports: ["4"], seam: [] }, colors: new Float32Array(16 * 4 * 9).fill(0.5) };
  const o = newObject({ kind: "mesh", meshId: "m" }); const k = addRegion(o.mask, "perforated"); stamp(o.mask, k, 0.5, 0.5, 4);
  const p: Project = { version: 2, presets: { machine: "machine/bambu-x1", filament: "filament/pla", process: "process/vase-0.4" }, userPresets: [], plates: [newPlate("A", [o, newObject()])], meshes: { m: mesh } };
  const zip = writeProjectArchive(p, [new Uint8Array([1, 2, 3])]);
  assert.equal(strFromU8(zip.subarray(0, 2)), "PK");
  const back = readProjectArchive(zip);
  assert.deepEqual(Array.from(back.meshes.m.tris), Array.from(mesh.tris));
  assert.deepEqual(back.meshes.m.paint, mesh.paint); assert.equal(back.meshes.m.colors!.length, mesh.colors!.length);
  assert.deepEqual(Array.from(back.plates[0].objects[0].mask.regions[0].weight), Array.from(o.mask.regions[0].weight));
  const viaDispatch = await importFile("x.nexspiro", zip); assert.equal(viaDispatch.kind, "project");
  const legacy = JSON.stringify({ version: 1, presets: {}, userPresets: [], plates: [{ id: "p", name: "Old", locked: false, primitive: "vase", transform: { scaleXY: 1, scaleZ: 1, rotation: 0 }, base: { pattern: "sine", params: {} }, regionParams: [], mask: { cols: 2, rows: 2, regions: [] } }] });
  assert.equal(readProjectArchive(strToU8(legacy)).plates[0].objects[0].source.kind, "primitive");
});
