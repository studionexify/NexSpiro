// Variables for vendor G-code templates (placeholder.ts), with the names and types Bambu Studio / OrcaSlicer /
// Snapmaker Orca give them (GCode.cpp: start, layer change, filament change, end). Only printers whose profile
// carries the maker's own templates (gcode_templates = 'vendor') use these; every other printer keeps
// expandMacro.
import type { Config } from '../profiles/settings';
import type { FilamentSlot } from './types';
import { renderTemplate, unescapeCStyle, type PPValue } from './placeholder';
import { VECTOR_BOOL_KEYS, VECTOR_INT_KEYS, VECTOR_KEYS } from './slicerOptionKinds';

const VECTOR_OPTS = new Set([...VECTOR_KEYS, ...VECTOR_INT_KEYS, ...VECTOR_BOOL_KEYS]);
const BOOL_OPTS = new Set(VECTOR_BOOL_KEYS);

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
  'timelapse_type', 'chamber_cooling_mode', 'temperature_vitrification', 'min_vitrification_temperature', 'initial_nozzle_id', 'current_nozzle_id',
  'next_nozzle_id', 'current_hotend', 'next_hotend', 'most_used_physical_extruder_id', 'curr_physical_extruder_id', 'current_extruder_id',
  'required_nozzle_HRC', 'num_extruders', 'num_printing_extruders', 'num_objects', 'num_instances', 'current_filament_id', 'next_filament_id', 'old_filament_e_feedrate', 'new_filament_e_feedrate', 'chamber_temperature', 'overall_chamber_temperature', 'current_object_idx', 'fan_speed',
  ...VECTOR_INT_KEYS,
]);

export interface TemplateExtra {
  [k: string]: PPValue | undefined;
}

/** The variables every template sees: the config, per-filament vectors and the printer's bed. */
export function baseTemplateVars(cfg: Config, filaments: FilamentSlot[]): Record<string, PPValue> {
  const v: Record<string, PPValue> = {};
  for (const [k, x] of Object.entries(cfg)) if (typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') v[k] = x;
  const fils = filaments.length ? filaments : [];
  // one value per extruder: as many as filaments, or heads on a tool changer (the extra heads repeat the first filament,
  // so a template that walks every head — Prusa XL — finds a value for each)
  const heads = Math.max(fils.length, Math.round(Number(cfg.toolhead_count ?? 1)) || 1, Math.round(Number(cfg.filament_slots ?? 0)) || 0);
  const per = <T extends PPValue>(f: (s: FilamentSlot, k: number) => T, fallback: T): T[] =>
    (fils.length ? Array.from({ length: heads }, (_, k) => f(fils[k] ?? fils[0], k)) : [fallback]);
  const fset = (s: FilamentSlot, k: string) => s.settings?.[k];
  // options the slicers keep per extruder / per filament are vectors there ({retraction_length[0]}): one value per
  // filament, the filament's own setting where it has one
  for (const k of Object.keys(v)) {
    if (!VECTOR_OPTS.has(k)) continue;
    const x = v[k] as number | string | boolean;
    const conv = (y: unknown): PPValue => (BOOL_OPTS.has(k) ? y === true || y === 1 || y === '1' || y === 'true' : (y as PPValue));
    v[k] = per((s) => conv(fset(s, k) ?? x), conv(x));
  }
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
    // Bambu Studio / OrcaSlicer filament-cut retraction (X1E, H2D change G-code)
    long_retraction_when_cut: per((s) => fset(s, 'long_retractions_when_cut') === true, false),
    retraction_distance_when_cut: per((s) => Number(fset(s, 'retraction_distances_when_cut') ?? 18), 18),
    // ... and when the H2D switches nozzles (not done by NexSpiro: one nozzle)
    long_retraction_when_ec: per((s) => fset(s, 'long_retractions_when_ec') === true, false),
    retraction_distance_when_ec: per((s) => Number(fset(s, 'retraction_distances_when_ec') ?? 10), 10),
    filament_cooling_before_tower: per((s) => Number(fset(s, 'filament_cooling_before_tower') ?? 0), 0),
    // hardness a filament needs from the nozzle (abrasive filaments; 0 = any), the printer's extruder count
    required_nozzle_HRC: per((s) => Math.round(Number(fset(s, 'required_nozzle_HRC') ?? 0)), 0),
    num_extruders: heads,
    // OrcaSlicer's custom G-code state (PrintConfig.cpp "placeholders"): at the start of a block nothing is hopped or
    // retracted
    zhop: 0, e_retracted: per(() => 0, 0), e_restart_extra: per(() => 0, 0), e_position: per(() => 0, 0),
    initial_filament_type: String(fils[0] ? (fset(fils[0], 'filament_type') ?? fils[0].type) : (cfg.filament_type ?? 'PLA')),
    has_single_extruder_multi_material_priming: false, num_printing_extruders: Math.max(1, fils.length),
    num_objects: 1, num_instances: 1, input_filename_base: String(cfg.input_filename_base ?? 'plate'),
    // softening temperature of each filament (OrcaSlicer default 100 °C) and the lowest one in the print (H2D, Artillery)
    temperature_vitrification: per((s) => Math.round(Number(fset(s, 'temperature_vitrification') ?? 100)), Math.round(Number(cfg.temperature_vitrification ?? 100))),
    // filaments this print uses (Prusa XL / MMU3 start G-code walks it); gcode.ts passes the real list
    is_extruder_used: per((_s, k) => k < Math.max(1, fils.length), true),
    // OrcaSlicer: the preset names ({if print_settings_id=~/.*SPEED.*/})
    print_settings_id: String(cfg.print_settings_id ?? cfg.preset_name ?? ''),
    filament_settings_id: per((s) => String(s.settings?.filament_settings_id ?? s.name ?? ''), ''),
    printer_settings_id: String(cfg.printer_settings_id ?? cfg.printer_model ?? ''),
    filament_notes: per((s) => String(fset(s, 'filament_notes') ?? ''), ''),
    printer_notes: String(cfg.printer_notes ?? ''),
    // filament weight extruded so far (Prusa MK4S before layer change); gcode.ts passes the running total
    extruded_volume_total: 0, extruded_weight_total: 0, extruded_volume: per(() => 0, 0), extruded_weight: per(() => 0, 0),
    // Bambu Studio H2D (two nozzles): NexSpiro prints with one, the left (main) nozzle, extruder 0
    nozzle_diameter_at_nozzle_id: per(() => Number(cfg.nozzle_diameter), Number(cfg.nozzle_diameter)),
    initial_nozzle_id: 0, current_nozzle_id: 0, next_nozzle_id: 0, current_hotend: 0, next_hotend: 0,
    most_used_physical_extruder_id: 0, curr_physical_extruder_id: 0, current_extruder_id: 0,
    timelapse_inline_photo: false, has_timelapse_safe_pos: false, farthest_point_timelapse_enabled: false, timelapse_pos_x: 0, timelapse_pos_y: 0, clear_to_x0: false,
  });
  v.min_vitrification_temperature = Math.min(...(v.temperature_vitrification as number[]).slice(0, Math.max(1, fils.length)));
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
  // filament change: the filaments' ids and their extrusion feedrates (OrcaSlicer: 60 × max volumetric speed / area)
  if (typeof extra.next_extruder === 'number' || typeof extra.next_extruder === 'string') {
    const next = Number(extra.next_extruder), prev = Number(extra.previous_extruder ?? next);
    const area = Math.PI * (Number(cfg.filament_diameter ?? 1.75) / 2) ** 2;
    const fr = (k: number) => Math.round((60 * Number(filaments[k]?.maxVolumetricSpeed ?? cfg.filament_max_volumetric_speed ?? 12)) / area);
    vars.next_filament_id ??= next; vars.current_filament_id ??= prev < 0 ? next : prev;
    vars.new_filament_e_feedrate ??= fr(next); vars.old_filament_e_feedrate ??= fr(prev < 0 ? next : prev);
  }
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

