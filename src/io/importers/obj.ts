import type { Mesh } from "../../core/mesh.ts";

/**
 * Wavefront OBJ: v / vt / vn / f (v, v/vt, v//vn, v/vt/vn; negative indices), n-gons fan-triangulated.
 * Each `o`/`g` block becomes its own mesh; `usemtl` names are kept as per-triangle material indices.
 * Texture coordinates are validated but not used for slicing.
 */
export function parseOBJ(text: string, name = "obj"): Mesh[] {
  const v: number[] = [], vn: number[] = [];
  let vtCount = 0;
  const groups: { name: string; tris: number[]; normals: number[]; hasNormals: boolean; mat: number[] }[] = [];
  const materials: string[] = [];
  let cur = { name, tris: [] as number[], normals: [] as number[], hasNormals: true, mat: [] as number[] };
  let curMat = -1;
  const flush = () => { if (cur.tris.length) groups.push(cur); };
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].trim();
    if (!line || line[0] === "#") continue;
    const parts = line.split(/\s+/), tag = parts[0];
    if (tag === "v") v.push(+parts[1], +parts[2], +parts[3]);
    else if (tag === "vn") vn.push(+parts[1], +parts[2], +parts[3]);
    else if (tag === "vt") vtCount++;
    else if (tag === "o" || tag === "g") {
      flush();
      cur = { name: parts.slice(1).join(" ") || `${name}_${groups.length + 1}`, tris: [], normals: [], hasNormals: true, mat: [] };
    } else if (tag === "usemtl") {
      const m = parts.slice(1).join(" ");
      curMat = materials.indexOf(m); if (curMat < 0) { materials.push(m); curMat = materials.length - 1; }
    } else if (tag === "f") {
      const idx = parts.slice(1).map((p) => {
        const [a, t, nrm] = p.split("/");
        const resolve = (s: string | undefined, count: number) => {
          if (s === undefined || s === "") return -1;
          const k = parseInt(s, 10);
          const r = k < 0 ? count + k : k - 1;
          if (!Number.isInteger(k) || r < 0 || r >= count) throw new Error(`OBJ line ${ln + 1}: index ${s} out of range`);
          return r;
        };
        resolve(t, vtCount);
        return [resolve(a, v.length / 3), resolve(nrm, vn.length / 3)] as const;
      });
      if (idx.length < 3) throw new Error(`OBJ line ${ln + 1}: face with fewer than 3 vertices`);
      for (let k = 1; k < idx.length - 1; k++) for (const [vi, ni] of [idx[0], idx[k], idx[k + 1]]) {
        cur.tris.push(v[vi * 3], v[vi * 3 + 1], v[vi * 3 + 2]);
        if (ni >= 0) cur.normals.push(vn[ni * 3], vn[ni * 3 + 1], vn[ni * 3 + 2]); else cur.hasNormals = false;
        if (cur.tris.length % 9 === 0) cur.mat.push(Math.max(0, curMat));
      }
    }
  }
  flush();
  if (!groups.length) throw new Error("OBJ contains no faces");
  if (v.some((x) => !Number.isFinite(x))) throw new Error("OBJ has non-numeric vertex coordinates");
  return groups.map((g) => ({
    name: g.name, tris: new Float32Array(g.tris),
    normals: g.hasNormals && g.normals.length === g.tris.length ? new Float32Array(g.normals) : undefined,
    triMaterial: materials.length ? Uint16Array.from(g.mat) : undefined,
    materials: materials.length ? materials : undefined,
  }));
}
