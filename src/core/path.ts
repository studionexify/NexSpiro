import type { Profile } from "./primitives.ts";
import { profileBody, type Body } from "./body.ts";
import type { Ring } from "./mesh.ts";
import { patterns, type PatternParams, type Sample } from "./patterns.ts";
import { sample, type PaintMask } from "./mask.ts";

export type PathSettings = {
  layerHeight: number;    // mm
  lineWidth: number;      // mm
  filamentDiameter: number;
  segmentsPerRev: number; // must be ≥ ~4× wavesPerRev to resolve the pattern
  pattern: string;        // base wall pattern (unpainted surface)
  params?: Partial<PatternParams>;
  fadeHeight: number;     // mm: pattern ramps from 0 at bottom to full over this height
  center: [number, number];
  zCap?: number;          // max |dz| allowed by printer (mm)
  planar?: boolean;       // true → suppress pattern Z (standard planar spiral)
  firstLayerHeight?: number; // defaults to layerHeight
  scaleXY?: number; scaleZ?: number; rotation?: number; // object transform (rotation in degrees about Z)
  paint?: PaintMask;
};
// Flat typed arrays: x,y,z per point; e = absolute E; tag = dominant region (0 = base, i+1 = paint region i).
export type Toolpath = { xyz: Float32Array; e: Float64Array; tag: Uint8Array; count: number; zClipped: number };

const resolve = (name: string, over?: Partial<PatternParams>) => {
  const pat = patterns[name];
  if (!pat) throw new Error(`Unknown pattern: ${name}`);
  return { fn: pat.fn, p: { ...pat.defaults, ...over } as PatternParams };
};

export function buildSpiral(shape: Profile | Body, s: PathSettings): Toolpath {
  const body: Body = "radius" in shape ? profileBody(shape) : shape;
  const base = resolve(s.pattern, s.params);
  const regions = (s.paint?.regions ?? []).map((r) => resolve(r.pattern, r.params));
  const sxy = s.scaleXY ?? 1, sz = s.scaleZ ?? 1, H = body.height * sz;
  const rot = ((s.rotation ?? 0) * Math.PI) / 180, cr = Math.cos(rot), sr = Math.sin(rot);
  const flh = s.firstLayerHeight ?? s.layerHeight, M = s.segmentsPerRev;
  const layers = Math.max(1, Math.floor((H - flh) / s.layerHeight + 1e-9) + 1);
  const n = layers * M + 1;
  const xyz = new Float32Array(n * 3), e = new Float64Array(n), tag = new Uint8Array(n);
  const filArea = Math.PI * (s.filamentDiameter / 2) ** 2;
  const beadArea = s.lineWidth * s.layerHeight;
  const cap = s.zCap ?? Infinity;
  // Rings are sampled in body space (unscaled Z) then scaled/rotated into object space.
  const ringAt = (L: number): Ring => {
    const z = Math.min(H, flh + s.layerHeight * L);
    const r = body.ring(z / sz, M);
    if (!r) throw new Error(`No contour at Z=${z.toFixed(2)} mm (open or non-manifold mesh?)`);
    for (let k = 0; k < M; k++) {
      const x = r.x[k] * sxy, y = r.y[k] * sxy, nx = r.nx[k], ny = r.ny[k];
      r.x[k] = x * cr - y * sr; r.y[k] = x * sr + y * cr;
      r.nx[k] = nx * cr - ny * sr; r.ny[k] = nx * sr + ny * cr;
    }
    return r;
  };
  let ringA = ringAt(0), ringB = ringAt(1), ringLayer = 0;
  let E = 0, px = 0, py = 0, pz = 0, zClipped = 0;
  for (let i = 0; i < n; i++) {
    const layer = i / M;                           // continuous (spiral)
    const k = i % M, u = k / M, theta = u * 2 * Math.PI;
    const L = Math.floor(layer);
    if (L !== ringLayer) { ringA = ringB; ringB = ringAt(L + 1); ringLayer = L; }
    const zBase = flh + s.layerHeight * layer;
    const t = Math.min(1, zBase / H);
    const fade = s.fadeHeight > 0 ? Math.min(1, (zBase - flh) / s.fadeHeight) : 1;

    // Blend base + painted regions by mask weight.
    let m: Sample = base.fn(theta, L, base.p);
    if (regions.length) {
      let wSum = 0, dr = 0, dz = 0, em = 0, best = 0, bestW = 0;
      for (let q = 0; q < regions.length; q++) {
        const w = sample(s.paint!, q, u, t);
        if (w <= 0) continue;
        const r = regions[q].fn(theta, L, regions[q].p);
        dr += w * r.dr; dz += w * r.dz; em += w * r.e; wSum += w;
        if (w > bestW) { bestW = w; best = q + 1; }
      }
      if (wSum > 0) {
        const wb = Math.max(0, 1 - wSum), tot = wb + wSum;
        m = { dr: (dr + wb * m.dr) / tot, dz: (dz + wb * m.dz) / tot, e: (em + wb * m.e) / tot };
        if (bestW > 0.5) tag[i] = best;
      }
    }
    let dz = s.planar ? 0 : fade * m.dz;
    if (Math.abs(dz) > cap) { dz = Math.sign(dz) * cap; zClipped++; }

    // Spiral: blend this layer's ring into the next one across the revolution.
    const f = layer - L, g = 1 - f, off = fade * m.dr;
    const nx = g * ringA.nx[k] + f * ringB.nx[k], ny = g * ringA.ny[k] + f * ringB.ny[k], nl = Math.hypot(nx, ny) || 1;
    const x = s.center[0] + g * ringA.x[k] + f * ringB.x[k] + (off * nx) / nl;
    const y = s.center[1] + g * ringA.y[k] + f * ringB.y[k] + (off * ny) / nl;
    const z = zBase + dz;
    if (i > 0) E += (Math.hypot(x - px, y - py, z - pz) * beadArea * (1 + fade * (m.e - 1))) / filArea;
    xyz[i * 3] = x; xyz[i * 3 + 1] = y; xyz[i * 3 + 2] = z; e[i] = E;
    px = x; py = y; pz = z;
  }
  return { xyz, e, tag, count: n, zClipped };
}
