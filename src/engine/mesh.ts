// Mesh utilities shared by the UI (import, transforms) and the engine (slicing).

export interface IndexedMesh { vertices: Float32Array; indices: Uint32Array }

/** Weld a triangle soup (flat xyz per corner) into an indexed mesh. */
export function weld(soup: Float32Array, tolerance = 1e-5): IndexedMesh {
  const inv = 1 / tolerance;
  const map = new Map<string, number>();
  const verts: number[] = [];
  const triCount = Math.floor(soup.length / 9);
  const idx = new Uint32Array(triCount * 3);
  let kept = 0;
  for (let t = 0; t < triCount; t++) {
    const tri: number[] = [];
    for (let c = 0; c < 3; c++) {
      const o = t * 9 + c * 3;
      const x = soup[o], y = soup[o + 1], z = soup[o + 2];
      const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
      let i = map.get(key);
      if (i === undefined) { i = verts.length / 3; verts.push(x, y, z); map.set(key, i); }
      tri.push(i);
    }
    // drop degenerate (collapsed) triangles
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    idx[kept * 3] = tri[0]; idx[kept * 3 + 1] = tri[1]; idx[kept * 3 + 2] = tri[2];
    kept++;
  }
  return { vertices: new Float32Array(verts), indices: idx.slice(0, kept * 3) };
}

export function meshBounds(v: Float32Array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = v[i + k];
      if (a < min[k]) min[k] = a;
      if (a > max[k]) max[k] = a;
    }
  }
  return { min, max };
}

/** Apply a column-major 4x4 matrix to positions. */
export function transformVertices(v: Float32Array, m: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

/** Signed volume (mm³) of a closed mesh. */
export function meshVolume(m: IndexedMesh): number {
  const v = m.vertices, ix = m.indices;
  let vol = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    vol += (v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1])
      - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c])
      + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])) / 6;
  }
  return vol;
}

/** Count edges not shared by exactly two triangles (0 for a watertight mesh). */
export function openEdgeCount(m: IndexedMesh): number {
  const counts = new Map<number, number>();
  const n = m.vertices.length / 3;
  const ix = m.indices;
  for (let t = 0; t < ix.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = ix[t + e], b = ix[t + ((e + 1) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  counts.forEach((c) => { if (c !== 2) open++; });
  return open;
}
