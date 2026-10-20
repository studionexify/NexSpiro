// Printer (machine) profiles. Add printers by appending to PRINTERS — the rest of the app is data-driven.
import type { Config } from './settings';

export type GcodeFlavor = 'marlin' | 'klipper' | 'bbl';
import type { ConnectionKind } from '../connect/types';
export type { ConnectionKind };
export type PlateType = 'cool_plate' | 'engineering_plate' | 'high_temp_plate' | 'textured_pei_plate';

export interface PrinterProfile {
  id: string;
  vendor: string;
  model: string;
  nozzle: number;
  bed: { x: number; y: number; z: number };
  /** Bed areas the nozzle cannot print on (e.g. wiper/cutter zones), polygons in mm. */
  excludedAreas?: [number, number][][];
  plates: { type: PlateType; label: string }[];
  flavor: GcodeFlavor;
  connections: ConnectionKind[];
  /** printer_model_id written into .gcode.3mf slice info (A1/P1/X1/H2 printers). */
  printerModelId?: string;
  /** Camera of A1/P1/X1/H2 printers: TLS JPEG stream (A1/P1) or RTSPS (X1/H2). */
  cameraMode?: 'jpeg' | 'rtsp';
  /** Short note shown in the printer picker (firmware quirks, what to check). */
  note?: string;
  machine: Config; // printer-level settings (retraction, limits, g-code macros)
  processOverrides: Config; // speed/accel defaults tuned for this machine
}

const BBL_PLATES: PrinterProfile['plates'] = [
  { type: 'cool_plate', label: 'Cool Plate (SuperTack)' },
  { type: 'engineering_plate', label: 'Engineering Plate' },
  { type: 'high_temp_plate', label: 'Smooth PEI / High Temp Plate' },
  { type: 'textured_pei_plate', label: 'Textured PEI Plate' },
];
const PEI_PLATES: PrinterProfile['plates'] = [
  { type: 'textured_pei_plate', label: 'Textured PEI Spring Steel' },
  { type: 'high_temp_plate', label: 'Smooth PEI Spring Steel' },
];

const bblStart = (name: string, purgeY: number, purgeX0: number) => `;===== NexSpiro start G-code: ${name} =====
M104 S0 ; keep hotend cold while homing
M140 S[bed_temperature_initial_layer] ; start heating bed
G90
M83 ; relative extrusion
G28 ; home all axes
M190 S[bed_temperature_initial_layer] ; wait for bed
G29 ; auto bed levelling
M104 S[nozzle_temperature_initial_layer]
G1 X${purgeX0} Y${purgeY} Z5 F18000
M109 S[nozzle_temperature_initial_layer] ; wait for hotend
G1 Z0.3 F1200
G1 X${purgeX0 + 80} E12 F1500 ; purge line
G1 X${purgeX0 + 110} E2 F3000
G1 Z1 F1200
;===== end of start G-code =====`;

const bblChange = (chuteX: number, chuteY: number) => `; ===== NexSpiro filament change [previous_extruder] -> [next_extruder] =====
M620 S[next_extruder]A
M204 S9000
G1 Z[toolchange_z] F1200
G1 X${chuteX} Y${chuteY - 20} F21000
G1 Y${chuteY} F3000 ; over the purge chute
M400
M106 P1 S0 ; part fan off while flushing
M104 S[new_filament_temp]
T[next_extruder] ; AMS: cut, unload, load
M400
G92 E0
M109 S[new_filament_temp]
G1 E[flush_length] F240 ; flush the previous colour
M400
G1 E-0.8 F1800
G1 X${chuteX + 20} F15000 ; wipe
G1 X${chuteX} F15000
G1 X${chuteX + 20} F15000
M621 S[next_extruder]A
; ===== end filament change =====`;

const bblEnd = `;===== NexSpiro end G-code =====
G1 E-0.8 F1800 ; retract
G91
G1 Z2 F900 ; lift
G90
G1 X128 Y250 F18000 ; present the print
M140 S0 ; bed off
M104 S0 ; hotend off
M106 S0 ; part fan off
M84 ; motors off`;

