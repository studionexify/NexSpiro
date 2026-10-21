// Batch reverse-verifier: slices fixtures headlessly, parses the G-code and runs the LOCKED mathAssertions
// against it. Every (target, profile) is one `it`; every assertion is one row in report.json / report.md.
import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slice, slotFromConfig } from '../../src/engine/slicer';
import { TECHS, type TechDef } from '../../src/engine/advanced/techs';
import { PRESETS as MOTION_PRESETS } from '../../src/plugins/motionex/presets';
import { defaultToolhead } from '../../src/plugins/motionex/core/toolhead';
import { DEFAULT_OPTIONS } from '../../src/plugins/motionex/modifier';
import { preset as hanexPreset } from '../../src/plugins/hanex/core/profile';
import { DEFAULT_BULNEX } from '../../src/plugins/bulnex/model';
import { builtinPattern, newPlacement } from '../../src/plugins/patternex';
import { adv } from '../advanced/helpers';
import { box, cylinder, tee } from '../fixtures';
import type { Config } from '../../src/profiles/settings';
import {
  LINE_WIDTH_KEYS, PLANAR_THETA_MAX_DEG, PRINTER, PROFILE_BOUNDARY, PROFILE_DEFAULT, PROFILE_EXTREME, PROFILES,
  advRampLimit, cfgWith, errorRow, M, meshOf, outerWallWidth, pointsOf, type Profile, type Row,
  specParams, standardRows, toRows,
} from './runner';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** Runner-declared expectations (not in the locked spec): the vase base skip and the continuity travel bound. */
const VASE_BASE_LAYERS = 3;
const VASE_MAX_JUMP_MM = 0.5;
const MOTION_Z_START = 2; // motionex recipe mask z_start (mm)
const WEAVE_FIRST_LAYER = 3;

interface Target { id: string; run: (p: Profile) => Row[] }
interface ReportRow extends Row { target: string; profile: Profile }

const PART_EXCLUDED = new Set(['brim', 'skirt', 'prime tower']);
const featName = (f?: string) => (f ?? '').replace(/_/g, ' ').trim().toLowerCase();

const boundaryOv = (profile: Profile) => (profile === PROFILE_BOUNDARY ? { layer_height: 0.08 } : {});

// ---------------------------------------------------------------------------------------------------------
// 1. Core planar slicer (cube / cylinder / tee), vase, thick-bridge and variable-width edge configs
// ---------------------------------------------------------------------------------------------------------
type CoreKind = 'cube' | 'cylinder' | 'tee' | 'vase' | 'thick-bridge' | 'width-mix';
const KIND_OVERRIDES: Record<CoreKind, Record<string, unknown>> = {
  cube: {},
  cylinder: {},
  tee: {},
  vase: { spiral_mode: true },
  'thick-bridge': { thick_bridges: true },
  'width-mix': { outer_wall_line_width: 0.3, inner_wall_line_width: 0.6 },
};

function coreGeom(kind: CoreKind, profile: Profile): { soup: Float32Array; height: number; radius?: number } {
  const tiny = profile === PROFILE_BOUNDARY;
  switch (kind) {
    case 'cube': return tiny ? { soup: box(100, 100, 0, 6, 6, 6), height: 6 } : { soup: box(100, 100, 0, 20, 20, 20), height: 20 };
    case 'cylinder':
    case 'width-mix': return tiny ? { soup: cylinder(100, 100, 3, 6), height: 6, radius: 3 } : { soup: cylinder(100, 100, 10, 20), height: 20, radius: 10 };
    case 'vase': return tiny ? { soup: cylinder(100, 100, 3, 6), height: 6, radius: 3 } : { soup: cylinder(100, 100, 15, 30), height: 30, radius: 15 };
    case 'tee':
    case 'thick-bridge': return { soup: tee(100, 100), height: 14 };
  }
}

function coreProfileOverrides(profile: Profile): Record<string, unknown> {
  if (profile === PROFILE_EXTREME) {
    const o: Record<string, unknown> = { layer_height: 0.72, sparse_infill_density: 90 }; // ~90 % of ParamSpec max (0.8 / 100)
    for (const k of LINE_WIDTH_KEYS) o[k] = 1.8; // ~90 % of line-width max (2.0)
    return o;
  }
  if (profile === PROFILE_BOUNDARY) {
    const o: Record<string, unknown> = { layer_height: 0.08, sparse_infill_density: 0 };
    for (const k of LINE_WIDTH_KEYS) o[k] = 0.1; // line_width ParamSpec min
    return o;
  }
  return {};
}

