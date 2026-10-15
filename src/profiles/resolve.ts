// Resolve the flat engine config: system defaults ← printer ← preset ← user overrides, plus machine & filament.
import type { FilamentSlot } from '../engine/types';
import { filamentById } from './filaments';
import { printerById, type PlateType } from './printers';
import { PROCESS_DEFAULTS, PROCESS_PRESETS, type Config } from './settings';

export interface ProfileSelection {
  printerId: string;
  plate: PlateType;
  filamentId: string;
  presetId: string;
  overrides: Config;
  machineOverrides?: Config;
}

/** Base process values before user overrides (used for "modified" detection). */
export function baseProcess(sel: Pick<ProfileSelection, 'printerId' | 'presetId'>): Config {
  const printer = printerById(sel.printerId);
  const preset = PROCESS_PRESETS.find((p) => p.id === sel.presetId) ?? PROCESS_PRESETS[3];
  const nz = printer.nozzle;
  const scaled: Config = nz === 0.4 ? {} : {
    line_width: +(nz * 1.05).toFixed(2), outer_wall_line_width: +(nz * 1.05).toFixed(2), inner_wall_line_width: +(nz * 1.125).toFixed(2),
    top_surface_line_width: +(nz * 1.05).toFixed(2), sparse_infill_line_width: +(nz * 1.125).toFixed(2),
    internal_solid_infill_line_width: +(nz * 1.05).toFixed(2), support_line_width: +(nz * 1.05).toFixed(2), initial_layer_line_width: +(nz * 1.25).toFixed(2),
  };
  return { ...PROCESS_DEFAULTS, ...scaled, ...printer.processOverrides, ...preset.values };
}

export function resolveConfig(sel: ProfileSelection): Config {
  const printer = printerById(sel.printerId);
  const fil = filamentById(sel.filamentId);
  const bed = fil.bedTemp[sel.plate] ?? 0;
  return {
    ...baseProcess(sel),
    ...sel.overrides,
    ...printer.machine,
    ...(sel.machineOverrides ?? {}),
    printer_model: `${printer.vendor} ${printer.model}`,
    gcode_flavor: printer.flavor,
    nozzle_diameter: printer.nozzle,
    bed_x: printer.bed.x, bed_y: printer.bed.y, bed_z: printer.bed.z,
    curr_bed_type: sel.plate,
    filament_type: fil.type,
    filament_settings_id: fil.name,
    filament_diameter: fil.diameter,
    filament_density: fil.density,
    filament_cost: fil.cost,
    filament_colour: fil.color,
    nozzle_temperature: fil.nozzleTemp,
    nozzle_temperature_initial_layer: fil.nozzleTempInitial,
    bed_temperature: bed,
    bed_temperature_initial_layer: bed,
    fan_min_speed: fil.fanMin,
    fan_max_speed: fil.fanMax,
    close_fan_the_first_x_layers: fil.fanOffFirstLayers,
    slow_down_layer_time: fil.slowDownLayerTime,
    slow_down_min_speed: fil.slowDownMinSpeed,
    filament_max_volumetric_speed: fil.maxVolumetricSpeed,
    filament_flow_ratio: fil.flowRatio,
    ...(fil.retractionLength !== undefined ? { retraction_length: fil.retractionLength } : {}),
  };
}

/** Validation warnings shown before slicing. */
export function validate(sel: ProfileSelection): string[] {
  const w: string[] = [];
  const fil = filamentById(sel.filamentId);
  if (!fil.bedTemp[sel.plate]) w.push(`${fil.name} is not recommended on this build plate.`);
  const c = resolveConfig(sel);
  if ((c.layer_height as number) > (c.nozzle_diameter as number) * 0.8) w.push('Layer height exceeds 80% of the nozzle diameter.');
  return w;
}

/** Engine filament slots from the UI slot list (preset + colour). */
export function filamentSlots(slots: { presetId: string; color: string }[]): FilamentSlot[] {
  return slots.map((s) => {
    const f = filamentById(s.presetId);
    return {
      name: f.name, type: f.type, color: s.color, diameter: f.diameter, density: f.density, cost: f.cost,
      nozzleTemp: f.nozzleTemp, nozzleTempInitial: f.nozzleTempInitial, flowRatio: f.flowRatio, maxVolumetricSpeed: f.maxVolumetricSpeed,
    };
  });
}
