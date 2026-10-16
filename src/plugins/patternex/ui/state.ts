// Patternex UI-side state: patterns, placements (object-local), region actions and printer options.
// Plain data with a tiny change signal, like Motionex. Converted to plate coordinates only for slicing.
import { builtinPattern } from '../builtin';
import type { Pattern, Placement, RegionAction } from '../model';
import type { PatternexConfig, SingleColourPolicy } from '../engine';
import type { V3, WorldPlacement } from '../projection';

/** A placement stored in its object's local frame, so it follows the object when it moves. */
export interface ObjPlacement extends Placement {
  object_id: string;
  /** Cylindrical: a point on the wrap axis, object-local (the object's centre line by default). */
  axis_origin?: V3;
  /** Object-local normal of the face it was dropped on (restored when switching back to planar). */
  anchor_normal?: V3;
}

export interface Overlays { outlines: boolean; transitions: boolean; swaps: boolean; bleed: boolean }

export interface PatternexState {
  patterns: Pattern[];
  placements: ObjPlacement[];
  actions: RegionAction[];
  singleColour: SingleColourPolicy;
  /** Calibrated transition volume (mm³) per filament slot; null = estimated. */
  transitionVolume: (number | null)[];
  /** Pattern waiting to be placed with the next click on the model. */
  armed: string | null;
  selected: string | null;
  overlays: Overlays;
}

const KEY = 'nexspiro.patternex.v1';

export function createPatternexState(store: Pick<Storage, 'getItem'> | null): PatternexState {
  const base: PatternexState = {
    patterns: [], placements: [], actions: [], singleColour: 'skip', transitionVolume: [],
    armed: null, selected: null, overlays: { outlines: true, transitions: true, swaps: true, bleed: true },
  };
  try {
    const saved = JSON.parse(store?.getItem(KEY) ?? 'null');
    if (saved && Array.isArray(saved.patterns)) return { ...base, ...saved, armed: null };
  } catch { /* ignore broken storage */ }
  return base;
}

export function savePatternexState(s: PatternexState, store: Pick<Storage, 'setItem'> | null): void {
  try {
    // built-in patterns are rebuilt on demand; keep only the ones in use
    const used = new Set(s.placements.map((p) => p.pattern_id));
    const patterns = s.patterns.filter((p) => p.source === 'svg' || used.has(p.id));
    store?.setItem(KEY, JSON.stringify({ ...s, patterns, armed: null }));
  } catch { /* quota or unavailable: keep in memory */ }
}

export function addPattern(s: PatternexState, p: Pattern): Pattern {
  const i = s.patterns.findIndex((x) => x.id === p.id);
  if (i >= 0) s.patterns[i] = p; else s.patterns.push(p);
  return p;
}

export const ensureBuiltin = (s: PatternexState, kind: Parameters<typeof builtinPattern>[0]) => addPattern(s, builtinPattern(kind));

/**
 * Default actions for a new placement, full purge. A one-colour pattern goes on slot 2; with several
 * colours the first stays the base material and the others take slots 2, 3, …
 */
export function defaultActions(placementId: string, pattern: Pattern, slots: number): RegionAction[] {
  const all = [...new Set(pattern.shapes.map((x) => x.fill_color))];
  const colors = all.length > 1 ? all.slice(1) : all;
  if (slots < 2) return [];
  return colors.map((color, k) => ({
    region_ref: { placement_id: placementId, color_group: color },
    material: { mode: 'slot', slot_index: Math.min(slots - 1, k + 1) },
    purge: { mode: 'full', change_point_shift_mm: 0 },
    motion: null,
  }));
}

type Mat = ArrayLike<number>; // column-major 4×4 (three.js Matrix4.elements)
const xform = (m: Mat, [x, y, z]: V3): V3 => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

/** Direction through the inverse-transpose (normals stay perpendicular under non-uniform scale). */
function xformNormal(m: Mat, [x, y, z]: V3): V3 {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  // cofactor matrix = det · inverse-transpose
  const n: V3 = [A * x + B * y + C * z, D * x + E * y + F * z, G * x + H * y + I * z];
  const det = a * A + b * B + c * C;
  const l = Math.hypot(...n) || 1;
  const sgn = det < 0 ? -1 : 1;
  return [(n[0] / l) * sgn, (n[1] / l) * sgn, (n[2] / l) * sgn];
}

/** Placements → plate coordinates for the worker. `objects` is the slice order with object→plate matrices. */
export function toWorldPlacements(placements: ObjPlacement[], objects: { id: string; matrix: Mat }[]): WorldPlacement[] {
  const out: WorldPlacement[] = [];
  for (const p of placements) {
    const k = objects.findIndex((o) => o.id === p.object_id);
    if (k < 0 || !p.visible) continue;
    const m = objects[k].matrix;
    const { object_id: _, axis_origin, anchor_normal: __, ...rest } = p;
    out.push({
      ...rest,
      object: k,
      position_xyz: xform(m, p.position_xyz),
      // the wrap axis is a direction like any other; normals need the inverse-transpose
      projection_axis: p.projection === 'cylindrical' ? dirOf(m, p.projection_axis) : xformNormal(m, p.projection_axis),
      axis_origin: axis_origin ? xform(m, axis_origin) : undefined,
    });
  }
  return out;
}

function dirOf(m: Mat, [x, y, z]: V3): V3 {
  const v: V3 = [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function toPatternexConfig(s: PatternexState, objects: { id: string; matrix: Mat }[]): PatternexConfig | undefined {
  const placements = toWorldPlacements(s.placements, objects);
  if (!placements.length) return undefined;
  const used = new Set(placements.map((p) => p.pattern_id));
  return {
    patterns: s.patterns.filter((p) => used.has(p.id)),
    placements,
    actions: s.actions.filter((a) => placements.some((p) => p.id === a.region_ref.placement_id)),
    singleColour: s.singleColour,
    transitionVolume: s.transitionVolume,
  };
}

/** What a project file keeps (spec: placements can be re-used for repeat orders). */
export interface PatternexProjectData {
  version: 1;
  patterns: Pattern[]; placements: ObjPlacement[]; actions: RegionAction[];
  singleColour: SingleColourPolicy; transitionVolume: (number | null)[];
}

export function projectData(s: PatternexState): PatternexProjectData | undefined {
  if (!s.placements.length) return undefined;
  const used = new Set(s.placements.map((p) => p.pattern_id));
  return {
    version: 1, patterns: s.patterns.filter((p) => used.has(p.id)), placements: s.placements, actions: s.actions,
    singleColour: s.singleColour, transitionVolume: s.transitionVolume,
  };
}

/** Replace the current placements with a project's (patterns are merged into the library). */
export function restoreProject(s: PatternexState, d: PatternexProjectData | undefined, objectIds: string[]): void {
  s.placements = []; s.actions = []; s.selected = null; s.armed = null;
  if (!d || d.version !== 1) return;
  for (const p of d.patterns ?? []) addPattern(s, p);
  const ids = new Set(objectIds);
  s.placements = (d.placements ?? []).filter((p) => ids.has(p.object_id));
  const kept = new Set(s.placements.map((p) => p.id));
  s.actions = (d.actions ?? []).filter((a) => kept.has(a.region_ref.placement_id));
  s.singleColour = d.singleColour ?? s.singleColour;
  s.transitionVolume = d.transitionVolume ?? s.transitionVolume;
}
