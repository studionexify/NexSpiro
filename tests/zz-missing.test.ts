import { it } from 'vitest';
import { renderVendor } from '../src/engine/templateVars';
import { resolveConfig, machineConfig } from '../src/profiles/resolve';
import { slotFromConfig } from '../src/engine/slicer';
import { PRINTERS } from '../src/profiles/printers';
it('missing', () => {
  const miss = new Map<string, Set<string>>();
  for (const p of PRINTERS) {
    const m = machineConfig(p.id);
    if (m.gcode_templates !== 'vendor') continue;
    const c = resolveConfig({ printerId: p.id, plate: p.plates[0].type, filamentId: 'generic-pla', presetId: '0.20', overrides: {} as never });
    const a = slotFromConfig(c);
    for (const k of Object.keys(m).filter((k) => k.endsWith('_gcode'))) {
      const extra: Record<string, any> = { layer_num: 1, layer_z: 0.4, max_layer_z: 0.4, total_layer_count: 10, initial_extruder: 0, initial_tool: 0, next_extruder: 1, previous_extruder: 0, toolchange_z: 1, flush_length: 10, flush_length_1: 5, flush_length_2: 5, flush_length_3: 0, flush_length_4: 0, new_filament_temp: 220, old_filament_temp: 220, first_layer_print_min: [0, 0], first_layer_print_max: [10, 10], first_layer_print_size: [10,10], first_layer_center_no_wipe_tower: [5,5], initial_layer_print_height: 0.2, has_wipe_tower: false, in_head_wrap_detect_zone: false };
      for (let n = 0; n < 60; n++) {
        try { renderVendor(String(m[k]), c, [a, { ...a }], extra, k); break; } catch (e) {
          const mm = /unknown variable "([^"]+)"/.exec((e as Error).message);
          if (!mm) { console.log('ERR', p.id, k, (e as Error).message); break; }
          extra[mm[1]] = 0; (miss.get(mm[1]) ?? miss.set(mm[1], new Set()).get(mm[1])!).add(`${p.id}:${k}`);
        }
      }
    }
  }
  for (const [k, v] of miss) console.log('MISS', k, [...v].join(' '));
});
