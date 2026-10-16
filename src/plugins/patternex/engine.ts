// Patternex engine side (spec §6).
// prepare():      Stage A–B — placements → per-layer region masks, handed to Nexspiro before perimeters.
// transition():   Stage D — purge mode per change (full / reduced / none) and the change-point shift.
// postToolpath(): runs after Motionex (§8) — applies change-point shifts, finds bleed zones and swap layers,
//                 and builds the pre-export report.
import type { LayerOps, Op } from '../../engine/gcode';
import { areaTotal, difference, SCALE } from '../../engine/clipper';
import type { Paths } from '../../engine/types';
import type { Config } from '../../profiles/settings';
import { TRANSITION_MARKER, type EnginePlugin, type PatternexRegion, type PluginSession, type PrepareContext, type RegionContribution, type TransitionPlan } from '../api';
import { placementDepth, type Pattern, type PurgeMode, type RegionAction, type Ring } from './model';
import type { WorldPlacement } from './projection';
import { placementGroups, type GroupResolver } from './resolve';

export type SingleColourPolicy = 'skip' | 'band' | 'allow';

/** Everything the worker needs, as plain data. */
export interface PatternexConfig {
  patterns: Pattern[];
  /** Placements in plate coordinates, with the object index they belong to. */
  placements: WorldPlacement[];
  actions: RegionAction[];
  /** Single-colour printers: what to do with regions that need a swap in the middle of a layer. */
  singleColour: SingleColourPolicy;
  /** mm³ of mixed output when changing without purge, per slot. Missing/null = estimate (uncalibrated). */
  transitionVolume: (number | null | undefined)[];
}

/** Default transition volume (mm³) when uncalibrated: a typical 0.4 mm hotend melt zone. */
export const DEFAULT_TRANSITION_VOLUME = 45;

export interface SwapEntry { layer: number; z: number; from: number; to: number; label: string }
export interface BleedZone { layer: number; z: number; to: number; lengthMm: number; pts: number[] }
export interface RegionSummary { id: string; placementId: string; color: string; fil: number; layers: [number, number]; layerCount: number; motion: string | null }

export interface PatternexReport {
  regions: RegionSummary[];
  toolChanges: number;
  transitions: Record<PurgeMode, number>;
  purgeMm3: number;
  purgeGrams: number;
  addedTimeS: number;
  /** Single-colour printers: every manual swap in print order. */
  swaps: SwapEntry[];
  manual: boolean;
  bleedZones: BleedZone[];
  unsupported: { regionId: string; layers: number }[];
  uncalibrated: number[];
  shifted: number;
  warnings: string[];
  /** Region outlines per layer (plate mm), capped, for the preview overlay. */
  outlines: { regionId: string; layer: number; rings: Ring[] }[];
}

export const MARKER = TRANSITION_MARKER;

const toRings = (ps: Paths): Ring[] => ps.map((p) => p.map((q) => [q.X / SCALE, q.Y / SCALE] as [number, number]));

interface Group { g: GroupResolver; action: RegionAction; fil: number }
interface ChangeRec { layer: number; from: number; to: number; mode: PurgeMode; volume: number; regionId?: string }

export class PatternexSession implements PluginSession {
  readonly groups: Group[] = [];
  private cache = new Map<string, RegionContribution[]>();
  readonly unsupported = new Map<string, Set<number>>();
  readonly used = new Map<string, Set<number>>();
  readonly changes: ChangeRec[] = [];
  readonly warnings: string[] = [];

  constructor(readonly config: PatternexConfig, readonly ctx: PrepareContext) {
    const patterns = new Map(config.patterns.map((p) => [p.id, p]));
    const clamp = (f: number) => Math.max(0, Math.min(ctx.filamentCount - 1, f | 0));
    for (const p of config.placements) {
      const pat = patterns.get(p.pattern_id);
      if (!pat || !p.visible || p.object < 0 || p.object >= ctx.meshes.length) continue;
      const depth = placementDepth(p, ctx.cfg);
      for (const g of placementGroups(p, pat, depth, ctx)) {
        const action = config.actions.find((a) => a.region_ref.placement_id === p.id && a.region_ref.color_group === g.color)
          ?? config.actions.find((a) => a.region_ref.placement_id === p.id && !a.region_ref.color_group);
        if (!action) continue; // unassigned regions keep the base material
        const fil = clamp(action.material.slot_index);
        if (action.material.slot_index >= ctx.filamentCount)
          this.warn(`Patternex: region ${g.regionId} uses slot ${action.material.slot_index + 1}, but only ${ctx.filamentCount} filament slot(s) are set up.`);
        this.groups.push({ g, action, fil });
      }
    }
  }

