// Planar print planner: orchestrates slicing, walls, shells, infill, supports, skirt/brim into a PlanarPlan.
import { Feature, type ExPoly, type Layer, type Path, type PlanarJob, type PlanarObject, type PlanarPlan, type Ring, type SupportResult } from "./types.ts";
import type { SettingMap } from "../settings.ts";
import { makeCfg, type Cfg } from "./slicecfg.ts";
import { sliceMesh } from "./slice.ts";
import {
  PolyIndex, diffPolys, intersectPolys, offsetPolys, polysBounds, unionAll, pointInPoly, samePolys, polysArea,
} from "./geom.ts";
import { buildWallGeom, gapFillPaths, innerEdgeOffset, makeOverhang, wallRingPaths, type SeamState, type WallCtx, type WallGeom, type WallParams, type WallRing } from "./perimeters.ts";
import { computeRegions } from "./shells.ts";
import { bridgeAngle, fillPolys, orderLines, type FillOpts } from "./infill.ts";
import { makeBrim, skirtRings } from "./skirt.ts";
import { linesToPaths, raftLayerPaths, supportLayerPaths } from "./suppaths.ts";

export type SupportContext = {
  layerZ: number[]; layerHeights: number[]; outlines: ExPoly[][]; settings: SettingMap; objIndex: number;
};
export type SupportCallback = (ctx: SupportContext) => SupportResult | null;

type ObjLayer = { z: number; h: number; paths: Path[]; isRaft: boolean };
type ObjPlan = {
  layers: ObjLayer[]; bounds: [number, number, number, number]; footprint: ExPoly[]; cfg: Cfg; height: number; brimArea: ExPoly[];
};

const sizeOf = (a: ExPoly[]) => a.length;

export function planPrint(job: PlanarJob, supports?: SupportCallback): PlanarPlan {
  const warnings: string[] = [];
  const prog = (f: number, s: string) => { try { job.onProgress?.(Math.max(0, Math.min(1, f)), s); } catch { /* ignore */ } };
  const n = job.objects.length;
  const jcfg = makeCfg(job.process, job.settings);
  const seqObj = jcfg.s("print_sequence") === "by object" || (n > 0 && !("print_sequence" in job.settings) && makeCfg(job.process, job.objects[0].settings).s("print_sequence") === "by object");
  const plans: ObjPlan[] = [];
  for (let i = 0; i < n; i++) {
    const o = job.objects[i];
    try {
      plans.push(planObject(job, i, supports, warnings, (f, s) => prog((i + f) / Math.max(1, n) * 0.92, s)));
    } catch (e) {
      warnings.push(`Object "${o.name}" could not be planned: ${(e as Error).message}`);
      plans.push({ layers: [], bounds: [0, 0, 0, 0], footprint: [], cfg: makeCfg(job.process, o.settings), height: 0, brimArea: [] });
    }
  }
  prog(0.93, "skirt");
  const skirtLoops = jcfg.n("skirt_loops"), skirtDist = jcfg.n("skirt_distance"), skirtLayers = Math.max(1, Math.round(jcfg.n("skirt_height")));
  const layers: Layer[] = [];
  const skirtPaths = (foot: ExPoly[], layer: ObjLayer, li: number, obj: number): Path[] => {
    if (skirtLoops <= 0 || li >= skirtLayers || !foot.length) return [];
    const w = li === 0 ? jcfg.n("initial_layer_line_width") : (jcfg.n("outer_wall_line_width") || jcfg.n("line_width"));
    const rings = skirtRings(foot, skirtLoops, skirtDist, w);
    const speed = li === 0 ? jcfg.n("initial_layer_speed") : jcfg.n("outer_wall_speed");
    return linesToPaths(rings.map((r) => ({ pts: r, closed: true })), layer.z, { feature: Feature.Skirt, obj, width: w, height: layer.h, flow: 1, speed });
  };
  if (!seqObj) {
    const map = new Map<number, { z: number; h: number; parts: { oi: number; l: ObjLayer; li: number }[] }>();
    plans.forEach((p, oi) => p.layers.forEach((l, li) => {
      const k = Math.round(l.z * 1000); let e = map.get(k);
      if (!e) { e = { z: l.z, h: l.h, parts: [] }; map.set(k, e); }
      e.parts.push({ oi, l, li }); e.h = Math.min(e.h, l.h);
    }));
    const keys = [...map.keys()].sort((a, b) => a - b);
    const foot = unionAll(plans.map((p) => unionAll([p.footprint, p.brimArea])));
    keys.forEach((k, gi) => {
      const e = map.get(k)!, paths: Path[] = [];
      if (gi < skirtLayers) paths.push(...skirtPaths(foot, { z: e.z, h: e.h, paths: [], isRaft: false }, gi, -1));
      for (const part of e.parts) paths.push(...part.l.paths);
      layers.push({ index: gi, obj: -1, z: e.z, height: e.h, paths, ...(e.parts.every((q) => q.l.isRaft) ? { isRaft: true } : {}) });
    });
  } else {
    let gi = 0;
    plans.forEach((p, oi) => {
      const foot = unionAll([p.footprint, p.brimArea]);
      p.layers.forEach((l, li) => {
        const paths = [...skirtPaths(foot, l, li, oi), ...l.paths];
        layers.push({ index: gi++, obj: oi, z: l.z, height: l.h, paths, ...(l.isRaft ? { isRaft: true } : {}) });
      });
    });
  }
  prog(1, "done");
  return { layers, sequence: seqObj ? "object" : "layer", warnings, objectNames: job.objects.map((o) => o.name), bounds: plans.map((p) => p.bounds) };
}