const baseMachine = (o: Config): Config => ({
  retraction_length: 0.8,
  retraction_speed: 30,
  deretraction_speed: 30,
  z_hop: 0.4,
  retraction_minimum_travel: 1,
  max_speed_xy: 500,
  max_speed_z: 20,
  max_acceleration: 20000,
  layer_change_gcode: '',
  change_filament_gcode: `; ===== filament change [previous_extruder] -> [next_extruder] =====
G1 Z[toolchange_z] F1200
M600 ; swap to filament [next_extruder], then resume
; ===== end filament change =====`,
  machine_pause_gcode: 'M601',
  filament_change_time: 0,
  has_ams: false,
  ...o,
});


/** Timelapse snapshot (A1/P1/X1/H2): the printer only records when the job enabled timelapse. */
const BBL_TIMELAPSE = `; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 M971 S11 C10 O0
M623
; SKIPPABLE_END`;

/** A1/P1/X1/H2 machine values on top of the base machine (Z hop, wipe, timelapse, extruder clearance). */
const bblMachine = (o: Config, gantry: 'corexy' | 'bedslinger' = 'corexy'): Config => baseMachine({
  z_hop_types: 'auto', retract_when_changing_layer: true, wipe: true, wipe_distance: 2, retract_length_toolchange: 2,
  time_lapse_gcode: BBL_TIMELAPSE, min_layer_height: 0.08, max_layer_height: 0.28,
  ...(gantry === 'corexy'
    ? { extruder_clearance_max_radius: 68, extruder_clearance_height_to_rod: 36, extruder_clearance_height_to_lid: 90, auxiliary_fan: true }
    : { extruder_clearance_max_radius: 76, extruder_clearance_height_to_rod: 25, extruder_clearance_height_to_lid: 250, auxiliary_fan: false }),
  ...o,
});

