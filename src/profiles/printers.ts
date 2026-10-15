// Printer (machine) profiles. Add printers by appending to PRINTERS — the rest of the app is data-driven.
import type { Config } from './settings';

export type GcodeFlavor = 'marlin' | 'klipper' | 'bambu';
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
  machine: Config; // printer-level settings (retraction, limits, g-code macros)
  processOverrides: Config; // speed/accel defaults tuned for this machine
}

const BAMBU_PLATES: PrinterProfile['plates'] = [
  { type: 'cool_plate', label: 'Cool Plate (SuperTack)' },
  { type: 'engineering_plate', label: 'Engineering Plate' },
  { type: 'high_temp_plate', label: 'Smooth PEI / High Temp Plate' },
  { type: 'textured_pei_plate', label: 'Textured PEI Plate' },
];
const PEI_PLATES: PrinterProfile['plates'] = [
  { type: 'textured_pei_plate', label: 'Textured PEI Spring Steel' },
  { type: 'high_temp_plate', label: 'Smooth PEI Spring Steel' },
];

const bambuStart = (name: string, purgeY: number, purgeX0: number) => `;===== NexSpiro start G-code: ${name} =====
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

const bambuEnd = `;===== NexSpiro end G-code =====
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
  ...o,
});

export const PRINTERS: PrinterProfile[] = [
  {
    id: 'bbl-a1', vendor: 'Bambu Lab', model: 'A1', nozzle: 0.4, bed: { x: 256, y: 256, z: 256 },
    plates: BAMBU_PLATES, flavor: 'bambu', connections: ['bambu_lan'],
    machine: baseMachine({ machine_start_gcode: bambuStart('Bambu Lab A1', -0.5, 20), machine_end_gcode: bambuEnd, max_acceleration: 12000 }),
    processOverrides: { travel_speed: 700, default_acceleration: 10000, outer_wall_acceleration: 5000 },
  },
  {
    id: 'bbl-a1mini', vendor: 'Bambu Lab', model: 'A1 mini', nozzle: 0.4, bed: { x: 180, y: 180, z: 180 },
    plates: BAMBU_PLATES, flavor: 'bambu', connections: ['bambu_lan'],
    machine: baseMachine({ machine_start_gcode: bambuStart('Bambu Lab A1 mini', -0.5, 10), machine_end_gcode: bambuEnd.replace('X128 Y250', 'X90 Y175'), max_acceleration: 10000 }),
    processOverrides: { travel_speed: 700, default_acceleration: 10000 },
  },
  {
    id: 'bbl-p1s', vendor: 'Bambu Lab', model: 'P1S', nozzle: 0.4, bed: { x: 256, y: 256, z: 256 },
    excludedAreas: [[[0, 0], [18, 0], [18, 28], [0, 28]]],
    plates: BAMBU_PLATES, flavor: 'bambu', connections: ['bambu_lan'],
    machine: baseMachine({ machine_start_gcode: bambuStart('Bambu Lab P1S', 0.5, 20), machine_end_gcode: bambuEnd }),
    processOverrides: {},
  },
  {
    id: 'bbl-p1p', vendor: 'Bambu Lab', model: 'P1P', nozzle: 0.4, bed: { x: 256, y: 256, z: 256 },
    excludedAreas: [[[0, 0], [18, 0], [18, 28], [0, 28]]],
    plates: BAMBU_PLATES, flavor: 'bambu', connections: ['bambu_lan'],
    machine: baseMachine({ machine_start_gcode: bambuStart('Bambu Lab P1P', 0.5, 20), machine_end_gcode: bambuEnd }),
    processOverrides: {},
  },
  {
    id: 'bbl-x1c', vendor: 'Bambu Lab', model: 'X1 Carbon', nozzle: 0.4, bed: { x: 256, y: 256, z: 256 },
    excludedAreas: [[[0, 0], [18, 0], [18, 28], [0, 28]]],
    plates: BAMBU_PLATES, flavor: 'bambu', connections: ['bambu_lan'],
    machine: baseMachine({ machine_start_gcode: bambuStart('Bambu Lab X1 Carbon', 0.5, 20), machine_end_gcode: bambuEnd }),
    processOverrides: {},
  },
  {
    id: 'bbl-x1e', vendor: 'Bambu Lab', model: 'X1E', nozzle: 0.4, bed: { x: 256, y: 256, z: 256 },
    excludedAreas: [[[0, 0], [18, 0], [18, 28], [0, 28]]],
    plates: BAMBU_PLATES, flavor: 'bambu', connections: ['bambu_lan'],
    machine: baseMachine({ machine_start_gcode: bambuStart('Bambu Lab X1E', 0.5, 20), machine_end_gcode: bambuEnd }),
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
    }),
    processOverrides: {
      outer_wall_speed: 150, inner_wall_speed: 200, sparse_infill_speed: 250, internal_solid_infill_speed: 200, top_surface_speed: 150,
      travel_speed: 400, default_acceleration: 5000, outer_wall_acceleration: 3000, top_surface_acceleration: 3000, travel_acceleration: 5000,
    },
  },
];

export const printerById = (id: string) => PRINTERS.find((p) => p.id === id) ?? PRINTERS[0];
export const printerName = (p: PrinterProfile) => `${p.vendor} ${p.model} ${p.nozzle} nozzle`;
