// Top / bottom / bridge / internal-solid / sparse region classification per layer.
import type { ExPoly } from "./types.ts";
import { diffPolys, intersectPolys, offsetPolys, openPolys, polyArea, unionAll, samePolys } from "./geom.ts";

export type ShellParams = {
  topLayers: number; bottomLayers: number;
  minSparseArea: number;          // mm²: smaller sparse islands become solid
  sparseSolid: boolean;           // density >= 100%
  onlyOneWallTop: boolean; onlyOneWallFirst: boolean;
};
export type LayerRegions = {
  top: ExPoly[]; bottom: ExPoly[]; bridge: ExPoly[]; solid: ExPoly[]; sparse: ExPoly[];
};
const OPEN_R = 0.08, BRIDGE_R = 0.6;

/**
 * outlines: slice outline per layer; cmp: nominal infill boundary per layer (same wall count everywhere, used for layer-to-layer comparison);
 * actual: per-layer real infill boundary (inside the printed walls).
 */
export function computeRegions(outlines: ExPoly[][], cmp: ExPoly[][], actual: ExPoly[][], p: ShellParams, progress?: (f: number) => void): LayerRegions[] {
  const n = cmp.length;
  const Z: ExPoly[] = [];
  const cm = (l: number) => (l >= 0 && l < n ? cmp[l] : Z);
  const topRaw: ExPoly[][] = new Array(n), botRaw: ExPoly[][] = new Array(n), bridgeRaw: ExPoly[][] = new Array(n);
  for (let l = 0; l < n; l++) {
    if (!cm(l).length) { topRaw[l] = botRaw[l] = bridgeRaw[l] = []; continue; }
    topRaw[l] = p.topLayers > 0 ? (samePolys(cm(l), cm(l + 1)) ? [] : openPolys(diffPolys(cm(l), cm(l + 1)), OPEN_R)) : [];
    botRaw[l] = p.bottomLayers > 0 ? (l === 0 ? cm(0) : samePolys(cm(l), cm(l - 1)) ? [] : openPolys(diffPolys(cm(l), cm(l - 1)), OPEN_R)) : [];
    bridgeRaw[l] = [];
    if (l > 0 && botRaw[l].length) {
      const un = diffPolys(botRaw[l], offsetPolys(outlines[l - 1], 0.05));
      if (un.length) bridgeRaw[l] = openPolys(un, BRIDGE_R);
    }
    if (progress && (l & 31) === 0) progress(0.5 * l / n);
  }
  const out: LayerRegions[] = new Array(n);
  for (let l = 0; l < n; l++) {
    const A = actual[l];
    if (!A.length) { out[l] = { top: [], bottom: [], bridge: [], solid: [], sparse: [] }; continue; }
    const c = cm(l);
    const topDeepL: ExPoly[][] = [], botDeepL: ExPoly[][] = [];
    for (let k = 1; k < p.topLayers && l + k < n; k++) if (topRaw[l + k].length) topDeepL.push(topRaw[l + k]);
    for (let k = 1; k < p.bottomLayers && l - k >= 0; k++) if (botRaw[l - k].length) botDeepL.push(botRaw[l - k]);
    const deep = unionAll([...topDeepL, ...botDeepL]);
    const bridgeFull = bridgeRaw[l].length ? intersectPolys(offsetPolys(bridgeRaw[l], 0.8), c) : [];
    let top = topRaw[l].length ? intersectPolys(topRaw[l], A) : [];
    let bottom = botRaw[l].length ? diffPolys(botRaw[l], bridgeFull) : [];
    if (bottom.length) bottom = intersectPolys(bottom, A);
    let bridge = bridgeFull.length ? intersectPolys(bridgeFull, A) : [];
    // regions with fewer walls than nominal become solid
    const extra = diffPolys(A, c);
    let extraSolid: ExPoly[] = [];
    if (extra.length) {
      const e = openPolys(extra, 0.02);
      if (p.onlyOneWallFirst && l === 0) bottom = unionAll([bottom, e]);
      else if (p.onlyOneWallTop && top.length) top = unionAll([top, e]);
      else extraSolid = e;
    }
    if (top.length && bottom.length) bottom = diffPolys(bottom, top);
    if (bridge.length) { if (top.length) bridge = diffPolys(bridge, top); }
    let solid = deep.length || extraSolid.length ? intersectPolys(unionAll([deep, extraSolid]), A) : [];
    const taken = unionAll([top, bridge, bottom]);
    if (solid.length && taken.length) solid = diffPolys(solid, taken);
    let sparse = diffPolys(A, unionAll([taken, solid]));
    if (sparse.length) sparse = sparse.filter((s) => polyArea(s) > 0.01);
    if (sparse.length && (p.sparseSolid || p.minSparseArea > 0)) {
      const small = p.sparseSolid ? sparse : sparse.filter((s) => polyArea(s) < p.minSparseArea);
      if (small.length) { solid = unionAll([solid, small]); sparse = p.sparseSolid ? [] : sparse.filter((s) => polyArea(s) >= p.minSparseArea); }
    }
    out[l] = { top, bottom, bridge, solid, sparse };
    if (progress && (l & 31) === 0) progress(0.5 + 0.5 * l / n);
  }
  return out;
}
