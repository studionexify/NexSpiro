// Harmonic scalar field dome slicing (#24). Solves Laplace ∇²φ = 0 in the part with φ = 0 where it
// stands on the bed and φ = 1 on its domes (zero flux elsewhere). Isosurfaces of φ start flat on the
// bed and morph into shells parallel to the domes; they become the layers, limited per column by the
// machine's head clearance and the allowed layer-thickness range.
import { zoneIndex } from './types';
import type { PartAnalysis } from './analysis';
import { laplace3 } from './solvers';
import { DisplacementField } from './warp';
import { smoothstep } from './grid';

export interface HarmonicResult {
  phi: Float32Array;
  /** Dirichlet cells: 1 bed (φ = 0), 2 dome (φ = 1). */
  bc: Uint8Array;
  domeCells: number;
  iterations: number;
}

/** Cells next to dome / shallow-slope triangles get φ = 1, the bottom cells φ = 0. */
export function harmonicField(a: PartAnalysis): HarmonicResult | null {
  const g = a.sdf.sdf, inside = a.sdf.inside;
  const kind = new Uint8Array(g.n), fixed = new Float32Array(g.n), bc = new Uint8Array(g.n);
  for (let p = 0; p < g.n; p++) if (inside[p]) kind[p] = 1;
  // bed contact: the lowest inside cell of every column
  const zBed = a.sdf.min[2] + g.h * 0.75;
  for (let k = 0; k < g.nz; k++) {
    if (g.z(k) > zBed) break;
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const p = g.idx(i, j, k);
      if (inside[p]) { kind[p] = 2; fixed[p] = 0; bc[p] = 1; }
    }
  }
  const s = a.surf;
  const domeZ = new Set([zoneIndex('dome'), zoneIndex('shallow')]);
  let domeCells = 0;
  const mark = (x: number, y: number, z: number) => {
    const p = g.cellAt(x, y, z);
    if (p < 0 || !inside[p] || bc[p] === 1) return;
    if (bc[p] !== 2) domeCells++;
    kind[p] = 2; fixed[p] = 1; bc[p] = 2;
  };
  const v = a.mesh.vertices, ix = a.mesh.indices;
  for (let t = 0; t < s.triCount; t++) {
    if (!domeZ.has(a.triZone[t])) continue;
    const nx = s.normal[t * 3], ny = s.normal[t * 3 + 1], nz = s.normal[t * 3 + 2];
    const d = g.h * 0.6;
    const pts: [number, number, number][] = [[s.centroid[t * 3], s.centroid[t * 3 + 1], s.centroid[t * 3 + 2]]];
    for (let c = 0; c < 3; c++) { const q = ix[t * 3 + c] * 3; pts.push([(v[q] + s.centroid[t * 3]) / 2, (v[q + 1] + s.centroid[t * 3 + 1]) / 2, (v[q + 2] + s.centroid[t * 3 + 2]) / 2]); }
    for (const [x, y, z] of pts) mark(x - nx * d, y - ny * d, z - nz * d);
  }
  if (!domeCells) return null;
  // initial guess: normalised height (fast convergence)
  const guess = new Float32Array(g.n);
  const H = Math.max(1e-6, a.sdf.max[2] - a.sdf.min[2]);
  for (let k = 0; k < g.nz; k++) for (let p = k * g.nx * g.ny; p < (k + 1) * g.nx * g.ny; p++) guess[p] = (g.z(k) - a.sdf.min[2]) / H;
  const res = laplace3(g.nx, g.ny, g.nz, kind, fixed, 1e-6, 3000, guess);
  for (let p = 0; p < g.n; p++) if (!inside[p]) res.phi[p] = 0;
  return { phi: res.phi, bc, domeCells, iterations: res.iterations };
}

export interface DomeOptions {
  maxSlopeDeg: number;
  minRatio: number;
  maxRatio: number;
  /** Morph band height (mm); 0 = automatic (dome height + 2 mm). */
  band: number;
}

/**
 * Displacement field whose flat warped layers are φ isosurfaces in the dome band, scaled per column
 * to the head's clearance and then globally until slope and thickness limits hold everywhere.
 */
