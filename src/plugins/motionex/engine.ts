// Motionex engine side: turns Nexspiro's move list into Motionex paths, applies the motions,
// runs the print-head collision check, and writes the result back as Nexspiro moves.
// Extrusion is recomputed from each new move's true 3D length; Nexspiro then writes the G-code.
import type { Config } from '../../profiles/settings';
import type { LayerOps, Op } from '../../engine/gcode';
import type { EnginePlugin, PluginContext } from '../api';
import { applyMotion, DEFAULT_OPTIONS, type ModifierOptions } from './modifier';
import { checkCollisions, limitZSpeed, type CollisionMode, type ToolheadProfile } from './core/toolhead';
import { RegionRegistry } from './core/regions';
import { clearOverlaps, type ClearanceOptions } from './core/clearance';
import { emptyCheck, SEAM_TOL, type Layer, type PointAction, type PrintCheck, type Toolpath, type ToolpathPoint } from './core/types';
import type { PrintProfiles, Firmware } from './core/profiles';
import type { MotionApplication, MotionBrush } from './model';

/** Everything the worker needs, as plain data. */
export interface MotionexConfig {
  applications: MotionApplication[];
  /** The motions the applications use. */
  brushes: MotionBrush[];
  options: ModifierOptions;
  collisionMode: CollisionMode;
  toolhead: ToolheadProfile;
  printerId: string;
}

export interface MotionexReport {
  check: PrintCheck;
  /** Moves changed by Motionex, for the preview. */
  movedPaths: number;
}

type Move = Extract<Op, { k: 'move' }>;

const num = (cfg: Config, k: string, d: number) => { const v = parseFloat(String(cfg[k] ?? '')); return Number.isFinite(v) ? v : d; };

/** Read machine, filament and process values the motion code needs from Nexspiro's config. */
export function profilesFromConfig(cfg: Config, printerId: string): PrintProfiles {
  const num = (k: string, d = 0) => (cfg[k] === undefined || cfg[k] === '' ? d : Number(cfg[k]));
  const flavor = String(cfg.gcode_flavor ?? 'marlin');
  const xy = num('max_speed_xy', 500), acc = num('max_acceleration', 10000);
  const maxFlow = num('filament_max_volumetric_speed', 15);
  return {
    machine: {
      id: printerId, name: String(cfg.printer_model ?? printerId), firmware: (['klipper', 'marlin', 'bambu'].includes(flavor) ? flavor : 'marlin') as Firmware,
      bed: { x: num('bed_x', 256), y: num('bed_y', 256), z: num('bed_z', 256) }, nozzle: num('nozzle_diameter', 0.4),
      maxSpeed: { x: xy, y: xy, z: num('max_speed_z', 12), e: 60 },
      maxAccel: { x: acc, y: acc, z: 500, e: 5000 },
      maxJerk: { x: 9, y: 9, z: 0.4, e: 2.5 },
      maxVolumetricFlow: maxFlow,
    },
    filament: {
      id: 'current', name: String(cfg.filament_type ?? 'Filament'), diameter: num('filament_diameter', 1.75), density: num('filament_density', 1.24),
      nozzleTemp: num('nozzle_temperature', 210), bedTemp: num('bed_temperature', 60), maxVolumetricFlow: maxFlow,
    },
    process: {
      id: 'current', name: 'current', layerHeight: num('layer_height', 0.2), firstLayerHeight: num('initial_layer_print_height', 0.2),
      lineWidth: num('outer_wall_line_width') || num('line_width', 0.42), wallSpeed: num('outer_wall_speed', 60),
      firstLayerSpeed: num('initial_layer_speed', 30), travelSpeed: num('travel_speed', 200), walls: num('wall_loops', 2),
      retractLength: num('retraction_length', 0.8), retractSpeed: num('retraction_speed', 30),
    },
  };
}

interface Run {
  layer: number;
  /** ops[start..end) are the printing moves of this path. */
  start: number; end: number;
  path: Toolpath;
  ePerMm: number;
  w: number; h: number;
  feature: Move['feature'];
}

