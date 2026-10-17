// Phase 4: field solvers and lattices — FEA stress paths and spinor frames, reaction–diffusion,
// quasicrystal, band-gap and homogenized cells, foam, inverse warp, lattices, dovetails, co-molding,
// metric morphing and caustic lenses.
import { describe, expect, it } from 'vitest';
import { slice } from '../../src/engine/slicer';
import { resolveConfig } from '../../src/profiles/resolve';
import { box, indexed } from './shapes';
import type { TechId } from '../../src/engine/advanced/types';
import { FEATURE_ORDER, type SliceOutput } from '../../src/engine/types';

const cfgFor = (printerId: string, overrides = {}, filamentId = 'generic-pla') => resolveConfig({ printerId, plate: 'textured_pei_plate', filamentId, presetId: '0.20', overrides });
const ALL = ['fea_stress', 'sdf_frep', 'eulerian_spiral', 'conformal_layers', 'hot_on_hot', 'kinematic_extrusion', 'z_weave', 'subvoxel_aa', 'turing_infill', 'corner_overshoot', 'spatial_lattice', 'metamaterial', 'dovetail', 'sgd_slicing', 'eikonal_offsets', 'inverse_warp', 'gloss_modulation', 'foam_control', 'knot_braiding', 'co_molding', 'thick_vase', 'tangent_entry', 'scarf_splice', 'harmonic_dome', 'conformal_ironing', 'perimeter_feathering', 'iso_gloss', 'quasicrystal', 'metric_morph', 'monge_ampere', 'symplectic_shaper', 'morse_router', 'spinor_fields', 'band_gap', 'homogenization'] as TechId[];
type Mesh = ReturnType<typeof indexed> & { paint?: { adv?: Uint8Array; color?: Uint8Array }; filament?: number };
/** Advanced slice with every technology off except the listed ones. */
export function adv(meshes: Mesh | Mesh[], printerId: string, on: TechId[], intent: 'structural' | 'aesthetic' | 'optical' | 'acoustic' | 'morph4d' = 'structural', o: { overrides?: Record<string, unknown>; params?: Record<string, Record<string, number | boolean | string>>; filamentId?: string; extra?: Record<string, unknown>; filaments?: unknown[] } = {}) {
  const techs: Record<string, { enabled: boolean; params?: Record<string, number | boolean | string> }> = Object.fromEntries(ALL.map((id) => [id, { enabled: on.includes(id) }]));
  for (const [id, p] of Object.entries(o.params ?? {})) techs[id] = { ...techs[id], params: p };
  const list = Array.isArray(meshes) ? meshes : [meshes];
  const out = slice(list as any, cfgFor(printerId, o.overrides, o.filamentId), () => {}, { advanced: { intent, printerId, techs, resolution: 'draft', ...(o.extra ?? {}) } as any, ...(o.filaments ? { filaments: o.filaments as any } : {}) });
  const rep = new Map(out.advanced!.techs.map((t) => [t.id, t]));
  return { out, rep };
}
export const sane = (g: string) => { expect(g).not.toMatch(/NaN|Infinity|undefined/); };
export const ran = (st?: string) => expect(['applied', 'adapted']).toContain(st);

/** Per-triangle paint from a predicate on the triangle centroid. */
export function paintBy(m: ReturnType<typeof indexed>, f: (x: number, y: number, z: number) => number): Uint8Array {
  const T = m.indices.length / 3, out = new Uint8Array(T), v = m.vertices, ix = m.indices;
  for (let t = 0; t < T; t++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { x += v[ix[t * 3 + k] * 3] / 3; y += v[ix[t * 3 + k] * 3 + 1] / 3; z += v[ix[t * 3 + k] * 3 + 2] / 3; }
    out[t] = f(x, y, z);
  }
  return out;
}

/** Extrusion segments of a feature on a layer (from the packed moves): [x0, y0, x1, y1, z1, w]. */
export function segments(out: SliceOutput, layer: number, feature: string): number[][] {
  const L = out.layers[layer], f = FEATURE_ORDER.indexOf(feature as never), m = out.moves;
  const res: number[][] = [];
  for (let i = Math.max(1, L.moveStart); i < L.moveEnd; i++) {
    if (out.moveFeatures[i] !== f || m[i * 8 + 3] <= 0) continue;
    res.push([m[(i - 1) * 8], m[(i - 1) * 8 + 1], m[i * 8], m[i * 8 + 1], m[i * 8 + 2], m[i * 8 + 3]]);
  }
  return res;
}
export const layerAt = (out: SliceOutput, z: number) => out.layers.findIndex((l) => Math.abs(l.z - z) < 0.11);

