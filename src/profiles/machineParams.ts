// Printer (machine) settings, laid out like Bambu Studio's printer settings pages.
import type { Config, ParamDef } from './settings';

const opts = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const noWipe = (c: Config) => !c.wipe;
const noHop = (c: Config) => !(Number(c.z_hop) > 0);

export const MACHINE_PAGES = ['Basic information', 'Machine G-code', 'Motion ability', 'Extruder', 'Notes'] as const;

export const MACHINE_PARAMS: ParamDef[] = [
  // ---------------- Basic information
  { key: 'use_relative_e_distances', label: 'Use relative E distances', tab: 'Basic information', group: 'Advanced', type: 'bool', def: true, tip: 'Relative extrusion (M83) is recommended. Off writes absolute E values (M82) and resets E at every layer.' },
  { key: 'extruder_clearance_max_radius', label: 'Max radius', tab: 'Basic information', group: 'Extruder Clearance', type: 'float', unit: 'mm', min: 0, max: 500, def: 65, tip: 'Radius of the clearance cylinder around the nozzle. With "By object" sequence, objects closer than this would hit the print head.' },
  { key: 'extruder_clearance_height_to_rod', label: 'Height to rod', tab: 'Basic information', group: 'Extruder Clearance', type: 'float', unit: 'mm', min: 0, max: 1000, def: 25, tip: 'Distance from the nozzle tip to the X gantry rod. With "By object" sequence, every object but the last must be lower than this.' },
  { key: 'extruder_clearance_height_to_lid', label: 'Height to lid', tab: 'Basic information', group: 'Extruder Clearance', type: 'float', unit: 'mm', min: 0, max: 1000, def: 250, tip: 'Distance from the nozzle tip to the lid. With "By object" sequence, objects must be lower than this.' },
  { key: 'auxiliary_fan', label: 'Auxiliary part cooling fan', tab: 'Basic information', group: 'Accessory', type: 'bool', def: false, tip: 'The printer has an auxiliary (big side) cooling fan driven with M106 P2.' },

  // ---------------- Machine G-code
  { key: 'machine_start_gcode', label: 'Machine start G-code', tab: 'Machine G-code', group: 'Machine start G-code', type: 'text', def: '', tip: 'Run before the first layer.' },
  { key: 'machine_end_gcode', label: 'Machine end G-code', tab: 'Machine G-code', group: 'Machine end G-code', type: 'text', def: '', tip: 'Run after the last layer.' },
  { key: 'printing_by_object_gcode', label: 'Between Object G-code', tab: 'Machine G-code', group: 'Printing by object G-code', type: 'text', def: '', tip: 'Inserted between objects when printing by object.' },
  { key: 'before_layer_change_gcode', label: 'Before layer change G-code', tab: 'Machine G-code', group: 'Before layer change G-code', type: 'text', def: '', tip: 'Inserted before moving up to the next layer. Placeholders: [layer_num], [layer_z].' },
  { key: 'layer_change_gcode', label: 'Layer change G-code', tab: 'Machine G-code', group: 'Layer change G-code', type: 'text', def: '', tip: 'Inserted after moving up to a new layer. Placeholders: [layer_num], [layer_z].' },
  { key: 'time_lapse_gcode', label: 'Time lapse G-code', tab: 'Machine G-code', group: 'Time lapse G-code', type: 'text', def: '', tip: 'Inserted at every layer change to take a timelapse snapshot.' },
  { key: 'change_filament_gcode', label: 'Change filament G-code', tab: 'Machine G-code', group: 'Change filament G-code', type: 'text', def: '', tip: 'Run for every filament change. Placeholders: [previous_extruder], [next_extruder], [flush_length], [new_filament_temp], [toolchange_z].' },
  { key: 'machine_pause_gcode', label: 'Pause G-code', tab: 'Machine G-code', group: 'Pause G-code', type: 'text', def: 'M601', tip: 'Inserted for a pause added on the layer slider.' },

  // ---------------- Motion ability
  { key: 'max_speed_xy', label: 'Maximum speed X/Y', tab: 'Motion ability', group: 'Speed limitation', type: 'float', unit: 'mm/s', min: 1, max: 2000, def: 500, tip: 'Firmware speed limit; used for the time estimate.' },
  { key: 'max_speed_z', label: 'Maximum speed Z', tab: 'Motion ability', group: 'Speed limitation', type: 'float', unit: 'mm/s', min: 1, max: 200, def: 20, tip: 'Speed of Z moves (layer changes and Z hops).' },
  { key: 'max_acceleration', label: 'Maximum acceleration', tab: 'Motion ability', group: 'Acceleration limitation', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 20000, tip: 'Firmware acceleration limit; accelerations above it are clamped.' },

  // ---------------- Extruder
  { key: 'min_layer_height', label: 'Min', tab: 'Extruder', group: 'Layer height limits', type: 'float', unit: 'mm', min: 0.01, max: 1, step: 0.01, def: 0.08, tip: 'Thinnest layer the nozzle prints well (variable layer height lower bound).' },
  { key: 'max_layer_height', label: 'Max', tab: 'Extruder', group: 'Layer height limits', type: 'float', unit: 'mm', min: 0.01, max: 2, step: 0.01, def: 0.28, tip: 'Thickest layer the nozzle prints well (variable layer height upper bound).' },
  { key: 'retraction_length', label: 'Length', tab: 'Extruder', group: 'Retraction', type: 'float', unit: 'mm', min: 0, max: 20, step: 0.1, def: 0.8, tip: 'Filament pulled back before a travel move, to stop oozing.' },
  { key: 'z_hop', label: 'Z hop when retract', tab: 'Extruder', group: 'Retraction', type: 'float', unit: 'mm', min: 0, max: 5, step: 0.05, def: 0.4, tip: 'Lift the nozzle on retracted travel so it does not drag over the print.' },
  { key: 'retract_lift_above', label: 'Z hop lower boundary', tab: 'Extruder', group: 'Retraction', type: 'float', unit: 'mm', min: 0, max: 1000, def: 0, disabledWhen: noHop, tip: 'Only hop at or above this height.' },
  { key: 'retract_lift_below', label: 'Z hop upper boundary', tab: 'Extruder', group: 'Retraction', type: 'float', unit: 'mm', min: 0, max: 1000, def: 0, disabledWhen: noHop, tip: 'Only hop at or below this height (0 = no limit).' },
  { key: 'z_hop_types', label: 'Z hop type', tab: 'Extruder', group: 'Retraction', type: 'enum', def: 'normal', disabledWhen: noHop,
    options: opts(['auto', 'Auto'], ['normal', 'Normal'], ['slope', 'Slope'], ['spiral', 'Spiral']),
    tip: 'Normal lifts straight up. Slope lifts while already moving. Spiral lifts in a small helix, which drags less on the surface. Auto uses Spiral when the travel crosses printed walls, Slope otherwise.' },
  { key: 'retraction_speed', label: 'Retraction speed', tab: 'Extruder', group: 'Retraction', type: 'float', unit: 'mm/s', min: 1, max: 200, def: 30, tip: 'Speed of the retraction.' },
  { key: 'deretraction_speed', label: 'Deretraction speed', tab: 'Extruder', group: 'Retraction', type: 'float', unit: 'mm/s', min: 0, max: 200, def: 30, tip: 'Speed of pushing filament back after travel (0 = same as retraction).' },
  { key: 'retract_restart_extra', label: 'Extra length on restart', tab: 'Extruder', group: 'Retraction', type: 'float', unit: 'mm', min: -5, max: 5, step: 0.01, def: 0, tip: 'Pushes a little more (or less) filament back than was retracted.' },
  { key: 'retraction_minimum_travel', label: 'Travel distance threshold', tab: 'Extruder', group: 'Retraction', type: 'float', unit: 'mm', min: 0, max: 100, step: 0.1, def: 1, tip: 'Retract only for travel longer than this.' },
  { key: 'retract_when_changing_layer', label: 'Retract when change layer', tab: 'Extruder', group: 'Retraction', type: 'bool', def: false, tip: 'Always retract when moving to the next layer.' },
  { key: 'wipe', label: 'Wipe while retracting', tab: 'Extruder', group: 'Retraction', type: 'bool', def: false, tip: 'Move the nozzle back along the last printed path while retracting, which wipes off ooze.' },
  { key: 'wipe_distance', label: 'Wipe distance', tab: 'Extruder', group: 'Retraction', type: 'float', unit: 'mm', min: 0, max: 20, step: 0.1, def: 2, disabledWhen: noWipe, tip: 'Length of the wipe move.' },
  { key: 'retract_before_wipe', label: 'Retract amount before wipe', tab: 'Extruder', group: 'Retraction', type: 'percent', unit: '%', min: 0, max: 100, def: 100, disabledWhen: noWipe, tip: 'Part of the retraction done before the wipe; the rest happens during the wipe move.' },
  { key: 'retract_length_toolchange', label: 'Length', tab: 'Extruder', group: 'Retraction when switching material', type: 'float', unit: 'mm', min: 0, max: 100, step: 0.5, def: 2, tip: 'Retraction before a filament change (before the change G-code runs).' },
  { key: 'retract_restart_extra_toolchange', label: 'Extra length on restart', tab: 'Extruder', group: 'Retraction when switching material', type: 'float', unit: 'mm', min: -5, max: 20, step: 0.1, def: 0, tip: 'Extra filament pushed after a filament change.' },

  // ---------------- Notes
  { key: 'printer_notes', label: 'Printer notes', tab: 'Notes', group: 'Notes', type: 'text', def: '', tip: 'Free text kept with the printer settings and written into the G-code config block.' },
];

export const MACHINE_DEFAULTS: Config = Object.fromEntries(MACHINE_PARAMS.map((p) => [p.key, p.def]));
export const MACHINE_PARAM_BY_KEY: Record<string, ParamDef> = Object.fromEntries(MACHINE_PARAMS.map((p) => [p.key, p]));
