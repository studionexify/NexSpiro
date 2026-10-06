import { strFromU8 } from "fflate";
import { parseSTL, type Mesh } from "../../core/mesh.ts";
import type { Preset } from "../../core/presets.ts";
import type { Project } from "../../core/project.ts";
import { parseOBJ } from "./obj.ts";
import { parsePLY } from "./ply.ts";
import { importSTEP, defaultStepOptions, type Occt, type StepOptions } from "./step.ts";
import { import3MF, type Imported3MF } from "./threemf.ts";
import { importProfileJSON, importPrusaINI } from "./profiles.ts";
import { readProjectArchive } from "../exporters/project.ts";

export type ImportResult =
  | { kind: "meshes"; meshes: Mesh[]; warnings: string[] }
  | { kind: "3mf"; data: Imported3MF; warnings: string[] }
  | { kind: "presets"; presets: Preset[]; warnings: string[] }
  | { kind: "project"; project: Project; warnings: string[] };

export type ImportContext = { loadOcct?: () => Promise<Occt>; step?: StepOptions; bed?: [number, number] };

export const MESH_EXTENSIONS = [".stl", ".obj", ".ply", ".3mf", ".step", ".stp"];
export const ACCEPT = [...MESH_EXTENSIONS, ".nexspiro", ".json", ".ini"].join(",");

/** Single entry point: dispatch on extension, verified against magic bytes where the format has them. */
export async function importFile(fileName: string, bytes: Uint8Array, ctx: ImportContext = {}): Promise<ImportResult> {
  const ext = (fileName.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  const base = fileName.replace(/\.[^.]+$/, "");
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const buf = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  switch (ext) {
    case ".stl": return { kind: "meshes", meshes: [parseSTL(buf(), base)], warnings: [] };
    case ".obj": return { kind: "meshes", meshes: parseOBJ(strFromU8(bytes), base), warnings: [] };
    case ".ply": return { kind: "meshes", meshes: [parsePLY(buf(), base)], warnings: [] };
    case ".step": case ".stp": {
      if (!/ISO-10303-21/.test(strFromU8(bytes.subarray(0, 64)))) throw new Error(`${fileName} is not a STEP (ISO-10303-21) file`);
      if (!ctx.loadOcct) throw new Error("STEP import needs the OpenCASCADE module, which is not available here");
      const occt = await ctx.loadOcct();
      return { kind: "meshes", meshes: importSTEP(occt, bytes, base, ctx.step ?? defaultStepOptions), warnings: [] };
    }
    case ".3mf": {
      if (!isZip) throw new Error(`${fileName} is not a 3MF (zip) file`);
      const data = import3MF(bytes, ctx.bed);
      return { kind: "3mf", data, warnings: data.warnings };
    }
    case ".nexspiro": return { kind: "project", project: readProjectArchive(bytes), warnings: [] };
    case ".json": { const r = importProfileJSON(strFromU8(bytes)); return { kind: "presets", ...r }; }
    case ".ini": { const r = importPrusaINI(strFromU8(bytes)); return { kind: "presets", ...r }; }
    default: throw new Error(`Unsupported file type "${ext || fileName}". Supported: ${ACCEPT}`);
  }
}
