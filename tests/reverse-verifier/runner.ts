/**
 * Harness helpers for the batch reverse-verifier (runner.test.ts). No assertions live here: every pass/fail
 * decision comes from the locked mathAssertions.ts. This file only wires slicer configs, the width/flow
 * declarations of the core engine, and row bookkeeping.
 */
import { resolveConfig } from '../../src/profiles/resolve';
import type { Config } from '../../src/profiles/settings';
import { machineCaps } from '../../src/engine/advanced/machine';
import { weld } from '../../src/engine/mesh';
import { parseGcode } from './gcodeParser';
import * as M from './mathAssertions';

export const PROFILE_DEFAULT = 'Default' as const;
export const PROFILE_EXTREME = 'Extreme Modulation' as const;
export const PROFILE_BOUNDARY = 'Boundary Edge-Cases' as const;
export const PROFILES = [PROFILE_DEFAULT, PROFILE_EXTREME, PROFILE_BOUNDARY] as const;
export type Profile = (typeof PROFILES)[number];

export const PRINTER = 'bbl-a1';
export const PLANAR_THETA_MAX_DEG = 90;

/** Line-width keys that the Extreme / Boundary profiles push. */
export const LINE_WIDTH_KEYS = [
  'line_width', 'initial_layer_line_width', 'outer_wall_line_width', 'inner_wall_line_width', 'top_surface_line_width',
  'sparse_infill_line_width', 'internal_solid_infill_line_width', 'support_line_width',
] as const;

export interface Row {
  assertion: string;
  pass: boolean;
  metrics: Record<string, number>;
  firstFailures: M.Failure[];
}

export function cfgWith(printerId: string, overrides: Record<string, unknown> = {}, presetId = '0.20'): Config {
  return resolveConfig({ printerId, plate: 'textured_pei_plate', filamentId: 'generic-pla', presetId, overrides });
}

export function meshOf(soup: Float32Array, id = 'part') {
  const m = weld(soup);
  return { id, name: id, vertices: m.vertices, indices: m.indices };
}

// ---------------------------------------------------------------------------------------------------------
// Core engine width / flow declarations (mirrors slicer.ts extrudePath: flowMul = filament_flow_ratio *
// print_flow_ratio * initial_layer_flow_ratio (layer 0) * top_solid_infill_flow_ratio (top surface)).
// ---------------------------------------------------------------------------------------------------------
const featName = (f?: string) => (f ?? '').replace(/_/g, ' ').trim().toLowerCase();

