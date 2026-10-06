import { patterns, type PatternParams } from "./patterns.ts";
import { primitiveDefs, buildPrimitive, type PrimitiveName } from "./primitives.ts";
import { createMask, type PaintMask } from "./mask.ts";
import { profileBody, meshBody, type Body } from "./body.ts";
import type { Mesh } from "./mesh.ts";
import type { MachinePreset, ProcessPreset, Preset } from "./presets.ts";

// Multi-plate, multi-object project model + .nexspiro (JSON) container.
export type ObjectTransform = { x: number; y: number; scaleXY: number; scaleZ: number; rotation: number }; // x,y: mm from bed centre
export type ObjectSource = { kind: "primitive"; primitive: PrimitiveName; params?: Record<string, number> } | { kind: "mesh"; meshId: string };
export type PlateObject = {
  id: string; name: string; source: ObjectSource; transform: ObjectTransform;
  base: { pattern: string; params: PatternParams };
  regionParams: PatternParams[];
  mask: PaintMask;
};
export type Plate = { id: string; name: string; locked: boolean; objects: PlateObject[] };
export type Project = {
  version: 2;
  presets: { machine: string; filament: string; process: string };
  userPresets: Preset[];
  plates: Plate[];
  meshes: Record<string, Mesh>;
};

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;
export function newObject(source: ObjectSource = { kind: "primitive", primitive: "bowl" }, name?: string): PlateObject {
  return {
    id: uid("obj"), name: name ?? (source.kind === "primitive" ? (primitiveDefs[source.primitive]?.label ?? source.primitive) : "mesh"), source,
    transform: { x: 0, y: 0, scaleXY: 1, scaleZ: 1, rotation: 0 },
    base: { pattern: "knit", params: { ...patterns.knit.defaults } }, regionParams: [], mask: createMask(256, 256),
  };
}
export function cloneObject(o: PlateObject): PlateObject {
  return {
    ...o, id: uid("obj"), name: `${o.name} copy`, source: { ...o.source, ...(o.source.kind === "primitive" && o.source.params ? { params: { ...o.source.params } } : {}) } as typeof o.source, transform: { ...o.transform },
    base: { pattern: o.base.pattern, params: { ...o.base.params } }, regionParams: o.regionParams.map((r) => ({ ...r })),
    mask: { cols: o.mask.cols, rows: o.mask.rows, regions: o.mask.regions.map((r) => ({ ...r, params: r.params && { ...r.params }, weight: r.weight.slice() })) },
  };
}
export function newPlate(name = "Plate", objects: PlateObject[] = [newObject()]): Plate {
  return { id: uid("plate"), name, locked: false, objects };
}
export const clonePlate = (p: Plate): Plate => ({ ...newPlate(`${p.name} copy`, p.objects.map(cloneObject)) });

export function objectBody(o: PlateObject, meshes: Record<string, Mesh>): Body {
  if (o.source.kind === "primitive") return profileBody(buildPrimitive(o.source.primitive, o.source.params));
  const m = meshes[o.source.meshId];
  if (!m) throw new Error(`Missing mesh ${o.source.meshId}`);
  return meshBody(m);
}

// ---- footprints, arrange, sequential-print clearance ----
const maxAmp = (o: PlateObject) => Math.max(o.base.params.amplitude, ...o.regionParams.map((r) => r.amplitude), 0);
const maxZAmp = (o: PlateObject) => Math.max(o.base.params.zAmplitude, ...o.regionParams.map((r) => r.zAmplitude), 0);
export const footprint = (o: PlateObject, b: Body, process: ProcessPreset) =>
  b.footprintRadius * o.transform.scaleXY + maxAmp(o) + process.nonLinear.collisionMargin;
export const objectHeight = (o: PlateObject, b: Body, machine: MachinePreset, process: ProcessPreset) =>
  b.height * o.transform.scaleZ + (process.nonLinear.enabled ? Math.min(machine.zWobbleMax, maxZAmp(o)) : 0);
/** Gap between footprints: sequential (by-object) printing needs the toolhead clearance radius. */
const spacing = (n: number, machine: MachinePreset) => (n > 1 ? machine.clearanceRadius : 0);

/** Does a footprint circle (bed-centre coordinates) touch any bed keep-out polygon? */
export function hitsExclusion(x: number, y: number, r: number, machine: MachinePreset): boolean {
  const [bx, by] = machine.bed, cx = x + bx / 2, cy = y + by / 2; // to bed-corner coordinates
  for (const poly of machine.bedExclude ?? []) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > cy) !== (yj > cy) && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
      const dx = xj - xi, dy = yj - yi, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((cx - xi) * dx + (cy - yi) * dy) / L2)) : 0;
      if (Math.hypot(cx - xi - t * dx, cy - yi - t * dy) < r) return true;
    }
    if (inside) return true;
  }
  return false;
}

/** Greedy circle packing on the bed, largest first, nearest-to-centre placement. Mutates transforms. */
export function arrangePlate(plate: Plate, bodies: Body[], machine: MachinePreset, process: ProcessPreset): string[] {
  const [bx, by] = machine.bed, gap = spacing(plate.objects.length, machine);
  const items = plate.objects.map((o, i) => ({ o, r: footprint(o, bodies[i], process) })).sort((a, b) => b.r - a.r);
  const placed: { x: number; y: number; r: number }[] = [], failed: string[] = [];
  const step = 2, cand: [number, number][] = [];
  for (let x = -bx / 2; x <= bx / 2; x += step) for (let y = -by / 2; y <= by / 2; y += step) cand.push([x, y]);
  cand.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  for (const { o, r } of items) {
    const spot = cand.find(([x, y]) =>
      Math.abs(x) + r <= bx / 2 && Math.abs(y) + r <= by / 2 && !hitsExclusion(x, y, r, machine) &&
      placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + gap));
    if (!spot) { failed.push(o.name); continue; }
    o.transform.x = spot[0]; o.transform.y = spot[1];
    placed.push({ x: spot[0], y: spot[1], r });
  }
  return failed;
}

