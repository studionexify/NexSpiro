// Three-tier preset system (Machine / Filament / Process), Bambu-Studio style:
// every preset may `inherits` a parent and stores only the keys it overrides.
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
  clearanceRadius: number;        // toolhead envelope radius around nozzle, mm
  clearanceHeight: number;        // nozzle tip → gantry, mm
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
  nonLinear: NonLinearSettings;
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
    travelSpeed: 150, retractLength: 0.8, retractSpeed: 35, clearanceRadius: 35, clearanceHeight: 28,
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
  { id: "machine/prusa-mk4", name: "Prusa MK4", kind: "machine", inherits: "machine/base", system: true, values: {
    bed: [250, 210], maxHeight: 220, zWobbleMax: 0.7, maxZSpeed: 12, maxAccel: 4000, travelSpeed: 200 } },
  // ---- filaments ----
  { id: "filament/pla", name: "Generic PLA", kind: "filament", system: true, values: {
    diameter: 1.75, flowRatio: 0.98, density: 1.24, costPerKg: 20,
    nozzleTempFirst: 220, nozzleTemp: 215, bedTempFirst: 60, bedTemp: 55, maxVolumetric: 15,
    fanMin: 60, fanMax: 100, fanOffFirstLayers: 1, fanMaxBelowLayerTime: 8, slowdownLayerTime: 6, minSpeed: 10 } },
  { id: "filament/pla-matte", name: "Matte PLA", kind: "filament", inherits: "filament/pla", system: true, values: { maxVolumetric: 12, costPerKg: 25 } },
  { id: "filament/petg", name: "Generic PETG", kind: "filament", inherits: "filament/pla", system: true, values: {
    flowRatio: 0.95, density: 1.27, nozzleTempFirst: 245, nozzleTemp: 240, bedTempFirst: 75, bedTemp: 70,
    maxVolumetric: 10, fanMin: 20, fanMax: 50, fanOffFirstLayers: 3 } },
  // ---- processes ----
  { id: "process/vase-0.4", name: "0.40mm Texture Vase", kind: "process", system: true, values: {
    layerHeight: 0.4, firstLayerHeight: 0.4, lineWidth: 0.8, wallSpeed: 25, firstLayerSpeed: 15,
    segmentsPerRev: 720, fadeHeight: 2,
    nonLinear: { enabled: true, deviationTol: 0.01, maxInclination: 30, collisionMargin: 2, zSmoothing: 0.5 } } },
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