// ====================================================================================================== one object
function meshBounds(tris: Float32Array): [number, number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity, zm = 0;
  for (let i = 0; i + 2 < tris.length; i += 3) { const x = tris[i], y = tris[i + 1], z = tris[i + 2]; if (!Number.isFinite(x + y + z)) continue; if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; if (z > zm) zm = z; }
  return [a, b, c, d, zm];
}
function compensate(polys: ExPoly[], contour: number, hole: number): ExPoly[] {
  if (!polys.length || (!contour && !hole)) return polys;
  const outers = polys.map((p) => ({ outer: p.outer, holes: [] as Ring[] }));
  const holes: ExPoly[] = []; for (const p of polys) for (const h of p.holes) holes.push({ outer: h.slice().reverse(), holes: [] });
  const o = contour ? offsetPolys(outers, contour) : outers;
  const h = holes.length ? (hole ? offsetPolys(holes, hole) : holes) : [];
  return h.length ? diffPolys(o, h) : o;
}
function tops(h0: number, lh: number, H: number): { z: number[]; h: number[] } {
  const z: number[] = [], h: number[] = [];
  let top = Math.min(h0, H); z.push(top); h.push(top);
  while (z.length < 100000) {
    const rem = H - top; if (rem < 0.25 * lh - 1e-9) break;
    const t = Math.min(lh, rem); top += t; z.push(top); h.push(t);
  }
  return { z, h };
}

