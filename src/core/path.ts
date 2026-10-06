import type { Profile } from "./primitives.ts";
import { patterns, type PatternParams } from "./patterns.ts";

export type PathSettings = {
  layerHeight: number;    // mm
  lineWidth: number;      // mm
  filamentDiameter: number;
  segmentsPerRev: number; // must be ≥ ~4× wavesPerRev to resolve the pattern
  pattern: string;
  params?: Partial<PatternParams>;
  fadeHeight: number;     // mm: pattern ramps from 0 at bottom to full over this height
  center: [number, number];
};
// Flat typed arrays: x,y,z per point; e = absolute E at each point.
export type Toolpath = { xyz: Float32Array; e: Float64Array; count: number };

export function buildSpiral(profile: Profile, s: PathSettings): Toolpath {
  const pat = patterns[s.pattern];
  if (!pat) throw new Error(`Unknown pattern: ${s.pattern}`);
  const p: PatternParams = { ...pat.defaults, ...s.params };
  const layers = Math.floor(profile.height / s.layerHeight);
  const n = layers * s.segmentsPerRev + 1;
  const xyz = new Float32Array(n * 3);
  const e = new Float64Array(n);
  const filArea = Math.PI * (s.filamentDiameter / 2) ** 2;
  const beadArea = s.lineWidth * s.layerHeight;
  let E = 0, px = 0, py = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    const layer = i / s.segmentsPerRev;            // continuous (spiral)
    const theta = (i % s.segmentsPerRev) / s.segmentsPerRev * 2 * Math.PI;
    const zBase = s.layerHeight * (1 + layer);     // first layer at 1×layerHeight
    const fade = s.fadeHeight > 0 ? Math.min(1, (zBase - s.layerHeight) / s.fadeHeight) : 1;
    const m = pat.fn(theta, Math.floor(layer), p);
    const r = profile.radius(Math.min(1, zBase / profile.height)) + fade * m.dr;
    const x = s.center[0] + r * Math.cos(theta), y = s.center[1] + r * Math.sin(theta);
    const z = zBase + fade * m.dz;
    if (i > 0) {
      const len = Math.hypot(x - px, y - py, z - pz);
      E += (len * beadArea * (1 + fade * (m.e - 1))) / filArea;
    }
    xyz[i * 3] = x; xyz[i * 3 + 1] = y; xyz[i * 3 + 2] = z; e[i] = E;
    px = x; py = y; pz = z;
  }
  return { xyz, e, count: n };
}