export const PRINTERS: PrinterProfile[] = [
  {
    id: 'bbl-a1', printerModelId: 'N2S', cameraMode: 'jpeg', vendor: 'Bambu Lab', model: 'A1', nozzle: 0.4, bed: { x: 256, y: 256, z: 256 },
    plates: BBL_PLATES, flavor: 'bbl', connections: ['bbl_lan'],
    machine: bblMachine({ machine_start_gcode: bblStart('Bambu Lab A1', -0.5, 20), machine_end_gcode: bblEnd, max_acceleration: 12000, change_filament_gcode: bblChange(-38, 245), machine_pause_gcode: 'M400 U1', filament_change_time: 60, has_ams: true }, 'bedslinger'),
    processOverrides: { travel_speed: 700, default_acceleration: 10000, outer_wall_acceleration: 5000 },
  },
  {
    id: 'bbl-a1mini', printerModelId: 'N1', cameraMode: 'jpeg', vendor: 'Bambu Lab', model: 'A1 mini', nozzle: 0.4, bed: { x: 180, y: 180, z: 180 },
    plates: BBL_PLATES, flavor: 'bbl', connections: ['bbl_lan'],
    machine: bblMachine({ machine_start_gcode: bblStart('Bambu Lab A1 mini', -0.5, 10), machine_end_gcode: bblEnd.replace('X128 Y250', 'X90 Y175'), max_acceleration: 10000, change_filament_gcode: bblChange(-13, 175), machine_pause_gcode: 'M400 U1', filament_change_time: 60, has_ams: true }, 'bedslinger'),
    processOverrides: { travel_speed: 700, default_acceleration: 10000 },
  },
  {
    id: 'bbl-p1s', printerModelId: 'C12', cameraMode: 'jpeg', vendor: 'Bambu Lab', model: 'P1S', nozzle: 0.4, bed: { x: 256, y: 256, z: 256 },
    excludedAreas: [[[0, 0], [18, 0], [18, 28], [0, 28]]],
    plates: BBL_PLATES, flavor: 'bbl', connections: ['bbl_lan'],
    machine: bblMachine({ machine_start_gcode: bblStart('Bambu Lab P1S', 0.5, 20), machine_end_gcode: bblEnd, change_filament_gcode: bblChange(70, 265), machine_pause_gcode: 'M400 U1', filament_change_time: 95, has_ams: true }),
    processOverrides: {},
  },
  {
    id: 'bbl-p1p', printerModelId: 'C11', cameraMode: 'jpeg', vendor: 'Bambu Lab', model: 'P1P', nozzle: 0.4, bed: { x: 256, y: 256, z: 256 },
    excludedAreas: [[[0, 0], [18, 0], [18, 28], [0, 28]]],
    plates: BBL_PLATES, flavor: 'bbl', connections: ['bbl_lan'],
    machine: bblMachine({ machine_start_gcode: bblStart('Bambu Lab P1P', 0.5, 20), machine_end_gcode: bblEnd, change_filament_gcode: bblChange(70, 265), machine_pause_gcode: 'M400 U1', filament_change_time: 95, has_ams: true, auxiliary_fan: false }),
    processOverrides: {},
  },
  {
    id: 'bbl-x1c', printerModelId: 'BL-P001', cameraMode: 'rtsp', vendor: 'Bambu Lab', model: 'X1 Carbon', nozzle: 0.4, bed: { x: 256, y: 256, z: 256 },
    excludedAreas: [[[0, 0], [18, 0], [18, 28], [0, 28]]],
    plates: BBL_PLATES, flavor: 'bbl', connections: ['bbl_lan'],
    machine: bblMachine({ machine_start_gcode: bblStart('Bambu Lab X1 Carbon', 0.5, 20), machine_end_gcode: bblEnd, change_filament_gcode: bblChange(70, 265), machine_pause_gcode: 'M400 U1', filament_change_time: 95, has_ams: true }),
    processOverrides: {},
  },
  {
    id: 'bbl-x1e', printerModelId: 'C13', cameraMode: 'rtsp', vendor: 'Bambu Lab', model: 'X1E', nozzle: 0.4, bed: { x: 256, y: 256, z: 256 },
    excludedAreas: [[[0, 0], [18, 0], [18, 28], [0, 28]]],
    plates: BBL_PLATES, flavor: 'bbl', connections: ['bbl_lan'],
    machine: bblMachine({ machine_start_gcode: bblStart('Bambu Lab X1E', 0.5, 20), machine_end_gcode: bblEnd, change_filament_gcode: bblChange(70, 265), machine_pause_gcode: 'M400 U1', filament_change_time: 95, has_ams: true }),
    processOverrides: {},
  },
  {
    id: 'creality-ender3v3ke', vendor: 'Creality', model: 'Ender-3 V3 KE', nozzle: 0.4, bed: { x: 220, y: 220, z: 240 },
    plates: PEI_PLATES, flavor: 'klipper', connections: ['moonraker'],
    machine: baseMachine({
      machine_start_gcode: `;===== NexSpiro start G-code: Creality Ender-3 V3 KE =====
M140 S[bed_temperature_initial_layer]
M104 S[nozzle_temperature_initial_layer]
START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer]
M190 S[bed_temperature_initial_layer]
M109 S[nozzle_temperature_initial_layer]
G90
M83`,
      machine_end_gcode: 'END_PRINT',
      machine_pause_gcode: 'PAUSE',
      retraction_length: 0.8, retraction_speed: 40, deretraction_speed: 40, z_hop: 0.2,
      max_acceleration: 8000,
    }),
    processOverrides: {
      outer_wall_speed: 200, inner_wall_speed: 300, sparse_infill_speed: 270, internal_solid_infill_speed: 250, top_surface_speed: 200,
      travel_speed: 500, default_acceleration: 5000, outer_wall_acceleration: 3000, travel_acceleration: 8000, initial_layer_speed: 50,
    },
  },
  {
    id: 'elegoo-neptune4max', vendor: 'Elegoo', model: 'Neptune 4 Max', nozzle: 0.4, bed: { x: 420, y: 420, z: 480 },
    plates: PEI_PLATES, flavor: 'klipper', connections: ['moonraker'],
    machine: baseMachine({
      machine_start_gcode: `;===== NexSpiro start G-code: Elegoo Neptune 4 Max =====
G90
M83
M140 S[bed_temperature_initial_layer]
M104 S140 ; preheat nozzle below ooze temperature
G28 ; home all axes
M190 S[bed_temperature_initial_layer]
M109 S[nozzle_temperature_initial_layer]
G1 X5 Y10 Z0.3 F6000
G1 Y200 E15 F1500 ; purge line
G1 X5.4 F6000
G1 Y10 E10 F1500
G1 Z1 F600`,
      machine_end_gcode: `G1 E-1 F2400
G91
G1 Z5 F600
G90
G1 X10 Y400 F6000
M104 S0
M140 S0
M106 S0
M84`,
      retraction_length: 0.8, retraction_speed: 40, deretraction_speed: 40, z_hop: 0.2,
      max_acceleration: 5000,
      machine_pause_gcode: 'PAUSE',
    }),
    processOverrides: {
      outer_wall_speed: 150, inner_wall_speed: 200, sparse_infill_speed: 250, internal_solid_infill_speed: 200, top_surface_speed: 150,
      travel_speed: 400, default_acceleration: 5000, outer_wall_acceleration: 3000, top_surface_acceleration: 3000, travel_acceleration: 5000,
    },
  },
];


