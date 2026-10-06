import type { Body } from "../../core/body.ts";
import type { Mesh, Ring } from "../../core/mesh.ts";
import type { MotionPath } from "../../core/motion.ts";
import type { ObjectTransform } from "../../core/project.ts";

/** Closed triangle mesh of a body of revolution / sliced mesh body from its rings (side wall + caps). */
export function tessellateBody(body: Body, name: string, rows = 96, cols = 192): Mesh {
  const H = body.height, rings: { r: Ring; z: number }[] = [];
  for (let j = 0; j <= rows; j++) {
    const z = Math.min(H - 1e-4, Math.max(1e-4, (j / rows) * H));
    const r = body.ring(z, cols);
    if (r) rings.push({ r, z: (j / rows) * H });
  }
  if (rings.length < 2) throw new Error(`${name}: not enough contours to tessellate`);
  const t: number[] = [];
  const P = (j: number, k: number) => { const { r, z } = rings[j]; return [r.x[k % cols], r.y[k % cols], z]; };
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < cols; k++) {
    const a = P(j, k), b = P(j, k + 1), c = P(j + 1, k + 1), d = P(j + 1, k);
    t.push(...a, ...b, ...c, ...a, ...c, ...d); // CCW from outside
  }
  for (const [j, up] of [[0, false], [rings.length - 1, true]] as const) { // caps: fan from ring centroid
    const { r, z } = rings[j];
    let cx = 0, cy = 0; for (let k = 0; k < cols; k++) { cx += r.x[k]; cy += r.y[k]; } cx /= cols; cy /= cols;
    for (let k = 0; k < cols; k++) {
      const a = [r.x[k], r.y[k], z], b = [r.x[(k + 1) % cols], r.y[(k + 1) % cols], z];
      t.push(cx, cy, z, ...(up ? a : b), ...(up ? b : a));
    }
  }
  return { name, tris: new Float32Array(t) };
}

/** Apply an object's plate transform (scale, rotation about Z, translation) to a mesh copy. */
export function transformMesh(m: Mesh, tf: ObjectTransform, offset: [number, number] = [0, 0]): Mesh {
  const c = Math.cos((tf.rotation * Math.PI) / 180), s = Math.sin((tf.rotation * Math.PI) / 180);
  const out = new Float32Array(m.tris.length);
  for (let i = 0; i < m.tris.length; i += 3) {
    const x = m.tris[i] * tf.scaleXY, y = m.tris[i + 1] * tf.scaleXY;
    out[i] = x * c - y * s + tf.x + offset[0]; out[i + 1] = x * s + y * c + tf.y + offset[1]; out[i + 2] = m.tris[i + 2] * tf.scaleZ;
  }
  return { ...m, tris: out, normals: undefined };
}

export function writeSTL(meshes: Mesh[], header = "NexSpiro export"): Uint8Array {
  const n = meshes.reduce((s, m) => s + m.tris.length / 9, 0);
  const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), h = new TextEncoder().encode(header.slice(0, 79));
  new Uint8Array(buf).set(h);
  dv.setUint32(80, n, true);
  let o = 84;
  for (const m of meshes) for (let f = 0; f < m.tris.length; f += 9) {
    const t = m.tris;
    const ux = t[f + 3] - t[f], uy = t[f + 4] - t[f + 1], uz = t[f + 5] - t[f + 2], vx = t[f + 6] - t[f], vy = t[f + 7] - t[f + 1], vz = t[f + 8] - t[f + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    for (const v of [nx, ny, nz]) { dv.setFloat32(o, v, true); o += 4; }
    for (let k = 0; k < 9; k++) { dv.setFloat32(o, t[f + k], true); o += 4; }
    o += 2;
  }
  return new Uint8Array(buf);
}

/** Welded vertices (exact match) → indexed mesh; shared by OBJ and 3MF writers. */
export function weld(tris: Float32Array): { verts: number[]; idx: Uint32Array } {
  const map = new Map<string, number>(), verts: number[] = [], idx = new Uint32Array(tris.length / 3);
  for (let i = 0; i < tris.length; i += 3) {
    const key = `${tris[i]},${tris[i + 1]},${tris[i + 2]}`;
    let k = map.get(key);
    if (k === undefined) { k = verts.length / 3; map.set(key, k); verts.push(tris[i], tris[i + 1], tris[i + 2]); }
    idx[i / 3] = k;
  }
  return { verts, idx };
}

