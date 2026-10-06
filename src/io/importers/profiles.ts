import type { Preset, PresetKind, MachinePreset } from "../../core/presets.ts";
import { fillTemplate } from "../../core/presets.ts";

// Bambu Studio / OrcaSlicer JSON and PrusaSlicer / Slic3r INI → NexSpiro presets (and back for 3MF export).
type Conv = "num" | "str" | "gcode" | "bed" | "exclude" | "flavor";
type Entry = { kind: PresetKind; path: string; bambu: string[]; prusa: string[]; conv: Conv };
const E = (kind: PresetKind, path: string, bambu: string[], prusa: string[], conv: Conv = "num"): Entry => ({ kind, path, bambu, prusa, conv });

export const KEY_MAP: Entry[] = [
  E("machine", "bed", ["printable_area"], ["bed_shape"], "bed"),
  E("machine", "bedExclude", ["bed_exclude_area"], [], "exclude"),
  E("machine", "maxHeight", ["printable_height"], ["max_print_height"]),
  E("machine", "nozzle", ["nozzle_diameter"], ["nozzle_diameter"]),
  E("machine", "maxZSpeed", ["machine_max_speed_z"], ["machine_max_feedrate_z"]),
  E("machine", "maxAccel", ["machine_max_acceleration_extruding"], ["machine_max_acceleration_extruding"]),
  E("machine", "travelSpeed", ["travel_speed"], ["travel_speed"]),
  E("machine", "retractLength", ["retraction_length"], ["retract_length"]),
  E("machine", "retractSpeed", ["retraction_speed"], ["retract_speed"]),
  E("machine", "clearanceRadius", ["extruder_clearance_radius"], ["extruder_clearance_radius"]),
  E("machine", "clearanceHeight", ["extruder_clearance_height_to_rod", "extruder_clearance_max_radius"], ["extruder_clearance_height"]),
  E("machine", "startGcode", ["machine_start_gcode"], ["start_gcode"], "gcode"),
  E("machine", "endGcode", ["machine_end_gcode"], ["end_gcode"], "gcode"),
  E("machine", "layerChangeGcode", ["layer_change_gcode"], ["layer_gcode"], "gcode"),
  E("machine", "flavor", ["gcode_flavor"], ["gcode_flavor"], "flavor"),
  E("filament", "diameter", ["filament_diameter"], ["filament_diameter"]),
  E("filament", "flowRatio", ["filament_flow_ratio"], ["extrusion_multiplier"]),
  E("filament", "density", ["filament_density"], ["filament_density"]),
  E("filament", "costPerKg", ["filament_cost"], ["filament_cost"]),
  E("filament", "nozzleTempFirst", ["nozzle_temperature_initial_layer"], ["first_layer_temperature"]),
  E("filament", "nozzleTemp", ["nozzle_temperature"], ["temperature"]),
  E("filament", "bedTempFirst", ["hot_plate_temp_initial_layer", "textured_plate_temp_initial_layer"], ["first_layer_bed_temperature"]),
  E("filament", "bedTemp", ["hot_plate_temp", "textured_plate_temp"], ["bed_temperature"]),
  E("filament", "maxVolumetric", ["filament_max_volumetric_speed"], ["filament_max_volumetric_speed"]),
  E("filament", "fanMin", ["fan_min_speed"], ["min_fan_speed"]),
  E("filament", "fanMax", ["fan_max_speed"], ["max_fan_speed"]),
  E("filament", "fanOffFirstLayers", ["close_fan_the_first_x_layers"], ["disable_fan_first_layers"]),
  E("filament", "fanMaxBelowLayerTime", ["fan_cooling_layer_time"], ["fan_below_layer_time"]),
  E("filament", "slowdownLayerTime", ["slow_down_layer_time"], ["slowdown_below_layer_time"]),
  E("filament", "minSpeed", ["slow_down_min_speed"], ["min_print_speed"]),
  E("process", "layerHeight", ["layer_height"], ["layer_height"]),
  E("process", "firstLayerHeight", ["initial_layer_print_height"], ["first_layer_height"]),
  E("process", "lineWidth", ["outer_wall_line_width"], ["external_perimeter_extrusion_width", "perimeter_extrusion_width"]),
  E("process", "wallSpeed", ["outer_wall_speed"], ["external_perimeter_speed", "perimeter_speed"]),
  E("process", "firstLayerSpeed", ["initial_layer_speed"], ["first_layer_speed"]),
];

