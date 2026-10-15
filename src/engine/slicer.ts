// The NexSpiro slicing pipeline (stages 2–10). Pure TypeScript, runs in a Web Worker or Node.
import type { Config } from '../profiles/settings';
import {
  area, bounds, difference, exToPaths, intersection, offset, opening, SCALE, toExPolygons, union,
} from './clipper';
import ClipperLib from 'clipper-lib';
import { concentricFill, linesFill, sparseFill, type SparsePattern } from './fill';
import { emit, type LayerOps, type Op } from './gcode';
import type { IndexedMesh } from './mesh';
import { orderPaths, pickSeam, rotateLoop, simplify, type SeamMode } from './order';
import { sliceMesh } from './slice';
import { generateSupport } from './support';
import type { ExPolygon, FeatureType, MeshInput, Paths, Polyline2, SliceOutput } from './types';

const C: any = (ClipperLib as any).default ?? ClipperLib;

export type ProgressFn = (stage: string, pct: number) => void;

interface PathItem extends Polyline2 { feature: FeatureType; width: number; flow: number; spiral?: boolean }

const spacingOf = (w: number, h: number) => w - h * (1 - Math.PI / 4);

function pathToPoly(p: Paths[number]): number[] {
  const out: number[] = [];
  for (const q of p) out.push(q.X / SCALE, q.Y / SCALE);
  return out;
}

function pointInPaths(x: number, y: number, paths: Paths): boolean {
  const pt = { X: Math.round(x * SCALE), Y: Math.round(y * SCALE) };
  let inside = 0;
  for (const p of paths) if (C.Clipper.PointInPolygon(pt, p) !== 0) inside++;
  return inside % 2 === 1;
}

/** Splits a wall loop into runs, marking segments unsupported by the layer below as overhang. */
function splitOverhang(item: PathItem, support: Paths | null): PathItem[] {
  if (!support) return [item];
  const pts = item.closed ? [...item.pts, item.pts[0], item.pts[1]] : item.pts;
  const n = pts.length / 2;
  const runs: PathItem[] = [];
  let curFeat: FeatureType | null = null;
  let cur: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const mx = (pts[i * 2] + pts[i * 2 + 2]) / 2, my = (pts[i * 2 + 1] + pts[i * 2 + 3]) / 2;
    const f: FeatureType = pointInPaths(mx, my, support) ? item.feature : 'overhang_wall';
    if (f !== curFeat) {
      if (cur.length >= 4) runs.push({ ...item, feature: curFeat!, pts: cur, closed: false });
      cur = [pts[i * 2], pts[i * 2 + 1]];
      curFeat = f;
    }
    cur.push(pts[i * 2 + 2], pts[i * 2 + 3]);
  }
  if (cur.length >= 4) runs.push({ ...item, feature: curFeat!, pts: cur, closed: false });
  if (runs.length === 1 && runs[0].feature === item.feature) return [item];
  return runs;
}

