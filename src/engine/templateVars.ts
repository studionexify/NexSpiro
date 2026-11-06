// Variables for vendor G-code templates (placeholder.ts), with the names and types Bambu Studio / OrcaSlicer /
// Snapmaker Orca give them (GCode.cpp: start, layer change, filament change, end). Only printers whose profile
// carries the maker's own templates (gcode_templates = 'vendor') use these; every other printer keeps
// expandMacro.
import type { Config } from '../profiles/settings';
import type { FilamentSlot } from './types';
import { renderTemplate, unescapeCStyle, type PPValue } from './placeholder';

export const usesVendorTemplates = (cfg: Config) => cfg.gcode_templates === 'vendor';

/** Bed type names as the slicers' curr_bed_type enum spells them. */
const BED_NAMES: Record<string, string> = {
  cool_plate: 'Cool Plate', engineering_plate: 'Engineering Plate', high_temp_plate: 'High Temp Plate', textured_pei_plate: 'Textured PEI Plate',
  supertack_plate: 'Supertack Plate', textured_cool_plate: 'Textured Cool Plate',
};

/** Integer-typed template variables (the rest of the numbers are doubles). */
const INTS = new Set([
  'layer_num', 'total_layer_count', 'initial_extruder', 'initial_tool', 'initial_no_support_extruder', 'initial_no_support_tool', 'current_extruder',
  'next_extruder', 'previous_extruder', 'toolchange_count', 'total_toolchanges', 'old_filament_temp', 'new_filament_temp',
  'bed_temperature_initial_layer_single', 'max_print_height', 'max_print_z', 'nozzle_temperature', 'nozzle_temperature_initial_layer', 'temperature',
  'first_layer_temperature', 'bed_temperature', 'bed_temperature_initial_layer', 'first_layer_bed_temperature', 'flush_temperatures',
  'timelapse_type', 'chamber_cooling_mode', 'chamber_temperature', 'overall_chamber_temperature', 'current_object_idx', 'fan_speed',
]);

export interface TemplateExtra {
  [k: string]: PPValue | undefined;
}