/** Split each layer's moves into printing paths (runs of moves with one feature, between travels). */
export function opsToLayers(layers: LayerOps[]): { layers: Layer[]; runs: Run[] } {
  const out: Layer[] = [];
  const runs: Run[] = [];
  layers.forEach((L, li) => {
    const paths: Toolpath[] = [];
    let last: { x: number; y: number; z: number } | null = null;
    let i = 0;
    while (i < L.ops.length) {
      const op = L.ops[i];
      if (op.k === 'raw' && op.resetPos) { last = null; i++; continue; }
      if (op.k !== 'move') { i++; continue; }
      if (op.travel || op.e <= 0 || !last) { last = { x: op.x, y: op.y, z: op.z }; i++; continue; }
      const feature = op.feature;
      let j = i;
      const pts: ToolpathPoint[] = [{ x: last.x, y: last.y, z: last.z, f: op.f, flow: 1, e: 0 }];
      let eSum = 0, lenSum = 0;
      while (j < L.ops.length) {
        const m = L.ops[j];
        if (m.k !== 'move' || m.travel || m.e <= 0 || m.feature !== feature) break;
        const p = pts[pts.length - 1];
        lenSum += Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z);
        eSum += m.e;
        pts.push({ x: m.x, y: m.y, z: m.z, f: m.f, flow: 1, e: m.e, w: m.w });
        j++;
      }
      const a = pts[0], b = pts[pts.length - 1];
      const path: Toolpath = { feature, closed: Math.hypot(a.x - b.x, a.y - b.y) < (lenSum > SEAM_TOL * 8 ? SEAM_TOL : 1e-3), points: pts };
      paths.push(path);
      runs.push({ layer: li, start: i, end: j, path, ePerMm: lenSum > 0 ? eSum / lenSum : 0, w: op.w, h: op.h, feature });
      last = { x: b.x, y: b.y, z: b.z };
      i = j;
    }
    out.push({ index: li, z: L.z, height: L.h, paths });
  });
  return { layers: out, runs };
}

function postOps(a: PointAction, at: ToolpathPoint, run: Run, cfg: Config): Op[] {
  const rs = Number(cfg.retraction_speed ?? 30) || 30, ds = Number(cfg.deretraction_speed ?? 0) || rs;
  const out: Op[] = [];
  if (a.retract_mm) out.push({ k: 'retract', len: a.retract_mm, speed: rs });
  // A blob is plastic pushed out on the spot, slowly (2 mm/s of filament).
  if (a.blob_mm) out.push({ k: 'move', x: at.x, y: at.y, z: at.z, e: a.blob_mm, f: 2, feature: run.feature, w: run.w, h: run.h, travel: false, fixed: true, noArc: true });
  if (a.dwell_ms) out.push({ k: 'raw', text: `G4 P${Math.round(a.dwell_ms)} ; motionex pause`, time: a.dwell_ms / 1000 });
  if (a.unretract_mm) out.push({ k: 'retract', len: -a.unretract_mm, speed: ds });
  return out;
}

/**
 * Moves for a changed path, with E from the true 3D length of each move. A path that was only cut
 * (not moved) keeps the slicer's own E for each piece, so variable-width lines keep their plastic.
 */
function runToOps(run: Run, original: ToolpathPoint, cfg: Config): Op[] {
  const pts = run.path.points;
  const out: Op[] = [];
  if (pts.length < 2) return out;
  const ownE = run.path.clipped && run.path.modifiedBy !== 'motionex';
  const s = pts[0];
  if (Math.hypot(s.x - original.x, s.y - original.y, s.z - original.z) > 1e-4)
    out.push({ k: 'move', x: s.x, y: s.y, z: s.z, e: 0, f: Number(cfg.travel_speed ?? 200), feature: 'travel', w: 0, h: run.h, travel: true });
  if (s.post) out.push(...postOps(s.post, s, run, cfg));
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1], q = pts[k];
    const len = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    if (q.travel) out.push({ k: 'move', x: q.x, y: q.y, z: q.z, e: 0, f: Number(cfg.travel_speed ?? 200), feature: 'travel', w: 0, h: run.h, travel: true, noArc: true });
    else if (len > 1e-6) out.push({ k: 'move', x: q.x, y: q.y, z: q.z, e: ownE ? q.e : len * run.ePerMm * q.flow, f: q.f, feature: run.feature, w: q.w ?? run.w, h: run.h, travel: false, noArc: true });
    if (q.post) out.push(...postOps(q.post, q, run, cfg));
  }
  return out;
}

