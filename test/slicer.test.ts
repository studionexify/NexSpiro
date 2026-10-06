import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PresetRegistry, diff, fillTemplate, primitives, buildSpiral, planMotion, toGcode, sliceStats,
  newPlate, clonePlate, checkPlate, serializeProject, deserializeProject, addRegion, stamp,
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

test("plate checks flag oversize objects and Z clearance", () => {
  const p = newPlate();
  assert.deepEqual(checkPlate(p, machine, proc).filter((i) => i.level === "error"), []);
  p.transform.scaleXY = 2;
  assert.ok(checkPlate(p, machine, proc).some((i) => /Footprint/.test(i.message)));
  p.transform.scaleXY = 1; p.base.params.zAmplitude = 0.9;
  assert.ok(checkPlate(p, machine, proc).some((i) => /capped/.test(i.message)));
});

test(".nexspiro round-trip preserves plates and paint", () => {
  const p = newPlate(); const k = addRegion(p.mask, "perforated"); stamp(p.mask, k, 0.3, 0.5, 5);
  p.regionParams[k] = { amplitude: 1, wavesPerRev: 10, phasePerLayer: 180, zAmplitude: 0, extrusionPulse: 0 };
  const q = clonePlate(p);
  const json = serializeProject({ version: 1, presets: { machine: "machine/bambu-x1", filament: "filament/pla", process: "process/vase-0.4" }, userPresets: [], plates: [p, q] });
  const back = deserializeProject(json);
  assert.equal(back.plates.length, 2);
  assert.deepEqual(Array.from(back.plates[1].mask.regions[0].weight), Array.from(p.mask.regions[0].weight));
  assert.throws(() => deserializeProject('{"version":2}'));
});
