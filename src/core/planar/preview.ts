// Preview data of the planar slicer: the plan flattened into typed arrays, one entry per path segment.
import { Feature } from "./types.ts";
import type { PlanarPlan, PlanarJob, PreviewSegments, GcodeResult } from "./types.ts";
import { makeCtx, pathSegCount, segCruise, accelFor, jerkFor, chainTimes, solveSlowdown, slowed, planMoves } from "./motion.ts";

export type PreviewOptions = {
  /** Also emit the implicit straight travel between paths as Feature.Travel segments (default false: only explicit Travel paths). */
  travel?: boolean;
};

/**
 * Flatten a plan into per-segment arrays. Time/speed use the same look-ahead model and cooling slowdown as the G-code writer
 * (implicit travel time between paths is counted, retraction time is not). `layer` is Layer.index.
 */
export function buildPreview(plan: PlanarPlan, job: PlanarJob, opts: PreviewOptions = {}): PreviewSegments {
  const ctx = makeCtx(job), F = ctx.F;
  let segTotal = 0, pathTotal = 0, maxItems = 0;
  for (const l of plan.layers) {
    let c = 0;
    for (const p of l.paths) { const s = pathSegCount(p); segTotal += s; c += s + 1; pathTotal++; }
    maxItems = Math.max(maxItems, c);
  }
  const cap = segTotal + (opts.travel ? pathTotal : 0);
  const a = new Float32Array(cap * 3), b = new Float32Array(cap * 3), feature = new Uint8Array(cap), layerA = new Uint32Array(cap), obj = new Int16Array(cap);
  const speed = new Float32Array(cap), width = new Float32Array(cap), zone = new Uint8Array(cap), order = new Float32Array(cap);
  // per-layer scratch
  const len = new Float64Array(maxItems), ux = new Float64Array(maxItems), uy = new Float64Array(maxItems), uz = new Float64Array(maxItems);
  const vbase = new Float64Array(maxItems), vcur = new Float64Array(maxItems), acc = new Float64Array(maxItems), jerk = new Float64Array(maxItems);
  const fixed = new Float64Array(maxItems), tt = new Float64Array(maxItems), vin = new Float64Array(maxItems + 1), isExt = new Uint8Array(maxItems), outIdx = new Int32Array(maxItems);
  let o = 0, clock = 0, px = 0, py = 0, pz = 0, has = false;
  const ordCount = new Map<number, number>();
  for (const layer of plan.layers) {
    const group = plan.sequence === "object" && layer.obj >= 0 ? layer.obj : -1;
    const ordinal = ordCount.get(group) ?? 0; ordCount.set(group, ordinal + 1);
    const first = ordinal === 0;
    const tSpeed = ctx.travelSpeed * (first ? Math.min(2, (ctx.num("initial_layer_travel_speed") || 100) / 100) : 1);
    let n = 0;
    const addTravel = (x: number, y: number, z: number, emitObj: number, l: number) => {
      len[n] = l; ux[n] = (x - px) / l; uy[n] = (y - py) / l; uz[n] = (z - pz) / l;
      vbase[n] = tSpeed; acc[n] = ctx.travelAccel; jerk[n] = ctx.travelJerk > 0 ? ctx.travelJerk : ctx.M.maxJerk || 9; fixed[n] = 0; isExt[n] = 0;
      if (opts.travel) {
        const k = o++;
        a[k * 3] = px; a[k * 3 + 1] = py; a[k * 3 + 2] = pz; b[k * 3] = x; b[k * 3 + 1] = y; b[k * 3 + 2] = z;
        feature[k] = Feature.Travel; layerA[k] = layer.index; obj[k] = emitObj; width[k] = 0;
        outIdx[n] = k;
      } else outIdx[n] = -1;
      n++;
    };
    const o0 = o;
    for (const p of layer.paths) {
      const segs = pathSegCount(p), np = p.xyz.length / 3;
      if (segs < 1) continue;
      const travelPath = p.feature === Feature.Travel;
      if (has) {
        const l = Math.hypot(p.xyz[0] - px, p.xyz[1] - py, p.xyz[2] - pz);
        if (l > 1e-6) addTravel(p.xyz[0], p.xyz[1], p.xyz[2], p.obj, l);
      }
      const ac = travelPath ? ctx.travelAccel : accelFor(ctx, p.feature, first, p.accel);
      const jr0 = jerkFor(ctx, p.feature, first), jr = jr0 > 0 ? jr0 : ctx.M.maxJerk > 0 ? ctx.M.maxJerk : 9;
      for (let k = 0; k < segs; k++) {
        const i0 = k, i1 = (k + 1) % np;
        const x0 = p.xyz[i0 * 3], y0 = p.xyz[i0 * 3 + 1], z0 = p.xyz[i0 * 3 + 2], x1 = p.xyz[i1 * 3], y1 = p.xyz[i1 * 3 + 1], z1 = p.xyz[i1 * 3 + 2];
        const l = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
        const idx = o++;
        a[idx * 3] = x0; a[idx * 3 + 1] = y0; a[idx * 3 + 2] = z0; b[idx * 3] = x1; b[idx * 3 + 1] = y1; b[idx * 3 + 2] = z1;
        feature[idx] = p.feature; layerA[idx] = layer.index; obj[idx] = p.obj; width[idx] = p.width; zone[idx] = p.zone ? p.zone[i1] ?? 0 : 0;
        len[n] = l; if (l > 0) { ux[n] = (x1 - x0) / l; uy[n] = (y1 - y0) / l; uz[n] = (z1 - z0) / l; } else ux[n] = uy[n] = uz[n] = 0;
        vbase[n] = segCruise(ctx, p, k, l, z1 - z0); acc[n] = ac; jerk[n] = jr; fixed[n] = 0; isExt[n] = travelPath ? 0 : 1; outIdx[n] = idx;
        n++;
        px = x1; py = y1; pz = z1; has = true;
      }
    }
    if (n === 0) continue;
    const timeAt = (fac: number) => {
      for (let i = 0; i < n; i++) vcur[i] = isExt[i] ? slowed(vbase[i], fac, F.minSpeed) : vbase[i];
      chainTimes(n, len, ux, uy, uz, vcur, acc, jerk, fixed, tt, vin);
      let ext = 0, other = 0;
      for (let i = 0; i < n; i++) if (isExt[i]) ext += tt[i]; else other += tt[i];
      return { ext, other };
    };
    const sol = solveSlowdown(F, timeAt);
    timeAt(sol.factor);
    // emit in item order so travel/segments interleave by time; items carry their own output index
    for (let i = 0; i < n; i++) {
      clock += tt[i];
      const k = outIdx[i];
      if (k >= 0) { speed[k] = vcur[i]; order[k] = clock; }
    }
    void o0;
  }
  const sub = <T extends { subarray(a: number, b: number): T }>(arr: T, m: number) => (o === cap ? arr : arr.subarray(0, o * m));
  return {
    count: o, a: sub(a, 3), b: sub(b, 3), feature: sub(feature, 1), layer: sub(layerA, 1), obj: sub(obj, 1), speed: sub(speed, 1),
    width: sub(width, 1), zone: sub(zone, 1), order: sub(order, 1),
  };
}

/** Time / filament / cost of a plan without writing text (same model as the G-code writer). */
export function sliceStatsPlanar(plan: PlanarPlan, job: PlanarJob): Omit<GcodeResult, "text"> {
  const mp = planMoves(plan, job);
  return { timeS: mp.timeS, filamentMm: mp.filamentMm, filamentCm3: mp.filamentCm3, grams: mp.grams, cost: mp.cost, layers: plan.layers.length, byFeature: mp.byFeature };
}
