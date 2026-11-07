import { it } from 'vitest';
import { weld } from '../src/engine/mesh';
import { slice } from '../src/engine/slicer';
import { resolveConfig } from '../src/profiles/resolve';
import { tee } from './fixtures';
const cfgFor = (printerId: string, overrides = {}, machine = {}, fil = {}) =>
  resolveConfig({ printerId, plate: 'textured_pei_plate', filamentId: 'generic-pla', presetId: '0.20', overrides, machineOverrides: machine, filamentOverrides: fil });
it('dbg', () => {
  process.env.DBGU = '1';
  const g = slice([{ id: 'a', name: 'a', ...weld(tee(100, 100)) }], cfgFor('bbl-p1s', { seam_slope_type: 'external', override_filament_scarf_seam_setting: true, seam_slope_conditional: false, enable_arc_fitting: false, scarf_overhang_threshold: 50 })).gcode;
  const L = g.split(';LAYER_CHANGE')[51].split('\n');
  let t = ''; for (const l of L) { if (l.startsWith(';TYPE')) t = l; if (/Z10\.1|Z10\.0/.test(l)) console.log('LOWZ', t, l); }
});