function fuzz(pts: number[], thick: number, dist: number, rnd: () => number): number[] {
  const out: number[] = [];
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2], ay = pts[i * 2 + 1];
    const bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.floor(len / dist));
    const nx = len ? -(by - ay) / len : 0, ny = len ? (bx - ax) / len : 0;
    for (let s = 0; s < steps; s++) {
      const t = s / steps, r = (rnd() * 2 - 1) * thick;
      out.push(ax + (bx - ax) * t + nx * r, ay + (by - ay) * t + ny * r);
    }
  }
  return out;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function slice(meshes: MeshInput[], cfg: Config, progress: ProgressFn = () => {}): SliceOutput {
  const num = (k: string) => Number(cfg[k] ?? 0);
  const str = (k: string) => String(cfg[k] ?? '');
  const bool = (k: string) => cfg[k] === true;
  const warnings: string[] = [];
  const rnd = mulberry(42);

  const nozzle = num('nozzle_diameter');
  const lw = (k: string) => num(k) || num('line_width') || nozzle * 1.05;
  const h0 = num('initial_layer_print_height');
  const hN = num('layer_height');
  const vase = bool('spiral_mode');
  const density = vase ? 0 : num('sparse_infill_density') / 100;
  const flavor = str('gcode_flavor');

  // ---------- layer plan
  let maxZ = 0;
  for (const m of meshes) for (let i = 2; i < m.vertices.length; i += 3) maxZ = Math.max(maxZ, m.vertices[i]);
  if (maxZ <= 0) throw new Error('Nothing to slice: the plate is empty.');
  const zs: number[] = [], hs: number[] = [];
  let z = h0; zs.push(z); hs.push(h0);
  while (z + hN * 0.5 < maxZ) { z += hN; zs.push(+z.toFixed(4)); hs.push(hN); }
  const N = zs.length;
  const planes = zs.map((zz, i) => zz - hs[i] / 2);

  // ---------- stage 2/3: slice each object + compensation
  progress('Slicing mesh', 0.05);
  const objSlices: Paths[][] = meshes.map((m, oi) => {
    const s = sliceMesh(m as IndexedMesh, planes);
    progress('Slicing mesh', 0.05 + 0.15 * ((oi + 1) / meshes.length));
    return s;
  });
  const xyc = num('xy_contour_compensation'), xyh = num('xy_hole_compensation'), efc = num('elefant_foot_compensation');
  for (const sl of objSlices) {
    for (let i = 0; i < N; i++) {
      if ((xyc || xyh) && sl[i].length) {
        const exs = toExPolygons(sl[i]);
        const outer = offset(exs.map((e) => e.contour), xyc);
        const holes = offset(exs.flatMap((e) => e.holes.map((h) => h.slice().reverse())), xyh);
        sl[i] = difference(outer, holes);
      }
      if (i === 0 && efc > 0) sl[i] = offset(sl[i], -efc);
    }
  }
  const layerSlices: Paths[] = Array.from({ length: N }, (_, i) => union(objSlices.flatMap((s) => s[i])));

  // ---------- stage 4: perimeters (classic)
  progress('Generating perimeters', 0.25);
  const wo0 = lw('outer_wall_line_width'), wi0 = lw('inner_wall_line_width');
  const walls = vase ? 1 : Math.max(0, Math.round(num('wall_loops')));
  interface Island { obj: number; ex: ExPolygon; loops: PathItem[][]; inner: Paths }
  const layerIslands: Island[][] = [];
  const layerInner: Paths[][] = []; // per object
  for (let i = 0; i < N; i++) {
    const h = hs[i];
    const wo = i === 0 ? lw('initial_layer_line_width') : wo0;
    const wi = i === 0 ? lw('initial_layer_line_width') : wi0;
    const so = spacingOf(wo, h), si = spacingOf(wi, h);
    const islands: Island[] = [];
    const inners: Paths[] = [];
    objSlices.forEach((sl, oi) => {
      const objInner: Paths = [];
      for (const ex of toExPolygons(sl[i])) {
        const ip = exToPaths(ex);
        const loops: PathItem[][] = [];
        let boundary = 0;
        for (let k = 0; k < walls; k++) {
          const d = k === 0 ? wo / 2 : wo / 2 + (so + si) / 2 + (k - 1) * si;
          const ps = offset(ip, -d);
          if (!ps.length) break;
          const w = k === 0 ? wo : wi;
          loops.push(ps.filter((p) => p.length >= 3).map((p) => ({
            pts: pathToPoly(p), closed: true, feature: (k === 0 ? 'outer_wall' : 'inner_wall') as FeatureType, width: w, flow: 1,
          })));
          boundary = d + (k === 0 ? so : si) / 2;
        }
        const inner = walls > 0 ? (loops.length === walls ? offset(ip, -boundary) : []) : ip;
        objInner.push(...inner);
        islands.push({ obj: oi, ex, loops, inner });
      }
      inners.push(union(objInner));
    });
    layerIslands.push(islands);
    layerInner.push(inners);
    if (i % 10 === 0) progress('Generating perimeters', 0.25 + 0.15 * (i / N));
  }

  // ---------- stage 5: region classification (per object)
  progress('Classifying surfaces', 0.4);
  const topLayers = vase ? 0 : Math.max(Math.round(num('top_shell_layers')), num('top_shell_thickness') > 0 ? Math.ceil(num('top_shell_thickness') / hN - 1e-6) : 0);
  const botLayers = Math.max(Math.round(num('bottom_shell_layers')), num('bottom_shell_thickness') > 0 ? Math.ceil(num('bottom_shell_thickness') / hN - 1e-6) : 0);
  type Regions = { top: Paths; bottom: Paths; bridge: Paths; solid: Paths; sparse: Paths };
  const regions: Regions[][] = []; // [layer][obj]
  const minSparse = num('minimum_sparse_infill_area');
  for (let i = 0; i < N; i++) {
    const per: Regions[] = [];
    for (let o = 0; o < meshes.length; o++) {
      const inner = layerInner[i][o];
      if (!inner.length) { per.push({ top: [], bottom: [], bridge: [], solid: [], sparse: [] }); continue; }
      const sw = lw('internal_solid_infill_line_width');
      const clean = (p: Paths) => opening(p, sw * 0.25);
      const above = i + 1 < N ? objSlices[o][i + 1] : [];
      const below = i > 0 ? objSlices[o][i - 1] : [];
      let top = vase && i >= botLayers ? [] : clean(i + 1 < N ? difference(inner, above) : inner);
      const bottomAll = clean(i > 0 ? difference(inner, below) : inner);
      let bottom = i === 0 ? bottomAll : [];
      let bridge = i === 0 ? [] : bottomAll;
      if (vase && i >= botLayers) { top = []; bridge = []; }

      let solid: Paths = [];
      if (vase) {
        solid = i < botLayers ? inner : [];
      } else {
        if (topLayers > 0) {
          let cov: Paths | null = null;
          for (let k = 1; k <= topLayers; k++) {
            if (i + k >= N) { cov = []; break; }
            cov = cov === null ? layerInner[i + k][o] : intersection(cov, layerInner[i + k][o]);
            if (!cov.length) break;
          }
          solid = solid.concat(difference(inner, cov ?? []));
        }
        if (botLayers > 0) {
          let cov: Paths | null = null;
          for (let k = 1; k <= botLayers; k++) {
            if (i - k < 0) { cov = []; break; }
            cov = cov === null ? layerInner[i - k][o] : intersection(cov, layerInner[i - k][o]);
            if (!cov.length) break;
          }
          solid = solid.concat(difference(inner, cov ?? []));
        }
        solid = clean(difference(union(solid), union([...top, ...bottom, ...bridge])));
      }
      let sparse = vase ? [] : difference(inner, union([...top, ...bottom, ...bridge, ...solid]));
      if (density >= 0.999) { solid = union([...solid, ...sparse]); sparse = []; }
      else if (minSparse > 0 && sparse.length) {
        const exs = toExPolygons(sparse);
        const small = exs.filter((e) => area(e.contour) + e.holes.reduce((s, hh) => s + area(hh), 0) < minSparse);
        if (small.length) {
          const smallPaths = small.flatMap(exToPaths);
          solid = union([...solid, ...smallPaths]);
          sparse = difference(sparse, smallPaths);
        }
      }
      per.push({ top, bottom, bridge, solid, sparse });
    }
    regions.push(per);
    if (i % 10 === 0) progress('Classifying surfaces', 0.4 + 0.15 * (i / N));
  }

  // ---------- stage 6: support
  let support: { base: Paths[]; iface: Paths[] } | null = null;
  if (bool('enable_support')) {
    progress('Generating support', 0.55);
    support = generateSupport(layerSlices, hs, {
      thresholdAngle: num('support_threshold_angle'),
      topZDistance: num('support_top_z_distance'),
      xyDistance: num('support_object_xy_distance'),
      interfaceLayers: Math.round(num('support_interface_top_layers')),
      buildPlateOnly: bool('support_on_build_plate_only'),
      removeSmall: bool('support_remove_small_overhang'),
      lineWidth: lw('support_line_width'),
    });
  }

  // ---------- bed adhesion (first layer)
  const brimLoops: PathItem[] = [];
  const skirtLoops: PathItem[] = [];
  {
    const w = lw('initial_layer_line_width');
    const s = spacingOf(w, h0);
    let brimType = str('brim_type');
    if (brimType === 'auto_brim') {
      // brim only for tall objects with a small footprint
      const b = bounds(layerSlices[0]);
      const minDim = Math.min(b.maxX - b.minX, b.maxY - b.minY) / SCALE;
      brimType = isFinite(minDim) && (maxZ / Math.max(minDim, 0.1) > 3 || minDim < 6) ? 'outer_only' : 'no_brim';
    }
    const bw = num('brim_width'), gap = num('brim_object_gap');
    const exs0 = toExPolygons(layerSlices[0]);
    if (brimType !== 'no_brim' && bw > 0) {
      const count = Math.max(1, Math.floor(bw / s));
      const outers = exs0.map((e) => e.contour);
      if (brimType === 'outer_only' || brimType === 'outer_and_inner') {
        for (let k = count - 1; k >= 0; k--) for (const p of offset(outers, gap + w / 2 + k * s)) brimLoops.push({ pts: pathToPoly(p), closed: true, feature: 'brim', width: w, flow: 1 });
      }
      if (brimType === 'inner_only' || brimType === 'outer_and_inner') {
        const holes = exs0.flatMap((e) => e.holes.map((h) => h.slice().reverse()));
        for (let k = 0; k < count; k++) for (const p of offset(holes, -(gap + w / 2 + k * s))) brimLoops.push({ pts: pathToPoly(p), closed: true, feature: 'brim', width: w, flow: 1 });
      }
    }
    const skirtN = Math.round(num('skirt_loops'));
    if (skirtN > 0) {
      let base = union([...layerSlices[0], ...(support ? [...support.base[0], ...support.iface[0]] : [])]);
      if (brimLoops.length) base = union(base, offset(base, gap + bw));
      for (let k = skirtN - 1; k >= 0; k--) {
        for (const p of offset(base, num('skirt_distance') + w / 2 + k * s, 'round')) skirtLoops.push({ pts: pathToPoly(p), closed: true, feature: 'skirt', width: w, flow: 1 });
      }
    }
  }

  // ---------- stage 7/8: infill, ordering, ops
  progress('Generating infill & toolpaths', 0.6);
  const seamMode = str('seam_position') as SeamMode;
  const resolution = num('resolution');
  const overlap = num('infill_wall_overlap') / 100;
  const sparsePattern = str('sparse_infill_pattern') as SparsePattern;
  const infillDir = num('infill_direction');
  const solidDir = num('solid_infill_direction');
  const ironing = str('ironing_type');
  const fuzzy = str('fuzzy_skin');
  const wallSeq = str('wall_sequence');
  const filArea = Math.PI * (num('filament_diameter') / 2) ** 2;
  const flowRatio = num('filament_flow_ratio') || 1;
  const mvs = num('filament_max_volumetric_speed') || 1e9;

  const speedFor = (feat: FeatureType, layer: number): number => {
    if (layer === 0) {
      if (feat === 'outer_wall' || feat === 'inner_wall' || feat === 'overhang_wall' || feat === 'skirt' || feat === 'brim') return num('initial_layer_speed');
      return num('initial_layer_infill_speed');
    }
    switch (feat) {
      case 'outer_wall': return num('outer_wall_speed');
      case 'inner_wall': return num('inner_wall_speed');
      case 'overhang_wall': return num('overhang_speed');
      case 'sparse_infill': return num('sparse_infill_speed');
      case 'internal_solid_infill': case 'bottom_surface': return num('internal_solid_infill_speed');
      case 'top_surface': return num('top_surface_speed');
      case 'bridge': return num('bridge_speed');
      case 'ironing': return num('ironing_speed');
      case 'support': return num('support_speed');
      case 'support_interface': return num('support_interface_speed');
      default: return num('initial_layer_speed');
    }
  };
  const accelFor = (feat: FeatureType, layer: number): number => {
    if (layer === 0) return num('initial_layer_acceleration');
    if (feat === 'outer_wall' || feat === 'overhang_wall') return num('outer_wall_acceleration');
    if (feat === 'top_surface' || feat === 'ironing') return num('top_surface_acceleration');
    return num('default_acceleration');
  };

  const retractLen = num('retraction_length'), retractSpeed = num('retraction_speed'), deretractSpeed = num('deretraction_speed') || retractSpeed;
  const zHop = num('z_hop'), minTravel = num('retraction_minimum_travel');
  const travelSpeed = num('travel_speed');
  const reduceInfillRetract = bool('reduce_infill_retraction');
  const fanOffLayers = num('close_fan_the_first_x_layers');
  const labels = bool('label_objects') && flavor !== 'bambu';

  const layerOps: LayerOps[] = [];
  let px = 0, py = 0;
  let retracted = false;
  let prevSeams: [number, number][] = [];
  let curZ = 0;

  for (let i = 0; i < N; i++) {
    const h = hs[i], zTop = zs[i];
    const ops: Op[] = [];
    const seams: [number, number][] = [];
    let lastFeature: FeatureType | null = null;
    let accelSet = -1;
    let lastObj = -1;

    const travel = (x: number, y: number, feat: FeatureType, z = zTop) => {
      const d = Math.hypot(x - px, y - py);
      if (d < 1e-4 && Math.abs(z - curZ) < 1e-6) return;
      const skipRetract = reduceInfillRetract && feat === 'sparse_infill' && lastFeature === 'sparse_infill';
      const needRetract = retractLen > 0 && d > minTravel && !skipRetract;
      if (needRetract && !retracted) { ops.push({ k: 'retract', len: retractLen, speed: retractSpeed }); retracted = true; }
      const hop = needRetract && zHop > 0;
      const ta = num('travel_acceleration');
      if (ta && ta !== accelSet) { ops.push({ k: 'accel', a: ta }); accelSet = ta; }
      if (hop) ops.push({ k: 'move', x: px, y: py, z: curZ + zHop, e: 0, f: num('max_speed_z') || 10, feature: 'travel', w: 0, h, travel: true, fixed: true });
      ops.push({ k: 'move', x, y, z: hop ? curZ + zHop : z, e: 0, f: i === 0 ? Math.min(travelSpeed, 250) : travelSpeed, feature: 'travel', w: 0, h, travel: true });
      if (hop) ops.push({ k: 'move', x, y, z, e: 0, f: num('max_speed_z') || 10, feature: 'travel', w: 0, h, travel: true, fixed: true });
      curZ = z; px = x; py = y;
    };

    const extrudePath = (it: PathItem) => {
      let pts = it.pts;
      if (pts.length < 4) return;
      const startZ = it.spiral ? zTop - h : zTop;
      travel(pts[0], pts[1], it.feature, startZ);
      if (retracted) { ops.push({ k: 'retract', len: -retractLen, speed: deretractSpeed }); retracted = false; }
      const a = accelFor(it.feature, i);
      if (a !== accelSet) { ops.push({ k: 'accel', a }); accelSet = a; }
      const hEff = it.feature === 'bridge' ? Math.min(it.width, nozzle) : h;
      const xs = it.feature === 'bridge'
        ? Math.PI * (nozzle / 2) ** 2
        : it.width > hEff ? (it.width - hEff) * hEff + Math.PI * (hEff / 2) ** 2 : it.width * hEff;
      const ePerMm = (xs / filArea) * flowRatio * it.flow;
      let v = speedFor(it.feature, i);
      v = Math.min(v, mvs / Math.max(xs, 1e-6));
      if (it.closed) pts = [...pts, pts[0], pts[1]];
      // total length for spiral z ramp
      let totalLen = 0;
      if (it.spiral) for (let k = 2; k < pts.length; k += 2) totalLen += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
      let run = 0;
      for (let k = 2; k < pts.length; k += 2) {
        const x = pts[k], y = pts[k + 1];
        const len = Math.hypot(x - px, y - py);
        if (len < 1e-5) continue;
        run += len;
        const zz = it.spiral ? startZ + (h * run) / Math.max(totalLen, 1e-6) : zTop;
        ops.push({ k: 'move', x, y, z: zz, e: len * ePerMm, f: v, feature: it.feature, w: it.width, h: hEff, travel: false });
        px = x; py = y; curZ = zz;
      }
      lastFeature = it.feature;
    };

    // --- first-layer adhesion
    if (i === 0) {
      for (const it of orderPaths(skirtLoops, px, py).paths) extrudePath(it);
      for (const it of orderPaths(brimLoops, px, py).paths) extrudePath(it);
    } else if (i < Math.round(num('skirt_height'))) {
      for (const it of orderPaths(skirtLoops.map((s) => ({ ...s })), px, py).paths) extrudePath(it);
    }

    // --- infill per object
    const islands = layerIslands[i];
    const lowerSupport = i > 0 ? offset(layerSlices[i - 1], (wo0 / 2)) : null;
    const objIndices = Array.from(new Set(islands.map((s) => s.obj)));
    for (const o of objIndices) {
      const rg = regions[i][o];
      const sw = lw('internal_solid_infill_line_width'), tw = lw('top_surface_line_width'), spw = lw('sparse_infill_line_width');
      const w0 = lw('initial_layer_line_width');
      const innerAll = layerInner[i][o];
      const clipTo = (r: Paths, w: number) => (r.length ? intersection(r, offset(innerAll, -(w / 2) + overlap * w)) : []);
      const fills: PathItem[] = [];
      const add = (polys: Polyline2[], feature: FeatureType, width: number, flow = 1) => {
        for (const p of polys) fills.push({ ...p, pts: simplify(p.pts, resolution, p.closed), feature, width, flow });
      };
      const solidAngle = solidDir + (i % 2 ? 90 : 0);
      const surface = (r: Paths, pattern: string, w: number, feature: FeatureType) => {
        const reg = clipTo(r, w);
        if (!reg.length) return;
        const s = spacingOf(w, h);
        if (pattern === 'concentric') add(concentricFill(reg, s, 0), feature, w);
        else add(linesFill(reg, s, pattern === 'aligned_rectilinear' ? solidDir : solidAngle, pattern === 'monotonic'), feature, w);
      };
      if (i === 0) surface(rg.bottom, str('bottom_surface_pattern'), w0, 'bottom_surface');
      else surface(rg.bottom, str('bottom_surface_pattern'), sw, 'bottom_surface');
      if (rg.bridge.length) {
        const reg = clipTo(rg.bridge, nozzle);
        for (const ex of toExPolygons(reg)) {
          const b = bounds([ex.contour]);
          const ang = (b.maxX - b.minX) > (b.maxY - b.minY) ? 90 : 0;
          add(linesFill(exToPaths(ex), nozzle * 1.0, ang), 'bridge', nozzle, num('bridge_flow') || 1);
        }
      }
      if (rg.solid.length) {
        const reg = clipTo(rg.solid, i === 0 ? w0 : sw);
        add(linesFill(reg, spacingOf(i === 0 ? w0 : sw, h), solidAngle), 'internal_solid_infill', i === 0 ? w0 : sw);
      }
      if (rg.sparse.length && density > 0) {
        const reg = clipTo(rg.sparse, spw);
        add(sparseFill(reg, sparsePattern, spw, density, i, zTop, infillDir), 'sparse_infill', spw);
      }
      if (rg.top.length) surface(rg.top, str('top_surface_pattern'), tw, 'top_surface');
      const ironPaths: PathItem[] = [];
      if (rg.top.length && (ironing === 'top' || (ironing === 'topmost' && i === N - 1))) {
        const reg = offset(rg.top, -tw / 2);
        for (const p of linesFill(reg, num('ironing_spacing'), solidAngle + 90)) {
          ironPaths.push({ ...p, feature: 'ironing', width: num('ironing_spacing'), flow: num('ironing_flow') / 100 * (h / num('ironing_spacing')) });
        }
      }

      // assign fills to islands by first point
      const objIslands = islands.filter((s) => s.obj === o);
      const byIsland = new Map<Island, PathItem[]>();
      for (const it of [...fills, ...ironPaths]) {
        let owner = objIslands[0];
        if (objIslands.length > 1) {
          const tx = it.pts[0], ty = it.pts[1];
          owner = objIslands.find((s) => pointInPaths(tx, ty, exToPaths(s.ex))) ?? objIslands[0];
        }
        const l = byIsland.get(owner); if (l) l.push(it); else byIsland.set(owner, [it]);
      }

      // order islands nearest-neighbour
      const left = objIslands.slice();
      if (labels && lastObj !== o) {
        const name = `obj${o}_${meshes[o].name.replace(/[^A-Za-z0-9_]/g, '_')}`;
        ops.push({ k: 'raw', text: flavor === 'klipper' ? `EXCLUDE_OBJECT_START NAME=${name}` : `M486 S${o}` });
        lastObj = o;
      }
      while (left.length) {
        let bi = 0, bd = Infinity;
        left.forEach((s, k) => {
          const c = s.ex.contour[0];
          const d = (c.X / SCALE - px) ** 2 + (c.Y / SCALE - py) ** 2;
          if (d < bd) { bd = d; bi = k; }
        });
        const isl = left.splice(bi, 1)[0];
        // walls in configured order
        const depthOrder = isl.loops.map((_, k) => k);
        let seq: number[];
        if (wallSeq === 'outer_inner') seq = depthOrder;
        else if (wallSeq === 'inner_outer_inner' && depthOrder.length >= 3) seq = [...depthOrder.slice(2).reverse(), 0, 1];
        else seq = depthOrder.slice().reverse();
        const wallItems: PathItem[] = [];
        for (const k of seq) {
          const ordered = orderPaths(isl.loops[k].map((l) => ({ ...l })), px, py).paths;
          for (const loop of ordered) {
            let pts = simplify(loop.pts, resolution, true);
            const prev = seamMode === 'aligned' && prevSeams.length
              ? prevSeams.reduce((b, s) => ((s[0] - pts[0]) ** 2 + (s[1] - pts[1]) ** 2 < (b[0] - pts[0]) ** 2 + (b[1] - pts[1]) ** 2 ? s : b))
              : null;
            const si = pickSeam(pts, seamMode, px, py, prev, rnd);
            pts = rotateLoop(pts, si);
            if (k === 0) seams.push([pts[0], pts[1]]);
            if (fuzzy !== 'none' && i > 0 && (fuzzy === 'all' || k === 0)) pts = fuzz(pts, num('fuzzy_skin_thickness'), num('fuzzy_skin_point_distance'), rnd);
            const item: PathItem = { ...loop, pts, spiral: vase && i >= botLayers };
            wallItems.push(...(i > 0 && !vase ? splitOverhang(item, lowerSupport) : [item]));
          }
        }
        const isFill = byIsland.get(isl) ?? [];
        const fillOrdered = () => {
          const groups: FeatureType[] = ['bottom_surface', 'bridge', 'internal_solid_infill', 'sparse_infill', 'top_surface', 'ironing'];
          const outp: PathItem[] = [];
          for (const g of groups) {
            const r = orderPaths(isFill.filter((f) => f.feature === g), px, py);
            outp.push(...r.paths);
          }
          return outp;
        };
        if (bool('is_infill_first')) { for (const it of fillOrdered()) extrudePath(it); for (const it of wallItems) extrudePath(it); }
        else { for (const it of wallItems) extrudePath(it); for (const it of fillOrdered()) extrudePath(it); }
      }
      if (labels) {
        const name = `obj${o}_${meshes[o].name.replace(/[^A-Za-z0-9_]/g, '_')}`;
        ops.push({ k: 'raw', text: flavor === 'klipper' ? `EXCLUDE_OBJECT_END NAME=${name}` : 'M486 S-1' });
        lastObj = -1;
      }
    }

    // --- support
    if (support) {
      const sw = i === 0 ? lw('initial_layer_line_width') : lw('support_line_width');
      const items: PathItem[] = [];
      if (support.base[i].length) {
        for (const p of offset(support.base[i], -sw / 2).map((pp) => ({ pts: pathToPoly(pp), closed: true }))) items.push({ ...p, feature: 'support', width: sw, flow: 1 });
        for (const p of linesFill(offset(support.base[i], -sw), num('support_base_pattern_spacing') + sw, num('support_angle') + (i === 0 ? 90 : 0))) items.push({ ...p, feature: 'support', width: sw, flow: 1 });
      }
      if (support.iface[i].length) {
        for (const p of linesFill(support.iface[i], num('support_interface_spacing') + sw, num('support_angle') + 90)) items.push({ ...p, feature: 'support_interface', width: sw, flow: 1 });
      }
      for (const it of orderPaths(items, px, py).paths) extrudePath(it);
    }

    if (seams.length) prevSeams = seams;
    const fan = i < fanOffLayers ? 0 : num('fan_max_speed');
    const L: LayerOps = { z: zTop, h, ops, fan };
    if (i === 1) {
      if (num('nozzle_temperature') !== num('nozzle_temperature_initial_layer')) L.temp = num('nozzle_temperature');
      if (num('bed_temperature') !== num('bed_temperature_initial_layer')) L.bedTemp = num('bed_temperature');
    }
    layerOps.push(L);
    if (i % 5 === 0) progress('Generating infill & toolpaths', 0.6 + 0.3 * (i / N));
  }

  // ---------- stage 10: emit
  progress('Writing G-code', 0.92);
  const objectLabels = meshes.map((m, o) => {
    const b = bounds(objSlices[o].flat());
    const x0 = b.minX / SCALE, y0 = b.minY / SCALE, x1 = b.maxX / SCALE, y1 = b.maxY / SCALE;
    return { name: `obj${o}_${m.name.replace(/[^A-Za-z0-9_]/g, '_')}`, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][] };
  }).filter((l) => isFinite(l.cx));
  const res = emit({ cfg, layers: layerOps, objectLabels: labels ? objectLabels : [] });

  // bounds check
  const bx = num('bed_x'), by = num('bed_y');
  const all = bounds(layerSlices.flat());
  if (all.minX / SCALE < -0.01 || all.minY / SCALE < -0.01 || all.maxX / SCALE > bx + 0.01 || all.maxY / SCALE > by + 0.01) {
    warnings.push('Some geometry lies outside the printable area.');
  }
  if (maxZ > num('bed_z')) warnings.push(`Model height ${maxZ.toFixed(1)} mm exceeds the printer's maximum height (${num('bed_z')} mm).`);
  progress('Done', 1);
  return { ...res, warnings };
}