type MoveLike = { k: string; x?: number; y?: number; e?: number; travel?: boolean; feature?: string };
/** First layer box of the extrusions (Bambu: first_layer_print_min/max/size, first_layer_center_no_wipe_tower without the tower). */
export function firstLayerTemplateVars(ops: readonly MoveLike[] | undefined, initialLayerHeight: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, oMinX = Infinity, oMinY = Infinity, oMaxX = -Infinity, oMaxY = -Infinity;
  for (const op of ops ?? []) {
    if (op.k !== 'move' || op.travel || !((op.e ?? 0) > 0) || op.x === undefined || op.y === undefined) continue;
    minX = Math.min(minX, op.x); minY = Math.min(minY, op.y); maxX = Math.max(maxX, op.x); maxY = Math.max(maxY, op.y);
    if (op.feature !== 'prime_tower') { oMinX = Math.min(oMinX, op.x); oMinY = Math.min(oMinY, op.y); oMaxX = Math.max(oMaxX, op.x); oMaxY = Math.max(oMaxY, op.y); }
  }
  if (!isFinite(minX)) { minX = minY = maxX = maxY = 0; }
  if (!isFinite(oMinX)) { oMinX = minX; oMinY = minY; oMaxX = maxX; oMaxY = maxY; }
  return {
    vars: {
      first_layer_print_min: [minX, minY], first_layer_print_max: [maxX, maxY], first_layer_print_size: [maxX - minX, maxY - minY],
      first_layer_center_no_wipe_tower: [(oMinX + oMaxX) / 2, (oMinY + oMaxY) / 2], initial_layer_print_height: initialLayerHeight,
    },
    objects: { minX: oMinX, minY: oMinY, maxX: oMaxX, maxY: oMaxY },
  };
}

/** Point-in-polygon for the A1's head wrap detect zone ("226x224" style points). */
export function inZone(zone: unknown, box: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  if (!Array.isArray(zone) || zone.length < 3) return false;
  const pts = zone.map((p) => String(p).split('x').map(Number));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  // the zones are axis-aligned rectangles: overlap of two boxes
  return box.maxX >= Math.min(...xs) && box.minX <= Math.max(...xs) && box.maxY >= Math.min(...ys) && box.minY <= Math.max(...ys);
}
