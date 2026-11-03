// Select & apply: rules made in the Select window. Each rule is a selection on the sliced print (a range of
// layers, single printed lines, or a brushed area) and what to change there: filament, a motion, speed, flow,
// temperature. Rules are plain data and travel to the slicing worker as part of the Motionex config.
// Selections are stored in plate mm, tied to the object they were made on: if the object moves, they move with it.
import type { FeatureType } from '../../../engine/types';

/** Kinds of printed line a rule can be limited to. */
export type LineGroup = 'outer' | 'inner' | 'infill' | 'solid' | 'support';

export const LINE_GROUPS: [LineGroup, string][] = [
  ['outer', 'Outer wall'], ['inner', 'Inner walls'], ['infill', 'Infill'], ['solid', 'Top / bottom / solid'], ['support', 'Support'],
];

const GROUP_FEATURES: Record<LineGroup, FeatureType[]> = {
  outer: ['outer_wall', 'overhang_wall'],
  inner: ['inner_wall'],
  infill: ['sparse_infill'],
  solid: ['internal_solid_infill', 'top_surface', 'bottom_surface', 'bridge', 'gap_infill', 'ironing'],
  support: ['support', 'support_interface'],
};

/** Features a rule may change: its line groups, or every printed part line when none are chosen. */
export function featuresOf(groups: LineGroup[] | undefined): Set<FeatureType> {
  const g = groups?.length ? groups : (Object.keys(GROUP_FEATURES) as LineGroup[]);
  return new Set(g.flatMap((k) => GROUP_FEATURES[k]).concat(groups?.length ? [] : ['wave_overhang']));
}

export function groupOf(f: FeatureType): LineGroup | undefined {
  for (const [g, fs] of Object.entries(GROUP_FEATURES)) if (fs.includes(f)) return g as LineGroup;
  return undefined;
}

/** One printed line picked in the window (a whole run of one feature between travels), plate mm. */
export interface LinePick {
  /** Object the line belongs to (id), when known. */
  obj?: string;
  /** Layer top (mm) and height. */
  z: number;
  h: number;
  feature: FeatureType;
  /** Line width (mm). */
  w: number;
  pts: [number, number][];
}

/** One brush dab: a ball of radius r (mm) at a point on the print. */
export interface Dab { obj?: string; x: number; y: number; z: number; r: number }

export type Pick =
  | { kind: 'layers'; z0: number; z1: number; obj?: string }
  | { kind: 'lines'; lines: LinePick[] }
  | { kind: 'brush'; dabs: Dab[] };

export type PickKind = Pick['kind'];

export interface RuleApply {
  /** Filament slot (0-based) to print the selection with. */
  filament?: number;
  /** A Motionex motion on the selected walls; scale 1 = as designed. */
  motion?: { brush_id: string; scale: number };
  /** Speed and flow in % of normal (100 = unchanged). */
  speed?: number;
  flow?: number;
  /** Nozzle temperature (°C) on the layers the selection touches. */
  temp?: number;
}

export interface SelectRule {
  id: string;
  name: string;
  enabled: boolean;
  pick: Pick;
  /** Line kinds the rule changes (empty = all). */
  lines: LineGroup[];
  apply: RuleApply;
  /** Soft edge (mm): speed, flow and motion fade out over this distance around the selection. */
  blend_mm: number;
  /** Where each object was (bounding box min x, y in plate mm) when the selection was made. */
  anchors: Record<string, [number, number]>;
}

let seq = 0;
export function newRule(n: number): SelectRule {
  return {
    id: `r${Date.now().toString(36)}${(seq++).toString(36)}`, name: `Selection ${n}`, enabled: true,
    pick: { kind: 'layers', z0: 0, z1: 0 }, lines: [], apply: {}, blend_mm: 2, anchors: {},
  };
}

export const pickEmpty = (p: Pick) => (p.kind === 'layers' ? p.z1 <= 0 && p.z0 <= 0 : p.kind === 'lines' ? !p.lines.length : !p.dabs.length);

/** Does the rule change anything? */
export const applies = (a: RuleApply) => a.filament !== undefined || !!a.motion || (a.speed !== undefined && a.speed !== 100) || (a.flow !== undefined && a.flow !== 100) || a.temp !== undefined;

export const ruleActive = (r: SelectRule) => r.enabled && !pickEmpty(r.pick) && applies(r.apply);

/** Saved rules, cleaned of anything malformed. */
export function loadRules(d: unknown): SelectRule[] {
  if (!Array.isArray(d)) return [];
  return d.filter((r) => r && typeof r === 'object' && r.pick && typeof r.pick.kind === 'string').map((r) => ({
    ...newRule(0), ...r, lines: Array.isArray(r.lines) ? r.lines : [], apply: { ...(r.apply ?? {}) }, anchors: { ...(r.anchors ?? {}) },
  }));
}

export function describePick(p: Pick): string {
  if (p.kind === 'layers') return pickEmpty(p) ? 'No layers chosen' : `Heights ${p.z0.toFixed(2)}–${p.z1.toFixed(2)} mm`;
  if (p.kind === 'lines') return `${p.lines.length} line${p.lines.length === 1 ? '' : 's'}`;
  return `${p.dabs.length} brush dab${p.dabs.length === 1 ? '' : 's'}`;
}
