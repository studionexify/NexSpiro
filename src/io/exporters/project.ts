import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { deserializeProject, type Project } from "../../core/project.ts";
import type { Mesh } from "../../core/mesh.ts";
import { patterns } from "../../core/patterns.ts";
import { primitives } from "../../core/primitives.ts";

// .nexspiro v3: zip archive. project.json holds structure; binary payloads are stored raw (little-endian Float32).
const f32 = (a: Float32Array) => new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
const toF32 = (u: Uint8Array) => { if (u.byteLength % 4) throw new Error("Corrupt binary payload"); return new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); };
const safe = (s: string) => s.replace(/[^\w.-]/g, "_");

export function writeProjectArchive(p: Project, thumbnails: Uint8Array[] = []): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const used = new Set(p.plates.flatMap((pl) => pl.objects.flatMap((o) => (o.source.kind === "mesh" ? [o.source.meshId] : []))));
  const meshes: Record<string, unknown> = {};
  for (const id of used) {
    const m = p.meshes[id]; if (!m) throw new Error(`Missing mesh ${id}`);
    const base = `meshes/${safe(id)}`;
    files[`${base}.tris.bin`] = f32(m.tris);
    if (m.normals) files[`${base}.normals.bin`] = f32(m.normals);
    if (m.colors) files[`${base}.colors.bin`] = f32(m.colors);
    meshes[id] = { name: m.name, file: base, normals: !!m.normals, colors: !!m.colors, paint: m.paint, materials: m.materials, triMaterial: m.triMaterial ? Array.from(m.triMaterial) : undefined };
  }
  const plates = p.plates.map((pl) => ({
    ...pl, objects: pl.objects.map((o) => ({
      ...o, mask: { cols: o.mask.cols, rows: o.mask.rows, regions: o.mask.regions.map((r, k) => {
        const file = `masks/${safe(o.id)}_${k}.bin`;
        files[file] = f32(r.weight);
        return { pattern: r.pattern, params: r.params, file };
      }) },
    })),
  }));
  thumbnails.forEach((png, i) => { if (png) files[`thumbnails/plate_${i + 1}.png`] = png; });
  files["project.json"] = strToU8(JSON.stringify({ format: "nexspiro", version: 3, presets: p.presets, userPresets: p.userPresets, plates, meshes }));
  return zipSync(files, { level: 6 });
}

/** Opens .nexspiro v3 (zip) as well as legacy v1/v2 JSON projects. */
export function readProjectArchive(bytes: Uint8Array): Project {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return deserializeProject(strFromU8(bytes)); // legacy JSON
  const files = unzipSync(bytes), pj = files["project.json"];
  if (!pj) throw new Error("project.json missing from .nexspiro archive");
  const raw = JSON.parse(strFromU8(pj));
  if (raw.format !== "nexspiro" || raw.version !== 3) throw new Error(`Unsupported .nexspiro version ${raw.version}`);
  const need = (f: string) => { const u = files[f]; if (!u) throw new Error(`${f} missing from archive`); return u; };
  const meshes: Record<string, Mesh> = {};
  for (const [id, m] of Object.entries(raw.meshes as Record<string, { name: string; file: string; normals: boolean; colors: boolean; paint?: Mesh["paint"]; materials?: string[]; triMaterial?: number[] }>)) {
    const tris = toF32(need(`${m.file}.tris.bin`));
    if (tris.length % 9) throw new Error(`Mesh ${id} is corrupt`);
    meshes[id] = {
      name: m.name, tris, paint: m.paint, materials: m.materials, triMaterial: m.triMaterial ? Uint16Array.from(m.triMaterial) : undefined,
      normals: m.normals ? toF32(need(`${m.file}.normals.bin`)) : undefined, colors: m.colors ? toF32(need(`${m.file}.colors.bin`)) : undefined,
    };
  }
  // Reuse the v2 validator for patterns/primitives/mask sizes by inlining the weights first.
  for (const pl of raw.plates) for (const o of pl.objects) for (const r of o.mask.regions) { r.weight = toF32(need(r.file)); delete r.file; }
  const p: Project = { version: 2, presets: raw.presets, userPresets: raw.userPresets ?? [], plates: raw.plates, meshes };
  for (const pl of p.plates) for (const o of pl.objects) {
    if (o.source.kind === "mesh" && !meshes[o.source.meshId]) throw new Error(`Missing mesh ${o.source.meshId}`);
    if (o.source.kind === "primitive" && !(o.source.primitive in primitives)) throw new Error(`Unknown primitive ${o.source.primitive}`);
    if (!(o.base.pattern in patterns)) throw new Error(`Unknown pattern ${o.base.pattern}`);
    for (const r of o.mask.regions) if (!(r.pattern in patterns)) throw new Error(`Unknown pattern ${r.pattern}`);
    for (const r of o.mask.regions) if (r.weight.length !== o.mask.cols * o.mask.rows) throw new Error("Paint mask size mismatch");
  }
  return p;
}
