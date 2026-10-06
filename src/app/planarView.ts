// Three.js geometry for planar toolpaths (PreviewSegments → coloured line segments with layer / time windows).
import * as THREE from "three";
import type { PreviewSegments } from "../core/planar/types.ts";

/** Bambu-Studio-like palette per feature id (see Feature in core/planar/types.ts). */
export const FEATURE_HEX: Record<number, number> = {
  0: 0x9aa5b1, 1: 0xff7d38, 2: 0xf2c94c, 3: 0x2f6bff, 4: 0xb5372f, 5: 0x9b5cd6, 6: 0xf0503c, 7: 0x2a4a9e, 8: 0x4d8fd0, 9: 0xeeeeee,
  10: 0x00a070, 11: 0x1fb86b, 12: 0x38c44a, 13: 0x0d8a3e, 14: 0xb4dc3a, 15: 0x6fbf73, 16: 0xc0c0ff, 17: 0xff77ff,
};
export type PlanarColorMode = "feature" | "speed" | "height" | "layerTime" | "width" | "zone";
export type PlanarSub = { mesh: THREE.LineSegments; seg: Uint32Array; layer: Uint32Array; order: Float32Array; count: number };
export type PlanarGeo = { extrude: PlanarSub; travel: PlanarSub; layers: number; totalTime: number; range: [number, number, string]; featuresPresent: number[]; layerTime: Float32Array };

const ramp = (t: number, c: THREE.Color) => c.setHSL((1 - Math.min(1, Math.max(0, t))) * 0.66, 0.7, 0.5);

export function legendOf(prev: PreviewSegments, mode: PlanarColorMode, layerTime: Float32Array): [number, number, string] {
  let lo = Infinity, hi = -Infinity;
  const n = prev.count;
  if (mode === "speed") { for (let i = 0; i < n; i++) if (prev.feature[i]) { lo = Math.min(lo, prev.speed[i]); hi = Math.max(hi, prev.speed[i]); } return [lo, hi, "mm/s"]; }
  if (mode === "height") { for (let i = 0; i < n; i++) { const z = prev.b[i * 3 + 2]; lo = 0; hi = Math.max(hi, z); } return [0, hi, "mm"]; }
  if (mode === "width") { for (let i = 0; i < n; i++) if (prev.feature[i]) { lo = Math.min(lo, prev.width[i]); hi = Math.max(hi, prev.width[i]); } return [lo, hi, "mm"]; }
  if (mode === "layerTime") { for (const t of layerTime) if (t > 0) { lo = Math.min(lo, t); hi = Math.max(hi, t); } return [lo, hi, "s"]; }
  return [0, 0, ""];
}

export function buildPlanar(prev: PreviewSegments, mode: PlanarColorMode, regionColors: number[], baseColor: number): PlanarGeo {
  const n = prev.count; let layers = 0, nT = 0;
  for (let i = 0; i < n; i++) { if (prev.layer[i] + 1 > layers) layers = prev.layer[i] + 1; if (!prev.feature[i]) nT++; }
  const layerTime = new Float32Array(layers);
  for (let i = 0; i < n; i++) layerTime[prev.layer[i]] += prev.order[i] - (i ? prev.order[i - 1] : 0);
  const range = legendOf(prev, mode, layerTime), [lo, hi] = range, span = hi - lo || 1;
  const present = new Set<number>();
  const build = (travel: boolean): PlanarSub => {
    const cnt = travel ? nT : n - nT, pos = new Float32Array(cnt * 6), col = new Float32Array(cnt * 6), seg = new Uint32Array(cnt), layer = new Uint32Array(cnt), order = new Float32Array(cnt);
    const c = new THREE.Color(); let k = 0;
    for (let i = 0; i < n; i++) {
      const f = prev.feature[i]; if ((f === 0) !== travel) continue;
      pos.set(prev.a.subarray(i * 3, i * 3 + 3), k * 6); pos.set(prev.b.subarray(i * 3, i * 3 + 3), k * 6 + 3);
      if (travel) c.set(FEATURE_HEX[0]); else {
        present.add(f);
        switch (mode) {
          case "feature": c.set(FEATURE_HEX[f] ?? 0xffffff); break;
          case "zone": if (f >= 1 && f <= 3 && prev.zone[i]) c.set(regionColors[(prev.zone[i] - 1) % regionColors.length]); else c.set(f === 1 ? baseColor : FEATURE_HEX[f] ?? baseColor); break;
          case "speed": ramp((prev.speed[i] - lo) / span, c); break;
          case "width": ramp((prev.width[i] - lo) / span, c); break;
          case "height": ramp((prev.b[i * 3 + 2] - lo) / span, c); break;
          case "layerTime": ramp((layerTime[prev.layer[i]] - lo) / span, c); break;
        }
      }
      col[k * 6] = col[k * 6 + 3] = c.r; col[k * 6 + 1] = col[k * 6 + 4] = c.g; col[k * 6 + 2] = col[k * 6 + 5] = c.b;
      seg[k] = i; layer[k] = prev.layer[i]; order[k] = prev.order[i]; k++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: travel, opacity: travel ? 0.45 : 1 }));
    mesh.frustumCulled = false; mesh.visible = !travel;
    return { mesh, seg, layer, order, count: cnt };
  };
  const extrude = build(false), travel = build(true);
  return { extrude, travel, layers, totalTime: n ? prev.order[n - 1] : 0, range, featuresPresent: [...present].sort((a, b) => a - b), layerTime };
}

const lowerBound = (a: ArrayLike<number>, n: number, v: number, key: "ge" | "gt") => { let l = 0, h = n; while (l < h) { const m = (l + h) >> 1; if (key === "ge" ? a[m] < v : a[m] <= v) l = m + 1; else h = m; } return l; };
/** Window both geometries to layers [lo, hi] (0-based, inclusive) and to print time ≤ `t`. Returns the segment index (into PreviewSegments) of the head, or -1. */
export function windowPlanar(geo: PlanarGeo, lo: number, hi: number, t: number): number {
  let head = -1;
  for (const sub of [geo.extrude, geo.travel]) {
    const a = lowerBound(sub.layer, sub.count, lo, "ge"), b = lowerBound(sub.layer, sub.count, hi, "gt"), e = Math.min(b, lowerBound(sub.order, sub.count, t, "gt"));
    sub.mesh.geometry.setDrawRange(a * 2, Math.max(0, e - a) * 2);
    if (sub === geo.extrude && e > a) head = sub.seg[e - 1];
  }
  return head;
}
export function disposePlanar(geo: PlanarGeo | undefined) { if (!geo) return; for (const s of [geo.extrude, geo.travel]) { s.mesh.parent?.remove(s.mesh); s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); } }