/** Print order for by-object sequential printing: shortest first, tallest last. */
export function printOrder(plate: Plate, bodies: Body[], machine: MachinePreset, process: ProcessPreset): number[] {
  return plate.objects.map((_, i) => i).sort((a, b) =>
    objectHeight(plate.objects[a], bodies[a], machine, process) - objectHeight(plate.objects[b], bodies[b], machine, process));
}

export type PlateIssue = { level: "error" | "warn"; message: string };
export function checkPlate(plate: Plate, bodies: Body[], machine: MachinePreset, process: ProcessPreset): PlateIssue[] {
  const issues: PlateIssue[] = [], [bx, by] = machine.bed, objs = plate.objects;
  const gap = spacing(objs.length, machine);
  objs.forEach((o, i) => {
    const r = footprint(o, bodies[i], process), h = objectHeight(o, bodies[i], machine, process) + process.nonLinear.collisionMargin;
    if (Math.abs(o.transform.x) + r > bx / 2 || Math.abs(o.transform.y) + r > by / 2)
      issues.push({ level: "error", message: `${o.name}: outside the bed (footprint Ø${(2 * r).toFixed(0)} mm)` });
    if (hitsExclusion(o.transform.x, o.transform.y, r, machine))
      issues.push({ level: "error", message: `${o.name}: overlaps a bed exclusion zone` });
    if (h > machine.maxHeight) issues.push({ level: "error", message: `${o.name}: height ${h.toFixed(0)} mm exceeds ${machine.maxHeight} mm` });
    if (process.nonLinear.enabled && maxZAmp(o) > machine.zWobbleMax)
      issues.push({ level: "warn", message: `${o.name}: Z wobble ${maxZAmp(o)} mm capped to ${machine.zWobbleMax} mm by toolhead clearance` });
    for (const w of bodies[i].warnings) issues.push({ level: "warn", message: `${o.name}: ${w}` });
    for (let j = i + 1; j < objs.length; j++) {
      const d = Math.hypot(o.transform.x - objs[j].transform.x, o.transform.y - objs[j].transform.y);
      const need = r + footprint(objs[j], bodies[j], process) + gap;
      if (d < need) issues.push({ level: "error", message: `${o.name} ↔ ${objs[j].name}: ${d.toFixed(0)} mm apart, need ${need.toFixed(0)} mm (toolhead clearance)` });
    }
  });
  if (objs.length > 1) {
    const order = printOrder(plate, bodies, machine, process);
    for (const i of order.slice(0, -1)) {
      const h = objectHeight(objs[i], bodies[i], machine, process) + process.nonLinear.collisionMargin;
      if (h > machine.clearanceHeight)
        issues.push({ level: "error", message: `${objs[i].name}: ${h.toFixed(0)} mm tall, gantry clearance is ${machine.clearanceHeight} mm (only the last object may be taller)` });
    }
  }
  if (!objs.length) issues.push({ level: "warn", message: "Plate is empty" });
  return issues;
}

// ---- .nexspiro serialization ----
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
  const used = new Set(p.plates.flatMap((pl) => pl.objects.flatMap((o) => (o.source.kind === "mesh" ? [o.source.meshId] : []))));
  return JSON.stringify({
    ...p,
    meshes: Object.fromEntries(Object.entries(p.meshes).filter(([id]) => used.has(id)).map(([id, m]) => [id, { name: m.name, tris: toB64(m.tris) }])),
    plates: p.plates.map((pl) => ({
      ...pl, objects: pl.objects.map((o) => ({
        ...o, mask: { cols: o.mask.cols, rows: o.mask.rows, regions: o.mask.regions.map((r) => ({ pattern: r.pattern, params: r.params, weight: toB64(r.weight) })) },
      })),
    })),
  });
}

export function deserializeProject(json: string): Project {
  const raw = JSON.parse(json);
  if (raw.version === 1 && Array.isArray(raw.plates)) { // v1: one primitive per plate
    raw.plates = raw.plates.map((pl: Record<string, unknown>) => ({
      id: pl.id, name: pl.name, locked: pl.locked,
      objects: [{ id: uid("obj"), name: pl.primitive, source: { kind: "primitive", primitive: pl.primitive },
        transform: { x: 0, y: 0, ...(pl.transform as object) }, base: pl.base, regionParams: pl.regionParams, mask: pl.mask }],
    }));
    raw.meshes = {}; raw.version = 2;
  }
  if (raw.version !== 2 || !Array.isArray(raw.plates)) throw new Error("Not a NexSpiro project");
  for (const m of Object.values(raw.meshes ?? {}) as { tris: string | Float32Array }[]) {
    m.tris = fromB64(m.tris as string);
    if (m.tris.length % 9) throw new Error("Corrupt mesh data");
  }
  for (const pl of raw.plates) for (const o of pl.objects) {
    if (o.source.kind === "primitive" && !(o.source.primitive in primitiveDefs)) throw new Error(`Unknown primitive: ${o.source.primitive}`);
    if (o.source.kind === "mesh" && !raw.meshes[o.source.meshId]) throw new Error(`Missing mesh ${o.source.meshId}`);
    for (const r of o.mask.regions) {
      if (!(r.pattern in patterns)) throw new Error(`Unknown pattern: ${r.pattern}`);
      r.weight = fromB64(r.weight);
      if (r.weight.length !== o.mask.cols * o.mask.rows) throw new Error("Paint mask size mismatch");
    }
  }
  return raw as Project;
}