export function writeOBJ(meshes: Mesh[]): string {
  const out = ["# NexSpiro (Studio Nexify) OBJ export", "# units: mm"];
  let base = 1;
  for (const m of meshes) {
    const { verts, idx } = weld(m.tris);
    out.push(`o ${m.name.replace(/\s+/g, "_")}`);
    for (let i = 0; i < verts.length; i += 3) out.push(`v ${+verts[i].toFixed(5)} ${+verts[i + 1].toFixed(5)} ${+verts[i + 2].toFixed(5)}`);
    for (let i = 0; i < idx.length; i += 3) out.push(`f ${idx[i] + base} ${idx[i + 1] + base} ${idx[i + 2] + base}`);
    base += verts.length / 3;
  }
  return out.join("\n") + "\n";
}

/**
 * Bake the printed wall: sweep a rectangular bead (lineWidth × layerHeight) along the motion path, oriented by
 * the surface normal. `stride` keeps every n-th point to bound file size. Ends are capped, so the result is closed.
 */
export function bakeToolpath(mp: MotionPath, lineWidth: number, layerHeight: number, name = "baked_wall", stride = 1): Mesh {
  const idx: number[] = [];
  for (let i = 0; i < mp.count; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== mp.count - 1) idx.push(mp.count - 1);
  const n = idx.length, hw = lineWidth / 2, hh = layerHeight / 2;
  const corners: number[][][] = [];
  for (let q = 0; q < n; q++) {
    const i = idx[q], a = idx[Math.max(0, q - 1)], b = idx[Math.min(n - 1, q + 1)];
    // travel direction
    let tx = mp.xyz[b * 3] - mp.xyz[a * 3], ty = mp.xyz[b * 3 + 1] - mp.xyz[a * 3 + 1], tz = mp.xyz[b * 3 + 2] - mp.xyz[a * 3 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // bead width: horizontal, perpendicular to travel, on the wall-normal side; height: completes the frame (≈ +Z)
    let wx = ty, wy = -tx; const wl = Math.hypot(wx, wy) || 1; wx /= wl; wy /= wl;
    if (wx * mp.normal[i * 3] + wy * mp.normal[i * 3 + 1] < 0) { wx = -wx; wy = -wy; }
    let ux = -tz * wy, uy = tz * wx, uz = tx * wy - ty * wx; // u = t × w
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    if (uz < 0) { ux = -ux; uy = -uy; uz = -uz; }
    const x = mp.xyz[i * 3], y = mp.xyz[i * 3 + 1], z = mp.xyz[i * 3 + 2] - hh; // bead centre half a layer below the nozzle
    corners.push([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, r]) => [x + p * hw * wx + r * hh * ux, y + p * hw * wy + r * hh * uy, z + r * hh * uz]));
  }
  // consistent outward winding regardless of travel direction (CW vs CCW spirals)
  const flip = (() => {
    const i = idx[0], j = idx[Math.min(1, n - 1)];
    const tx = mp.xyz[j * 3] - mp.xyz[i * 3], ty = mp.xyz[j * 3 + 1] - mp.xyz[i * 3 + 1];
    const c = corners[0], wx = c[1][0] - c[0][0], wy = c[1][1] - c[0][1];
    return tx * wy - ty * wx > 0; // (t × w)·z > 0 ⇔ frame (w, u, t) left-handed for our quad order
  })();
  const t: number[] = [];
  for (let q = 0; q < n - 1; q++) for (let s = 0; s < 4; s++) {
    const a = corners[q][s], b = corners[q][(s + 1) % 4], c = corners[q + 1][(s + 1) % 4], d = corners[q + 1][s];
    if (flip) t.push(...a, ...c, ...d, ...a, ...b, ...c); else t.push(...a, ...d, ...c, ...a, ...c, ...b);
  }
  const [s0, s1] = [corners[0], corners[n - 1]];
  if (flip) { t.push(...s0[0], ...s0[2], ...s0[1], ...s0[0], ...s0[3], ...s0[2], ...s1[0], ...s1[1], ...s1[2], ...s1[0], ...s1[2], ...s1[3]); }
  else { t.push(...s0[0], ...s0[1], ...s0[2], ...s0[0], ...s0[2], ...s0[3], ...s1[0], ...s1[2], ...s1[1], ...s1[0], ...s1[3], ...s1[2]); }
  return { name, tris: new Float32Array(t) };
}