export function domeWarp(a: PartAnalysis, hr: HarmonicResult, o: DomeOptions): { field: DisplacementField; conformity: number; scale: number } | null {
  const g = a.sdf.sdf;
  const zMin = a.sdf.min[2], H = a.sdf.max[2] - zMin;
  if (H <= 0) return null;
  const hz = g.h;
  const nzw = Math.ceil((zMin + H + 2 * hz) / hz) + 1;
  const field = new DisplacementField(g.nx, g.ny, nzw, g.ox, g.oy, g.h, hz, 'harmonic_dome');
  // dome height range for the automatic band
  let domeLo = Infinity;
  for (let p = 0; p < g.n; p++) if (hr.bc[p] === 2) domeLo = Math.min(domeLo, g.z(Math.floor(p / (g.nx * g.ny))));
  const band = o.band > 0 ? o.band : Math.min(H, H - (domeLo - zMin) + 2);
  const w = (zw: number) => (band >= H ? 1 : smoothstep((zw - zMin - (H - band)) / band));
  const raw = new Float32Array(field.d.length);
  const colTop = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    // monotone φ(z) along the column, from the bed (z = zMin, φ = 0) to the column's top surface
    const zs: number[] = [zMin], ph: number[] = [0];
    let top = -Infinity;
    for (let k = 0; k < g.nz; k++) {
      const p = g.idx(i, j, k);
      if (!a.sdf.inside[p]) continue;
      const z = g.z(k);
      if (z <= zs[zs.length - 1]) continue;
      zs.push(z); ph.push(Math.max(ph[ph.length - 1] + 1e-7, hr.phi[p]));
      top = z;
    }
    if (top === -Infinity) continue;
    const surf = a.surf.grid.topAt(g.x(i), g.y(j));
    const T = Number.isFinite(surf) ? Math.max(surf, top) : top + g.h / 2;
    // a dome column reaches φ = 1 on its surface; any other column keeps its top value (zero flux)
    const topDome = hr.bc[g.idx(i, j, Math.round((top - g.oz) / g.h))] === 2;
    const phiTop = topDome ? 1 : ph[ph.length - 1];
    zs.push(T); ph.push(Math.max(phiTop, ph[ph.length - 1] + 1e-7));
    colTop[i + g.nx * j] = T;
    const pTop = ph[ph.length - 1];
    for (let k = 0; k < nzw; k++) {
      const zw = k * hz;
      const target = (zw - zMin) / H;
      let z: number;
      if (target <= 0) z = zw;
      else if (target >= pTop) z = T + (zw - zMin - H * pTop);
      else {
        let m = 1;
        while (m < ph.length - 1 && ph[m] < target) m++;
        const t = (target - ph[m - 1]) / Math.max(1e-12, ph[m] - ph[m - 1]);
        z = zs[m - 1] + (zs[m] - zs[m - 1]) * t;
      }
      raw[field.idx(i, j, k)] = (z - zw) * w(zw);
    }
  }
  // per-column conformity λ: the column's steepest layer slope must fit the clearance limit
  // curved layers rise faster than their tangent plane: keep a 20 % margin under the clearance slope
  const lim = Math.tan((o.maxSlopeDeg * 0.75 * Math.PI) / 180);
  const lam = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    let s = 0;
    for (let k = 0; k < nzw; k++) {
      const gx = (raw[field.idx(Math.min(g.nx - 1, i + 1), j, k)] - raw[field.idx(Math.max(0, i - 1), j, k)]) / (2 * g.h);
      const gy = (raw[field.idx(i, Math.min(g.ny - 1, j + 1), k)] - raw[field.idx(i, Math.max(0, j - 1), k)]) / (2 * g.h);
      s = Math.max(s, Math.hypot(gx, gy));
    }
    lam[i + g.nx * j] = s > 1e-9 ? Math.min(1, lim / s) : 1;
  }
  // smooth λ so its own gradient does not add slope (a few box-blur passes ≈ Gaussian)
  const tmp = new Float32Array(lam.length);
  for (let pass = 0; pass < 6; pass++) {
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
        s += lam[ii + g.nx * jj]; c++;
      }
      tmp[i + g.nx * j] = Math.min(lam[i + g.nx * j], s / c);
    }
    lam.set(tmp);
  }
  for (let k = 0; k < nzw; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const q = field.idx(i, j, k);
    field.d[q] = raw[q] * lam[i + g.nx * j];
  }
  // global scale until every limit holds
  const tanMax = Math.tan((o.maxSlopeDeg * 0.8 * Math.PI) / 180);
  let scale = 1;
  for (let it = 0; it < 30; it++) {
    const st = field.scaled(scale).stats();
    if (st.maxSlope <= tanMax && st.minRatio >= o.minRatio && st.maxRatio <= o.maxRatio) break;
    scale *= 0.85;
  }
  const out = scale < 1 ? field.scaled(scale) : field;
  // conformity: how much of the dome's height difference the top layer follows (area-weighted mean λ)
  let num = 0, den = 0;
  for (let q = 0; q < lam.length; q++) if (colTop[q]) { num += lam[q] * scale; den++; }
  return { field: out, conformity: den ? num / den : 0, scale };
}