/** The variables every template sees: the config, per-filament vectors and the printer's bed. */
export function baseTemplateVars(cfg: Config, filaments: FilamentSlot[]): Record<string, PPValue> {
  const v: Record<string, PPValue> = {};
  for (const [k, x] of Object.entries(cfg)) if (typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') v[k] = x;
  const fils = filaments.length ? filaments : [];
  const per = <T extends PPValue>(f: (s: FilamentSlot, k: number) => T, fallback: T): T[] => (fils.length ? fils.map(f) : [fallback]);
  const fset = (s: FilamentSlot, k: string) => s.settings?.[k];
  const bed = Math.round(Number(cfg.bed_temperature ?? 0)), bed0 = Math.round(Number(cfg.bed_temperature_initial_layer ?? bed));
  Object.assign(v, {
    printer_model: String(cfg.printer_model ?? ''),
    print_sequence: cfg.print_sequence === 'by_object' ? 'by object' : 'by layer',
    timelapse_type: cfg.timelapse_type === 'smooth' ? 1 : 0,
    curr_bed_type: BED_NAMES[String(cfg.curr_bed_type)] ?? String(cfg.curr_bed_type ?? ''),
    spiral_mode: cfg.spiral_mode === true,
    nozzle_diameter: per(() => Number(cfg.nozzle_diameter), Number(cfg.nozzle_diameter)),
    max_print_height: Math.floor(Number(cfg.printable_height ?? cfg.bed_z ?? 0)),
    printable_height: Number(cfg.printable_height ?? cfg.bed_z ?? 0),
    z_offset: 0,
    print_bed_min: [0, 0], print_bed_max: [Number(cfg.bed_x), Number(cfg.bed_y)], print_bed_size: [Number(cfg.bed_x), Number(cfg.bed_y)],
    filament_type: per((s) => String(fset(s, 'filament_type') ?? s.type), String(cfg.filament_type ?? 'PLA')),
    nozzle_temperature: per((s) => Math.round(s.nozzleTemp), Math.round(Number(cfg.nozzle_temperature ?? 0))),
    temperature: per((s) => Math.round(s.nozzleTemp), Math.round(Number(cfg.nozzle_temperature ?? 0))),
    nozzle_temperature_initial_layer: per((s) => Math.round(s.nozzleTempInitial), Math.round(Number(cfg.nozzle_temperature_initial_layer ?? 0))),
    first_layer_temperature: per((s) => Math.round(s.nozzleTempInitial), Math.round(Number(cfg.nozzle_temperature_initial_layer ?? 0))),
    bed_temperature: per(() => bed, bed),
    bed_temperature_initial_layer: per(() => bed0, bed0),
    first_layer_bed_temperature: per(() => bed0, bed0),
    bed_temperature_initial_layer_single: bed0,
    // Bambu: flush at the filament's flush temperature (else the top of its nozzle range), at its flush (else max) flow
    flush_temperatures: per((s) => Math.round(Number(fset(s, 'filament_flush_temp') || fset(s, 'nozzle_temperature_range_high') || s.nozzleTemp)), Math.round(Number(cfg.nozzle_temperature ?? 0))),
    flush_volumetric_speeds: per((s) => Number(fset(s, 'filament_flush_volumetric_speed') || s.maxVolumetricSpeed), Number(cfg.filament_max_volumetric_speed ?? 12)),
    filament_max_volumetric_speed: per((s) => s.maxVolumetricSpeed, Number(cfg.filament_max_volumetric_speed ?? 12)),
    long_retractions_when_cut: per((s) => fset(s, 'long_retractions_when_cut') === true, false),
    retraction_distances_when_cut: per((s) => Number(fset(s, 'retraction_distances_when_cut') ?? 18), 18),
    chamber_cooling_mode: Number(cfg.chamber_cooling_mode ?? 1),
    chamber_temperature: [Math.round(Number(cfg.chamber_temperature ?? 0))],
    overall_chamber_temperature: Math.round(Number(cfg.chamber_temperature ?? 0)),
    initial_extruder: 0, initial_tool: 0, initial_no_support_extruder: 0, initial_no_support_tool: 0, current_extruder: 0,
    layer_num: 0, layer_z: 0, max_layer_z: 0, total_layer_count: 0, toolchange_count: 0, total_toolchanges: 0, current_object_idx: 0,
    has_wipe_tower: false, in_head_wrap_detect_zone: false, position: [0, 0, 0], fan_speed: 0,
  });
  // outer wall volumetric speed of a filament (Bambu: the outer wall's flow, capped by the filament)
  const h = Number(cfg.layer_height) || 0.2, w = Number(cfg.outer_wall_line_width) || Number(cfg.nozzle_diameter) || 0.4;
  v.outer_wall_volumetric_speed = Math.min(Number(cfg.outer_wall_speed) * w * h || 12, fils[0]?.maxVolumetricSpeed ?? 1e9);
  return v;
}

/** Expands a vendor template (unescaped as the slicers do when they load a profile). */
export function renderVendor(tpl: string, cfg: Config, filaments: FilamentSlot[], extra: TemplateExtra = {}, what = 'G-code template'): string {
  if (!tpl) return '';
  const vars: Record<string, PPValue | undefined> = { ...baseTemplateVars(cfg, filaments) };
  for (const [k, x] of Object.entries(extra)) if (x !== undefined) vars[k] = x;
  try {
    return renderTemplate(unescapeCStyle(tpl), { vars, ints: INTS });
  } catch (e) {
    throw new Error(`${what}: ${(e as Error).message}`);
  }
}

/** Purge split into up to 4 steps of about 135 mm³ (Bambu Studio GCode.cpp: g_purge_volume_one_time, g_max_flush_count). */
export function flushSplit(flushVolume: number, filamentArea: number): Record<string, number> {
  const len = flushVolume / filamentArea;
  let count = Math.min(4, Math.round(flushVolume / 135));
  if (count === 0 && flushVolume > 0) count = 1;
  const out: Record<string, number> = { flush_length: len };
  for (let k = 0; k < 4; k++) out[`flush_length_${k + 1}`] = k < count ? len / count : 0;
  return out;
}

/** Point-in-polygon for the A1's head wrap detect zone ("226x224" style points). */
export function inZone(zone: unknown, box: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  if (!Array.isArray(zone) || zone.length < 3) return false;
  const pts = zone.map((p) => String(p).split('x').map(Number));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  // the zones are axis-aligned rectangles: overlap of two boxes
  return box.maxX >= Math.min(...xs) && box.minX <= Math.max(...xs) && box.maxY >= Math.min(...ys) && box.minY <= Math.max(...ys);
}
