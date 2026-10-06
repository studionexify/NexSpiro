import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { Mesh } from "../../core/mesh.ts";
import { normalizeMesh } from "../../core/mesh.ts";
import type { Preset } from "../../core/presets.ts";
import type { Project } from "../../core/project.ts";
import { readProjectArchive } from "../exporters/project.ts";
import { presetsFromBambuSettings } from "./profiles.ts";

export type Imported3MFObject = { mesh: Mesh; name: string; plate: number; x: number; y: number; source: { objectId: string } };
export type Imported3MF = {
  objects: Imported3MFObject[];
  plates: { name: string; locked: boolean }[];
  presets: Preset[];
  bed: [number, number];
  warnings: string[];
  project?: Project;          // full NexSpiro project when the 3MF was written by NexSpiro (lossless round trip)
};

const xml = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "", removeNSPrefix: true, parseAttributeValue: false,
  isArray: (name) => ["object", "component", "triangle", "vertex", "item", "metadata", "plate", "model_instance", "part", "Relationship"].includes(name),
});

const UNIT: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
type M4 = number[]; // 3MF 3×4 row-vector affine: [m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32]
const IDENT: M4 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const parseM = (s?: string): M4 => {
  if (!s) return IDENT;
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some((x) => !Number.isFinite(x))) throw new Error(`Bad 3MF transform "${s}"`);
  return v;
};
const mul = (a: M4, b: M4): M4 => { // apply a then b
  const r: M4 = new Array(12).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    let s = i === 3 ? b[9 + j] : 0;
    for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
    r[i * 3 + j] = s;
  }
  return r;
};
const apply = (m: M4, x: number, y: number, z: number): [number, number, number] =>
  [x * m[0] + y * m[3] + z * m[6] + m[9], x * m[1] + y * m[4] + z * m[7] + m[10], x * m[2] + y * m[5] + z * m[8] + m[11]];

type RawObject = {
  name?: string; vertices?: Float64Array; triangles?: Uint32Array;
  paint: { color: string[]; supports: string[]; seam: string[] }; hasPaint: boolean;
  components?: { objectid: string; path?: string; transform: M4 }[];
};

/** Bambu plate grid: plates laid out in a ⌈√n⌉-column grid with a 20 % gap (LOGICAL_PART_PLATE_GAP = 1/5). */
export function bambuPlateOrigin(i: number, n: number, bed: [number, number]): [number, number] {
  const cols = Math.ceil(Math.sqrt(Math.max(1, n)));
  return [(i % cols) * bed[0] * 1.2, -Math.floor(i / cols) * bed[1] * 1.2];
}

