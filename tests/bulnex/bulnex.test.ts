import { describe, expect, it } from 'vitest';
import { weld } from '../../src/engine/mesh';
import { slice } from '../../src/engine/slicer';
import { resolveConfig } from '../../src/profiles/resolve';
import type { MeshInput } from '../../src/engine/types';
import { DEFAULT_BULNEX, checkParts, planRow, pushZFor, type PartGeometry } from '../../src/plugins/bulnex/model';
import { box } from '../fixtures';

const cfgFor = (filamentId = 'generic-pla') => resolveConfig({ printerId: 'bbl-a1', plate: 'textured_pei_plate', filamentId, presetId: '0.20', overrides: {} });
const mesh = (soup: Float32Array, name = 'part'): MeshInput => { const m = weld(soup); return { id: name, name, vertices: m.vertices, indices: m.indices }; };
const part = (o: Partial<PartGeometry> = {}): PartGeometry => ({ name: 'part', minX: 120, maxX: 136, minY: 20, maxY: 36, height: 20, contactArea: 256, hitAtPush: true, widthAtPush: 16, ...o });

describe('bulnex model', () => {
  it('clamps the push height', () => {
    expect(pushZFor(20, 0.3)).toBeCloseTo(6);
    expect(pushZFor(4, 0.3)).toBe(2);
    expect(pushZFor(2.5, 0.9)).toBe(2);
  });
  it('plans one row behind the last part', () => {
    const r = planRow([part(), part({ minY: 40, maxY: 56 })], DEFAULT_BULNEX)!;
    expect(r.x).toBeCloseTo(128);
    expect(r.startY).toBeCloseTo(64);
    expect(r.parts).toBe(2);
  });
  it('warns (but does not block) on short, wide and off-row parts', () => {
    const ok = checkParts([part()], DEFAULT_BULNEX, 'PLA', 256);
    expect(ok.every((c) => c.level === 'ok')).toBe(true);
    const w = checkParts([part({ height: 4, contactArea: 5000 }), part({ name: 'part (2)', minX: 10, maxX: 26, minY: 40, maxY: 56 })], DEFAULT_BULNEX, 'PETG', 256).map((c) => c.text).join('\n');
    expect(w).toMatch(/below the 8 mm minimum/);
    expect(w).toMatch(/above the 1000 mm² limit for PETG/);
    expect(w).toMatch(/not in line/);
    expect(checkParts([part()], DEFAULT_BULNEX, 'TPU', 256)[0].text).toMatch(/not supported/);
  });
});

describe('bulnex g-code', () => {
  it('repeats the print N times with an eject between cycles and homing only once', () => {
    const cfg = { ...DEFAULT_BULNEX, cycles: 3, passes: 2, coolWaitMin: 2 };
    const out = slice([mesh(box(120, 20, 0, 16, 16, 12))], cfgFor(), () => {}, { plugins: { bulnex: cfg } });
    const g = out.gcode;
    expect(g.match(/^G28/gm)?.length).toBe(1);
    expect(g.match(/^G29/gm)?.length).toBe(1);
    expect(g.match(/BULNEX eject/g)?.length).toBe(3);
    expect(g.match(/^;LAYER_CHANGE/gm)?.length).toBe(out.stats.layerCount * 3);
    expect(g.match(/^; push \d of 2/gm)?.length).toBe(6);
    expect(g.match(/^M190 S/gm)!.length).toBe(1 + 2); // start + two re-heats (none after the last cycle)
    expect(g).toMatch(/M17 X0\.33 Y0\.6 Z0\.6/);
    expect(g).toMatch(/G1 Z3\.6 F600/); // 30 % of 12 mm
    expect(g.match(/^G4 S60/gm)?.length).toBe(6);
    const rep = out.pluginReports?.bulnex as any;
    expect(rep.row.parts).toBe(1);
    expect(rep.checks[0].level).toBe('ok');
    // the eject comes before the end G-code
    expect(g.lastIndexOf('all cycles done')).toBeLessThan(g.indexOf('NexSpiro end G-code'));
  });
  it('flags a ring the nozzle would pass through', () => {
    // two separate walls with a gap on the push line
    const a = box(110, 20, 0, 6, 16, 12), b = box(130, 20, 0, 6, 16, 12);
    const soup = new Float32Array(a.length + b.length); soup.set(a); soup.set(b, a.length);
    const out = slice([mesh(soup)], cfgFor(), () => {}, { plugins: { bulnex: DEFAULT_BULNEX } });
    expect(out.warnings.join('\n')).toMatch(/nozzle would pass through/);
  });
});

describe('bulnex calibration', () => {
  it('pushes each ladder block on its own, smallest first, with a pause after each', async () => {
    const { CALIBRATION_BLOCKS, CALIBRATION_FRONT_Y } = await import('../../src/plugins/bulnex/model');
    const blocks = CALIBRATION_BLOCKS.map((b) => mesh(box(b.x - b.side / 2, CALIBRATION_FRONT_Y, 0, b.side, b.side, 15), `Ladder ${b.label}`));
    const out = slice(blocks, cfgFor(), () => {}, { plugins: { bulnex: { ...DEFAULT_BULNEX, calibration: true, passes: 1 } } });
    const g = out.gcode;
    expect(g.match(/BULNEX eject/g)).toBeNull();
    const order = [...g.matchAll(/^; block \d: (Ladder \w)/gm)].map((m) => m[1]);
    expect(order).toEqual(['Ladder A', 'Ladder B', 'Ladder C', 'Ladder D', 'Ladder E']);
    expect(g.match(/^M400 U1/gm)?.length).toBe(5);
    expect(g).toMatch(/G1 X214 Y78 F6000/); // block E: centre X, 8 mm behind its back edge
    expect(g).toMatch(/G1 Z4\.5 F600/);
    expect(out.warnings.join('\n')).not.toMatch(/different designs|not in line/);
  });
});

describe('bulnex large programs', () => {
  it('writes a full row × 10 cycles without overflowing the stack', () => {
    const ms = Array.from({ length: 10 }, (_, k) => mesh(box(118, 3 + k * 23, 0, 20, 20, 15), k ? `A (${k + 1})` : 'A'));
    const out = slice(ms, cfgFor(), () => {}, { plugins: { bulnex: DEFAULT_BULNEX } });
    expect(out.gcode.match(/BULNEX eject/g)?.length).toBe(10);
    expect((out.pluginReports?.bulnex as any).row.parts).toBe(10);
    expect(out.warnings).toEqual([]);
  });
});
