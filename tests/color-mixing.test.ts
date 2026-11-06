// Colour mixing: mixed (virtual) filaments resolve to a physical slot per layer.
import { describe, expect, it } from 'vitest';
import { slice, slotFromConfig } from '../src/engine/slicer';
import { weld } from '../src/engine/mesh';
import { resolveConfig } from '../src/profiles/resolve';
import { mixColor, mixProblems, mixSequence, mixesAfterSlotRemoved, resolveFilament, shiftIndex, type MixedFilament } from '../src/profiles/mixing';
import { box } from './fixtures';

const ratio = (a: number, b: number, ra: number, rb: number): MixedFilament => ({ id: 'm', kind: 'ratio', a, b, ra, rb });

describe('mix sequences', () => {
  it('spreads a ratio evenly', () => {
    expect(mixSequence(ratio(0, 1, 1, 1))).toEqual([0, 1]);
    expect(mixSequence(ratio(0, 1, 2, 1))).toEqual([0, 0, 1]);
    const s = mixSequence(ratio(0, 1, 3, 2));
    expect(s.filter((k) => k === 0).length).toBe(3);
    expect(s.filter((k) => k === 1).length).toBe(2);
    // never two B layers in a row when A is the majority
    expect(s.join('')).not.toMatch(/11/);
  });
  it('repeats a cycle and resolves per layer', () => {
    const c: MixedFilament = { id: 'c', kind: 'cycle', seq: [0, 1, 1, 2] };
    expect([0, 1, 2, 3, 4, 5].map((i) => resolveFilament(4, i, 4, [c]))).toEqual([0, 1, 1, 2, 0, 1]);
    expect(resolveFilament(2, 7, 4, [c])).toBe(2); // physical slots pass through
  });
  it('blends in linear light and flags bad mixes', () => {
    expect(mixColor(ratio(0, 1, 1, 1), ['#000000', '#FFFFFF'])).toBe('#BCBCBC');
    expect(mixColor(ratio(0, 1, 1, 1), ['#FF0000', '#FF0000'])).toBe('#FF0000');
    expect(mixProblems(ratio(0, 0, 1, 1), 4)).toHaveLength(1);
    expect(mixProblems(ratio(0, 5, 1, 1), 4).length).toBeGreaterThan(0);
    expect(mixProblems(ratio(0, 1, 1, 1), 4)).toEqual([]);
  });
  it('keeps references valid when slots change', () => {
    expect(mixesAfterSlotRemoved([ratio(1, 3, 1, 1)], 1)).toEqual([ratio(0, 2, 1, 1)]);
    expect(shiftIndex(4, null, 4, 1)).toBe(5);
    expect(shiftIndex(2, null, 4, 1)).toBe(2);
    expect(shiftIndex(4, 4, 5, -1)).toBe(0);
    expect(shiftIndex(5, 4, 5, -1)).toBe(4);
  });
});

describe('slicing a mixed filament on the Snapmaker U1', () => {
  const c = resolveConfig({ printerId: 'snapmaker-u1', plate: 'textured_pei_plate', filamentId: 'generic-pla', presetId: '0.20', overrides: {} as never });
  const a = slotFromConfig(c);
  const filaments = [0, 1, 2, 3].map((k) => ({ ...a, name: `PLA ${k + 1}`, color: ['#ffffff', '#cc2222', '#2222cc', '#111111'][k] }));
  const run = (m: MixedFilament) => slice([{ id: 'b', name: 'b', filament: 4, ...weld(box(100, 100, 0, 20, 20, 6)) }], c, () => {}, { filaments, mixes: [m] });

  it('swaps heads layer by layer for a 1:1 ratio', () => {
    const out = run(ratio(0, 1, 1, 1));
    const g = out.gcode;
    expect(g).toMatch(/^T1\b/m);
    expect(out.stats.perFilament[0].grams).toBeGreaterThan(0);
    expect(out.stats.perFilament[1].grams).toBeGreaterThan(0);
    expect(out.stats.perFilament[2]?.grams ?? 0).toBe(0);
    expect(out.stats.toolChanges).toBeGreaterThanOrEqual(out.stats.layerCount - 2);
    expect(out.warnings.join(' ')).not.toMatch(/Colour mixing/);
  });

  it('uses each filament in proportion for a 2:1 ratio', () => {
    const out = run(ratio(0, 2, 2, 1));
    const ga = out.stats.perFilament[0].grams, gb = out.stats.perFilament[2].grams;
    expect(ga / gb).toBeGreaterThan(1.4);
    expect(ga / gb).toBeLessThan(2.8);
  });

  it('warns on a single-nozzle printer', () => {
    const p = resolveConfig({ printerId: 'bbl-p1s', plate: 'textured_pei_plate', filamentId: 'generic-pla', presetId: '0.20', overrides: {} as never });
    const out = slice([{ id: 'b', name: 'b', filament: 2, ...weld(box(100, 100, 0, 20, 20, 3)) }], p, () => {}, { filaments: filaments.slice(0, 2), mixes: [ratio(0, 1, 1, 1)] });
    expect(out.warnings.join(' ')).toMatch(/Colour mixing changes filament on every layer/);
  });
});