export function import3MF(bytes: Uint8Array, defaultBed: [number, number] = [256, 256]): Imported3MF {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error("Not a 3MF (zip) file"); }
  const get = (p: string) => files[p.replace(/^\//, "")];
  const warnings: string[] = [];

  const rels = get("_rels/.rels");
  let root = "3D/3dmodel.model";
  if (rels) {
    const r = xml.parse(strFromU8(rels))?.Relationships?.Relationship ?? [];
    const model = r.find((x: Record<string, string>) => /3dmodel$/.test(x.Type ?? ""));
    if (model?.Target) root = model.Target.replace(/^\//, "");
  }
  if (!get(root)) throw new Error(`3MF model part ${root} missing`);

  const models = new Map<string, { scale: number; objects: Map<string, RawObject>; items: { objectid: string; transform: M4 }[] }>();
  const loadModel = (path: string) => {
    const key = path.replace(/^\//, "");
    let m = models.get(key);
    if (m) return m;
    const data = get(key);
    if (!data) throw new Error(`3MF references missing part ${path}`);
    const doc = xml.parse(strFromU8(data)).model;
    if (!doc) throw new Error(`${path} is not a 3MF model`);
    const scale = UNIT[doc.unit ?? "millimeter"] ?? 1;
    const objects = new Map<string, RawObject>();
    for (const o of doc.resources?.object ?? []) {
      const raw: RawObject = { name: o.name, paint: { color: [], supports: [], seam: [] }, hasPaint: false };
      if (o.mesh) {
        const vs = o.mesh.vertices?.vertex ?? [], ts = o.mesh.triangles?.triangle ?? [];
        raw.vertices = new Float64Array(vs.length * 3);
        vs.forEach((v: Record<string, string>, i: number) => { raw.vertices![i * 3] = +v.x * scale; raw.vertices![i * 3 + 1] = +v.y * scale; raw.vertices![i * 3 + 2] = +v.z * scale; });
        raw.triangles = new Uint32Array(ts.length * 3);
        ts.forEach((t: Record<string, string>, i: number) => {
          const a = +t.v1, b = +t.v2, c = +t.v3;
          if (![a, b, c].every((k) => Number.isInteger(k) && k >= 0 && k < vs.length)) throw new Error(`3MF object ${o.id}: triangle ${i} index out of range`);
          raw.triangles![i * 3] = a; raw.triangles![i * 3 + 1] = b; raw.triangles![i * 3 + 2] = c;
          const col = t.paint_color ?? t.mmu_segmentation ?? "", sup = t.paint_supports ?? t.custom_supports ?? "", seam = t.paint_seam ?? t.custom_seam ?? "";
          raw.paint.color.push(col); raw.paint.supports.push(sup); raw.paint.seam.push(seam);
          if (col || sup || seam) raw.hasPaint = true;
        });
      }
      if (o.components) raw.components = (o.components.component ?? []).map((c: Record<string, string>) => ({ objectid: c.objectid, path: c.path, transform: parseM(c.transform) }));
      objects.set(String(o.id), raw);
    }
    const items = (doc.build?.item ?? []).map((it: Record<string, string>) => ({ objectid: String(it.objectid), transform: parseM(it.transform) }));
    m = { scale, objects, items };
    models.set(key, m);
    return m;
  };

  // Flatten an object (mesh or component tree) into a triangle soup in world coordinates.
  const flatten = (path: string, id: string, tf: M4, out: { tris: number[]; color: string[]; supports: string[]; seam: string[] }, depth = 0) => {
    if (depth > 16) throw new Error("3MF component nesting too deep");
    const o = loadModel(path).objects.get(id);
    if (!o) throw new Error(`3MF object ${id} not found in ${path}`);
    if (o.vertices && o.triangles) {
      for (let t = 0; t < o.triangles.length / 3; t++) {
        for (let c = 0; c < 3; c++) {
          const v = o.triangles[t * 3 + c];
          out.tris.push(...apply(tf, o.vertices[v * 3], o.vertices[v * 3 + 1], o.vertices[v * 3 + 2]));
        }
        out.color.push(o.paint.color[t]); out.supports.push(o.paint.supports[t]); out.seam.push(o.paint.seam[t]);
      }
    }
    for (const c of o.components ?? []) flatten(c.path ?? path, c.objectid, mul(c.transform, tf), out, depth + 1);
  };

  // Bambu project metadata (optional)
  const objName = new Map<string, string>(), objPlate = new Map<string, number>(), plates: { name: string; locked: boolean }[] = [];
  const cfg = get("Metadata/model_settings.config");
  if (cfg) {
    const c = xml.parse(strFromU8(cfg)).config ?? {};
    const meta = (node: { metadata?: Record<string, string>[] }, k: string) => node.metadata?.find((m) => m.key === k)?.value;
    for (const o of c.object ?? []) { const n = meta(o, "name"); if (n) objName.set(String(o.id), n); }
    for (const p of c.plate ?? []) {
      const idx = Number(meta(p, "plater_id") ?? plates.length + 1) - 1;
      plates[idx] = { name: meta(p, "plater_name") || `Plate ${idx + 1}`, locked: meta(p, "locked") === "true" };
      for (const mi of p.model_instance ?? []) { const oid = meta(mi, "object_id"); if (oid) objPlate.set(oid, idx); }
    }
  }
  let presets: Preset[] = [], bed = defaultBed;
  const ps = get("Metadata/project_settings.config");
  if (ps) {
    try {
      const settings = JSON.parse(strFromU8(ps));
      const r = presetsFromBambuSettings(settings, "3mf");
      presets = r.presets; warnings.push(...r.warnings);
      if (r.bed) bed = r.bed;
    } catch (e) { warnings.push(`project_settings.config unreadable: ${e instanceof Error ? e.message : e}`); }
  }
  for (let i = 0; i < plates.length; i++) plates[i] ??= { name: `Plate ${i + 1}`, locked: false };
  if (!plates.length) plates.push({ name: "Plate 1", locked: false });

  const rootModel = loadModel(root);
  const objects: Imported3MFObject[] = [];
  let ignoredPaint = 0;
  rootModel.items.forEach((it, k) => {
    const out = { tris: [] as number[], color: [] as string[], supports: [] as string[], seam: [] as string[] };
    flatten(root, it.objectid, it.transform, out);
    if (!out.tris.length) { warnings.push(`Build item ${k + 1} has no geometry`); return; }
    const raw = rootModel.objects.get(it.objectid);
    const mesh: Mesh = { name: objName.get(it.objectid) ?? raw?.name ?? `object_${it.objectid}`, tris: new Float32Array(out.tris) };
    if (out.color.some(Boolean) || out.supports.some(Boolean) || out.seam.some(Boolean)) {
      mesh.paint = { color: out.color, supports: out.supports, seam: out.seam };
      ignoredPaint += out.supports.filter(Boolean).length + out.seam.filter(Boolean).length;
    }
    const n = normalizeMesh(mesh);
    const plate = objPlate.get(it.objectid) ?? 0;
    const [px, py] = cfg ? bambuPlateOrigin(plate, plates.length, bed) : [0, 0];
    // object centre relative to its plate's bed centre
    objects.push({ mesh: n, name: n.name, plate, x: n.offset[0] - px - bed[0] / 2, y: n.offset[1] - py - bed[1] / 2, source: { objectId: it.objectid } });
  });
  if (!objects.length) throw new Error("3MF contains no printable build items");
  if (ignoredPaint) warnings.push(`${ignoredPaint} support/seam-painted facets kept for round-trip; ignored for spiral printing`);

  let project: Project | undefined;
  const nx = get("Metadata/project.nexspiro");
  if (nx) try { project = readProjectArchive(nx); } catch (e) { warnings.push(`Embedded NexSpiro project unreadable (${e instanceof Error ? e.message : e}); using 3MF geometry only`); }
  return { objects, plates, presets, bed, warnings, project };
}
