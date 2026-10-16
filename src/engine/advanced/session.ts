// The Advanced slicing session: analyses every part, routes zones to technologies, adapts them to the
// machine, and exposes the hooks the slicer calls at each pipeline stage. Basic mode never creates one.
import type { Config } from '../../profiles/settings';
import type { LayerOps } from '../gcode';
import type { IndexedMesh } from '../mesh';
import type { FilamentSlot, MeshInput, Paths, Polyline2, ExPolygon } from '../types';
import type { PluginSession } from '../../plugins/api';
import { analyzePart, RESOLUTION_CELLS, type PartAnalysis } from './analysis';
import { machineCaps, type MachineCaps } from './machine';
import { resolveTechs, type ResolvedTech } from './techs';
import type { AdvancedConfig, AdvancedReport, TechId, TechReport, ParamValue } from './types';
import { MODULES } from './modules';

export interface WallLoop { pts: number[]; closed: boolean; feature: 'outer_wall' | 'inner_wall'; width: number; flow: number }
export interface WallResult { loops: WallLoop[][]; inner: Paths }
export interface InfillPath extends Polyline2 { width: number; flow?: number; feature?: 'sparse_infill' | 'internal_solid_infill'; /** Width per point (variable-width beads). */ widths?: number[] }

/** Context the slicer gives the wall hook for one island. */
export interface WallCtx { walls: number; wo: number; wi: number; so: number; si: number; h: number; z: number; layer: number }
/** Context for the infill hook. */
export interface InfillCtx { width: number; density: number; z: number; h: number; layer: number; pattern: string }

export interface StageCtx {
  cfg: Config;
  layerZ: number[];
  layerH: number[];
  warn(msg: string): void;
}

export interface SessionCtx {
  cfg: Config;
  num(k: string): number;
  caps: MachineCaps;
  adv: AdvancedConfig;
  filaments: FilamentSlot[];
  meshes: MeshInput[];
  parts: PartAnalysis[];
  techs: Map<TechId, ResolvedTech>;
  /** Report entry of a technology (created on first use). */
  report(id: TechId): TechReport;
  warn(msg: string): void;
  /** True when the technology is enabled and the machine allows it. */
  on(id: TechId): boolean;
  param(id: TechId, key: string): ParamValue;
  pnum(id: TechId, key: string): number;
}

/** A technology implementation: any subset of the stage hooks. */
export interface TechModule {
  id: TechId;
  /** Adds this technology's field to a part analysis for the Zone Inspector (no slicing). */
  inspect?(a: PartAnalysis): void;
  prepare?(s: SessionCtx): void;
  /** Z displacement field for curved layers: real z = z′ + dz(x, y, z′). */
  warp?(s: SessionCtx): Warp | undefined;
  reshape?(s: SessionCtx, object: number, layer: number, slice: Paths, z: number): Paths;
  walls?(s: SessionCtx, object: number, ex: ExPolygon, c: WallCtx): WallResult | undefined;
  infill?(s: SessionCtx, object: number, region: Paths, c: InfillCtx): InfillPath[] | undefined;
  post?(s: SessionCtx, layers: LayerOps[], c: StageCtx): void;
  finalize?(s: SessionCtx, layers: LayerOps[], c: StageCtx): void;
}

export interface Warp {
  /** Displacement in Z at a point of the warped (sliced) space. */
  dz(x: number, y: number, zw: number): number;
  /** Map a real point into warped space (for warping the mesh). */
  toWarped(x: number, y: number, z: number): number;
  /** d(real z)/d(warped z): local layer-thickness ratio. */
  ratio(x: number, y: number, zw: number): number;
  source: TechId;
}

export interface AdvancedSession {
  ctx: SessionCtx;
  /** Meshes to slice: warped into curved-layer space when a layer technology is active. */
  meshes: MeshInput[];
  warp?: Warp;
  plugin: PluginSession;
  /** Wall generator override for one island (first technology that answers wins). */
  walls?: (object: number, ex: ExPolygon, c: WallCtx) => WallResult | undefined;
  /** Infill override for one sparse region. */
  infill?: (object: number, region: Paths, c: InfillCtx) => InfillPath[] | undefined;
  post(layers: LayerOps[], c: StageCtx): void;
  finalize(layers: LayerOps[], c: StageCtx): void;
  report(): AdvancedReport;
}