// ---------------------------------------------------------------- full catalogue (Phase 4)
const marlinStart = (name: string, purgeX = 5, purgeY0 = 20, purgeLen = 180, mesh = 'G29 ; auto bed levelling') => `;===== NexSpiro start G-code: ${name} =====
G90
M83
M140 S[bed_temperature_initial_layer]
M104 S150 ; preheat below ooze temperature
G28 ; home all axes
M190 S[bed_temperature_initial_layer]
${mesh}
M109 S[nozzle_temperature_initial_layer]
G1 Z2 F1500
G1 X${purgeX} Y${purgeY0} Z0.3 F6000
G1 Y${purgeY0 + purgeLen} E15 F1500 ; purge line
G1 X${purgeX + 0.4} F6000
G1 Y${purgeY0} E12 F1500
G1 Z1 F600`;
const marlinEnd = (x: number, y: number) => `G1 E-1 F2400
G91
G1 Z5 F600
G90
G1 X${x} Y${y} F6000 ; present the print
M104 S0
M140 S0
M106 S0
M84`;
const klipperStart = (name: string, macro: string) => `;===== NexSpiro start G-code: ${name} =====
M140 S[bed_temperature_initial_layer]
M104 S[nozzle_temperature_initial_layer]
${macro}
M190 S[bed_temperature_initial_layer]
M109 S[nozzle_temperature_initial_layer]
G90
M83`;