function coreRun(kind: CoreKind) {
  return (profile: Profile): Row[] => {
    const g = coreGeom(kind, profile);
    const cfg = cfgWith(PRINTER, { ...coreProfileOverrides(profile), ...KIND_OVERRIDES[kind] });
    const out = slice([meshOf(g.soup)], cfg, () => {}, {});
    const { moves, results } = standardRows(out.gcode, cfg, PLANAR_THETA_MAX_DEG);
    const rows = toRows(results);
    // Envelope scope = the part itself: brim, skirt and prime-tower beads sit outside it by design.
    const partMoves = moves.filter((m) => !PART_EXCLUDED.has(featName(m.feature)));
    rows.push(...toRows([M.checkEnvelope(M.reconstructPointCloud(partMoves), {
      height: g.height,
      layerHeight: Number(cfg.layer_height),
      lineWidth: outerWallWidth(cfg),
      ...(g.radius !== undefined ? { radius: g.radius, center: { x: 100, y: 100 } } : {}),
    })]));
    if (kind === 'vase') {
      rows.push(...toRows([M.checkContinuity(moves, { maxJump: VASE_MAX_JUMP_MM, zMode: 'monotonic', fromLayer: VASE_BASE_LAYERS })]));
    }
    return rows;
  };
}

// ---------------------------------------------------------------------------------------------------------
// 2. Every Advanced technology, enabled alone via adv() with default / spec-extreme / spec-minimum params
// ---------------------------------------------------------------------------------------------------------
function advRun(tech: TechDef) {
  return (profile: Profile): Row[] => {
    const tiny = profile === PROFILE_BOUNDARY;
    const s = tiny ? 6 : 20;
    const ov = boundaryOv(profile);
    const params = specParams(tech.params, profile);
    const { out, rep } = adv([meshOf(box(100, 100, 0, s, s, s))] as any, PRINTER, [tech.id], 'structural', {
      overrides: ov,
      ...(params ? { params: { [tech.id]: params } } : {}),
    });
    const cfg = cfgWith(PRINTER, ov);
    const t = rep.get(tech.id);
    const okStatus = t?.status === 'applied' || t?.status === 'adapted';
    const rows: Row[] = [{
      assertion: 'tech-status',
      pass: okStatus,
      metrics: {},
      firstFailures: okStatus ? [] : [{ assertion: 'tech-status', message: `status=${t?.status ?? 'missing from advanced output'}${t?.reason ? ` (${t.reason})` : ''}` }],
    }];
    rows.push(...toRows(standardRows(out.gcode, cfg, advRampLimit(cfg)).results));
    return rows;
  };
}

// ---------------------------------------------------------------------------------------------------------
// 3. Engine plugins (manifest section 6b recipes)
// ---------------------------------------------------------------------------------------------------------
const SINE = MOTION_PRESETS.find((b) => b.id === 'preset-sine')!;

function motionexRun(profile: Profile): Row[] {
  const tiny = profile === PROFILE_BOUNDARY;
  const R = tiny ? 3 : 10, H = tiny ? 6 : 20;
  const amp = profile === PROFILE_EXTREME ? 2.0 : tiny ? 0.05 : SINE.amplitude;
  const period = profile === PROFILE_EXTREME ? 2 : tiny ? 2 : SINE.period_mm;
  const brush = { ...SINE, amplitude: amp, period_mm: period };
  const cfg = cfgWith('bbl-x1c', { enable_arc_fitting: false, ...boundaryOv(profile) });
  const mx = {
    applications: [{ brush_id: SINE.id, target: { type: 'body', walls: 'outer' }, mask: { z_start: 2, z_end: 1e4, fade_in_mm: 0, fade_out_mm: 0 }, order: 0, blend: 'add', enabled: true }],
    brushes: [brush], options: DEFAULT_OPTIONS, collisionMode: 'clamp', toolhead: defaultToolhead('bbl-x1c'), printerId: 'bbl-x1c',
  };
  const out = slice([meshOf(cylinder(100, 100, R, H))], cfg, () => {}, { plugins: { motionex: mx } });
  const { moves, results } = standardRows(out.gcode, cfg, PLANAR_THETA_MAX_DEG);
  // Known signature: sine lateral offset on the outer wall -> dominant harmonic = wave count per revolution.
  // Only layers inside the brush mask (z >= z_start = 2 mm) are modulated; the wall centreline sits W/2 inside R.
  const Rwall = R - outerWallWidth(cfg) / 2;
  const lobes = Math.round((2 * Math.PI * Rwall) / period);
  const modulated = [...new Set(pointsOf(moves, 'outer wall').filter((p) => p.z >= MOTION_Z_START).map((p) => p.layer))];
  results.push(M.checkSpiroSignature(pointsOf(moves, 'outer wall'), { center: { x: 100, y: 100 }, lobes, amplitude: amp, layers: modulated }));
  return toRows(results);
}

