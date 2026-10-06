// Three-tier preset system (Machine / Filament / Process), Bambu-Studio style:
// every preset may `inherits` a parent and stores only the keys it overrides.
import type { SettingMap } from "./settings.ts";
export type Flavor = "marlin" | "klipper" | "bambu";

export type MachinePreset = {
  flavor: Flavor;
  bed: [number, number];          // mm
  maxHeight: number;              // mm
  nozzle: number;                 // mm
  zWobbleMax: number;             // max in-layer Z excursion the nozzle/shroud tolerates, mm
  maxZSpeed: number;              // mm/s
  maxAccel: number;               // mm/s²  (used for cornering speed limit)
  travelSpeed: number;            // mm/s
  retractLength: number; retractSpeed: number;
  deretractSpeed: number;         // mm/s, 0 = same as retractSpeed
  retractRestartExtra: number;    // mm of extra filament pushed after un-retract
  retractMinTravel: number;       // mm: no retraction for shorter travels
  retractOnLayerChange: boolean;
  zHop: number;                   // mm lift on retraction (0 = off)
  zHopType: "normal" | "slope" | "spiral";
  wipe: boolean; wipeDistance: number; retractBeforeWipe: number; // %
  pressureAdvanceDefault: number; // K (Klipper) / linear advance (Marlin)
  maxSpeedXY: number;             // mm/s hard limit
  maxJerk: number;                // mm/s (Marlin M205)
  clearanceRadius: number;        // toolhead envelope radius around nozzle, mm
  clearanceHeight: number;        // nozzle tip → gantry, mm
  bedExclude: [number, number][][]; // keep-out polygons in bed coordinates (origin = bed corner), mm
  startGcode: string; endGcode: string; layerChangeGcode: string;
};
export type FilamentPreset = {
  diameter: number; flowRatio: number; density: number; costPerKg: number;
  nozzleTempFirst: number; nozzleTemp: number; bedTempFirst: number; bedTemp: number;
  maxVolumetric: number;          // mm³/s clamp
  fanMin: number; fanMax: number; // 0..100 %
  fanOffFirstLayers: number;
  fanMaxBelowLayerTime: number;   // s: below this, fan ramps to fanMax
  slowdownLayerTime: number;      // s: slow down layers faster than this
  minSpeed: number;               // mm/s floor for slowdown
  pressureAdvance: number;        // K; 0 = off (process override wins when non-zero)
  overhangFanSpeed: number;       // % when printing overhangs/bridges
  overhangFanThreshold: number;   // % overhang that triggers it
  fanOnBridges: boolean;
  auxFanSpeed: number;            // % additional (chamber/aux) cooling
  fullFanLayer: number;           // layer where the part fan reaches fanMin
  fanCoolingEnabled: boolean;
  minLayerTime: number;           // s
};
export type NonLinearSettings = {
  enabled: boolean;               // false → planar spiral (pattern Z wobble suppressed)
  deviationTol: number;           // mm: point decimation tolerance
  maxInclination: number;         // °: max segment slope from horizontal
  collisionMargin: number;        // mm added to footprint/Z clearance checks
  zSmoothing: number;             // 0..1: feedrate smoothing strength
};
export type ProcessPreset = {
  layerHeight: number; firstLayerHeight: number; lineWidth: number;
  wallSpeed: number; firstLayerSpeed: number;
  segmentsPerRev: number; fadeHeight: number;
  arcFitting: boolean;            // emit helical G2/G3 where the path fits a circle
  arcTolerance: number;           // mm
  nonLinear: NonLinearSettings;
  /** Bambu/Orca-style settings (see settings.ts). Missing keys fall back to the schema default. */
  settings?: SettingMap;
};
export type PresetKind = "machine" | "filament" | "process";
type Body = { machine: MachinePreset; filament: FilamentPreset; process: ProcessPreset };
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };
export type Preset<K extends PresetKind = PresetKind> = {
  id: string; name: string; kind: K; inherits?: string; system?: boolean; values: DeepPartial<Body[K]>;
};

const MARLIN_START = `M140 S{bed_temperature_initial_layer}
M104 S{nozzle_temperature_initial_layer}
G28
M190 S{bed_temperature_initial_layer}
M109 S{nozzle_temperature_initial_layer}
G90
M83
G92 E0`;
const MARLIN_END = `M107
G91
G1 Z10 F600
G90
G1 X0 Y{bed_y} F{travel_feed}
M104 S0
M140 S0
M84`;