export const motionexEngine: EnginePlugin<MotionexConfig, MotionexReport> = {
  id: 'motionex',
  name: 'Motionex',
  version: '0.3.0',
  postToolpath(layerOps, config, ctx: PluginContext) {
    const check = emptyCheck();
    const apps = config.applications.filter((a) => a.enabled).map((a) => ({ ...a, target: { ...a.target } }));
    if (!apps.length) return { check, movedPaths: 0 };
    const profiles = profilesFromConfig(ctx.cfg, config.printerId);
    const regions = new RegionRegistry();
    for (const f of ctx.faceRegions) {
      regions.set({ region_id: f.id, name: f.name, layer_range: [0, layerOps.length - 1], polygon_mask_per_layer: (l) => f.polygonsAt(l), attributes: { source: 'faces' } });
    }
    // Regions owned by Patternex (spec §8): Motionex only edits toolpaths inside their masks.
    for (const r of ctx.sharedRegions ?? []) regions.set(r);
    // A picked-surface number means that surface set on every object; a shared region id is used as is.
    for (const a of apps) if (a.target.type === 'faces')
      a.target = {
        ...a.target,
        faces: [
          ...ctx.faceRegions.filter((f) => (a.target.faces ?? []).some((n) => f.id === n || f.id.endsWith(`:${n}`))).map((f) => f.id),
          ...(a.target.faces ?? []).filter((n) => regions.get(n)?.attributes.source === 'patternex'),
        ],
      };
    const { layers, runs } = opsToLayers(layerOps);
    const originals = runs.map((r) => ({ ...r.path.points[0] }));
    const brushes = new Map(config.brushes.map((b) => [b.id, b]));
    const res = applyMotion(layers, apps, (id) => brushes.get(id), profiles, config.options ?? DEFAULT_OPTIONS, check, regions);
    for (const w of res.warnings) ctx.warn(w.message);
    // applyMotion replaces path objects; map them back to their runs by position in the layer.
    const byLayer = new Map<number, Run[]>();
    for (const r of runs) { const l = byLayer.get(r.layer); if (l) l.push(r); else byLayer.set(r.layer, [r]); }
    for (const [li, rs] of byLayer) rs.forEach((r, k) => { r.path = res.layers[li].paths[k]; });

    if (res.layers.some((l) => l.paths.some((p) => p.points.some((q) => q.zOff)))) {
      checkCollisions(res.layers, config.toolhead, profiles.machine.bed, config.collisionMode, check, (w) => ctx.warn(w.message));
      check.zSpeedHits += limitZSpeed(res.layers, profiles.machine.maxSpeed.z);
    }
    if (check.blocking) ctx.warn('Motionex: export is blocked until the print-head collisions are fixed.');

    // Nothing may print over a moved wall: cut the other lines of each layer back to the slicer's spacing.
    const clear: ClearanceOptions = {
      layerHeight: profiles.process.layerHeight, infillOverlap: num(ctx.cfg, 'infill_wall_overlap', 15) / 100,
      retractOver: Math.max(1, num(ctx.cfg, 'retraction_minimum_travel', 1)), retractLength: num(ctx.cfg, 'retraction_length', 0.8),
    };
    for (const [li, rs] of byLayer) {
      const L = res.layers[li];
      if (!clearOverlaps(L, (_p, k) => rs[k].w, { ...clear, layerHeight: rs[0]?.h || clear.layerHeight })) continue;
      rs.forEach((r, k) => { r.path = L.paths[k]; });
    }

    // Write back from the last run of each layer so earlier op indices stay valid.
    let moved = 0;
    for (let k = runs.length - 1; k >= 0; k--) {
      const r = runs[k];
      if (r.path.modifiedBy !== 'motionex' && !r.path.clipped) continue;
      layerOps[r.layer].ops.splice(r.start, r.end - r.start, ...runToOps(r, originals[k], ctx.cfg));
      moved++;
    }
    return { check, movedPaths: moved };
  },
  gcodeHeader(config) {
    const names = new Map(config.brushes.map((b) => [b.id, b]));
    return config.applications.filter((a) => a.enabled).map((a) => {
      const b = a.brush ?? names.get(a.brush_id);
      const where = a.target.type === 'faces' ? `${(a.target.faces ?? []).length} picked surface(s)` : 'whole body';
      return `; motionex: ${b?.name ?? a.brush_id} v${b?.version ?? '?'} on ${where}, ${a.target.walls} walls, z ${a.mask.z_start}-${a.mask.z_end}${a.scale && a.scale !== 1 ? ` size x${a.scale}` : ''}${a.blend === 'override' ? ' replace' : ''}`;
    });
  },
};
