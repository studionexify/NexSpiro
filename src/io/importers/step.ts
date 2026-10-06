import type { Mesh } from "../../core/mesh.ts";

// STEP / STP via OpenCASCADE (occt-import-js, WASM). The OCCT instance is injected so the same code runs
// in the browser worker (lazy-loaded) and in Node tests.
export type OcctMesh = {
  name?: string; color?: number[];
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } };
  index: { array: ArrayLike<number> };
};
export type Occt = { ReadStepFile(content: Uint8Array, params: object | null): { success: boolean; meshes: OcctMesh[] } };
export type StepOptions = {
  linearDeflection: number;      // mm (absolute) — max chord deviation of the tessellation
  angularDeflection: number;     // radians — max angle between adjacent facet normals
  unit?: "millimeter" | "centimeter" | "meter" | "inch" | "foot";
};
export const defaultStepOptions: StepOptions = { linearDeflection: 0.05, angularDeflection: 0.2, unit: "millimeter" };

/**
 * Tessellates every solid. Normals come from the analytic B-rep surfaces at each tessellation vertex
 * (not from facet cross products), so curved walls keep smooth normals.
 */
export function importSTEP(occt: Occt, bytes: Uint8Array, name = "step", opts: StepOptions = defaultStepOptions): Mesh[] {
  const res = occt.ReadStepFile(bytes, {
    linearUnit: opts.unit ?? "millimeter", linearDeflectionType: "absolute_value",
    linearDeflection: opts.linearDeflection, angularDeflection: opts.angularDeflection,
  });
  if (!res.success || !res.meshes.length) throw new Error("STEP import failed (no solids found or unreadable file)");
  return res.meshes.map((m, k) => {
    const pos = m.attributes.position.array, nrm = m.attributes.normal?.array, idx = m.index.array;
    const tris = new Float32Array(idx.length * 3), normals = nrm ? new Float32Array(idx.length * 3) : undefined;
    for (let i = 0; i < idx.length; i++) {
      const v = idx[i];
      tris[i * 3] = pos[v * 3]; tris[i * 3 + 1] = pos[v * 3 + 1]; tris[i * 3 + 2] = pos[v * 3 + 2];
      if (normals && nrm) { normals[i * 3] = nrm[v * 3]; normals[i * 3 + 1] = nrm[v * 3 + 1]; normals[i * 3 + 2] = nrm[v * 3 + 2]; }
    }
    // object naming like Bambu Studio: file name, plus the STEP part name when the file holds several solids
    return { name: res.meshes.length > 1 ? `${name}:${m.name || k + 1}` : name, tris, normals };
  });
}
