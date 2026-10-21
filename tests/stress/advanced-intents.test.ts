// Every Advanced engine intent with plain, vase, hollow, supported and over-wide-brim settings: each slice must finish
// and pass the strict G-code validator.
import { describe, expect, it } from 'vitest';
import { slice } from '../../src/engine/slicer';
import { type Config } from '../../src/profiles/settings';
import { cylinder, tee } from '../fixtures';
import { cfgWith, mesh, PRINTER } from './helpers';
import { describeIssues, validateSlice } from './gcodeValidator';

describe('Advanced engine intents', () => {
  const shapes = () => [mesh(tee(128, 128), 'tee'), mesh(cylinder(128, 175, 12, 25, 64), 'cyl')];
  for (const intent of ['structural', 'aesthetic', 'optical', 'acoustic', 'morph4d'])
    for (const ov of [{}, { spiral_mode: true }, { wall_loops: 1, sparse_infill_density: '0%' }, { enable_support: true }, { brim_type: 'outer_only', brim_width: 100 }] as Config[])
      it(`${intent} ${JSON.stringify(ov)}`, () => {
        const cfg = cfgWith({ overrides: ov });
        const out = slice(shapes(), cfg, () => {}, { advanced: { intent, printerId: PRINTER, techs: {}, resolution: 'draft' } as any });
        // non-planar technologies (conformal layers, Z weave) may dip below the layer plane; never below the bed
        const issues = validateSlice(out, cfg, { allowZReset: true });
        expect(issues, describeIssues(issues)).toEqual([]);
        expect(out.stats.filamentMm).toBeGreaterThan(0);
      });
});