const posNum = (cfg: Config, k: string): number | undefined => {
  const v = Number(cfg[k]);
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

/**
 * Resolved line width, mirroring slicer.ts: the feature's own key, else `line_width`, else nozzle * 1.05
 * (slicer.ts olw / lw0). Feature -> key mapping follows the width each feature is given in slicer.ts:
 * walls at 408-409 (layer 0 uses initial_layer_line_width), bottom surfaces at 1204 (layer 0 uses
 * initial_layer_infill_line_width, else initial_layer_line_width), bridges at 1252 (internal solid width,
 * or nozzle when thick_bridges is on: that case is a declared mismatch, not a bent assertion).
 */
export function widthFn(cfg: Config): (m: M.GMove) => number {
  const nz = Number(cfg.nozzle_diameter);
  const chain = (...keys: string[]) => {
    for (const k of keys) { const v = posNum(cfg, k); if (v) return v; }
    return nz * 1.05;
  };
  return (m) => {
    const f = featName(m.feature);
    const onLayer0 = m.layerIndex === 0;
    if (onLayer0 && (f === 'outer wall' || f === 'inner wall' || f === 'overhang wall')) return chain('initial_layer_line_width', 'line_width');
    if (onLayer0 && f === 'bottom surface') return chain('initial_layer_infill_line_width', 'initial_layer_line_width', 'line_width');
    // slicer.ts:822 brim width w = lw0('initial_layer_line_width') at every layer.
    if (f === 'brim') return chain('initial_layer_line_width', 'line_width');
    // slicer.ts towerW(): initial layer width on layer 0, support width above.
    if (f === 'prime tower') return onLayer0 ? chain('initial_layer_line_width', 'line_width') : chain('support_line_width', 'line_width');
    switch (f) {
      case 'outer wall': case 'overhang wall': return chain('outer_wall_line_width', 'line_width');
      case 'inner wall': return chain('inner_wall_line_width', 'line_width');
      case 'sparse infill': return chain('sparse_infill_line_width', 'line_width');
      case 'internal solid infill': case 'bottom surface': case 'bridge': return chain('internal_solid_infill_line_width', 'line_width');
      case 'top surface': return chain('top_surface_line_width', 'line_width');
      case 'support': case 'support interface': return chain('support_line_width', 'line_width');
      default: return chain('line_width');
    }
  };
}

/** Resolved flow multiplier for a move (see slicer.ts extrudePath). */
export function flowFn(cfg: Config): (m: M.GMove) => number {
  const base = (Number(cfg.filament_flow_ratio) || 1) * (Number(cfg.print_flow_ratio) || 1);
  const init = Number(cfg.initial_layer_flow_ratio) || 1;
  const top = Number(cfg.top_solid_infill_flow_ratio) || 1;
  return (m) => base * (m.layerIndex === 0 ? init : 1) * (featName(m.feature) === 'top surface' ? top : 1);
}

export function outerWallWidth(cfg: Config): number {
  return widthFn(cfg)({ feature: 'outer wall', layerIndex: 1 } as M.GMove);
}

// ---------------------------------------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------------------------------------
export function toRows(res: M.AssertionResult[]): Row[] {
  return res.map((r) => ({ assertion: r.name, pass: r.pass, metrics: r.metrics, firstFailures: r.failures.slice(0, 3) }));
}

/** A slice or parse exception becomes a failing row. It is never swallowed. */
export function errorRow(assertion: string, e: unknown): Row {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return { assertion, pass: false, metrics: {}, firstFailures: [{ assertion, message: msg.slice(0, 500) }] };
}

/** The three checks every (target, profile) gets: volumetric conservation, finite/bed-safe, ramp angle. */
export function standardRows(gcode: string, cfg: Config, thetaMaxDeg: number, extraFlow?: { width?: (m: M.GMove) => number; flow?: (m: M.GMove) => number }) {
  const parsed = parseGcode(gcode);
  const moves = parsed.moves;
  const width = extraFlow?.width ?? widthFn(cfg);
  const flow = extraFlow?.flow ?? flowFn(cfg);
  return {
    moves,
    results: [
      M.checkVolumetricConservation(moves, {
        filamentDiameter: Number(cfg.filament_diameter),
        width,
        flow,
        crossSection: 'stadium',
      }),
      M.checkFiniteAndSafe(moves, gcode),
      M.checkRampAngle(moves, thetaMaxDeg),
    ],
  };
}

/** Advanced techs: ramp limit is the machine's steepest riding slope (machine.ts maxSlopeDeg). */
export function advRampLimit(cfg: Config): number {
  return machineCaps(PRINTER, cfg).maxSlopeDeg;
}

export function pickMoves(moves: M.GMove[], feature: string) {
  const f = featName(feature);
  return moves.filter((m) => featName(m.feature) === f);
}

/** Point cloud (extrusion end points) of one feature. */
export function pointsOf(moves: M.GMove[], feature: string): M.Pt3[] {
  return M.reconstructPointCloud(pickMoves(moves, feature).map((m) => m));
}

/** Parameter values for the Extreme (90 % of ParamSpec max) and Boundary (ParamSpec min) profiles. */
export function specParams(
  params: { key: string; type: string; def: unknown; min?: number; max?: number; options?: { value: string }[] }[],
  profile: Profile,
): Record<string, number | boolean | string> | undefined {
  if (profile === PROFILE_DEFAULT || params.length === 0) return undefined;
  const out: Record<string, number | boolean | string> = {};
  for (const s of params) {
    if (s.type === 'bool') out[s.key] = profile === PROFILE_EXTREME ? !s.def : Boolean(s.def);
    else if (s.type === 'enum') {
      const o = s.options ?? [];
      out[s.key] = profile === PROFILE_EXTREME ? (o.at(-1)?.value ?? String(s.def)) : (o[0]?.value ?? String(s.def));
    } else if (profile === PROFILE_EXTREME) out[s.key] = s.max !== undefined ? 0.9 * s.max : Number(s.def);
    else out[s.key] = s.min !== undefined ? s.min : Number(s.def);
  }
  return out;
}

export { M };
