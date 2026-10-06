import type { PresetKind } from "../core/index.ts";

export const opt = (v: string, label: string, sel: boolean) => `<option value="${v}"${sel ? " selected" : ""}>${label}</option>`;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const LABELS: Record<string, string> = {
  flavor: "G-code flavor", bed: "Bed size X,Y (mm)", maxHeight: "Max height (mm)", nozzle: "Nozzle Ø (mm)",
  zWobbleMax: "Max Z wobble / clearance (mm)", maxZSpeed: "Max Z speed (mm/s)", maxAccel: "Max acceleration (mm/s²)",
  travelSpeed: "Travel speed (mm/s)", retractLength: "Retraction length (mm)", retractSpeed: "Retraction speed (mm/s)",
  clearanceRadius: "Toolhead clearance radius (mm)", clearanceHeight: "Toolhead clearance height (mm)",
  startGcode: "Start G-code", endGcode: "End G-code", layerChangeGcode: "Layer change G-code",
  diameter: "Diameter (mm)", flowRatio: "Flow ratio", density: "Density (g/cm³)", costPerKg: "Cost per kg",
  nozzleTempFirst: "Nozzle temp, first layer (°C)", nozzleTemp: "Nozzle temp, other layers (°C)",
  bedTempFirst: "Bed temp, first layer (°C)", bedTemp: "Bed temp, other layers (°C)", maxVolumetric: "Max volumetric speed (mm³/s)",
  fanMin: "Fan min (%)", fanMax: "Fan max (%)", fanOffFirstLayers: "No cooling for first N layers",
  fanMaxBelowLayerTime: "Full fan if layer time below (s)", slowdownLayerTime: "Slow down if layer time below (s)", minSpeed: "Min print speed (mm/s)",
  layerHeight: "Layer height (mm)", firstLayerHeight: "First layer height (mm)", lineWidth: "Line width (mm)",
  wallSpeed: "Wall speed (mm/s)", firstLayerSpeed: "First layer speed (mm/s)", segmentsPerRev: "Segments per revolution", fadeHeight: "Pattern fade-in height (mm)",
  arcFitting: "Arc fitting (helical G2/G3)", arcTolerance: "Arc fitting tolerance (mm)",
  enabled: "Enable non-linear motion (off = planar)", deviationTol: "Curve deviation tolerance (mm)", maxInclination: "Max surface inclination (°)",
  collisionMargin: "Toolhead collision margin (mm)", zSmoothing: "Z feedrate / jerk smoothing (0–1)",
};
export const GROUPS: Record<PresetKind, [string, string[]][]> = {
  machine: [["Basic", ["flavor", "bed", "maxHeight", "nozzle"]], ["Motion", ["maxZSpeed", "maxAccel", "travelSpeed", "retractLength", "retractSpeed"]],
    ["Toolhead clearance", ["zWobbleMax", "clearanceRadius", "clearanceHeight"]], ["Machine G-code", ["startGcode", "layerChangeGcode", "endGcode"]]],
  filament: [["Basic", ["diameter", "flowRatio", "density", "costPerKg"]], ["Temperature", ["nozzleTempFirst", "nozzleTemp", "bedTempFirst", "bedTemp"]],
    ["Volumetric speed", ["maxVolumetric"]], ["Cooling", ["fanMin", "fanMax", "fanOffFirstLayers", "fanMaxBelowLayerTime", "slowdownLayerTime", "minSpeed"]]],
  process: [["Quality", ["layerHeight", "firstLayerHeight", "lineWidth", "segmentsPerRev", "fadeHeight"]], ["Speed", ["wallSpeed", "firstLayerSpeed"]], ["G-code output", ["arcFitting", "arcTolerance"]],
    ["NexSpiro Non-Linear Motion", ["nonLinear.enabled", "nonLinear.deviationTol", "nonLinear.maxInclination", "nonLinear.collisionMargin", "nonLinear.zSmoothing"]]],
};

export function field(path: string, value: unknown): string {
  const key = path.split(".").pop()!, label = LABELS[key] ?? key;
  if (typeof value === "boolean") return `<label>${label} <input type="checkbox" data-path="${path}"${value ? " checked" : ""}></label>`;
  if (typeof value === "number") return `<label>${label} <input type="number" step="any" data-path="${path}" value="${value}"></label>`;
  if (key === "flavor") return `<label>${label} <select data-path="${path}">${["marlin", "klipper", "bambu"].map((f) => opt(f, f, f === value)).join("")}</select></label>`;
  if (Array.isArray(value)) return `<label>${label} <input type="text" data-path="${path}" data-array="1" value="${value.join(",")}"></label>`;
  return `<div class="field-block">${label}<textarea data-path="${path}" rows="5">${esc(String(value))}</textarea></div>`;
}
export const getPath = (o: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], o);
export function setPath(o: Record<string, unknown>, path: string, v: unknown) {
  const ks = path.split("."), last = ks.pop()!;
  (ks.reduce<Record<string, unknown>>((a, k) => a[k] as Record<string, unknown>, o))[last] = v;
}