function planObject(job: PlanarJob, oi: number, supports: SupportCallback | undefined, warnings: string[], progress: (f: number, s: string) => void): ObjPlan {
  const obj: PlanarObject = job.objects[oi], cfg = makeCfg(job.process, obj.settings);
  const mb = meshBounds(obj.tris);
  const bounds: [number, number, number, number] = Number.isFinite(mb[0]) ? [mb[0], mb[1], mb[2], mb[3]] : [0, 0, 0, 0];
  const H = mb[4];
  const empty: ObjPlan = { layers: [], bounds, footprint: [], cfg, height: H, brimArea: [] };
  if (!(obj.tris.length >= 9) || !(H > 0)) { warnings.push(`Object "${obj.name}" has no printable geometry.`); return empty; }
  const lh = Math.max(0.01, cfg.n("layer_height")), h0 = Math.max(0.01, cfg.n("initial_layer_print_height") || lh);
  const grid = tops(h0, lh, H), nl = grid.z.length;
  const w0 = cfg.n("initial_layer_line_width") || cfg.n("line_width");
  const wOut = cfg.n("outer_wall_line_width") || cfg.n("line_width"), wIn = cfg.n("inner_wall_line_width") || wOut;
  const nozzle = job.machine.nozzle || 0.4;

  // ---- slice
  progress(0, "slice");
  const mid = grid.z.map((z, i) => z - grid.h[i] / 2);
  const sw: string[] = [];
  const rawOut = sliceMesh(obj.tris, mid, { closingRadius: cfg.n("slice_closing_radius"), mode: cfg.s("slicing_mode") as "regular", resolution: cfg.n("resolution"), warnings: sw });
  for (const w of sw) warnings.push(`${obj.name}: ${w}`);
  const contourC = cfg.n("xy_contour_compensation"), holeC = cfg.n("xy_hole_compensation");
  const outlines: ExPoly[][] = rawOut.map((p, l) => {
    let q = compensate(p, contourC, holeC);
    if (l === 0 && cfg.b("elefant_foot_compensation_on") && cfg.n("elefant_foot_compensation") > 0) q = offsetPolys(q, -cfg.n("elefant_foot_compensation"));
    return q;
  });
  let emptyLayers = 0; for (let l = 0; l < nl; l++) if (!outlines[l].length) emptyLayers++;
  if (emptyLayers === nl) { warnings.push(`Object "${obj.name}": slicing produced no contours.`); return empty; }
  if (emptyLayers) warnings.push(`Object "${obj.name}": ${emptyLayers} empty layer${emptyLayers > 1 ? "s" : ""} (gaps in the model).`);

  // ---- supports
  let sres: SupportResult | null = null;
  if (cfg.b("enable_support") && supports) {
    progress(0.15, "supports");
    try { sres = supports({ layerZ: grid.z.slice(), layerHeights: grid.h.slice(), outlines, settings: obj.settings, objIndex: oi }); }
    catch (e) { warnings.push(`Support generation failed for "${obj.name}": ${(e as Error).message}`); sres = null; }
    if (sres?.warnings) for (const w of sres.warnings) warnings.push(w);
  }
  const raftN = sres ? sres.raftLayers.length : 0;
  const raftH: number[] = []; for (let r = 0; r < raftN; r++) raftH.push(r === 0 ? h0 : lh);
  const raftTop = raftH.reduce((a, b) => a + b, 0);
  const zOff = raftN ? raftTop + cfg.n("raft_contact_distance") : 0;

  // ---- walls geometry
  progress(0.2, "perimeters");
  const nomLoops = Math.max(1, Math.round(cfg.n("wall_loops")));
  const precise = cfg.b("precise_outer_wall");
  const nomParams: WallParams = { layerH: lh, loops: nomLoops, wo: wOut, wi: wIn, precise };
  const nomOff = innerEdgeOffset(nomParams);
  const cmp: ExPoly[][] = new Array(nl);
  for (let l = 0; l < nl; l++) cmp[l] = l > 0 && samePolys(outlines[l], outlines[l - 1]) ? cmp[l - 1] : offsetPolys(outlines[l], -nomOff);
  const topFlag: boolean[] = new Array(nl).fill(false);
  if (cfg.b("only_one_wall_top")) for (let l = 0; l < nl; l++) topFlag[l] = !!cmp[l].length && (l === nl - 1 || (!samePolys(cmp[l], cmp[l + 1]) && polysArea(diffPolys(cmp[l], cmp[l + 1])) > 0.5));
  const geoms: WallGeom[] = new Array(nl), gparams: WallParams[] = new Array(nl);
  const altExtra = cfg.b("alternate_extra_wall"), oneFirst = cfg.b("only_one_wall_first_layer");
  for (let l = 0; l < nl; l++) {
    let loops = nomLoops;
    if (altExtra && l > 0 && (l & 1)) loops++;
    if (l === 0 && oneFirst) loops = 1;
    if (topFlag[l]) loops = 1;
    const p: WallParams = { layerH: grid.h[l], loops, wo: l === 0 ? w0 : wOut, wi: l === 0 ? w0 : wIn, precise };
    gparams[l] = p;
    const pp = l > 0 ? gparams[l - 1] : null;
    if (pp && pp.loops === p.loops && pp.wo === p.wo && pp.wi === p.wi && pp.layerH === p.layerH && samePolys(outlines[l], outlines[l - 1])) geoms[l] = geoms[l - 1];
    else geoms[l] = buildWallGeom(outlines[l], p);
    if ((l & 15) === 0) progress(0.2 + 0.2 * l / nl, "perimeters");
  }

  // ---- shells
  progress(0.4, "shells");
  const dens = cfg.n("sparse_infill_density") / 100;
  const nTop = Math.max(Math.round(cfg.n("top_shell_layers")), Math.ceil(cfg.n("top_shell_thickness") / lh - 1e-6));
  const nBot = Math.max(Math.round(cfg.n("bottom_shell_layers")), Math.ceil(cfg.n("bottom_shell_thickness") / lh - 1e-6));
  const regions = computeRegions(outlines, cmp, geoms.map((g) => g.inner), {
    topLayers: Math.max(0, nTop), bottomLayers: Math.max(0, nBot), minSparseArea: cfg.n("minimum_sparse_infill_area"), sparseSolid: dens >= 0.995,
    onlyOneWallTop: cfg.b("only_one_wall_top"), onlyOneWallFirst: oneFirst,
  }, (f) => progress(0.4 + 0.15 * f, "shells"));

  // ---- combined infill
  const sparseNorm: ExPoly[][] = regions.map((r) => r.sparse), sparseComb: ExPoly[][] = regions.map(() => []);
  if (cfg.b("infill_combination") && dens < 0.995) {
    for (let l = 1; l + 1 < nl; l += 2) {
      if (!sparseNorm[l].length || !sparseNorm[l + 1].length) continue;
      const c = intersectPolys(sparseNorm[l], sparseNorm[l + 1]).filter((p) => polysArea([p]) > 1);
      if (!c.length) continue;
      sparseComb[l + 1] = c; sparseNorm[l] = diffPolys(sparseNorm[l], c); sparseNorm[l + 1] = diffPolys(sparseNorm[l + 1], c);
    }
  }
  // ---- ironing coverage (topmost)
  const ironType = cfg.s("ironing_type");
  const covered: ExPoly[][] = [];
  if (ironType === "topmost") {
    let cov: ExPoly[] = [], last: ExPoly[] | null = null;
    for (let l = nl - 1; l >= 0; l--) { covered[l] = cov; if (!last || !samePolys(last, outlines[l])) { cov = unionAll([cov, outlines[l]]); last = outlines[l]; } }
  }

  // ---- paths per layer
  const layersOut: ObjLayer[] = [];
  const seams: SeamState = { prev: [], cur: [] };
  const pos = { x: 0, y: 0 };
  const rngSeed = oi * 1000 + 17;
  const sparsePat = cfg.s("sparse_infill_pattern");
  const spW = cfg.n("sparse_infill_line_width") || wIn, isW = cfg.n("internal_solid_infill_line_width") || wIn, tpW = cfg.n("top_surface_line_width") || wOut;
  const anchorL = Math.min(cfg.n("sparse_infill_anchor") * spW / 100, cfg.n("sparse_infill_anchor_max"));
  const ovS = cfg.n("infill_wall_overlap") / 100, ovT = cfg.n("top_bottom_infill_wall_overlap") / 100;
  const seqW = cfg.s("wall_sequence");
  const thickBridge = cfg.b("thick_bridges"), bridgeFlow = cfg.n("bridge_flow") || 1;

  for (let l = 0; l < nl; l++) {
    if ((l & 7) === 0) progress(0.55 + 0.4 * l / nl, "infill");
    const z = grid.z[l] + zOff, h = grid.h[l], first = l === 0;
    const out: Path[] = [];
    if (sres?.layers[l]) out.push(...supportLayerPaths(sres.layers[l], l, z, h, oi, cfg, pos, first));
    const outline = outlines[l];
    if (outline.length) {
      const geom = geoms[l], gp = gparams[l], reg = regions[l];
      const lower = l > 0 && !sres?.layers[l] ? outlines[l - 1] : l > 0 ? outlines[l - 1] : null;
      const c0 = unionAll(geom.centers.length ? [geom.centers[0]] : []);
      const ctx: WallCtx = {
        cfg, obj: oi, layerIndex: l, z, h, wo: gp.wo, wi: gp.wi, first, seams, pos,
        overhang: lower && cfg.b("detect_overhang_wall") && c0.length ? makeOverhang(lower, c0, gp.wo) : null,
        ...(obj.texture ? { texture: obj.texture } : {}), seedBase: rngSeed + l, speedOuter: cfg.n("outer_wall_speed"), speedInner: cfg.n("inner_wall_speed"),
      };
      // island buckets
      const nI = outline.length, wallsBy: WallRing[][][] = Array.from({ length: nI }, () => []);
      const islandIdx = (x: number, y: number): number => {
        for (let i = 0; i < nI; i++) if (pointInPoly(outline[i], x, y)) return i;
        let bi = 0, bd = Infinity;
        for (let i = 0; i < nI; i++) { const r = outline[i].outer; for (let v = 0; v < r.length; v += 2) { const d = (r[v] - x) ** 2 + (r[v + 1] - y) ** 2; if (d < bd) { bd = d; bi = i; } } }
        return bi;
      };
      geom.centers.forEach((polys, k) => {
        for (const p of polys) {
          const i = islandIdx(p.outer[0], p.outer[1]);
          (wallsBy[i][k] ??= []).push({ ring: p.outer, level: k, hole: false });
          for (const hh of p.holes) (wallsBy[i][k] ??= []).push({ ring: hh, level: k, hole: true });
        }
      });
      const fillBy: Path[][] = Array.from({ length: nI }, () => []);
      const gapBy: Path[][] = Array.from({ length: nI }, () => []);
      const ironPaths: Path[] = [];
      const fpos = { x: pos.x, y: pos.y };
      const emit = (region: ExPoly, o: FillOpts, base: Omit<Path, "xyz" | "closed">, zz: number) => {
        const lines = fillPolys([region], o);
        if (!lines.length) return;
        const ord = orderLines(lines, fpos.x, fpos.y); fpos.x = ord.x; fpos.y = ord.y;
        const i = islandIdx(region.outer[0], region.outer[1]);
        fillBy[i].push(...linesToPaths(ord.lines, zz, base));
      };
      const emitAll = (rs: ExPoly[], o: FillOpts, base: Omit<Path, "xyz" | "closed">, zz: number) => { for (const q of rs) emit(q, o, base, zz); };
      const ext = (polys: ExPoly[], d: number) => (d > 0 ? offsetPolys(polys, d) : polys);
      const solidAngle = cfg.n("solid_infill_direction"), sparseAngle = cfg.n("infill_direction");
      const widthOr = (w: number) => (first ? w0 : w);
      const spdInfill = (v: number) => (first ? cfg.n("initial_layer_infill_speed") : v);
      // gap fill
      const gaps = gapFillPaths(geom.gaps, z, { wi: gp.wi, h, speed: first ? cfg.n("initial_layer_infill_speed") : cfg.n("gap_infill_speed"), detectThin: cfg.b("detect_thin_wall"), filterTiny: cfg.b("filter_out_gap_fill"), obj: oi });
      for (const g of gaps) gapBy[islandIdx(g.xyz[0], g.xyz[1])].push(g);
      // bridges
      for (const r of reg.bridge) {
        const D = nozzle, ang = cfg.n("bridge_angle") > 0 ? cfg.n("bridge_angle") : bridgeAngle([r]);
        const bw = thickBridge ? D : widthOr(isW), bh = thickBridge ? D : h, pitch = thickBridge ? D * 1.02 : widthOr(isW);
        emit(r, { pattern: "monotonicline", width: bw, density: 1, angle: ang, layer: 0, z, pitch }, { feature: Feature.Bridge, obj: oi, width: bw, height: bh, flow: thickBridge ? bridgeFlow * Math.PI / 4 : bridgeFlow, speed: cfg.n("bridge_speed") }, z);
      }
      // bottom / internal solid
      const solidPat = (name: string) => name;
      for (const r of reg.bottom) emitAll(ext([r], ovT * widthOr(isW)), { pattern: solidPat(cfg.s("bottom_surface_pattern")), width: widthOr(isW), density: 1, angle: solidAngle, layer: l, z }, { feature: Feature.BottomSurface, obj: oi, width: widthOr(isW), height: h, flow: 1, speed: spdInfill(cfg.n("internal_solid_infill_speed")) }, z);
      for (const r of reg.solid) emitAll(ext([r], ovT * widthOr(isW)), { pattern: solidPat(cfg.s("internal_solid_infill_pattern")), width: widthOr(isW), density: 1, angle: solidAngle, layer: l, z }, { feature: Feature.InternalSolid, obj: oi, width: widthOr(isW), height: h, flow: 1, speed: spdInfill(cfg.n("internal_solid_infill_speed")) }, z);
      // sparse
      if (dens > 0.005) {
        const sOpts = (layer: number): FillOpts => ({ pattern: sparsePat, width: widthOr(spW), density: dens, angle: sparseAngle, layer, z, anchor: anchorL });
        const sBase = (hh: number): Omit<Path, "xyz" | "closed"> => ({ feature: Feature.SparseInfill, obj: oi, width: widthOr(spW), height: hh, flow: 1, speed: spdInfill(cfg.n("sparse_infill_speed")) });
        for (const r of sparseNorm[l]) emitAll(ext([r], ovS * spW), sOpts(l), sBase(h), z);
        for (const r of sparseComb[l]) emitAll(ext([r], ovS * spW), sOpts(l), sBase(h + grid.h[l - 1]), z);
      }
      // top
      for (const r of reg.top) emitAll(ext([r], ovT * tpW), { pattern: cfg.s("top_surface_pattern"), width: widthOr(tpW), density: 1, angle: solidAngle, layer: l, z }, { feature: Feature.TopSurface, obj: oi, width: widthOr(tpW), height: h, flow: 1, speed: spdInfill(cfg.n("top_surface_speed")) }, z);
      // ironing
      if (ironType !== "no ironing") {
        let ir: ExPoly[] = [];
        if (ironType === "top") ir = reg.top; else if (ironType === "topmost") ir = covered[l]?.length ? diffPolys(reg.top, covered[l]) : reg.top;
        else if (ironType === "solid") ir = unionAll([reg.top, reg.bottom, reg.solid]);
        const sp = Math.max(0.05, cfg.n("ironing_spacing"));
        for (const r of ir) {
          const lines = fillPolys([r], { pattern: cfg.s("ironing_pattern") === "concentric" ? "concentric" : "zig-zag", width: tpW, density: 1, angle: solidAngle, layer: 0, z, pitch: sp });
          const ord = orderLines(lines, fpos.x, fpos.y); fpos.x = ord.x; fpos.y = ord.y;
          ironPaths.push(...linesToPaths(ord.lines, z, { feature: Feature.Ironing, obj: oi, width: tpW, height: h, flow: cfg.n("ironing_flow") / 100, speed: cfg.n("ironing_speed") }));
        }
      }
      // order islands (nearest neighbour on a representative point) and compose
      const rep: [number, number][] = outline.map((p) => [p.outer[0], p.outer[1]]);
      const order: number[] = [], left = new Set<number>(outline.map((_, i) => i));
      let cx = pos.x, cy = pos.y;
      while (left.size) {
        let bi = -1, bd = Infinity;
        for (const i of left) { const d = (rep[i][0] - cx) ** 2 + (rep[i][1] - cy) ** 2; if (d < bd) { bd = d; bi = i; } }
        left.delete(bi); order.push(bi); cx = rep[bi][0]; cy = rep[bi][1];
      }
      for (const i of order) {
        const levels = wallsBy[i].map((r, k) => (r && r.length ? k : -1)).filter((k) => k >= 0);
        let seq: number[];
        if (seqW === "outer wall/inner wall") seq = levels;
        else if (seqW === "inner-outer-inner wall") seq = levels.length >= 3 ? [levels[1], levels[0], ...levels.slice(2)] : levels.length === 2 ? [levels[1], levels[0]] : levels;
        else seq = levels.slice().reverse();
        for (const k of seq) {
          const rings = wallsBy[i][k].slice();
          while (rings.length) {
            let bi = 0, bd = Infinity;
            for (let q = 0; q < rings.length; q++) {
              const r = rings[q].ring, step = Math.max(1, (r.length >> 1) >> 5);
              for (let v = 0; v < r.length >> 1; v += step) { const d = (r[2 * v] - ctx.pos.x) ** 2 + (r[2 * v + 1] - ctx.pos.y) ** 2; if (d < bd) { bd = d; bi = q; } }
            }
            const wr = rings.splice(bi, 1)[0];
            out.push(...wallRingPaths(wr, ctx));
          }
        }
        out.push(...gapBy[i]);
        out.push(...fillBy[i]);
        if (fillBy[i].length) { const lp = fillBy[i][fillBy[i].length - 1].xyz; ctx.pos.x = lp[lp.length - 3]; ctx.pos.y = lp[lp.length - 2]; }
      }
      out.push(...ironPaths);
      seams.prev = seams.cur; seams.cur = [];
    }
    layersOut.push({ z, h, paths: out, isRaft: false });
  }
  // ---- raft layers below
  if (sres && raftN) {
    const raftLayers: ObjLayer[] = []; let zt = 0;
    for (let r = 0; r < raftN; r++) {
      zt += raftH[r];
      raftLayers.push({ z: zt, h: raftH[r], paths: raftLayerPaths(sres.raftLayers[r], r, zt, raftH[r], oi, cfg, pos), isRaft: true });
    }
    layersOut.unshift(...raftLayers);
  }
  // ---- brim (not with raft)
  let brimArea: ExPoly[] = [];
  const footprint = raftN && sres ? sres.raftLayers[0] : outlines[0];
  if (!raftN) {
    const others: ExPoly[] = [];
    for (let j = 0; j < job.objects.length; j++) if (j !== oi) {
      const ob = job.objects[j], bb = meshBounds(ob.tris);
      if (Number.isFinite(bb[0])) others.push({ outer: Float64Array.of(bb[0], bb[1], bb[2], bb[1], bb[2], bb[3], bb[0], bb[3]), holes: [] });
    }
    const br = makeBrim(outlines[0], others, cfg, H, w0);
    brimArea = br.area;
    if (br.rings.length) {
      const bp = linesToPaths(br.rings.map((r) => ({ pts: r, closed: true })), layersOut[0].z, { feature: Feature.Brim, obj: oi, width: w0, height: layersOut[0].h, flow: 1, speed: cfg.n("initial_layer_speed") });
      layersOut[0].paths.unshift(...bp);
    }
  }
  void sizeOf; void PolyIndex; void polysBounds;
  return { layers: layersOut, bounds, footprint, cfg, height: H, brimArea };
}

