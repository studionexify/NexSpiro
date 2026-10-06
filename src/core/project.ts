import { patterns, type PatternParams } from "./patterns.ts";
import { primitives, type PrimitiveName, type Profile } from "./primitives.ts";
import { createMask, type PaintMask } from "./mask.ts";
import type { MachinePreset, ProcessPreset, Preset } from "./presets.ts";

// Multi-plate project model + .nexspiro (JSON) container.
export type ObjectTransform = { scaleXY: number; scaleZ: number; rotation: number };
export type Plate = {
  id: string; name: string; locked: boolean;
  primitive: PrimitiveName; transform: ObjectTransform;
  base: { pattern: string; params: PatternParams };
  regionParams: PatternParams[];
  mask: PaintMask;
};
export type Project = {
  version: 1;
  presets: { machine: string; filament: string; process: string };
  userPresets: Preset[];
  plates: Plate[];
};

let plateSeq = 0;
export function newPlate(name?: string): Plate {
  plateSeq++;
  return {
    id: `plate-${Date.now().toString(36)}-${plateSeq}`, name: name ?? `Plate ${plateSeq}`, locked: false,
    primitive: "bowl", transform: { scaleXY: 1, scaleZ: 1, rotation: 0 },
    base: { pattern: "knit", params: { ...patterns.knit.defaults } }, regionParams: [], mask: createMask(256, 256),
  };
}
export function clonePlate(p: Plate): Plate {
  const c = newPlate(`${p.name} copy`);
  return {
    ...c, primitive: p.primitive, transform: { ...p.transform }, base: { pattern: p.base.pattern, params: { ...p.base.params } },
    regionParams: p.regionParams.map((r) => ({ ...r })),
    mask: { cols: p.mask.cols, rows: p.mask.rows, regions: p.mask.regions.map((r) => ({ ...r, params: r.params && { ...r.params }, weight: r.weight.slice() })) },
  };
}
export const plateProfile = (p: Plate): Profile => primitives[p.primitive]();

// ---- collision / fit checks (footprint + toolhead envelope + non-linear Z clearance) ----
export type PlateIssue = { level: "error" | "warn"; message: string };
export function checkPlate(p: Plate, machine: MachinePreset, process: ProcessPreset): PlateIssue[] {
  const prof = plateProfile(p), issues: PlateIssue[] = [];
  let rMax = 0;
  for (let i = 0; i <= 100; i++) rMax = Math.max(rMax, prof.radius(i / 100));
  const amp = Math.max(p.base.params.amplitude, ...p.regionParams.map((r) => r.amplitude), 0);
  const zAmp = process.nonLinear.enabled ? Math.min(machine.zWobbleMax, Math.max(p.base.params.zAmplitude, ...p.regionParams.map((r) => r.zAmplitude), 0)) : 0;
  const footprint = 2 * (rMax * p.transform.scaleXY + amp + process.nonLinear.collisionMargin);
  const height = prof.height * p.transform.scaleZ + zAmp + process.nonLinear.collisionMargin;
  if (footprint > Math.min(...machine.bed)) issues.push({ level: "error", message: `Footprint ${footprint.toFixed(0)} mm exceeds bed ${machine.bed.join("×")} mm` });
  if (height > machine.maxHeight) issues.push({ level: "error", message: `Height ${height.toFixed(0)} mm (incl. Z wobble + margin) exceeds ${machine.maxHeight} mm` });
  const zReq = Math.max(p.base.params.zAmplitude, ...p.regionParams.map((r) => r.zAmplitude), 0);
  if (process.nonLinear.enabled && zReq > machine.zWobbleMax)
    issues.push({ level: "warn", message: `Z wobble ${zReq} mm capped to ${machine.zWobbleMax} mm by toolhead clearance` });
  return issues;
}

// ---- .nexspiro serialization (paint weights as base64 Float32) ----
const toB64 = (a: Float32Array) => {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => {
  const bin = atob(s), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new Float32Array(b.buffer);
};

export function serializeProject(p: Project): string {
  return JSON.stringify({
    ...p,
    plates: p.plates.map((pl) => ({
      ...pl, mask: { cols: pl.mask.cols, rows: pl.mask.rows, regions: pl.mask.regions.map((r) => ({ pattern: r.pattern, params: r.params, weight: toB64(r.weight) })) },
    })),
  });
}
export function deserializeProject(json: string): Project {
  const raw = JSON.parse(json);
  if (raw.version !== 1 || !Array.isArray(raw.plates)) throw new Error("Not a NexSpiro v1 project");
  for (const pl of raw.plates) {
    if (!(pl.primitive in primitives)) throw new Error(`Unknown primitive: ${pl.primitive}`);
    for (const r of pl.mask.regions) {
      if (!(r.pattern in patterns)) throw new Error(`Unknown pattern: ${r.pattern}`);
      r.weight = fromB64(r.weight);
      if (r.weight.length !== pl.mask.cols * pl.mask.rows) throw new Error("Paint mask size mismatch");
    }
  }
  return raw as Project;
}