interface Spec {
  id: string; vendor: string; model: string; bed: [number, number, number]; flavor: GcodeFlavor;
  connections: ConnectionKind[]; accel: number; speed: 'slow' | 'medium' | 'fast'; start: string; end: string;
  retract?: number; pause?: string; note?: string; plates?: PrinterProfile['plates'];
}
const SPEEDS = {
  slow: { outer_wall_speed: 60, inner_wall_speed: 90, sparse_infill_speed: 120, internal_solid_infill_speed: 100, top_surface_speed: 60, travel_speed: 180, default_acceleration: 1000, outer_wall_acceleration: 800, top_surface_acceleration: 800, travel_acceleration: 1500, initial_layer_speed: 25, initial_layer_infill_speed: 40, initial_layer_acceleration: 500 },
  medium: { outer_wall_speed: 120, inner_wall_speed: 180, sparse_infill_speed: 220, internal_solid_infill_speed: 180, top_surface_speed: 120, travel_speed: 300, default_acceleration: 4000, outer_wall_acceleration: 2500, top_surface_acceleration: 2500, travel_acceleration: 5000, initial_layer_speed: 40 },
  fast: { outer_wall_speed: 200, inner_wall_speed: 300, sparse_infill_speed: 270, internal_solid_infill_speed: 250, top_surface_speed: 200, travel_speed: 500, default_acceleration: 8000, outer_wall_acceleration: 5000, top_surface_acceleration: 5000, travel_acceleration: 12000, initial_layer_speed: 50 },
};
const make = (p: Spec): PrinterProfile => ({
  id: p.id, vendor: p.vendor, model: p.model, nozzle: 0.4, bed: { x: p.bed[0], y: p.bed[1], z: p.bed[2] },
  plates: p.plates ?? PEI_PLATES, flavor: p.flavor, connections: p.connections, note: p.note,
  machine: baseMachine({
    machine_start_gcode: p.start, machine_end_gcode: p.end, max_acceleration: p.accel,
    retraction_length: p.retract ?? (p.flavor === 'marlin' ? 1 : 0.8), retraction_speed: 40, deretraction_speed: 40, z_hop: 0.2,
    machine_pause_gcode: p.pause ?? (p.flavor === 'klipper' ? 'PAUSE' : 'M601'),
  }),
  processOverrides: { ...SPEEDS[p.speed], default_acceleration: Math.min(SPEEDS[p.speed].default_acceleration, p.accel) },
});
const K = (id: string, vendor: string, model: string, bed: [number, number, number], macro: string, speed: Spec['speed'], accel: number, extra: Partial<Spec> = {}) =>
  make({ id, vendor, model, bed, flavor: 'klipper', connections: ['moonraker'], accel, speed, start: klipperStart(`${vendor} ${model}`, macro), end: extra.end ?? 'END_PRINT', ...extra });
const M = (id: string, vendor: string, model: string, bed: [number, number, number], speed: Spec['speed'], accel: number, extra: Partial<Spec> = {}) =>
  make({ id, vendor, model, bed, flavor: 'marlin', connections: ['serial', 'octoprint'], accel, speed, start: marlinStart(`${vendor} ${model}`), end: marlinEnd(10, bed[1] - 10), ...extra });

const H2D: PrinterProfile = {
  id: 'bbl-h2d', printerModelId: 'O1D', cameraMode: 'rtsp', vendor: 'Bambu Lab', model: 'H2D', nozzle: 0.4, bed: { x: 350, y: 320, z: 325 },
  plates: BBL_PLATES, flavor: 'bbl', connections: ['bbl_lan'],
  note: 'Single-nozzle printing on the H2D. Dual-nozzle (left/right extruder) slicing is not supported yet.',
  machine: bblMachine({ machine_start_gcode: bblStart('Bambu Lab H2D', 0.5, 20), machine_end_gcode: bblEnd.replace('X128 Y250', 'X160 Y310'), change_filament_gcode: bblChange(340, 300), machine_pause_gcode: 'M400 U1', filament_change_time: 95, has_ams: true }),
  processOverrides: {},
};