export const systemPresets: Preset[] = [
  // ---- machines ----
  { id: "machine/base", name: "Generic FDM", kind: "machine", system: true, values: {
    flavor: "marlin", bed: [220, 220], maxHeight: 250, nozzle: 0.4, zWobbleMax: 0.6, maxZSpeed: 10, maxAccel: 1500,
    travelSpeed: 150, retractLength: 0.8, retractSpeed: 35, deretractSpeed: 0, retractRestartExtra: 0, retractMinTravel: 1, retractOnLayerChange: true, zHop: 0.4, zHopType: "normal", wipe: true, wipeDistance: 1.2, retractBeforeWipe: 70, pressureAdvanceDefault: 0, maxSpeedXY: 500, maxJerk: 9, clearanceRadius: 35, clearanceHeight: 28, bedExclude: [],
    startGcode: MARLIN_START, endGcode: MARLIN_END, layerChangeGcode: ";LAYER:{layer_num} Z:{layer_z}" } },
  { id: "machine/bambu-x1", name: "Bambu Lab X1/P1 0.4", kind: "machine", inherits: "machine/base", system: true, values: {
    flavor: "bambu", bed: [256, 256], maxHeight: 250, zWobbleMax: 0.5, maxZSpeed: 20, maxAccel: 10000, travelSpeed: 500,
    clearanceRadius: 32, clearanceHeight: 36,
    startGcode: "M140 S{bed_temperature_initial_layer}\nM104 S{nozzle_temperature_initial_layer}\nG28\nM190 S{bed_temperature_initial_layer}\nM109 S{nozzle_temperature_initial_layer}\nM975 S1 ; vibration compensation\nG90\nM83\nG92 E0",
    layerChangeGcode: "; layer num/total_layer_count: {layer_num}/{total_layer_count}\nM73 L{layer_num}" } },
  { id: "machine/bambu-a1", name: "Bambu Lab A1 0.4", kind: "machine", inherits: "machine/bambu-x1", system: true, values: {
    maxHeight: 256, clearanceRadius: 30, clearanceHeight: 32 } },
  { id: "machine/klipper", name: "Generic Klipper", kind: "machine", inherits: "machine/base", system: true, values: {
    flavor: "klipper", maxAccel: 5000, travelSpeed: 250,
    startGcode: "PRINT_START EXTRUDER={nozzle_temperature_initial_layer} BED={bed_temperature_initial_layer}\nG90\nM83\nG92 E0",
    endGcode: "PRINT_END", layerChangeGcode: "SET_PRINT_STATS_INFO CURRENT_LAYER={layer_num}" } },
  { id: "machine/voron-24", name: "Voron 2.4 350", kind: "machine", inherits: "machine/klipper", system: true, values: {
    bed: [350, 350], maxHeight: 340, zWobbleMax: 1.0, maxZSpeed: 25, maxAccel: 8000, clearanceRadius: 40, clearanceHeight: 40 } },
  { id: "machine/creality-k1", name: "Creality K1", kind: "machine", inherits: "machine/klipper", system: true, values: {
    bed: [220, 220], maxHeight: 250, zWobbleMax: 0.6, maxZSpeed: 20, clearanceRadius: 33, clearanceHeight: 30 } },
  { id: "machine/ender3", name: "Creality Ender 3", kind: "machine", inherits: "machine/base", system: true, values: {
    zWobbleMax: 0.8, maxZSpeed: 5, maxAccel: 500, travelSpeed: 120 } },
  { id: "machine/bambu-p1s", name: "Bambu Lab P1S 0.4", kind: "machine", inherits: "machine/bambu-x1", system: true, values: { clearanceRadius: 32, clearanceHeight: 36 } },
  { id: "machine/bambu-a1-mini", name: "Bambu Lab A1 mini 0.4", kind: "machine", inherits: "machine/bambu-a1", system: true, values: { bed: [180, 180], maxHeight: 180, clearanceRadius: 28, clearanceHeight: 28 } },
  { id: "machine/ender3-v3-ke", name: "Creality Ender-3 V3 KE 0.4", kind: "machine", inherits: "machine/klipper", system: true, values: {
    bed: [220, 220], maxHeight: 240, zWobbleMax: 0.6, maxZSpeed: 10, maxAccel: 5000, travelSpeed: 300, maxSpeedXY: 500, retractLength: 0.8, retractSpeed: 40, zHop: 0.4, pressureAdvanceDefault: 0.04, clearanceRadius: 30, clearanceHeight: 30,
    startGcode: "START_PRINT EXTRUDER_TEMP={nozzle_temperature_initial_layer} BED_TEMP={bed_temperature_initial_layer}\nG90\nM83\nG92 E0", endGcode: "END_PRINT" } },
  { id: "machine/neptune4-max", name: "Elegoo Neptune 4 Max 0.4", kind: "machine", inherits: "machine/klipper", system: true, values: {
    bed: [420, 420], maxHeight: 480, zWobbleMax: 0.8, maxZSpeed: 10, maxAccel: 5000, travelSpeed: 300, maxSpeedXY: 500, retractLength: 0.8, retractSpeed: 40, zHop: 0.4, pressureAdvanceDefault: 0.04, clearanceRadius: 38, clearanceHeight: 40,
    startGcode: "PRINT_START EXTRUDER={nozzle_temperature_initial_layer} BED={bed_temperature_initial_layer}\nG90\nM83\nG92 E0", endGcode: "PRINT_END" } },
  { id: "machine/prusa-mk4", name: "Prusa MK4", kind: "machine", inherits: "machine/base", system: true, values: {
    bed: [250, 210], maxHeight: 220, zWobbleMax: 0.7, maxZSpeed: 12, maxAccel: 4000, travelSpeed: 200 } },
  // ---- filaments ----
  { id: "filament/pla", name: "Generic PLA", kind: "filament", system: true, values: {
    diameter: 1.75, flowRatio: 0.98, density: 1.24, costPerKg: 20,
    nozzleTempFirst: 220, nozzleTemp: 215, bedTempFirst: 60, bedTemp: 55, maxVolumetric: 15,
    fanMin: 60, fanMax: 100, fanOffFirstLayers: 1, fanMaxBelowLayerTime: 8, slowdownLayerTime: 6, minSpeed: 10,
    pressureAdvance: 0.02, overhangFanSpeed: 100, overhangFanThreshold: 50, fanOnBridges: true, auxFanSpeed: 0, fullFanLayer: 3, fanCoolingEnabled: true, minLayerTime: 4 } },
  { id: "filament/pla-matte", name: "Matte PLA", kind: "filament", inherits: "filament/pla", system: true, values: { maxVolumetric: 12, costPerKg: 25 } },
  { id: "filament/petg", name: "Generic PETG", kind: "filament", inherits: "filament/pla", system: true, values: {
    flowRatio: 0.95, density: 1.27, nozzleTempFirst: 245, nozzleTemp: 240, bedTempFirst: 75, bedTemp: 70,
    maxVolumetric: 10, fanMin: 20, fanMax: 50, fanOffFirstLayers: 3 } },
  { id: "filament/abs", name: "Generic ABS", kind: "filament", inherits: "filament/pla", system: true, values: {
    flowRatio: 0.926, density: 1.04, nozzleTempFirst: 270, nozzleTemp: 260, bedTempFirst: 100, bedTemp: 100, maxVolumetric: 16, fanMin: 0, fanMax: 30, fanOffFirstLayers: 3, pressureAdvance: 0.025 } },
  { id: "filament/asa", name: "Generic ASA", kind: "filament", inherits: "filament/abs", system: true, values: { density: 1.07, nozzleTemp: 260 } },
  { id: "filament/tpu", name: "Generic TPU", kind: "filament", inherits: "filament/pla", system: true, values: {
    flowRatio: 1, density: 1.22, nozzleTempFirst: 230, nozzleTemp: 230, bedTempFirst: 35, bedTemp: 35, maxVolumetric: 3.2, fanMin: 50, fanMax: 100, minSpeed: 5, pressureAdvance: 0.05 } },
  { id: "filament/pc", name: "Generic PC", kind: "filament", inherits: "filament/abs", system: true, values: { density: 1.2, nozzleTempFirst: 270, nozzleTemp: 270, bedTemp: 110, bedTempFirst: 110, fanMax: 20 } },
  { id: "filament/pa", name: "Generic PA-CF", kind: "filament", inherits: "filament/abs", system: true, values: { density: 1.14, nozzleTempFirst: 290, nozzleTemp: 290, bedTemp: 90, bedTempFirst: 90, fanMax: 20, maxVolumetric: 8 } },
  // ---- processes ----
  { id: "process/std-0.20", name: "0.20mm Standard", kind: "process", system: true, values: {
    layerHeight: 0.2, firstLayerHeight: 0.2, lineWidth: 0.42, wallSpeed: 200, firstLayerSpeed: 50,
    segmentsPerRev: 720, fadeHeight: 2, arcFitting: false, arcTolerance: 0.02,
    nonLinear: { enabled: true, deviationTol: 0.01, maxInclination: 30, collisionMargin: 2, zSmoothing: 0.5 },
    settings: { outer_wall_speed: 200, inner_wall_speed: 300, sparse_infill_speed: 270, internal_solid_infill_speed: 250, top_surface_speed: 200, bridge_speed: 50, support_speed: 150, support_interface_speed: 80 } } },
  { id: "process/std-0.08", name: "0.08mm Extra Fine", kind: "process", inherits: "process/std-0.20", system: true, values: {
    layerHeight: 0.08, firstLayerHeight: 0.2, wallSpeed: 120, settings: { inner_wall_speed: 200, sparse_infill_speed: 200, top_surface_speed: 120, top_shell_layers: 9, bottom_shell_layers: 7, default_acceleration: 5000 } } },
  { id: "process/std-0.12", name: "0.12mm Fine", kind: "process", inherits: "process/std-0.20", system: true, values: {
    layerHeight: 0.12, wallSpeed: 120, settings: { inner_wall_speed: 200, sparse_infill_speed: 200, top_surface_speed: 120, top_shell_layers: 7, bottom_shell_layers: 5, default_acceleration: 5000 } } },
  { id: "process/std-0.16", name: "0.16mm Optimal", kind: "process", inherits: "process/std-0.20", system: true, values: {
    layerHeight: 0.16, wallSpeed: 150, settings: { inner_wall_speed: 250, top_shell_layers: 6, bottom_shell_layers: 4 } } },
  { id: "process/std-0.24", name: "0.24mm Draft", kind: "process", inherits: "process/std-0.20", system: true, values: {
    layerHeight: 0.24, lineWidth: 0.42, settings: { top_shell_layers: 4, bottom_shell_layers: 3 } } },
  { id: "process/std-0.28", name: "0.28mm Extra Draft", kind: "process", inherits: "process/std-0.20", system: true, values: {
    layerHeight: 0.28, settings: { top_shell_layers: 3, bottom_shell_layers: 3, sparse_infill_density: 10 } } },
  { id: "process/strength-0.20", name: "0.20mm Strength", kind: "process", inherits: "process/std-0.20", system: true, values: {
    settings: { wall_loops: 6, sparse_infill_density: 25, sparse_infill_pattern: "gyroid", top_shell_layers: 5, bottom_shell_layers: 4, outer_wall_speed: 150, inner_wall_speed: 200 } } },
  { id: "process/vase-0.4", name: "0.40mm Texture Vase", kind: "process", system: true, values: {
    layerHeight: 0.4, firstLayerHeight: 0.4, lineWidth: 0.8, wallSpeed: 25, firstLayerSpeed: 15,
    segmentsPerRev: 720, fadeHeight: 2, arcFitting: false, arcTolerance: 0.02,
    nonLinear: { enabled: true, deviationTol: 0.01, maxInclination: 30, collisionMargin: 2, zSmoothing: 0.5 }, settings: { spiral_mode: true } } },
  { id: "process/vase-0.2-fine", name: "0.20mm Fine Texture", kind: "process", inherits: "process/vase-0.4", system: true, values: {
    layerHeight: 0.2, firstLayerHeight: 0.24, lineWidth: 0.5, segmentsPerRev: 1080 } },
  { id: "process/planar-0.4", name: "0.40mm Planar Spiral", kind: "process", inherits: "process/vase-0.4", system: true, values: {
    nonLinear: { enabled: false } } },
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function merge<T>(a: T, b: unknown): T {
  if (!isObj(a) || !isObj(b)) return (b === undefined ? a : b) as T;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  return out as T;
}

export class PresetRegistry {
  private map = new Map<string, Preset>();
  constructor(presets: Preset[] = systemPresets) { for (const p of presets) this.add(p); }
  add(p: Preset) { this.map.set(p.id, p); }
  remove(id: string) { const p = this.map.get(id); if (p && !p.system) this.map.delete(id); }
  get(id: string) { return this.map.get(id); }
  list<K extends PresetKind>(kind: K): Preset<K>[] { return [...this.map.values()].filter((p): p is Preset<K> => p.kind === kind); }
  user() { return [...this.map.values()].filter((p) => !p.system); }

  /** Fully resolved values: root-first merge along the inherits chain. */
  resolve<K extends PresetKind>(id: string): Body[K] {
    const chain: Preset[] = [];
    for (let p = this.map.get(id), guard = 0; p; p = p.inherits ? this.map.get(p.inherits) : undefined) {
      if (++guard > 32) throw new Error(`Preset inheritance cycle at ${id}`);
      chain.unshift(p);
    }
    if (!chain.length) throw new Error(`Unknown preset: ${id}`);
    return chain.reduce<unknown>((acc, p) => merge(acc, p.values), {}) as Body[K];
  }

  /** Save edited values as a user preset storing only the delta vs `parent`. */
  saveDelta<K extends PresetKind>(id: string, name: string, kind: K, parent: string, edited: Body[K]): Preset<K> {
    const p: Preset<K> = { id, name, kind, inherits: parent, values: diff(this.resolve<K>(parent), edited) as DeepPartial<Body[K]> };
    this.add(p as Preset);
    return p;
  }
}

export function diff(base: unknown, edited: unknown): unknown {
  if (!isObj(base) || !isObj(edited)) return JSON.stringify(base) === JSON.stringify(edited) ? undefined : edited;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(edited)) {
    const d = diff(base[k], edited[k]);
    if (d !== undefined && !(isObj(d) && !Object.keys(d).length)) out[k] = d;
  }
  return out;
}

/** Bambu/Orca-style `{placeholder}` substitution. Unknown keys are left intact. */
export function fillTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
