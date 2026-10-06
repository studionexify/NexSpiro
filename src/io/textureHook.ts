// Wall textures + non-linear motion for the planar slicer: displaces the OUTER wall of an object by the same patterns and paint
// zones the spiral engine uses. Everything else (inner walls, infill, supports) is left untouched, like Bambu Studio.
import { patterns, sample, type Body, type PlateObject, type ProcessPreset, type MachinePreset, type PatternParams } from "../core/index.ts";
import type { TextureHook } from "../core/planar/types.ts";

export function hasTexture(o: PlateObject): boolean {
  return (o.base.pattern !== "none" && (o.base.params.amplitude > 0 || o.base.params.zAmplitude > 0)) || o.mask.regions.some((r, k) => r.weight.some((w) => w > 0.01) && (o.regionParams[k]?.amplitude > 0 || o.regionParams[k]?.zAmplitude > 0));
}

export function makeTextureHook(o: PlateObject, body: Body, process: ProcessPreset, machine: MachinePreset): TextureHook | undefined {
  if (!hasTexture(o)) return undefined;
  const t = o.transform, a = (t.rotation * Math.PI) / 180, cr = Math.cos(a), sr = Math.sin(a), H = body.height;
  const base = { fn: patterns[o.base.pattern].fn, p: { ...patterns[o.base.pattern].defaults, ...o.base.params } as PatternParams };
  const regions = o.mask.regions.map((r, k) => ({ fn: patterns[r.pattern].fn, p: { ...patterns[r.pattern].defaults, ...(o.regionParams[k] ?? r.params) } as PatternParams }));
  const nl = process.nonLinear.enabled, flh = process.firstLayerHeight, fadeH = process.fadeHeight;
  return (ring, z, layer) => {
    const n = ring.length / 2; if (n < 4) return null;
    const zl = Math.min(1, Math.max(0, z / t.scaleZ / H)), tt = zl;
    // arc-length parameter u ∈ [0,1) counter-clockwise from the body ring's seam point (the same origin the paint mask uses)
    const r0 = body.ring(Math.min(H - 1e-3, Math.max(1e-3, zl * H)), 8);
    let s0 = 0;
    if (r0) {
      const sx = (r0.x[0] * t.scaleXY * cr - r0.y[0] * t.scaleXY * sr) + t.x, sy = (r0.x[0] * t.scaleXY * sr + r0.y[0] * t.scaleXY * cr) + t.y;
      let bd = Infinity; for (let i = 0; i < n; i++) { const d = (ring[i * 2] - sx) ** 2 + (ring[i * 2 + 1] - sy) ** 2; if (d < bd) { bd = d; s0 = i; } }
    }
    const cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; cum[i + 1] = cum[i] + Math.hypot(ring[j * 2] - ring[i * 2], ring[j * 2 + 1] - ring[i * 2 + 1]); }
    const P = cum[n] || 1, xyz = new Float32Array(n * 3), zone = new Uint8Array(n), flow = new Float32Array(n);
    const fade = fadeH > 0 ? Math.min(1, Math.max(0, (z - flh) / fadeH)) : 1;
    for (let i = 0; i < n; i++) {
      const ip = (i + n - 1) % n, inx = (i + 1) % n, tx = ring[inx * 2] - ring[ip * 2], ty = ring[inx * 2 + 1] - ring[ip * 2 + 1], tl = Math.hypot(tx, ty) || 1;
      const nx = ty / tl, ny = -tx / tl; // outward for a counter-clockwise outer ring
      const u = (((cum[i] - cum[s0]) % P) + P) % P / P, theta = u * Math.PI * 2;
      let m = base.fn(theta, layer, base.p), wSum = 0, dr = 0, dz = 0, em = 0, best = 0, bestW = 0;
      for (let q = 0; q < regions.length; q++) {
        const w = sample(o.mask, q, u, tt); if (w <= 0) continue;
        const r = regions[q].fn(theta, layer, regions[q].p); dr += w * r.dr; dz += w * r.dz; em += w * r.e; wSum += w;
        if (w > bestW) { bestW = w; best = q + 1; }
      }
      if (wSum > 0) { const wb = Math.max(0, 1 - wSum), tot = wb + wSum; m = { dr: (dr + wb * m.dr) / tot, dz: (dz + wb * m.dz) / tot, e: (em + wb * m.e) / tot }; if (bestW > 0.5) zone[i] = best; }
      const zoff = nl ? Math.max(-machine.zWobbleMax, Math.min(machine.zWobbleMax, fade * m.dz)) : 0, off = fade * m.dr;
      xyz[i * 3] = ring[i * 2] + nx * off; xyz[i * 3 + 1] = ring[i * 2 + 1] + ny * off; xyz[i * 3 + 2] = z + zoff;
      flow[i] = 1 + fade * (m.e - 1);
    }
    return { xyz, zone, flow };
  };
}