describe('FEA stress-aligned paths (#1) and spinor frames (#33)', () => {
  it('follows the bending stress of a painted cantilever', () => {
    const m: Mesh = indexed(box(70, 95, 0, 60, 10, 10), 'beam');
    m.paint = { adv: paintBy(m, (x) => (x < 70.01 ? 1 : x > 129.99 ? 2 : 0)) };
    const t0 = performance.now();
    const { out, rep } = adv(m, 'bbl-x1c', ['fea_stress', 'spinor_fields'], 'structural', { params: { fea_stress: { threshold: 0, family: 'max' } } });
    const ms = performance.now() - t0;
    const r = rep.get('fea_stress')!;
    console.log('fea', r.stats, rep.get('spinor_fields')!.stats, Math.round(ms));
    ran(r.status);
    expect(String(r.stats!.load)).toContain('painted');
    expect(Number(r.stats!.streamlines)).toBeGreaterThan(20);
    ran(rep.get('spinor_fields')!.status);
    // upper fibres are in tension along the beam, so the tension trajectories run along x
    let along = 0, total = 0;
    for (const [x0, y0, x1, y1] of segments(out, layerAt(out, 8), 'sparse_infill')) { const l = Math.hypot(x1 - x0, y1 - y0); total += l; along += Math.abs(x1 - x0); }
    expect(total).toBeGreaterThan(50);
    expect(along / total).toBeGreaterThan(0.85);
    sane(out.gcode);
  });
});

import { orientQuasicrystal, fibonacci } from '../../src/engine/advanced/modules/quasicrystal';
import { designBandGap } from '../../src/engine/advanced/modules/bandGap';

describe('quasicrystal infill (#28)', () => {
  it('puts a five-fold axis up: five printable families at 26.6°, isotropic in the layer', () => {
    const o = orientQuasicrystal(45);
    expect(o.normals.length).toBe(5);
    expect(Math.max(...o.tilts)).toBeCloseTo(26.57, 0);
    expect(o.aniso).toBeLessThan(0.02);
  });
  it('spaces planes as a Fibonacci chain (gaps 1 and τ)', () => {
    const gaps = new Set<string>();
    for (let n = 0; n < 50; n++) gaps.add((fibonacci(n + 1, 0.3) - fibonacci(n, 0.3)).toFixed(6));
    expect([...gaps].sort()).toEqual(['1.000000', '1.618034']);
  });
  it('fills the core of a block', () => {
    const { out, rep } = adv(indexed(box(80, 80, 0, 40, 40, 20), 'blk'), 'bbl-x1c', ['quasicrystal']);
    ran(rep.get('quasicrystal')!.status);
    expect(Number(rep.get('quasicrystal')!.stats!.lines)).toBeGreaterThan(100);
    sane(out.gcode);
  });
});

describe('Gray–Scott Turing infill (#9)', () => {
  it('grows ribs and keeps them from layer to layer', () => {
    const { out, rep } = adv(indexed(box(80, 80, 0, 40, 40, 12), 'blk'), 'bbl-x1c', ['turing_infill']);
    const r = rep.get('turing_infill')!;
    console.log('turing', r.stats, r.ms);
    ran(r.status);
    expect(Number(r.stats!.ribs)).toBeGreaterThan(50);
    // consecutive layers print nearly the same ribs (Z continuation)
    const a = segments(out, layerAt(out, 6), 'sparse_infill'), b = segments(out, layerAt(out, 6.2), 'sparse_infill');
    const la = a.reduce((t, s) => t + Math.hypot(s[2] - s[0], s[3] - s[1]), 0), lb = b.reduce((t, s) => t + Math.hypot(s[2] - s[0], s[3] - s[1]), 0);
    expect(la).toBeGreaterThan(100);
    expect(Math.abs(la - lb) / la).toBeLessThan(0.15);
    sane(out.gcode);
  });
});

describe('metamaterial, band gap and homogenization (#12, #34, #35)', () => {
  it('designs a resonator lattice whose gap holds the target frequency', () => {
    const d = designBandGap(800, 0.45, false)!;
    console.log(d);
    expect(d.inGap).toBe(true);
    expect(d.chern).toBe(0);
  });
  it('acoustic intent: band-gap core, graded auxetic cells, homogenized design', () => {
    const { out, rep } = adv(indexed(box(70, 70, 0, 60, 60, 10), 'pad'), 'bbl-x1c', ['band_gap', 'metamaterial', 'homogenization'], 'acoustic', { params: { homogenization: { targetNu: -0.5 } } });
    for (const id of ['band_gap', 'metamaterial', 'homogenization'] as const) { console.log(id, rep.get(id)!.stats, rep.get(id)!.ms); ran(rep.get(id)!.status); }
    expect(Number(rep.get('homogenization')!.stats!.poisson_homogenized)).toBeLessThan(0);
    expect(Number(rep.get('band_gap')!.stats!.resonators)).toBeGreaterThan(0);
    sane(out.gcode);
  });
});
