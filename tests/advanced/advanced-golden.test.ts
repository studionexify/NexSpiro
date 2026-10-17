// Advanced mode is its own engine: Basic (Bambu Studio) changes must never alter its G-code. The config fixture
// and these hashes come from main before the Bambu parity work (81187d6); the same config through the same
// technologies must keep producing exactly that G-code.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { slice } from '../../src/engine/slicer';
import { md5 } from '../../src/io/md5';
import { box, cylinder, dome, indexed, tube } from './shapes';

const cfgs = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-config.json', import.meta.url), 'utf8'));
const run = (m: ReturnType<typeof indexed>, c: Record<string, unknown>, techs: string[], intent = 'aesthetic') =>
  md5(slice([m], c as any, () => {}, { advanced: { intent, printerId: 'x', techs: Object.fromEntries(techs.map((t) => [t, { enabled: true }])), resolution: 'draft' } as any }).gcode);

const CASES: { name: string; run: () => string; hash: string }[] = [
  { name: 'tangent entry seams', run: () => run(indexed(box(90, 90, 0, 30, 30, 8), 'b'), cfgs.p1s, ['tangent_entry']), hash: '81ee59cf7fefed97185c334ea9b52b26' },
  { name: 'scarf splice', run: () => run(indexed(cylinder(100, 100, 12, 8), 'c'), cfgs.p1s, ['scarf_splice']), hash: 'f2a314cffb7b2f503600204a4452abab' },
  { name: 'helical thick-vase', run: () => run(indexed(tube(100, 100, 15, 3, 20), 'tube'), cfgs.x1c, ['thick_vase']), hash: '8d60534c847c019dcc0d45f63f2670c7' },
  { name: 'sub-voxel anti-aliasing', run: () => run(indexed(dome(100, 100, 20, 8, 4), 'd'), cfgs.x1c, ['subvoxel_aa']), hash: '3f4f1c185c63bb1cdcc147af7cb44d2f' },
  { name: 'Eulerian spiral infill', run: () => run(indexed(box(90, 90, 0, 25, 25, 6), 'b'), cfgs.p1s, ['eulerian_spiral'], 'structural'), hash: '96427c217b4202883b279368e3e132ca' },
];

describe('Advanced mode is independent of the Basic engine', () => {
  for (const c of CASES) it(`${c.name} — G-code unchanged`, () => { expect(c.run()).toBe(c.hash); });
});
