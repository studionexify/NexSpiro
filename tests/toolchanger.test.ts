// Tool changers (one nozzle per filament): head swaps instead of filament swaps, parked heads at standby
// and preheated before their pick-up, no purge. Checked with a two-colour weave, the hardest case (a
// change every layer).
import { describe, expect, it } from 'vitest';
import { slice, slotFromConfig } from '../src/engine/slicer';
import { weld } from '../src/engine/mesh';
import { resolveConfig } from '../src/profiles/resolve';
import { printerById, PRINTERS } from '../src/profiles/printers';
import { changerOf, toolheadCount, autoChanges } from '../src/profiles/changer';
import { cylinder } from './fixtures';
import { defaultToolhead } from '../src/plugins/motionex/core/toolhead';
import { DEFAULT_OPTIONS } from '../src/plugins/motionex/modifier';
import type { MotionexConfig, MotionexReport } from '../src/plugins/motionex/engine';
import { defaultWeave, type WeaveSettings } from '../src/plugins/motionex/weave/model';
import { motifImage } from '../src/plugins/motionex/weave/motifs';
import { weavePrintSettings } from '../src/plugins/motionex/weave/plan';

const cfg = (printerId: string, o: Record<string, unknown> = {}) => resolveConfig({ printerId, plate: 'textured_pei_plate', filamentId: 'generic-pla', presetId: '0.20', overrides: o as never });
const weave = (w: Partial<WeaveSettings> = {}): WeaveSettings => ({ ...defaultWeave(), enabled: true, image: motifImage('checker', 32, 12, 2), z_start: 1.2, ...w });
const mx = (w: WeaveSettings, printerId: string): MotionexConfig => ({ applications: [], brushes: [], options: DEFAULT_OPTIONS, collisionMode: 'clamp', toolhead: defaultToolhead(printerId), printerId, weave: w });

function run(printerId: string, n = 2, w = weave(), o: Record<string, unknown> = {}) {
  const c = cfg(printerId, { ...weavePrintSettings(w), ...o });
  const a = slotFromConfig(c);
  const filaments = Array.from({ length: n }, (_, k) => ({ ...a, name: `PLA ${k + 1}`, color: ['#ffffff', '#cc2222', '#111111'][k], nozzleTemp: 215 + k * 5 }));
  const out = slice([{ id: 'v', name: 'v', ...weld(cylinder(128, 128, 18, 8, 96)) }], c, () => {}, { filaments, plugins: { motionex: mx(w, printerId) } });
  return { out, c, rep: (out.pluginReports!.motionex as MotionexReport).weave! };
}

describe('filament changers', () => {
  it('tells the kinds apart', () => {
    expect(changerOf(printerById('bbl-p1s').machine)).toBe('ams');
    expect(changerOf(printerById('creality-ender3v2').machine)).toBe('manual');
    expect(changerOf(printerById('snapmaker-u1').machine)).toBe('toolchanger');
    expect(toolheadCount(printerById('prusa-xl-5t').machine)).toBe(5);
    expect(toolheadCount(printerById('bbl-p1s').machine)).toBe(1);
    expect(autoChanges(printerById('generic-idex').machine)).toBe(true);
    // a printer setting overrides the profile: any printer can be set up as a tool changer
    expect(changerOf({ ...printerById('voron-24-350').machine, changer_type: 'toolchanger' })).toBe('toolchanger');
    for (const p of PRINTERS.filter((q) => changerOf(q.machine) === 'toolchanger')) expect(String(p.machine.change_filament_gcode)).toMatch(/T\[next_extruder\]/);
  });

  it('swaps heads every layer with no purge, parks at standby and preheats before the pick-up', () => {
    const { out, rep } = run('snapmaker-u1');
    expect(rep.changes).toBeGreaterThan(20);
    const g = out.gcode;
    // one head swap per colour change
    const picks = [...g.matchAll(/^T([01]) ; park the head in use/gm)];
    expect(picks.length).toBe(rep.wovenLayers - 1);
    expect(out.stats.toolChanges).toBe(picks.length);
    // the parked head waits 40 °C below its print temperature
    expect(g).toMatch(/^M104 T0 S175 ; park T0 at standby/m);
    expect(g).toMatch(/^M104 T1 S180 ; park T1 at standby/m);
    // and is heated back before it is needed: after its park, before its pick-up
    const lines = g.split('\n');
    let checked = 0;
    lines.forEach((l, k) => {
      const m = /^T(\d) ; park/.exec(l);
      if (!m || checked > 10) return;
      const t = m[1];
      const park = lines.slice(0, k).map((q, i) => (q.startsWith(`M104 T${t} S`) && q.includes('standby') ? i : -1)).filter((i) => i >= 0).pop();
      if (park === undefined) return;
      const pre = lines.slice(park, k).findIndex((q) => q.startsWith(`M104 T${t} S${t === '0' ? 215 : 220} ; preheat`));
      expect(pre, `pick-up at line ${k}`).toBeGreaterThan(0);
      checked++;
    });
    expect(checked).toBeGreaterThan(5);
    // a head swap takes seconds, not a minute: the whole print is far shorter than on an AMS printer
    const ams = run('bbl-p1s');
    expect(out.stats.timeSeconds).toBeLessThan(ams.out.stats.timeSeconds * 0.6);
    expect(g).not.toMatch(/NaN|Infinity|\[next_extruder\]|\[flush_length\]/);
  });

  it('warns when a colour needs a head the printer does not have', () => {
    const { out } = run('generic-idex', 3, weave({ slots: [0, 2] }));
    expect(out.warnings.some((w) => /need 3 heads, the tool changer has 2/.test(w))).toBe(true);
  });
});