  private warn(m: string) { if (!this.warnings.includes(m)) { this.warnings.push(m); this.ctx.warn(m); } }

  regionsAt(object: number, layer: number): RegionContribution[] {
    const key = `${object}:${layer}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const out: RegionContribution[] = [];
    for (const { g, fil } of this.groups) {
      if (g.object !== object) continue;
      let paths = g.at(layer);
      if (!paths.length) continue;
      if (!this.ctx.hasAms && this.config.singleColour !== 'allow') {
        const slice = this.ctx.sliceAt(object, layer);
        const covers = areaTotal(difference(slice, paths)) < 0.05;
        if (!covers) {
          if (this.config.singleColour === 'skip') {
            let s = this.unsupported.get(g.regionId); if (!s) this.unsupported.set(g.regionId, (s = new Set()));
            s.add(layer);
            continue;
          }
          paths = slice; // layer band fallback
        }
      }
      let u = this.used.get(g.regionId); if (!u) this.used.set(g.regionId, (u = new Set()));
      u.add(layer);
      out.push({ regionId: g.regionId, fil, paths });
    }
    this.cache.set(key, out);
    return out;
  }

  transition(t: { layer: number; from: number; to: number; flushVolume?: number }): TransitionPlan | undefined {
    if (!this.groups.length || t.from === t.to) return undefined; // first load, not a change
    const here: { r: RegionContribution; action: RegionAction }[] = [];
    for (let o = 0; o < this.ctx.meshes.length; o++) for (const r of this.regionsAt(o, t.layer)) {
      const g = this.groups.find((x) => x.g.regionId === r.regionId);
      if (g) here.push({ r, action: g.action });
    }
    const pick = here.find((h) => h.r.fil === t.to) ?? here.find((h) => h.r.fil === t.from);
    const base = t.flushVolume ?? 0;
    if (!pick) { this.changes.push({ layer: t.layer, from: t.from, to: t.to, mode: 'full', volume: base }); return this.ctx.hasAms ? undefined : { label: `filament ${t.to + 1}` }; }
    const pu = pick.action.purge;
    const rec: ChangeRec = { layer: t.layer, from: t.from, to: t.to, mode: pu.mode, volume: base, regionId: pick.r.regionId };
    let plan: TransitionPlan = { regionId: pick.r.regionId };
    const target = this.groups.find((g) => g.fil === t.to)?.action.material;
    if (!this.ctx.hasAms) plan.label = target?.swap_label || `filament ${t.to + 1}`;
    if (pu.mode === 'reduced') { rec.volume = Math.max(0, pu.volume_mm3 ?? base / 2); plan = { ...plan, flushVolume: rec.volume }; }
    else if (pu.mode === 'none') {
      rec.volume = 0;
      // the shift places the bleed; it is relative to entering the region, so leaving it mirrors it
      const shift = pu.change_point_shift_mm || 0;
      plan = { ...plan, flushVolume: 0, skipTower: true, shiftMm: pick.r.fil === t.to ? shift : -shift };
    }
    this.changes.push(rec);
    return plan;
  }

  sharedRegions(): PatternexRegion[] {
    return this.groups.map(({ g, action, fil }) => ({
      region_id: g.regionId,
      name: g.regionId,
      layer_range: g.layerRange,
      polygon_mask_per_layer: (l: number) => toRings(this.regionsAt(g.object, l).filter((r) => r.regionId === g.regionId).flatMap((r) => r.paths)),
      attributes: { source: 'patternex', placement_id: g.placementId, color: g.color, material: fil, motion: action.motion?.motionex_brush_id ?? null },
    }));
  }
}

// ---------- change-point shift (post-pass on the final move list)
type Move = Extract<Op, { k: 'move' }>;
const isExtrude = (op: Op): op is Move => op.k === 'move' && !op.travel && op.e > 0;

/** Position before ops[i] (end of the last move before it), or null when unknown. */
function posBefore(ops: Op[], i: number): [number, number, number] | null {
  for (let k = i - 1; k >= 0; k--) {
    const op = ops[k];
    if (op.k === 'move') return [op.x, op.y, op.z];
    if (op.k === 'raw' && op.resetPos) return null;
  }
  return null;
}

/** Split move m (from start s) at length `at` from its start: returns [first, second]. */
function splitMove(m: Move, s: [number, number, number], at: number): [Move, Move] {
  const len = Math.hypot(m.x - s[0], m.y - s[1], m.z - s[2]) || 1;
  const f = Math.max(0, Math.min(1, at / len));
  const px = s[0] + (m.x - s[0]) * f, py = s[1] + (m.y - s[1]) * f, pz = s[2] + (m.z - s[2]) * f;
  return [{ ...m, x: px, y: py, z: pz, e: m.e * f, t: undefined, noArc: true }, { ...m, e: m.e * (1 - f), t: undefined, noArc: true }];
}

interface ShiftParams { retract: number; retractSpeed: number; deretractSpeed: number; travelF: number }

/** Returns true when the change point moved. `marker` is the index of the marker op. */
export function applyShift(ops: Op[], marker: number, shift: number, p: ShiftParams): boolean {
  if (Math.abs(shift) < 1e-3) return false;
  const toolIdx = ops.findIndex((op, k) => k > marker && op.k === 'tool');
  if (toolIdx < 0) return false;
  const travel = (x: number, y: number, z: number, h: number): Move => ({ k: 'move', x, y, z, e: 0, f: p.travelF, feature: 'travel', w: 0, h, travel: true });
  // is the nozzle expected to be retracted right after the change? (slicer deretracts before the next extrusion)
  const firstNew = ops.findIndex((op, k) => k > toolIdx && isExtrude(op));
  if (firstNew < 0) return false;
  const retractedAfter = ops.slice(toolIdx + 1, firstNew).some((op) => op.k === 'retract' && op.len < 0);

  if (shift > 0) {
    // the last `shift` mm before the change are printed with the new filament
    let k = marker - 1;
    while (k >= 0 && ops[k].k === 'accel') k--;
    if (k < 0 || !isExtrude(ops[k])) return false;
    const run: number[] = [];
    while (k >= 0 && (isExtrude(ops[k]) || ops[k].k === 'accel')) { if (isExtrude(ops[k])) run.unshift(k); k--; }
    let acc = 0, cut = -1, cutAt = 0;
    for (let r = run.length - 1; r >= 0; r--) {
      const s = posBefore(ops, run[r]);
      if (!s) return false;
      const m = ops[run[r]] as Move;
      const l = Math.hypot(m.x - s[0], m.y - s[1], m.z - s[2]);
      if (acc + l >= shift) { cut = r; cutAt = l - (shift - acc); break; }
      acc += l;
    }
    if (cut < 0) cut = 0, cutAt = 0; // shift longer than the run: move all of it
    const ci = run[cut];
    const s0 = posBefore(ops, ci)!;
    const [keep, rest] = splitMove(ops[ci] as Move, s0, cutAt);
    const tail: Move[] = [rest, ...run.slice(cut + 1).map((i) => ops[i] as Move)];
    const start: [number, number, number] = [keep.x, keep.y, keep.z];
    // remove the tail from before the change
    const removeFrom = ci + 1, removeTo = run[run.length - 1];
    const block: Op[] = [travel(start[0], start[1], start[2], rest.h)];
    if (retractedAfter) block.push({ k: 'retract', len: -p.retract, speed: p.deretractSpeed });
    block.push(...tail);
    if (retractedAfter) block.push({ k: 'retract', len: p.retract, speed: p.retractSpeed });
    ops.splice(toolIdx + 1, 0, ...block);
    ops.splice(removeFrom, removeTo - removeFrom + 1);
    if (cutAt > 1e-6) ops[ci] = keep; else ops.splice(ci, 1);
    return true;
  }

  // shift < 0: the first |shift| mm after the change are printed with the old filament
  const need = -shift;
  const run: number[] = [];
  for (let k = firstNew; k < ops.length && (isExtrude(ops[k]) || ops[k].k === 'accel'); k++) if (isExtrude(ops[k])) run.push(k);
  const s0 = posBefore(ops, firstNew);
  if (!s0) return false;
  let acc = 0, cut = run.length - 1, cutAt = Infinity;
  for (let r = 0; r < run.length; r++) {
    const s = posBefore(ops, run[r])!;
    const m = ops[run[r]] as Move;
    const l = Math.hypot(m.x - s[0], m.y - s[1], m.z - s[2]);
    if (acc + l >= need) { cut = r; cutAt = need - acc; break; }
    acc += l;
  }
  const ci = run[cut];
  const sc = posBefore(ops, ci)!;
  const whole = cutAt === Infinity;
  const [head, rest] = whole ? [ops[ci] as Move, null] : splitMove(ops[ci] as Move, sc, cutAt);
  const headMoves: Move[] = [...run.slice(0, cut).map((i) => ops[i] as Move), head];
  // the new filament now starts where the head ends: retarget the travel that led to the run
  const end = headMoves[headMoves.length - 1];
  if (rest) ops[ci] = rest; else ops.splice(ci, 1);
  for (let r = cut - 1; r >= 0; r--) ops.splice(run[r], 1);
  for (let k = firstNew - 1; k > toolIdx; k--) {
    const op = ops[k];
    if (op.k === 'move' && op.travel) { ops[k] = { ...op, x: end.x, y: end.y }; break; }
  }
  const before = marker > 0 ? ops[marker - 1] : undefined;
  const block: Op[] = [];
  const wasPrinting = !!before && isExtrude(before);
  if (wasPrinting) block.push({ k: 'retract', len: p.retract, speed: p.retractSpeed });
  block.push(travel(s0[0], s0[1], s0[2], head.h));
  block.push({ k: 'retract', len: -p.retract, speed: p.deretractSpeed });
  block.push(...headMoves.map((m) => ({ ...m, t: undefined, noArc: true })));
  if (!wasPrinting) block.push({ k: 'retract', len: p.retract, speed: p.retractSpeed });
  ops.splice(marker, 0, ...block);
  return true;
}

/** First `len` mm printed after ops[from] (a tool op), as a flat xy polyline. */
function zoneAfter(ops: Op[], from: number, len: number): { pts: number[]; got: number } {
  const pts: number[] = [];
  let got = 0;
  for (let k = from + 1; k < ops.length && got < len; k++) {
    const op = ops[k];
    if (op.k === 'tool') break;
    if (!isExtrude(op)) continue;
    const s = posBefore(ops, k);
    if (!s) continue;
    const l = Math.hypot(op.x - s[0], op.y - s[1]);
    if (!pts.length || pts[pts.length - 2] !== s[0] || pts[pts.length - 1] !== s[1]) pts.push(s[0], s[1]);
    if (got + l > len) { const f = (len - got) / l; pts.push(s[0] + (op.x - s[0]) * f, s[1] + (op.y - s[1]) * f); got = len; break; }
    pts.push(op.x, op.y);
    got += l;
  }
  return { pts, got };
}

const OUTLINE_POINT_CAP = 200_000;

export function buildReport(layers: LayerOps[], config: PatternexConfig, cfg: Config, s: PatternexSession | undefined, hasAms: boolean, filColors: string[] = []): PatternexReport {
  const num = (k: string, d = 0) => (cfg[k] === undefined || cfg[k] === '' ? d : Number(cfg[k]));
  const rep: PatternexReport = {
    regions: [], toolChanges: 0, transitions: { full: 0, reduced: 0, none: 0 }, purgeMm3: 0, purgeGrams: 0, addedTimeS: 0,
    swaps: [], manual: !hasAms, bleedZones: [], unsupported: [], uncalibrated: [], shifted: 0, warnings: [], outlines: [],
  };
  if (!s) return rep;
  const tv = (slot: number) => config.transitionVolume[slot] ?? DEFAULT_TRANSITION_VOLUME;
  const shift: ShiftParams = {
    retract: num('retraction_length', 0.8), retractSpeed: num('retraction_speed', 30), deretractSpeed: num('deretraction_speed') || num('retraction_speed', 30),
    travelF: num('travel_speed', 200),
  };
  // 1) change-point shifts, applied on the final move list (after Motionex changed path lengths)
  layers.forEach((L) => {
    for (let k = 0; k < L.ops.length; k++) {
      const op = L.ops[k];
      if (op.k !== 'raw' || !op.text.startsWith(MARKER)) continue;
      const m = / shift=(-?[\d.]+)/.exec(op.text);
      if (m && applyShift(L.ops, k, Number(m[1]), shift)) rep.shifted++;
    }
  });
  // 2) tool changes, swaps and bleed zones
  let tool = -1;
  layers.forEach((L, li) => {
    let pendingNone = false;
    for (let k = 0; k < L.ops.length; k++) {
      const op = L.ops[k];
      if (op.k === 'raw' && op.text.startsWith(MARKER)) pendingNone = / mode=none/.test(op.text);
      if (op.k !== 'tool') continue;
      if (tool >= 0 && op.tool !== tool) {
        rep.toolChanges++;
        if (!hasAms) {
          const action = s.groups.find((g) => g.fil === op.tool)?.action;
          const label = action?.material.swap_label || filColors[op.tool] || `Filament ${op.tool + 1}`;
          rep.swaps.push({ layer: li, z: L.z, from: tool, to: op.tool, label });
        }
        if (pendingNone) {
          const move = L.ops.slice(k + 1).find(isExtrude);
          const w = move?.w || num('line_width', 0.42), h = move?.h || L.h;
          const want = tv(op.tool) / Math.max(w * h, 1e-3);
          const z = zoneAfter(L.ops, k, want);
          if (z.pts.length >= 4 && rep.bleedZones.length < 5000) rep.bleedZones.push({ layer: li, z: L.z, to: op.tool, lengthMm: z.got, pts: z.pts });
        }
      }
      pendingNone = false;
      tool = op.tool;
    }
  });
  // 3) totals
  for (const c of s.changes) {
    rep.transitions[c.mode]++;
    rep.purgeMm3 += c.volume;
    if (c.mode === 'none' && config.transitionVolume[c.to] == null && !rep.uncalibrated.includes(c.to)) rep.uncalibrated.push(c.to);
  }
  rep.purgeGrams = (rep.purgeMm3 / 1000) * num('filament_density', 1.24);
  rep.addedTimeS = rep.toolChanges * num('filament_change_time', hasAms ? 60 : 0);
  for (const { g, action, fil } of s.groups) {
    const used = [...(s.used.get(g.regionId) ?? [])].sort((a, b) => a - b);
    rep.regions.push({ id: g.regionId, placementId: g.placementId, color: g.color, fil, layers: used.length ? [used[0], used[used.length - 1]] : [0, -1], layerCount: used.length, motion: action.motion?.motionex_brush_id ?? null });
  }
  for (const [regionId, ls] of s.unsupported) rep.unsupported.push({ regionId, layers: ls.size });
  // 4) messages
  if (rep.unsupported.length)
    rep.warnings.push(`Single-colour printer: ${rep.unsupported.length} region(s) need a colour swap in the middle of a layer and were left in the base colour. Switch to layer bands or allow mid-layer swaps to print them.`);
  if (!hasAms && config.singleColour === 'allow' && rep.swaps.length > 20)
    rep.warnings.push(`Single-colour printer: ${rep.swaps.length} manual swaps — consider layer bands.`);
  if (rep.uncalibrated.length)
    rep.warnings.push(`No-purge transitions use an estimated (uncalibrated) bleed volume for slot(s) ${rep.uncalibrated.map((k) => k + 1).join(', ')}.`);
  if (rep.regions.length && rep.regions.every((r) => !r.layerCount))
    rep.warnings.push('Patternex: no placement reaches the model — check the projection direction and depth.');
  rep.warnings.push(...s.warnings);
  // 5) outlines for the preview
  let budget = OUTLINE_POINT_CAP;
  outer: for (const { g } of s.groups) for (const li of [...(s.used.get(g.regionId) ?? [])].sort((a, b) => a - b)) {
    const rings = toRings(s.regionsAt(g.object, li).filter((r) => r.regionId === g.regionId).flatMap((r) => r.paths));
    budget -= rings.reduce((a, r) => a + r.length, 0);
    if (budget < 0) break outer;
    rep.outlines.push({ regionId: g.regionId, layer: li, rings });
  }
  return rep;
}

export const patternexEngine: EnginePlugin<PatternexConfig, PatternexReport> = {
  id: 'patternex',
  name: 'Patternex',
  version: '1.0.0',
  prepare(config, ctx) {
    if (!config.placements.length) return undefined;
    return new PatternexSession(config, ctx);
  },
  postToolpath(layers, config, ctx) {
    const s = ctx.session as PatternexSession | undefined;
    const rep = buildReport(layers, config, ctx.cfg, s, ctx.cfg.has_ams === true);
    for (const w of rep.warnings) if (!s?.warnings.includes(w)) ctx.warn(w);
    return rep;
  },
  gcodeHeader(config) {
    return config.placements.filter((p) => p.visible).map((p) => {
      const n = config.actions.filter((a) => a.region_ref.placement_id === p.id).length;
      return `; patternex: ${p.pattern_id} ${p.projection} on object ${p.object}, ${n} region action(s)${p.through ? ', through' : ''}`;
    });
  },
};
