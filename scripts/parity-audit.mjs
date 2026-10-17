#!/usr/bin/env node
// Bambu Studio parameter parity audit.
//
// Reads the settings page layout from a Bambu Studio source checkout (src/slic3r/GUI/Tab.cpp:
// the Process, Filament and Printer tabs in their on-screen order) and checks every key against
// NexSpiro: is it in a NexSpiro settings schema, and does the slicing / G-code engine read it?
//
//   node scripts/parity-audit.mjs --bambu <BambuStudio checkout> [--baseline <git ref>] [--write AUDIT_REPORT.md]
//
// With --write the generated tables replace the block between the PARAMS markers in the report.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
if (!args.bambu) {
  console.error('usage: node scripts/parity-audit.mjs --bambu <BambuStudio checkout> [--baseline <git ref>] [--write AUDIT_REPORT.md]');
  process.exit(2);
}
const root = new URL('..', import.meta.url).pathname;

// ------------------------------------------------------------------ Bambu Studio layout
const tab = readFileSync(join(args.bambu, 'src/slic3r/GUI/Tab.cpp'), 'utf8').split('\n');
const fnRange = (sig) => {
  const start = tab.findIndex((l) => l.startsWith(sig));
  if (start < 0) return [];
  let end = tab.findIndex((l, i) => i > start && /^(void|bool|std::|wxSizer|int|static|PageShp) /.test(l));
  return tab.slice(start, end < 0 ? undefined : end);
};
function layout(lines, tabName) {
  const rows = [];
  let page = '', group = '';
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith('//')) continue;
    let m;
    if ((m = /add_options_page\(L\("([^"]+)"\)/.exec(l))) { page = m[1]; continue; }
    if ((m = /new_optgroup\(L\("([^"]+)"\)/.exec(l))) { group = m[1]; continue; }
    for (const mm of l.matchAll(/(?:append_single_option_line|get_option)\("([a-zA-Z0-9_]+)"/g)) {
      if (!rows.some((r) => r.key === mm[1])) rows.push({ tab: tabName, page, group, key: mm[1] });
    }
  }
  return rows;
}
const extruderStart = tab.findIndex((l) => l.includes('optgroup->append_single_option_line("extruder_type"'));
const extruderLines = extruderStart > 0 ? tab.slice(extruderStart - 4, extruderStart + 160) : [];
const bambu = [
  ...layout(fnRange('void TabPrint::build()'), 'Process'),
  ...layout(fnRange('void TabFilament::build()'), 'Filament'),
  ...layout(fnRange('void TabPrinter::build_fff()'), 'Printer'),
  ...layout(extruderLines, 'Printer').map((r) => ({ ...r, page: r.page || 'Extruder' })),
];
// labels from PrintConfig.cpp
const pc = readFileSync(join(args.bambu, 'src/libslic3r/PrintConfig.cpp'), 'utf8');
const labels = {};
for (const part of pc.split(/\n\s*def\s*=\s*this->add(?:_nullable)?\(/).slice(1)) {
  const k = /^\s*"([a-zA-Z0-9_]+)"/.exec(part)?.[1];
  const lab = /def->(?:full_label|label)\s*=\s*L\("((?:[^"\\]|\\.)*)"\)/.exec(part)?.[1];
  if (k && lab && !labels[k]) labels[k] = lab;
}

// ------------------------------------------------------------------ NexSpiro sources (working tree or a git ref)
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [relative(root, p)] : [];
});
function sources(ref) {
  if (!ref) {
    const read = (p) => readFileSync(join(root, p), 'utf8');
    return { files: walk(join(root, 'src')), read };
  }
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'src'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => /\.tsx?$/.test(f));
  const read = (p) => execFileSync('git', ['show', `${ref}:${p}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  return { files, read };
}

// Keys NexSpiro stores under another name, or as part of its printer/filament profile records.
// read indirectly: plate temps via PLATE_TEMP_KEYS in resolve.ts; notes/vendor are metadata Bambu does not slice with either
const INDIRECT = new Set(['cool_plate_temp', 'eng_plate_temp', 'hot_plate_temp', 'textured_plate_temp',
  'cool_plate_temp_initial_layer', 'eng_plate_temp_initial_layer', 'hot_plate_temp_initial_layer', 'textured_plate_temp_initial_layer',
  'process_notes', 'filament_notes', 'printer_notes', 'filament_vendor',
  // read when exporting (src/state/printjob.ts)
  'filename_format', 'post_process']);
const ALIASES = {
  exclude_object: 'label_objects',
  reduce_infill_retraction_mode: 'reduce_infill_retraction',
  printable_height: 'bed_z',
  bed_exclude_area: 'excludedAreas',
  nozzle_diameter: 'nozzle_diameter',
  cool_plate_temp: 'bed_temperature', eng_plate_temp: 'bed_temperature', hot_plate_temp: 'bed_temperature', textured_plate_temp: 'bed_temperature',
  cool_plate_temp_initial_layer: 'bed_temperature_initial_layer', eng_plate_temp_initial_layer: 'bed_temperature_initial_layer',
  hot_plate_temp_initial_layer: 'bed_temperature_initial_layer', textured_plate_temp_initial_layer: 'bed_temperature_initial_layer',
};
// Bambu settings that only exist for Bambu-specific hardware or services NexSpiro does not drive.
const NOT_APPLICABLE = {
  enable_mixed_color_sublayer: 'H2D mixed-colour sub-layers', enable_wrapping_detection: 'H2D nozzle clumping probe', wrapping_detection_gcode: 'H2D nozzle clumping probe',
  scan_first_layer: 'X1 lidar', printer_structure: 'Bambu device database', machine_switch_extruder_time: 'H2D dual nozzle', machine_hotend_change_time: 'H2C hot-end changer',
  extruder_type: 'H2D dual nozzle', nozzle_volume: 'H2D dual nozzle', extruder_printable_height: 'H2D dual nozzle', impact_strength_z: 'Bambu filament database',
  required_nozzle_HRC: 'Bambu filament database', filament_adhesiveness_category: 'H2D prime tower tuning', filament_metal_stickiness: 'Bambu filament database',
  filament_velocity_adaptation_factor: 'Bambu adaptive volumetric speed model', filament_adaptive_volumetric_speed: 'Bambu adaptive volumetric speed model',
  filament_cooling_before_tower: 'H2D prime tower tuning', filament_tower_interface_pre_extrusion_dist: 'H2D prime tower tuning', filament_tower_interface_pre_extrusion_length: 'H2D prime tower tuning',
  filament_tower_ironing_area: 'H2D prime tower tuning', filament_tower_interface_purge_volume: 'H2D prime tower tuning', filament_tower_interface_print_temp: 'H2D prime tower tuning',
  enable_tower_interface_features: 'H2D prime tower tuning', filament_prime_volume_nc: 'H2D dual nozzle', filament_change_length_nc: 'H2D dual nozzle',
  filament_ramming_travel_time: 'H2D dual nozzle', filament_ramming_travel_time_nc: 'H2D dual nozzle', filament_pre_cooling_temperature: 'H2D dual nozzle',
  filament_pre_cooling_temperature_nc: 'H2D dual nozzle', filament_ramming_volumetric_speed: 'H2D dual nozzle', filament_ramming_volumetric_speed_nc: 'H2D dual nozzle',
  long_retractions_when_ec: 'H2D dual nozzle', retraction_distances_when_ec: 'H2D dual nozzle', filament_flush_temp_fast: 'H2D dual nozzle',
  supertack_plate_temp: 'Bambu SuperTack plate', supertack_plate_temp_initial_layer: 'Bambu SuperTack plate', activate_air_filtration: 'X1/P1 exhaust fan',
  during_print_exhaust_fan_speed: 'X1/P1 exhaust fan', complete_print_exhaust_fan_speed: 'X1/P1 exhaust fan', support_air_filtration: 'X1/P1 exhaust fan',
  cooling_filter_enabled: 'H2 cooling filter', fan_direction: 'H2 fan duct', conformal_infill: 'Bambu beta infill', conformal_stagger: 'Bambu beta infill',
  conformal_link_keep_layers: 'Bambu beta infill', conformal_link_flip_layers: 'Bambu beta infill', conformal_pole: 'Bambu beta infill', conformal_ray_count: 'Bambu beta infill',
  conformal_hub_radius: 'Bambu beta infill', locked_skin_infill_pattern: 'Bambu Locked Zag infill', skin_infill_density: 'Bambu Locked Zag infill',
  locked_skeleton_infill_pattern: 'Bambu Locked Zag infill', skeleton_infill_density: 'Bambu Locked Zag infill', infill_lock_depth: 'Bambu Locked Zag infill',
  skin_infill_depth: 'Bambu Locked Zag infill', skin_infill_line_width: 'Bambu Locked Zag infill', skeleton_infill_line_width: 'Bambu Locked Zag infill',
  enable_order_independent_overlap_carving: 'Bambu multi-part carving', interlocking_beam: 'Bambu multi-material interlocking', interlocking_beam_width: 'Bambu multi-material interlocking',
  interlocking_orientation: 'Bambu multi-material interlocking', interlocking_beam_layer_count: 'Bambu multi-material interlocking', interlocking_depth: 'Bambu multi-material interlocking',
  interlocking_boundary_avoidance: 'Bambu multi-material interlocking', mmu_segmented_region_interlocking_depth: 'Bambu multi-material interlocking',
  prime_tower_skip_points: 'H2D prime tower tuning', wipe_tower_no_sparse_layers: 'H2D prime tower tuning', prime_tower_enable_framework: 'H2D prime tower tuning',
  smooth_speed_discontinuity_area: 'Bambu speed smoothing (H2D)', smooth_coefficient: 'Bambu speed smoothing (H2D)', z_direction_outwall_speed_continuous: 'Bambu speed smoothing (H2D)',
  avoid_crossing_wall_includes_support: 'Bambu travel planner detail', enable_circle_compensation: 'Bambu hole calibration', circle_compensation_manual_offset: 'Bambu hole calibration',
  filament_shrink: 'Bambu shrinkage compensation', temperature_vitrification: 'Bambu filament database', filament_printable: 'Bambu filament database',
  pre_start_fan_time: 'Bambu fan pre-spin', cooling_slowdown_logic: 'Bambu cooling heuristics', cooling_perimeter_transition_distance: 'Bambu cooling heuristics',
  overhang_threshold_participating_cooling: 'Bambu cooling heuristics', thumbnail_size: 'fixed thumbnail sizes', bed_temperature_formula: 'H2D heated bed zones',
  best_object_pos: 'H2D dual nozzle', machine_load_filament_time: 'AMS timing table', machine_unload_filament_time: 'AMS timing table',
  support_chamber_temp_control: 'X1E/H2 chamber heater', top_color_penetration_layers: 'Bambu colour painting depth', bottom_color_penetration_layers: 'Bambu colour painting depth',
  print_in_clockwise: 'H2 kinematics option', use_firmware_retraction: 'Bambu firmware', fill_multiline: 'Bambu beta infill', sparse_infill_lattice_angle_1: 'Bambu beta infill',
  sparse_infill_lattice_angle_2: 'Bambu beta infill', symmetric_infill_y_axis: 'Bambu beta infill', infill_shift_step: 'Bambu beta infill', infill_rotate_step: 'Bambu beta infill',
  embedding_wall_into_infill: 'Bambu beta walls', filament_flush_temp: 'H2D flush temperature', filament_flush_volumetric_speed: 'H2D flush speed',
  extruder_clearance_dist_to_rod: 'X1/P1 gantry rod (covered by height to rod)', role_base_wipe_speed: 'Bambu wipe planner detail', template_custom_gcode: 'Bambu G-code template',
  long_retractions_when_cut: 'Bambu filament cutter', retraction_distances_when_cut: 'Bambu filament cutter', filament_change_length: 'multi-extruder change length', extruder_offset: 'single-nozzle printers', extruder_printable_area: 'multi-extruder printers', counterbore_hole_bridging: 'Bambu counterbore bridging', default_filament_colour: 'filament colour is chosen per slot',
};

function analyse(src) {
  const files = src.files;
  const text = Object.fromEntries(files.map((f) => [f, src.read(f)]));
  const schemaFiles = files.filter((f) => f.startsWith('src/profiles/'));
  const defined = new Set();
  for (const f of schemaFiles) for (const m of text[f].matchAll(/\bkey:\s*'([a-z0-9_]+)'/g)) defined.add(m[1]);
  for (const f of schemaFiles) for (const m of text[f].matchAll(/[{,\s]([a-z][a-z0-9_]+):\s/g)) defined.add(m[1]);
  const engine = files.filter((f) => f.startsWith('src/engine/') || f === 'src/profiles/resolve.ts' || f === 'src/state/slicing.ts').map((f) => text[f]).join('\n');
  const used = (k) => engine.includes(`'${k}'`) || engine.includes(`"${k}"`) || new RegExp(`\\b${k}\\b`).test(engine.replace(/\/\/.*$/gm, ''));
  return (key) => {
    if (NOT_APPLICABLE[key]) return { status: 'N/A', note: NOT_APPLICABLE[key] };
    const k = defined.has(key) ? key : (ALIASES[key] ?? key);
    if (!defined.has(k) && !(k === 'excludedAreas' && Object.values(text).some((t) => t.includes('excludedAreas')))) return { status: 'MISSING' };
    return used(k) || INDIRECT.has(k) || k === 'excludedAreas' ? { status: 'COMPLETE' } : { status: 'PARTIAL', note: 'in the UI, not read by the engine' };
  };
}

const now = analyse(sources());
const before = args.baseline ? analyse(sources(args.baseline)) : null;
const badge = (s) => (s.status === 'COMPLETE' ? '[COMPLETE]' : s.status === 'PARTIAL' ? '[PARTIAL / STUBBED]' : s.status === 'MISSING' ? '[MISSING]' : '[N/A]');

const out = [];
const count = (fn) => {
  const c = { COMPLETE: 0, PARTIAL: 0, MISSING: 0, 'N/A': 0 };
  for (const r of bambu) c[fn(r.key).status]++;
  return c;
};
const cNow = count(now);
out.push(`Generated by \`node scripts/parity-audit.mjs --bambu <BambuStudio checkout>${args.baseline ? ` --baseline ${args.baseline}` : ''}\` from Bambu Studio's \`Tab.cpp\` page layout (${bambu.length} settings).`);
out.push('');
if (before) {
  const cB = count(before);
  out.push('| | Complete | Partial | Missing | N/A |');
  out.push('|---|---:|---:|---:|---:|');
  out.push(`| Baseline (\`${args.baseline}\`) | ${cB.COMPLETE} | ${cB.PARTIAL} | ${cB.MISSING} | ${cB['N/A']} |`);
  out.push(`| This branch | ${cNow.COMPLETE} | ${cNow.PARTIAL} | ${cNow.MISSING} | ${cNow['N/A']} |`);
} else {
  out.push(`Complete ${cNow.COMPLETE} · Partial ${cNow.PARTIAL} · Missing ${cNow.MISSING} · N/A ${cNow['N/A']}`);
}
out.push('');
let lastHead = '';
for (const r of bambu) {
  const head = `${r.tab} › ${r.page}`;
  if (head !== lastHead) {
    out.push('', `#### ${head}`, '', before ? '| Group | Bambu key | Label | Baseline | Now | Note |' : '| Group | Bambu key | Label | Status | Note |', before ? '|---|---|---|---|---|---|' : '|---|---|---|---|---|');
    lastHead = head;
  }
  const s = now(r.key);
  const note = s.note ?? (ALIASES[r.key] && ALIASES[r.key] !== r.key ? `as \`${ALIASES[r.key]}\`` : '');
  const cells = [r.group, `\`${r.key}\``, labels[r.key] ?? '', ...(before ? [badge(before(r.key))] : []), badge(s), note];
  out.push(`| ${cells.join(' | ')} |`);
}
const table = out.join('\n');

if (args.write) {
  const file = join(root, args.write);
  const doc = readFileSync(file, 'utf8');
  const a = doc.indexOf('<!-- PARAMS:BEGIN -->'), b = doc.indexOf('<!-- PARAMS:END -->');
  if (a < 0 || b < 0) throw new Error(`${args.write} has no PARAMS markers`);
  writeFileSync(file, `${doc.slice(0, a)}<!-- PARAMS:BEGIN -->\n${table}\n${doc.slice(b)}`);
  console.log(`wrote ${bambu.length} settings to ${args.write}`);
} else {
  console.log(table);
}