PRINTERS.push(
  H2D,
  // Creality
  K('creality-k1', 'Creality', 'K1', [220, 220, 250], 'START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer]', 'fast', 20000),
  K('creality-k1c', 'Creality', 'K1C', [220, 220, 250], 'START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer]', 'fast', 20000),
  K('creality-k1max', 'Creality', 'K1 Max', [300, 300, 300], 'START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer]', 'fast', 20000),
  K('creality-k2plus', 'Creality', 'K2 Plus', [350, 350, 350], 'START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer]', 'fast', 20000, { note: 'Single-colour printing; CFS multi-colour units are not driven yet.' }),
  K('creality-ender3v3', 'Creality', 'Ender-3 V3', [220, 220, 250], 'START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer]', 'fast', 20000),
  M('creality-ender3v3se', 'Creality', 'Ender-3 V3 SE', [220, 220, 250], 'medium', 3000, { start: marlinStart('Creality Ender-3 V3 SE', 5, 20, 180, 'G29 ; CR Touch levelling') }),
  M('creality-ender3s1', 'Creality', 'Ender-3 S1', [220, 220, 270], 'slow', 1000),
  M('creality-ender3v2', 'Creality', 'Ender-3 V2', [220, 220, 250], 'slow', 1000, { start: marlinStart('Creality Ender-3 V2', 5, 20, 180, '; (no probe) use the saved mesh: M420 S1') }),
  K('creality-cr10se', 'Creality', 'CR-10 SE', [220, 220, 265], 'START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer]', 'fast', 8000),
  // Elegoo
  K('elegoo-neptune4', 'Elegoo', 'Neptune 4', [225, 225, 265], '', 'fast', 5000, { start: marlinStart('Elegoo Neptune 4').replace('G29 ; auto bed levelling', 'BED_MESH_PROFILE LOAD=default'), end: marlinEnd(10, 215) }),
  K('elegoo-neptune4pro', 'Elegoo', 'Neptune 4 Pro', [225, 225, 265], '', 'fast', 5000, { start: marlinStart('Elegoo Neptune 4 Pro').replace('G29 ; auto bed levelling', 'BED_MESH_PROFILE LOAD=default'), end: marlinEnd(10, 215) }),
  K('elegoo-neptune4plus', 'Elegoo', 'Neptune 4 Plus', [320, 320, 385], '', 'fast', 5000, { start: marlinStart('Elegoo Neptune 4 Plus').replace('G29 ; auto bed levelling', 'BED_MESH_PROFILE LOAD=default'), end: marlinEnd(10, 310) }),
  M('elegoo-neptune3pro', 'Elegoo', 'Neptune 3 Pro', [225, 225, 280], 'slow', 1500),
  make({ id: 'elegoo-centauri', vendor: 'Elegoo', model: 'Centauri Carbon', bed: [256, 256, 256], flavor: 'klipper', connections: [], accel: 20000, speed: 'fast',
    start: klipperStart('Elegoo Centauri Carbon', 'START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer]'), end: 'END_PRINT',
    note: 'Uses Elegoo\'s own network protocol — export the G-code and print from USB stick.' }),
  // Prusa (PrusaLink accepts the OctoPrint upload API)
  M('prusa-mk4s', 'Prusa', 'MK4S', [250, 210, 220], 'medium', 4000, { connections: ['octoprint', 'serial'], start: marlinStart('Prusa MK4S', 5, 20, 120, 'G29 ; mesh bed levelling'), note: 'PrusaLink: use OctoPrint connection with the PrusaLink API key.' }),
  M('prusa-mk3s', 'Prusa', 'MK3S+', [250, 210, 210], 'slow', 1250, { connections: ['octoprint', 'serial'], start: marlinStart('Prusa MK3S+', 5, 20, 120, 'G80 ; mesh bed levelling') }),
  M('prusa-mini', 'Prusa', 'MINI+', [180, 180, 180], 'medium', 2500, { connections: ['octoprint', 'serial'], start: marlinStart('Prusa MINI+', 5, 20, 120, 'G29 ; mesh bed levelling') }),
  M('prusa-coreone', 'Prusa', 'CORE One', [250, 220, 270], 'fast', 8000, { connections: ['octoprint'], start: marlinStart('Prusa CORE One', 5, 20, 120, 'G29 ; mesh bed levelling') }),
  M('prusa-xl', 'Prusa', 'XL (single tool)', [360, 360, 360], 'medium', 5000, { connections: ['octoprint'], start: marlinStart('Prusa XL', 5, 20, 200, 'G29 ; mesh bed levelling') }),
  // Anycubic
  M('anycubic-kobra2neo', 'Anycubic', 'Kobra 2 Neo', [220, 220, 250], 'medium', 2500),
  M('anycubic-kobra2max', 'Anycubic', 'Kobra 2 Max', [420, 420, 500], 'medium', 3000),
  M('anycubic-kobra3', 'Anycubic', 'Kobra 3', [250, 250, 260], 'fast', 10000, { connections: ['serial'], note: 'ACE Pro multi-colour is not driven yet; prints single colour.' }),
  // Voron & other Klipper machines
  K('voron-24-350', 'Voron', '2.4 350', [350, 350, 340], 'PRINT_START BED=[bed_temperature_initial_layer] HOTEND=[nozzle_temperature_initial_layer]', 'fast', 10000, { end: 'PRINT_END' }),
  K('voron-trident-300', 'Voron', 'Trident 300', [300, 300, 250], 'PRINT_START BED=[bed_temperature_initial_layer] HOTEND=[nozzle_temperature_initial_layer]', 'fast', 10000, { end: 'PRINT_END' }),
  K('voron-02', 'Voron', '0.2', [120, 120, 120], 'PRINT_START BED=[bed_temperature_initial_layer] HOTEND=[nozzle_temperature_initial_layer]', 'fast', 10000, { end: 'PRINT_END' }),
  K('qidi-q1pro', 'Qidi', 'Q1 Pro', [245, 245, 240], 'PRINT_START BED=[bed_temperature_initial_layer] HOTEND=[nozzle_temperature_initial_layer] CHAMBER=0', 'fast', 20000, { end: 'PRINT_END' }),
  K('qidi-xplus3', 'Qidi', 'X-Plus 3', [280, 280, 270], 'PRINT_START BED=[bed_temperature_initial_layer] HOTEND=[nozzle_temperature_initial_layer] CHAMBER=0', 'fast', 20000, { end: 'PRINT_END' }),
  K('qidi-xmax3', 'Qidi', 'X-Max 3', [325, 325, 315], 'PRINT_START BED=[bed_temperature_initial_layer] HOTEND=[nozzle_temperature_initial_layer] CHAMBER=0', 'fast', 20000, { end: 'PRINT_END' }),
  K('sovol-sv08', 'Sovol', 'SV08', [350, 350, 345], 'START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer]', 'fast', 20000),
  K('sovol-sv07', 'Sovol', 'SV07', [220, 220, 250], 'PRINT_START BED_TEMP=[bed_temperature_initial_layer] EXTRUDER_TEMP=[nozzle_temperature_initial_layer]', 'fast', 8000, { end: 'PRINT_END' }),
  M('sovol-sv06', 'Sovol', 'SV06', [220, 220, 250], 'slow', 1500),
  K('artillery-x4plus', 'Artillery', 'Sidewinder X4 Plus', [300, 300, 400], 'START_PRINT EXTRUDER_TEMP=[nozzle_temperature_initial_layer] BED_TEMP=[bed_temperature_initial_layer]', 'fast', 7000),
  // generic
  M('generic-marlin', 'Generic', 'Marlin printer', [220, 220, 250], 'slow', 1000, { note: 'Starting point for any Marlin printer — set the bed size and start G-code in Printer settings.' }),
  K('generic-klipper', 'Generic', 'Klipper printer', [300, 300, 300], 'PRINT_START BED=[bed_temperature_initial_layer] HOTEND=[nozzle_temperature_initial_layer]', 'medium', 5000, { end: 'PRINT_END', note: 'Expects PRINT_START / PRINT_END macros in printer.cfg.' }),
);

export const printerById = (id: string) => PRINTERS.find((p) => p.id === id) ?? PRINTERS[0];
/** Display name; pass the nozzle in use (see effectiveNozzle) to show a chosen nozzle instead of the printer's own. */
export const printerName = (p: PrinterProfile, nozzle: number = p.nozzle) => `${p.vendor} ${p.model} ${nozzle} nozzle`;
