// RE-PINNED (reverse-verifier remediation): Basic hashes changed only because a first-layer bottom-surface width of 0 now means
// 'same as initial layer' as its tooltip says (checked: reverting that one line restores the old hashes). Advanced hashes changed because
// E now follows true 3-D bead length / local bead height on non-planar paths (see tests/reverse-verifier).
// Basic mode must keep producing exactly the G-code of the classic engine. These hashes were taken from
// the engine before the Advanced core existed; if a deliberate Basic-engine change alters them, update
// them in the same commit and say why.
// Updated with the Basic settings rework (PR #22), which changed the classic engine's defaults and
// toolpath rules (walls, seams, cooling, travel). The new hashes were checked to be identical before and after
// merging the Advanced core, so the Advanced plumbing itself still leaves Basic mode untouched. The P1S hash
// changed once more only because the G-code config block now reads gcode_flavor = bbl (flavour renamed).
// All four changed again only because the config block lists the new outline_smoothing / outline_smoothing_corner
// settings (off by default); with those two lines removed the G-code hashes are exactly the previous ones.
// The two cylinder hashes changed with the slicing speed-up: cross-section outlines now drop the points that lie
// on a straight wall (the crossings of a flat face's diagonal edge, which slid from layer to layer) and the ones
// within the path resolution, so identical layers are recognised and their polygon work is reused. Wall points
// move by less than the Resolution setting (0.012 mm); the cube and the supported tee are unchanged.
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
  { name: 'cube on P1S', run: () => slice([mesh(box(100, 100, 0, 20, 20, 20), 'cube')], cfgFor('bbl-p1s')).gcode, hash: '3adaf704795637d7a93522b166bf384b' },
  { name: 'cylinder on Voron (arachne, arcs)', run: () => slice([mesh(cylinder(80, 80, 12, 15), 'cyl')], cfgFor('voron-24-350', { wall_generator: 'arachne', enable_arc_fitting: true })).gcode, hash: '3f480cf61a1e9edf0810ec6e0d912c03' },
  { name: 'tee with tree support on Prusa MK4S', run: () => slice([mesh(tee(100, 100), 'tee')], cfgFor('prusa-mk4s', { enable_support: true, support_type: 'tree_auto' })).gcode, hash: '8fe121109305da2d8edb65db7be842e1' },
  { name: 'vase cylinder on Ender-3 V2', run: () => slice([mesh(cylinder(100, 100, 15, 20), 'vase')], cfgFor('creality-ender3v2', { spiral_mode: true })).gcode, hash: '0b224d14c49a52bdc4311c632366d89d' },
];

describe('Basic mode is the classic engine', () => {
  for (const c of CASES) it(`${c.name} — G-code unchanged`, () => {
    expect(md5(c.run())).toBe(c.hash);
  });
});
