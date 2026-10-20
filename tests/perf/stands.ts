// Synthetic "wavy stand" plate resembling a tray of holders with negative cylinder parts.
import { weld } from '../../src/engine/mesh';
import { cylinder } from '../fixtures';
import type { MeshInput } from '../../src/engine/types';

/** Closed wavy-walled shell (outer + inner skin), ~ 4*nSeg*nZ triangles. */
export function wavyShell(cx: number, cy: number, w: number, d: number, h: number, nSeg = 160, nZ = 120, wall = 2.4): Float32Array {
  const out: number[] = [];
  const ring = (z: number, grow: number) => {
    const p: number[][] = [];
    for (let i = 0; i < nSeg; i++) {
      const a = (i / nSeg) * Math.PI * 2;
      const wob = 1 + 0.05 * Math.sin(10 * a + z * 0.35) + 0.03 * Math.sin(3 * a - z * 0.1);
      p.push([cx + ((w / 2 + grow) * Math.cos(a)) * wob, cy + ((d / 2 + grow) * Math.sin(a)) * wob, z]);
    }
    return p;
  };
  const tri = (a: number[], b: number[], c: number[]) => out.push(...a, ...b, ...c);
  const outerR = Array.from({ length: nZ + 1 }, (_, k) => ring((k / nZ) * h, 0));
  const innerR = Array.from({ length: nZ + 1 }, (_, k) => ring((k / nZ) * h, -wall));
  for (let k = 0; k < nZ; k++) for (let i = 0; i < nSeg; i++) {
    const j = (i + 1) % nSeg;
    tri(outerR[k][i], outerR[k][j], outerR[k + 1][j]); tri(outerR[k][i], outerR[k + 1][j], outerR[k + 1][i]);
    tri(innerR[k][i], innerR[k + 1][j], innerR[k][j]); tri(innerR[k][i], innerR[k + 1][i], innerR[k + 1][j]);
  }
  // bottom annulus and top annulus
  for (let i = 0; i < nSeg; i++) {
    const j = (i + 1) % nSeg;
    tri(outerR[0][i], innerR[0][j], outerR[0][j]); tri(outerR[0][i], innerR[0][i], innerR[0][j]);
    tri(outerR[nZ][i], outerR[nZ][j], innerR[nZ][j]); tri(outerR[nZ][i], innerR[nZ][j], innerR[nZ][i]);
  }
  return new Float32Array(out);
}

export function standsPlate(n = 9, opts: { nSeg?: number; nZ?: number; h?: number } = {}): MeshInput[] {
  const meshes: MeshInput[] = [];
  const cols = Math.ceil(Math.sqrt(n));
  for (let k = 0; k < n; k++) {
    const cx = 30 + (k % cols) * 75, cy = 30 + Math.floor(k / cols) * 75;
    const m = weld(wavyShell(cx, cy, 68, 60, opts.h ?? 40, opts.nSeg ?? 160, opts.nZ ?? 120));
    const neg = weld(cylinder(cx, cy + 5, 14, 30, 48));
    meshes.push({
      id: `o${k}`, name: `stand ${k}`, vertices: m.vertices, indices: m.indices,
      parts: [{ type: 'negative', overrides: {}, vertices: neg.vertices, indices: neg.indices }],
    } as any);
  }
  return meshes;
}