export function createAdvancedSession(meshes: MeshInput[], cfg: Config, adv: AdvancedConfig, filaments: FilamentSlot[], warn: (m: string) => void): AdvancedSession {
  const t0 = now();
  const num = (k: string) => Number(cfg[k] ?? 0);
  const caps = machineCaps(adv.printerId, cfg, adv.machine);
  const nozzle = num('nozzle_diameter') || 0.4;
  const lw = (k: string) => num(k) || num('line_width') || nozzle * 1.05;
  const wallLoops = Math.max(1, Math.round(num('wall_loops')) || 2);
  const shell = lw('outer_wall_line_width') + (wallLoops - 1) * lw('inner_wall_line_width');
  const cells = RESOLUTION_CELLS[adv.resolution ?? 'normal'];
  const parts = meshes.map((m) => analyzePart(m as IndexedMesh, {
    cells, shell, lineWidth: lw('line_width'), layerHeight: num('layer_height') || 0.2, overhangDeg: num('support_threshold_angle') || 30, color: m.paint?.color,
  }));
  const usedFils = new Set(meshes.map((m) => m.filament ?? 0));
  for (const m of meshes) m.paint?.color?.forEach((c) => { if (c) usedFils.add(c - 1); });
  const resolved = resolveTechs(adv, {
    caps, filamentType: filaments[0]?.type ?? String(cfg.filament_type ?? 'PLA'), materials: usedFils.size, wallLoops, hasCaustic: !!adv.caustic?.pixels?.length,
  });
  const techs = new Map(resolved.map((r) => [r.def.id, r]));
  const reports = new Map<TechId, TechReport>();
  const warnings: string[] = [];
  const ctx: SessionCtx = {
    cfg, num, caps, adv, filaments, meshes, parts, techs,
    report(id) { let r = reports.get(id); if (!r) { r = { id, status: 'applied', stats: {} }; reports.set(id, r); } return r; },
    warn(msg) { if (!warnings.includes(msg)) warnings.push(msg); warn(msg); },
    on(id) { const t = techs.get(id); return !!t && t.enabled && t.verdict.status !== 'unavailable'; },
    param(id, key) { return techs.get(id)!.params[key]; },
    pnum(id, key) { return Number(techs.get(id)!.params[key]); },
  };
  const active = MODULES.filter((m) => ctx.on(m.id));
  const timed = <T>(id: TechId, fn: () => T): T => {
    const s = now();
    try { return fn(); } finally { const r = ctx.report(id); r.ms = (r.ms ?? 0) + (now() - s); }
  };
  for (const m of active) if (m.prepare) timed(m.id, () => m.prepare!(ctx));
  // curved layers: the first layer technology that yields a warp wins (dome slicing before SGD)
  let warp: Warp | undefined;
  for (const m of active) {
    if (warp || !m.warp) continue;
    warp = timed(m.id, () => m.warp!(ctx));
  }
  const sliceMeshes = warp ? meshes.map((m) => warpMesh(m, warp!)) : meshes;

  const reshapers = active.filter((m) => m.reshape);
  const wallers = active.filter((m) => m.walls);
  const fillers = active.filter((m) => m.infill);
  const plugin: PluginSession = {
    reshape: reshapers.length ? (o, i, sl) => reshapers.reduce((acc, m) => m.reshape!(ctx, o, i, acc, NaN), sl) : undefined,
  };
  const walls = wallers.length ? (o: number, ex: ExPolygon, c: WallCtx) => {
    for (const m of wallers) { const r = timed(m.id, () => m.walls!(ctx, o, ex, c)); if (r) return r; }
    return undefined;
  } : undefined;
  const infill = fillers.length ? (o: number, region: Paths, c: InfillCtx) => {
    for (const m of fillers) { const r = timed(m.id, () => m.infill!(ctx, o, region, c)); if (r) return r; }
    return undefined;
  } : undefined;

  return {
    ctx, meshes: sliceMeshes, warp, plugin, walls, infill,
    post(layers, c) { for (const m of active) if (m.post) timed(m.id, () => m.post!(ctx, layers, c)); },
    finalize(layers, c) { for (const m of active) if (m.finalize) timed(m.id, () => m.finalize!(ctx, layers, c)); },
    report() {
      const zoneTotals = new Map<string, { kind: any; areaMm2: number; volumeMm3: number; triangles: number }>();
      for (const p of parts) for (const z of p.zones) {
        const s = zoneTotals.get(z.kind) ?? { kind: z.kind, areaMm2: 0, volumeMm3: 0, triangles: 0 };
        s.areaMm2 += z.areaMm2; s.volumeMm3 += z.volumeMm3; s.triangles += z.triangles;
        zoneTotals.set(z.kind, s);
      }
      const implemented = new Set(MODULES.map((m) => m.id));
      const techReports: TechReport[] = resolved.map((r) => {
        const used = reports.get(r.def.id);
        if (!r.enabled) return { id: r.def.id, status: 'disabled' };
        if (r.verdict.status === 'unavailable') return { id: r.def.id, status: 'unavailable', reason: r.verdict.reason };
        if (!implemented.has(r.def.id) && r.def.id !== 'sdf_frep') return { id: r.def.id, status: 'idle', reason: 'Not part of this engine build.' };
        const applied = r.def.id === 'sdf_frep' || (used && used.status === 'applied' && Object.keys(used.stats ?? {}).length > 0);
        const status = used?.status === 'idle' || !applied ? 'idle' : r.verdict.status === 'adapted' ? 'adapted' : 'applied';
        return { id: r.def.id, status, reason: used?.reason ?? r.verdict.reason, stats: used?.stats, ms: used?.ms };
      });
      const sdf = techReports.find((r) => r.id === 'sdf_frep');
      if (sdf && sdf.status !== 'disabled') {
        sdf.stats = { ...(sdf.stats ?? {}), voxels: parts.reduce((s, p) => s + p.sdf.sdf.n, 0), cell_mm: +Math.min(...parts.map((p) => p.sdf.sdf.h)).toFixed(3) };
      }
      return {
        intent: adv.intent,
        machine: { name: caps.name, kinematics: caps.kinematics, axes: caps.axes, maxSlopeDeg: +caps.maxSlopeDeg.toFixed(1), firmware: caps.firmware, notes: caps.notes },
        zones: [...zoneTotals.values()],
        techs: techReports,
        warnings,
        ms: Math.round(now() - t0),
      };
    },
  };
}

/** Warp a mesh into curved-layer space (z → z′) so planar slicing yields curved layers. */
function warpMesh(m: MeshInput, w: Warp): MeshInput {
  const v = m.vertices.slice();
  for (let i = 0; i < v.length; i += 3) v[i + 2] = w.toWarped(v[i], v[i + 1], v[i + 2]);
  return { ...m, vertices: v, parts: m.parts?.map((p) => {
    const pv = p.vertices.slice();
    for (let i = 0; i < pv.length; i += 3) pv[i + 2] = w.toWarped(pv[i], pv[i + 1], pv[i + 2]);
    return { ...p, vertices: pv };
  }) };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
