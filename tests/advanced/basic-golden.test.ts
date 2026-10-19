// Basic mode must keep producing exactly the G-code of the classic engine. These hashes were taken from
// the engine before the Advanced core existed; if a deliberate Basic-engine change alters them, update
// them in the same commit and say why.
// Updated with the Basic settings rework (PR #22), which changed the classic engine's defaults and
// toolpath rules (walls, seams, cooling, travel). The new hashes were checked to be identical before and after
// merging the Advanced core, so the Advanced plumbing itself still leaves Basic mode untouched. The P1S hash
// changed once more only because the G-code config block now reads gcode_flavor = bbl (flavour renamed).
// All four changed again only because the config block lists the new outline_smoothing / outline_smoothing_corner
// settings (off by default); with those two lines removed the G-code hashes are exactly the previous ones.
import { describe, expect, it } from 'vitest';
import { weld } from '../../src/engine/mesh';
import { slice } from '../../src/engine/slicer';
import { resolveConfig } from '../../src/profiles/resolve';
import { md5 } from '../../src/io/md5';
import { box, cylinder, tee } from '../fixtures';

const cfgFor = (printerId: string, overrides = {}) =>
  resolveConfig({ printerId, plate: 'textured_pei_plate', filamentId: 'generic-pla', presetId: '0.20', overrides });
const mesh = (soup: Float32Array, name: string) => { const m = weld(soup); return { id: name, name, vertices: m.vertices, indices: m.indices }; };

const CASES: { name: string; run: () => string; hash: string }[] = [
  { name: 'cube on P1S', run: () => slice([mesh(box(100, 100, 0, 20, 20, 20), 'cube')], cfgFor('bbl-p1s')).gcode, hash: '7dd6f36a96ecbe31f2f552da94da456c' },
  { name: 'cylinder on Voron (arachne, arcs)', run: () => slice([mesh(cylinder(80, 80, 12, 15), 'cyl')], cfgFor('voron-24-350', { wall_generator: 'arachne', enable_arc_fitting: true })).gcode, hash: 'd76c564824cffe1694795ef4b52a7302' },
  { name: 'tee with tree support on Prusa MK4S', run: () => slice([mesh(tee(100, 100), 'tee')], cfgFor('prusa-mk4s', { enable_support: true, support_type: 'tree_auto' })).gcode, hash: '27611b99212ef529083a35669598290c' },
  { name: 'vase cylinder on Ender-3 V2', run: () => slice([mesh(cylinder(100, 100, 15, 20), 'vase')], cfgFor('creality-ender3v2', { spiral_mode: true })).gcode, hash: '840a85fefcfaab584f9581dd7495b9e4' },
];

describe('Basic mode is the classic engine', () => {
  for (const c of CASES) it(`${c.name} — G-code unchanged`, () => {
    expect(md5(c.run())).toBe(c.hash);
  });
});