function hanexRun(profile: Profile): Row[] {
  const tiny = profile === PROFILE_BOUNDARY;
  const cfg = cfgWith(PRINTER, boundaryOv(profile));
  const p = profile === PROFILE_EXTREME ? { tipDiameter: 2.5, minArea: 50 } : tiny ? { tipDiameter: 0.4, minArea: 0 } : { tipDiameter: 1.0, minArea: 4 };
  const soup = tiny ? box(100, 100, 0, 6, 6, 6) : tee(100, 100);
  const out = slice([meshOf(soup)], cfg, () => {}, { plugins: { hanex: { profile: hanexPreset('hanex-pla'), ...p } } });
  return toRows(standardRows(out.gcode, cfg, PLANAR_THETA_MAX_DEG).results);
}

function bulnexRun(profile: Profile): Row[] {
  const tiny = profile === PROFILE_BOUNDARY;
  const cfg = cfgWith(PRINTER, boundaryOv(profile));
  const b = profile === PROFILE_EXTREME
    ? { ...DEFAULT_BULNEX, cycles: 9, passes: 4, pushHeightPct: 0.9, coolWaitMin: 15 }
    : tiny ? { ...DEFAULT_BULNEX, cycles: 1, passes: 1, pushHeightPct: 0.05, coolWaitMin: 0 }
      : { ...DEFAULT_BULNEX, cycles: 3, passes: 2, coolWaitMin: 2 };
  const soup = tiny ? box(120, 20, 0, 6, 6, 6) : box(120, 20, 0, 16, 16, 12);
  const out = slice([meshOf(soup)], cfg, () => {}, { plugins: { bulnex: b } });
  return toRows(standardRows(out.gcode, cfg, PLANAR_THETA_MAX_DEG).results);
}

function patternexRun(profile: Profile): Row[] {
  const tiny = profile === PROFILE_BOUNDARY;
  const cfg = cfgWith('bbl-p1s', { enable_arc_fitting: false, ...boundaryOv(profile) });
  const a = slotFromConfig(cfg);
  const filaments = [a, { ...a, name: 'Black', color: '#111111' }, { ...a, name: 'Red', color: '#ff0000' }];
  const pattern = builtinPattern('dots');
  const top = tiny ? 6 : 4;
  const at = tiny ? 63 : 70;
  const scale = profile === PROFILE_EXTREME ? 1.8 : tiny ? 0.3 : 1;
  const placement = {
    ...newPlacement('p1', pattern, 'm:0', [at, at, top], [0, 0, 1]),
    object: 0, position_xyz: [at, at, top], projection_axis: [0, 0, 1], scale_xy: [scale, scale],
  };
  const purge = profile === PROFILE_EXTREME
    ? { mode: 'reduced', volume_mm3: 30, change_point_shift_mm: 0 }
    : tiny ? { mode: 'none', change_point_shift_mm: 0 } : { mode: 'full', change_point_shift_mm: 0 };
  const action = { region_ref: { placement_id: 'p1' }, material: { mode: 'slot', slot_index: 1 }, purge, motion: null };
  const pcfg = { patterns: [pattern], placements: [placement], actions: [action], singleColour: 'skip', transitionVolume: [] };
  const soup = tiny ? box(60, 60, 0, 6, 6, 6) : box(60, 60, 0, 20, 20, 4);
  const out = slice([meshOf(soup, 'm')], cfg, () => {}, { filaments, plugins: { patternex: pcfg as any } });
  return toRows(standardRows(out.gcode, cfg, PLANAR_THETA_MAX_DEG).results);
}

// ---------------------------------------------------------------------------------------------------------
// 4. z_weave on a cylinder with the weave-alternation signature
// ---------------------------------------------------------------------------------------------------------
const ZW = TECHS.find((t) => t.id === 'z_weave')!;