const BASE: Record<PresetKind, string> = { machine: "machine/base", filament: "filament/pla", process: "process/vase-0.4" };

// Slicer placeholders → NexSpiro {placeholders}
const PLACEHOLDER: Record<string, string> = {
  first_layer_temperature: "nozzle_temperature_initial_layer", nozzle_temperature_initial_layer: "nozzle_temperature_initial_layer",
  temperature: "nozzle_temperature", nozzle_temperature: "nozzle_temperature",
  first_layer_bed_temperature: "bed_temperature_initial_layer", bed_temperature_initial_layer: "bed_temperature_initial_layer",
  bed_temperature_initial_layer_single: "bed_temperature_initial_layer", hot_plate_temp_initial_layer: "bed_temperature_initial_layer",
  bed_temperature: "bed_temperature", hot_plate_temp: "bed_temperature",
  layer_num: "layer_num", layer_z: "layer_z", total_layer_count: "total_layer_count",
  layer_height: "layer_height", first_layer_height: "first_layer_height", initial_layer_print_height: "first_layer_height",
};
export function convertGcodeTemplate(src: string): { text: string; unknown: string[] } {
  const unknown = new Set<string>();
  const text = src.replace(/[[{]\s*([A-Za-z_]\w*)(?:\[\d+\])?\s*[\]}]/g, (m, k: string) => {
    const t = PLACEHOLDER[k];
    if (t) return `{${t}}`;
    unknown.add(k); return m;
  });
  for (const m of src.matchAll(/\{\s*(if|elsif|else|endif)\b/g)) unknown.add(`{${m[1]} …} conditional`);
  return { text, unknown: [...unknown] };
}

const first = (v: unknown): string | undefined => (Array.isArray(v) ? (v.length ? String(v[0]) : undefined) : v === undefined || v === null ? undefined : String(v));
const parsePoints = (v: unknown): [number, number][] => {
  const arr = Array.isArray(v) ? v.map(String) : String(v ?? "").split(",");
  return arr.map((s) => s.trim()).filter(Boolean).map((s) => {
    const [x, y] = s.split("x").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Bad point "${s}"`);
    return [x, y];
  });
};
const setPath = (o: Record<string, unknown>, path: string, v: unknown) => { o[path] = v; };

/** Map a flat key→value settings object (any mix of Bambu/Orca/Prusa keys) into per-kind preset values. */
export function mapSettings(settings: Record<string, unknown>, which: "bambu" | "prusa", kinds: PresetKind[] = ["machine", "filament", "process"]) {
  const values: Record<PresetKind, Record<string, unknown>> = { machine: {}, filament: {}, process: {} };
  const warnings: string[] = [];
  let bed: [number, number] | undefined;
  for (const e of KEY_MAP) {
    if (!kinds.includes(e.kind)) continue;
    const cands = (which === "bambu" ? e.bambu : e.prusa).filter((k) => settings[k] !== undefined && first(settings[k]) !== "");
    if (!cands.length) continue;
    // numeric keys: prefer the first candidate holding an absolute value (Prusa allows "50%" / 0 = auto)
    const usable = (k: string) => { const v = first(settings[k])!; return !/%$/.test(v) && !(e.path === "lineWidth" && Number(v) === 0); };
    const key = e.conv === "num" ? cands.find(usable) ?? cands[0] : cands[0];
    const raw = settings[key];
    try {
      switch (e.conv) {
        case "num": {
          const s = first(raw)!;
          if (/%$/.test(s)) { warnings.push(`${key} = ${s}: percentage values are not converted; NexSpiro default kept`); break; }
          const n = Number(s);
          if (!Number.isFinite(n)) throw new Error(`not a number: ${s}`);
          if (e.path === "lineWidth" && n === 0) { warnings.push(`${key} = 0 (auto) not converted`); break; }
          setPath(values[e.kind], e.path, n); break;
        }
        case "bed": {
          const pts = parsePoints(raw);
          if (pts.length < 3) throw new Error("needs ≥ 3 points");
          const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
          bed = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
          setPath(values[e.kind], e.path, bed); break;
        }
        case "exclude": {
          const pts = parsePoints(raw);
          setPath(values[e.kind], e.path, pts.length >= 3 && pts.some(([x, y]) => x || y) ? [pts] : []); break;
        }
        case "gcode": {
          const g = convertGcodeTemplate(first(raw)!.replace(/\\n/g, "\n"));
          if (g.unknown.length) warnings.push(`${key}: unsupported placeholders left unchanged — review before printing: ${g.unknown.join(", ")}`);
          setPath(values[e.kind], e.path, g.text); break;
        }
        case "flavor": {
          const f = first(raw)!.toLowerCase();
          const model = first(settings.printer_model) ?? "";
          const flavor = /bambu/i.test(model) ? "bambu" : f === "klipper" ? "klipper" : f.startsWith("marlin") ? "marlin" : null;
          if (!flavor) { warnings.push(`gcode_flavor "${f}" not supported; using Marlin`); setPath(values[e.kind], e.path, "marlin"); }
          else setPath(values[e.kind], e.path, flavor);
          break;
        }
        case "str": setPath(values[e.kind], e.path, first(raw)); break;
      }
    } catch (err) { warnings.push(`${key}: ${err instanceof Error ? err.message : err}`); }
  }
  if (first(settings.spiral_mode) === "0" || first(settings.spiral_vase) === "0")
    warnings.push("Source profile is not in spiral/vase mode; NexSpiro always prints a single spiral wall");
  return { values, warnings, bed };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported";
const makePreset = (kind: PresetKind, name: string, values: Record<string, unknown>): Preset =>
  ({ id: `user/${kind}/${slug(name)}`, name, kind, inherits: BASE[kind], values } as Preset);

/** Bambu 3MF project_settings.config (flat, all kinds). */
export function presetsFromBambuSettings(settings: Record<string, unknown>, label: string) {
  const { values, warnings, bed } = mapSettings(settings, "bambu");
  const presets: Preset[] = [];
  const names: Record<PresetKind, string> = {
    machine: first(settings.printer_settings_id) ?? `${label} printer`,
    filament: first(settings.filament_settings_id) ?? `${label} filament`,
    process: first(settings.print_settings_id) ?? `${label} process`,
  };
  for (const k of ["machine", "filament", "process"] as const)
    if (Object.keys(values[k]).length) presets.push(makePreset(k, `${names[k]} (imported)`, values[k]));
  return { presets, warnings, bed };
}

/** A single Bambu Studio / OrcaSlicer profile JSON (`type`: machine | filament | process). */
export function importProfileJSON(text: string): { presets: Preset[]; warnings: string[] } {
  let j: Record<string, unknown>;
  try { j = JSON.parse(text); } catch { throw new Error("Profile is not valid JSON"); }
  const kind = (({ machine: "machine", printer: "machine", filament: "filament", process: "process", print: "process" } as Record<string, PresetKind>)[String(j.type)]);
  if (!kind) {
    if (j.version !== undefined && Array.isArray(j.plates)) throw new Error("This is a NexSpiro project, not a profile");
    return presetsFromBambuSettings(j, "Imported");
  }
  const { values, warnings } = mapSettings(j, "bambu", [kind]);
  if (j.inherits) warnings.push(`Parent "${j.inherits}" is not available in NexSpiro; unset values fall back to ${BASE[kind]}`);
  if (!Object.keys(values[kind]).length) throw new Error(`No supported ${kind} settings found in profile "${j.name ?? "?"}"`);
  return { presets: [makePreset(kind, String(j.name ?? `Imported ${kind}`), values[kind])], warnings };
}

/** PrusaSlicer / SuperSlicer / Slic3r INI: either a single exported config or a config bundle with [print:..] sections. */
export function importPrusaINI(text: string): { presets: Preset[]; warnings: string[] } {
  const sections: { kind: PresetKind | "all"; name: string; kv: Record<string, string> }[] = [];
  let cur: (typeof sections)[number] = { kind: "all", name: "Imported", kv: {} };
  sections.push(cur);
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#") || l.startsWith(";")) continue;
    const sec = l.match(/^\[(print|filament|printer):(.+)\]$/);
    if (sec) {
      cur = { kind: ({ print: "process", filament: "filament", printer: "machine" } as const)[sec[1] as "print" | "filament" | "printer"], name: sec[2].trim(), kv: {} };
      sections.push(cur); continue;
    }
    if (/^\[.*\]$/.test(l)) { cur = { kind: "all", name: "ignored", kv: {} }; continue; } // [presets], [physical_printer:..]
    const eq = l.indexOf("=");
    if (eq > 0) cur.kv[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
  }
  const presets: Preset[] = [], warnings: string[] = [];
  for (const s of sections) {
    if (!Object.keys(s.kv).length || s.name === "ignored") continue;
    const kinds: PresetKind[] = s.kind === "all" ? ["machine", "filament", "process"] : [s.kind];
    const r = mapSettings(s.kv, "prusa", kinds);
    warnings.push(...r.warnings.map((w) => `${s.name}: ${w}`));
    for (const k of kinds) if (Object.keys(r.values[k]).length) presets.push(makePreset(k, s.kind === "all" ? `${s.name} ${k}` : s.name, r.values[k]));
  }
  if (!presets.length) throw new Error("No supported PrusaSlicer settings found in INI");
  return { presets, warnings };
}

/** NexSpiro presets → Bambu project_settings.config keys (strings / string arrays, as Bambu writes them). */
export function toBambuSettings(vals: { machine: MachinePreset; filament: Record<string, unknown>; process: Record<string, unknown> }, names: Record<PresetKind, string>) {
  const out: Record<string, unknown> = {
    printer_settings_id: names.machine, filament_settings_id: [names.filament], print_settings_id: names.process,
    spiral_mode: "1", wall_loops: "1", sparse_infill_density: "0%", top_shell_layers: "0",
  };
  const ARRAY_KEYS = new Set(["nozzle_diameter", "filament_diameter", "filament_flow_ratio", "filament_density", "filament_cost",
    "nozzle_temperature", "nozzle_temperature_initial_layer", "hot_plate_temp", "hot_plate_temp_initial_layer", "filament_max_volumetric_speed",
    "fan_min_speed", "fan_max_speed", "close_fan_the_first_x_layers", "fan_cooling_layer_time", "slow_down_layer_time", "slow_down_min_speed",
    "retraction_length", "retraction_speed"]);
  const all = { ...vals.machine, ...vals.filament, ...vals.process } as Record<string, unknown>;
  for (const e of KEY_MAP) {
    const v = (e.kind === "machine" ? vals.machine as unknown as Record<string, unknown> : e.kind === "filament" ? vals.filament : vals.process)[e.path] ?? all[e.path];
    if (v === undefined) continue;
    const key = e.bambu[0];
    let s: unknown;
    if (e.conv === "bed") { const [x, y] = v as [number, number]; s = [`0x0`, `${x}x0`, `${x}x${y}`, `0x${y}`]; }
    else if (e.conv === "exclude") s = ((v as [number, number][][])[0] ?? []).map(([x, y]) => `${x}x${y}`);
    else if (e.conv === "flavor") s = v === "klipper" ? "klipper" : "marlin";
    else if (e.conv === "gcode") s = toBambuTemplate(String(v), vals.machine);
    else s = String(v);
    out[key] = ARRAY_KEYS.has(key) && !Array.isArray(s) ? [s] : s;
  }
  return out;
}

/** NexSpiro {placeholders} → Bambu Studio [placeholders]; machine constants are substituted as numbers. */
const TO_BAMBU: Record<string, string> = {
  nozzle_temperature_initial_layer: "nozzle_temperature_initial_layer", nozzle_temperature: "nozzle_temperature",
  bed_temperature_initial_layer: "bed_temperature_initial_layer_single", bed_temperature: "bed_temperature",
  layer_num: "layer_num", layer_z: "layer_z", total_layer_count: "total_layer_count",
  layer_height: "layer_height", first_layer_height: "initial_layer_print_height",
};
export function toBambuTemplate(tpl: string, m: MachinePreset): string {
  const fixed = fillTemplate(tpl, { bed_x: m.bed[0], bed_y: m.bed[1], travel_feed: m.travelSpeed * 60 });
  return fixed.replace(/\{(\w+)\}/g, (all, k: string) => (TO_BAMBU[k] ? `[${TO_BAMBU[k]}]` : all));
}
