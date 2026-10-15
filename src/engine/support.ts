// Stage 6: normal (grid) support synthesis by downward projection of overhang areas.
import { difference, intersection, offset, opening, union } from './clipper';
import type { Paths } from './types';

export interface SupportParams {
  thresholdAngle: number; // degrees from the bed
  topZDistance: number; // mm
  xyDistance: number; // mm
  interfaceLayers: number;
  buildPlateOnly: boolean;
  removeSmall: boolean;
  lineWidth: number;
}

export interface SupportLayers { base: Paths[]; iface: Paths[] }

export function generateSupport(slices: Paths[], heights: number[], p: SupportParams): SupportLayers {
  const N = slices.length;
  const base: Paths[] = Array.from({ length: N }, () => []);
  const iface: Paths[] = Array.from({ length: N }, () => []);
  if (N < 2) return { base, iface };

  const tanT = Math.tan((Math.max(1, Math.min(89.9, p.thresholdAngle)) * Math.PI) / 180);
  // Overhang area of each layer: the part not supported by the layer below (+ allowed step-out).
  const over: Paths[] = [[]];
  for (let i = 1; i < N; i++) {
    const allowed = heights[i] / tanT;
    let o = difference(slices[i], offset(slices[i - 1], allowed));
    if (p.removeSmall) o = opening(o, p.lineWidth);
    over.push(o);
  }

  const avgH = heights[Math.min(1, N - 1)];
  const gap = Math.max(0, Math.round(p.topZDistance / avgH));

  // Project downward.
  let cur: Paths = [];
  const S: Paths[] = Array.from({ length: N }, () => []);
  for (let i = N - 2; i >= 0; i--) {
    const src = i + 1 + gap < N ? over[i + 1 + gap] : [];
    if (src.length) cur = union(cur, src);
    if (!cur.length) continue;
    cur = difference(cur, offset(slices[i], p.xyDistance));
    // bottom Z gap above model surfaces
    let blocked: Paths = [];
    for (let k = 1; k <= gap && i - k >= 0; k++) blocked = blocked.concat(slices[i - k]);
    S[i] = blocked.length ? difference(cur, union(blocked)) : cur;
    S[i] = opening(S[i], p.lineWidth * 0.5);
  }

  if (p.buildPlateOnly) {
    // a column may only exist where the layer below also had support (grows from the bed)
    for (let i = 1; i < N; i++) S[i] = S[i].length && S[i - 1].length ? intersection(S[i], offset(S[i - 1], 0.01)) : [];
  }

  for (let i = 0; i < N; i++) {
    if (!S[i].length) continue;
    let ov: Paths = [];
    for (let k = 1; k <= p.interfaceLayers; k++) {
      const j = i + k + gap;
      if (j < N && over[j].length) ov = ov.concat(over[j]);
    }
    const iz = ov.length ? intersection(S[i], union(ov)) : [];
    iface[i] = iz;
    base[i] = iz.length ? difference(S[i], iz) : S[i];
  }
  return { base, iface };
}