function weaveRun(profile: Profile): Row[] {
  const tiny = profile === PROFILE_BOUNDARY;
  const R = tiny ? 3 : 10, H = tiny ? 6 : 20;
  const ov = boundaryOv(profile);
  const p = specParams(ZW.params, profile);
  const { out, rep } = adv([meshOf(cylinder(100, 100, R, H))] as any, PRINTER, ['z_weave'], 'structural', {
    overrides: ov, ...(p ? { params: { z_weave: p } } : {}),
  });
  const cfg = cfgWith(PRINTER, ov);
  const t = rep.get('z_weave');
  const okStatus = t?.status === 'applied' || t?.status === 'adapted';
  const rows: Row[] = [{
    assertion: 'tech-status', pass: okStatus, metrics: {},
    firstFailures: okStatus ? [] : [{ assertion: 'tech-status', message: `status=${t?.status ?? 'missing'}${t?.reason ? ` (${t.reason})` : ''}` }],
  }];
  const { moves, results } = standardRows(out.gcode, cfg, advRampLimit(cfg));
  const eff = { ...Object.fromEntries(ZW.params.map((s) => [s.key, s.def])), ...(p ?? {}) } as Record<string, number>;
  const lobes = Math.max(1, Math.round((2 * Math.PI * R) / eff.wavelength));
  // The module weaves inner walls and sparse infill (weave.ts WOVEN); inner walls are the cylinder's wall loops.
  // weave.ts skips the first three layers (li < 3: solid base), so only layers 3.. are woven.
  results.push(M.checkWeaveAlternation(pointsOf(moves, 'inner wall').filter((p) => p.layer >= WEAVE_FIRST_LAYER), {
    center: { x: 100, y: 100 }, lobes, amplitude: eff.amp * Number(cfg.layer_height),
  }));
  rows.push(...toRows(results));
  return rows;
}

// ---------------------------------------------------------------------------------------------------------
const TARGETS: Target[] = [
  ...(['cube', 'cylinder', 'tee', 'vase', 'thick-bridge', 'width-mix'] as CoreKind[]).map((k) => ({ id: `core/${k}`, run: coreRun(k) })),
  ...TECHS.map((t) => ({ id: `adv/${t.id}`, run: advRun(t) })),
  { id: 'plugin/motionex', run: motionexRun },
  { id: 'plugin/hanex', run: hanexRun },
  { id: 'plugin/bulnex', run: bulnexRun },
  { id: 'plugin/patternex', run: patternexRun },
  { id: 'weave/z_weave-cylinder', run: weaveRun },
];

const report: ReportRow[] = [];

function runSafely(t: Target, profile: Profile): Row[] {
  try {
    return t.run(profile);
  } catch (e) {
    // Harness / slice / parse error: recorded as a failing row, never swallowed.
    return [errorRow('slice-ran', e)];
  }
}

describe('batch reverse-verifier', () => {
  for (const t of TARGETS) {
    for (const profile of PROFILES) {
      it(`${t.id} | ${profile}`, () => {
        const rows = runSafely(t, profile);
        for (const r of rows) report.push({ target: t.id, profile, ...r });
        const bad = rows.filter((r) => !r.pass);
        if (bad.length) {
          throw new Error(bad.map((b) => `${b.assertion}: ${b.firstFailures[0]?.message ?? 'failed'}`).join('\n'));
        }
        expect(bad).toHaveLength(0);
      }, 240_000);
    }
  }

  afterAll(() => {
    writeFileSync(`${HERE}report.json`, JSON.stringify(report, null, 2));
    writeFileSync(`${HERE}report.md`, toMarkdown(report));
  });
});

function toMarkdown(rows: ReportRow[]): string {
  const esc = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');
  const groups = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = `${r.target}\u0000${r.profile}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const lines: string[] = [
    '# Batch reverse-verifier summary', '',
    `Rows: ${rows.length}, (target, profile) cells: ${groups.size}, failing cells: ${[...groups.values()].filter((g) => g.some((r) => !r.pass)).length}`, '',
    '| Target | Profile | Result | Failing assertions | Max rel. err % (volumetric) | Example message |',
    '|---|---|---|---|---|---|',
  ];
  for (const [k, g] of groups) {
    const [target, profile] = k.split('\u0000');
    const failing = g.filter((r) => !r.pass);
    const vol = g.find((r) => r.assertion === 'volumetric-extrusion-conservation');
    const err = vol?.metrics.maxRelErrPct !== undefined ? vol.metrics.maxRelErrPct.toFixed(2) : '-';
    const ex = failing[0]?.firstFailures[0]?.message ?? '';
    lines.push(`| ${target} | ${profile} | ${failing.length ? 'FAIL' : 'PASS'} | ${esc(failing.map((r) => r.assertion).join(', ')) || '-'} | ${err} | ${esc(ex).slice(0, 240) || '-'} |`);
  }
  lines.push('', '`Max rel. err %` is the volumetric maxRelErrPct metric; the tolerance is 2 % (locked).', '');
  return lines.join('\n');
}

export { PROFILE_DEFAULT };
