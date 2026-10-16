// Calibration workspace: each routine builds real test models plus the per-layer setting changes
// ('config' layer actions) or per-object overrides that make the test, then puts them on the plate.
import { create } from 'zustand';
import { weld } from '../engine/mesh';
import type { LayerAction } from '../engine/types';
import { filamentById } from '../profiles/filaments';
import { printerById } from '../profiles/printers';
import type { Config } from '../profiles/settings';
import { emptyProject, newId, useStore, type FilamentTuning, type SceneObject } from './store';

export type CalibId = 'temp' | 'pa' | 'flow' | 'flow_fine' | 'mvs' | 'retraction';

export interface CalibResult {
  objects: SceneObject[];
  layerActions: LayerAction[];
  overrides: Config;
  /** How to read the result, shown after the plate is created. */
  howTo: string;
  /** Value lookup for the "apply result" step: label -> tuning. */
  choices: { label: string; tuning: FilamentTuning }[];
}

// ---------------------------------------------------------------- geometry
function box(x0: number, y0: number, z0: number, sx: number, sy: number, sz: number): number[] {
  const x1 = x0 + sx, y1 = y0 + sy, z1 = z0 + sz;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.flatMap((t) => t.flatMap((i) => v[i]));
}
function cylinder(r: number, h: number, seg = 96, z0 = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [r * Math.cos(a0), r * Math.sin(a0)], p1 = [r * Math.cos(a1), r * Math.sin(a1)];
    out.push(0, 0, z0, p1[0], p1[1], z0, p0[0], p0[1], z0);
    out.push(0, 0, z0 + h, p0[0], p0[1], z0 + h, p1[0], p1[1], z0 + h);
    out.push(p0[0], p0[1], z0, p1[0], p1[1], z0, p1[0], p1[1], z0 + h);
    out.push(p0[0], p0[1], z0, p1[0], p1[1], z0 + h, p0[0], p0[1], z0 + h);
  }
  return out;
}
/** Temperature tower block: a base slab, a pillar and a 45° + bridge overhang to judge quality. */
function tempBlock(z0: number, h: number): number[] {
  return [
    ...box(-15, -5, z0, 30, 10, 1.2), // separating slab (shows layer adhesion)
    ...box(-15, -5, z0 + 1.2, 6, 10, h - 1.2), // left pillar
    ...box(9, -5, z0 + 1.2, 6, 10, h - 1.2), // right pillar
    ...box(-9, -1, z0 + h - 2, 18, 2, 2), // bridge between the pillars
    ...box(-3, -5, z0 + 1.2, 3, 10, h * 0.6), // thin fin (stringing between pillars)
  ];
}
const mk = (name: string, soup: number[], x: number, y: number, extra: Partial<SceneObject> = {}): SceneObject => {
  const mesh = weld(new Float32Array(soup));
  // centre XY, keep z
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    minX = Math.min(minX, mesh.vertices[i]); maxX = Math.max(maxX, mesh.vertices[i]);
    minY = Math.min(minY, mesh.vertices[i + 1]); maxY = Math.max(maxY, mesh.vertices[i + 1]);
    minZ = Math.min(minZ, mesh.vertices[i + 2]);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  for (let i = 0; i < mesh.vertices.length; i += 3) { mesh.vertices[i] -= cx; mesh.vertices[i + 1] -= cy; mesh.vertices[i + 2] -= minZ; }
  return { id: newId(), name, mesh, position: [x, y, 0], rotation: [0, 0, 0], scale: [1, 1, 1], openEdges: 0, ...extra };
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- routines
export interface CalibParams { start: number; end: number; step: number }

export const CALIBRATIONS: { id: CalibId; title: string; description: string; params: (fil: ReturnType<typeof filamentById>, flavor: string) => CalibParams & { unit: string; label: string } }[] = [
  { id: 'temp', title: 'Temperature tower', description: 'Steps the nozzle temperature every 10 mm. Pick the block with the best bridges, overhang and least stringing.',
    params: (f) => ({ start: f.nozzleTemp + 15, end: f.nozzleTemp - 15, step: 5, unit: '°C', label: 'Temperature' }) },
  { id: 'pa', title: 'Pressure advance (flow dynamics)', description: 'A tower whose pressure advance increases with height. Find the height where the corners are sharpest without gaps.',
    params: (_f, flavor) => ({ start: 0, end: flavor === 'bambu' ? 0.06 : 0.1, step: 0.002, unit: '', label: 'K / pressure advance' }) },
  { id: 'flow', title: 'Flow rate — coarse', description: 'Nine patches from −20% to +20% flow. Pick the smoothest top surface without gaps or ridges.',
    params: () => ({ start: -20, end: 20, step: 5, unit: '%', label: 'Flow offset' }) },
  { id: 'flow_fine', title: 'Flow rate — fine', description: 'Ten patches from −9% to 0% around your coarse result for a precise flow ratio.',
    params: () => ({ start: -9, end: 0, step: 1, unit: '%', label: 'Flow offset' }) },
  { id: 'mvs', title: 'Max volumetric speed', description: 'A single-wall vase that speeds up with height. Where the wall starts to fail is your hotend\'s limit.',
    params: (f) => ({ start: 5, end: Math.max(20, Math.round(f.maxVolumetricSpeed * 1.6)), step: 0.5, unit: 'mm³/s', label: 'Volumetric speed' }) },
  { id: 'retraction', title: 'Retraction test', description: 'Two towers; retraction length increases every 2 mm. Pick the lowest length with no strings between the towers.',
    params: (_f, flavor) => ({ start: 0, end: flavor === 'marlin' ? 4 : 2, step: flavor === 'marlin' ? 0.4 : 0.2, unit: 'mm', label: 'Retraction length' }) },
];

export function buildCalibration(id: CalibId, p: CalibParams, printerId: string, filamentId: string): CalibResult {
  const printer = printerById(printerId);
  const fil = filamentById(filamentId);
  const bx = printer.bed.x / 2, by = printer.bed.y / 2;
  const flavor = printer.flavor;
  const dir = p.end >= p.start ? 1 : -1;
  const steps = Math.max(1, Math.floor(Math.abs(p.end - p.start) / p.step + 1e-6) + 1);
  const values = Array.from({ length: steps }, (_, i) => r3(p.start + dir * i * p.step));

  if (id === 'temp') {
    const h = 10;
    const obj = mk(`Temp tower ${values[0]}→${values.at(-1)}°C`, [...box(-20, -8, 0, 40, 16, 1), ...values.flatMap((_, i) => tempBlock(1 + i * h, h))], bx, by);
    return {
      objects: [obj], overrides: { enable_support: false, wall_loops: 2, sparse_infill_density: 15 },
      layerActions: values.map((t, i) => ({ z: i === 0 ? 0.01 : 1 + i * h, type: 'config', key: 'nozzle_temperature', value: t, gcode: `M104 S${t} ; temperature tower: ${t}°C` })),
      howTo: `Blocks from the bottom: ${values.join(', ')} °C (10 mm each, above a 1 mm base).`,
      choices: values.map((t) => ({ label: `${t} °C`, tuning: { nozzleTemp: t } })),
    };
  }
  if (id === 'pa') {
    const height = Math.min(printer.bed.z - 10, 1 + values.length * 1); // 1 mm per step
    const wall = 0.9;
    const soup = [...box(-20, -20, 0, 40, 40, 1),
      ...box(-20, -20, 1, 40, wall, height - 1), ...box(-20, 20 - wall, 1, 40, wall, height - 1),
      ...box(-20, -20 + wall, 1, wall, 40 - 2 * wall, height - 1), ...box(20 - wall, -20 + wall, 1, wall, 40 - 2 * wall, height - 1)];
    const obj = mk(`PA tower ${values[0]}→${values.at(-1)}`, soup, bx, by);
    const cmd = (k: number) => (flavor === 'klipper' ? `SET_PRESSURE_ADVANCE ADVANCE=${k}` : `M900 K${k}`);
    return {
      objects: [obj],
      overrides: { wall_loops: 1, top_shell_layers: 0, bottom_shell_layers: 3, sparse_infill_density: 0, outer_wall_speed: 120, inner_wall_speed: 150, outer_wall_acceleration: 5000, slow_down_layer_time: 0, enable_support: false, seam_position: 'aligned' },
      layerActions: values.map((k, i) => ({ z: 1 + i, type: 'custom', gcode: `${cmd(k)} ; PA tower ${k} at ${(1 + i).toFixed(1)} mm` })),
      howTo: `Pressure advance starts at ${values[0]} at Z = 1 mm and rises by ${p.step} per mm. Measure the height (mm above the plate) with the sharpest corners: value = ${values[0]} + (height − 1) × ${p.step}.`,
      choices: values.map((k, i) => ({ label: `${(1 + i).toFixed(0)} mm → ${k}`, tuning: { pressureAdvance: k } })),
    };
  }
  if (id === 'flow' || id === 'flow_fine') {
    const base = fil.flowRatio;
    const cols = Math.ceil(Math.sqrt(values.length));
    const objects = values.map((v, i) => {
      const x = bx + ((i % cols) - (cols - 1) / 2) * 28;
      const y = by - (Math.floor(i / cols) - (Math.ceil(values.length / cols) - 1) / 2) * 28;
      const notch = v < 0 ? box(-10, 8, 2.5, 3, 2, 0.5) : []; // tiny marker on negative patches
      return mk(`Flow ${v >= 0 ? '+' : ''}${v}%`, [...box(-10, -10, 0, 20, 20, 3), ...notch], x, y, { overrides: { flow_ratio_scale: r3(1 + v / 100), top_surface_pattern: 'monotonic', top_shell_layers: 4, sparse_infill_density: 35 } });
    });
    return {
      objects, layerActions: [], overrides: { enable_support: false, ironing_type: 'no_ironing' },
      howTo: `Patches are labelled in the object list (${values.map((v) => `${v >= 0 ? '+' : ''}${v}%`).join(', ')}); negative patches carry a small marker. Pick the smoothest top surface.`,
      choices: values.map((v) => ({ label: `${v >= 0 ? '+' : ''}${v}% → ${r3(base * (1 + v / 100))}`, tuning: { flowRatio: r3(base * (1 + v / 100)) } })),
    };
  }
  if (id === 'mvs') {
    const w = 0.45 * (printer.nozzle / 0.4) * 1.5, h = 0.3;
    const xs = (w - h) * h + Math.PI * (h / 2) ** 2;
    const mmPerStep = 1;
    const height = Math.min(printer.bed.z - 10, 1 + values.length * mmPerStep);
    const obj = mk(`Volumetric speed ${values[0]}→${values.at(-1)} mm³/s`, cylinder(25, height), bx, by);
    return {
      objects: [obj],
      overrides: { spiral_mode: true, layer_height: h, outer_wall_line_width: r3(w), bottom_shell_layers: 3, slow_down_layer_time: 0, enable_support: false, sparse_infill_density: 0 },
      layerActions: [
        { z: 0.01, type: 'config', key: 'filament_max_volumetric_speed', value: 1000 },
        ...values.map((v, i) => ({ z: 1 + i * mmPerStep, type: 'config' as const, key: 'outer_wall_speed', value: r3(v / xs), gcode: `; volumetric speed ${v} mm³/s` })),
      ],
      howTo: `Volumetric speed starts at ${values[0]} mm³/s at 1 mm and rises by ${p.step} mm³/s per mm. Measure where the wall first gets rough or gaps: value = ${values[0]} + (height − 1) × ${p.step}. Use ~90% of that.`,
      choices: values.map((v, i) => ({ label: `${(1 + i).toFixed(0)} mm → ${r3(v * 0.9)} mm³/s`, tuning: { maxVolumetricSpeed: r3(v * 0.9) } })),
    };
  }
  // retraction
  const stepMm = 2;
  const height = 1 + values.length * stepMm;
  const soup = [...box(-25, -6, 0, 50, 12, 1), ...box(-20, -4, 1, 8, 8, height - 1), ...box(12, -4, 1, 8, 8, height - 1)];
  return {
    objects: [mk(`Retraction ${values[0]}→${values.at(-1)} mm`, soup, bx, by)],
    overrides: { wall_loops: 2, sparse_infill_density: 15, enable_support: false, z_hop: 0, retraction_minimum_travel: 1, slow_down_layer_time: 0 },
    layerActions: values.map((v, i) => ({ z: 1 + i * stepMm, type: 'config', key: 'retraction_length', value: v, gcode: `; retraction ${v} mm` })),
    howTo: `Retraction starts at ${values[0]} mm at Z = 1 mm and increases by ${p.step} mm every ${stepMm} mm of height.`,
    choices: values.map((v, i) => ({ label: `${(1 + i * stepMm).toFixed(0)}–${(1 + (i + 1) * stepMm).toFixed(0)} mm → ${v} mm`, tuning: { retractionLength: v } })),
  };
}

/** The last calibration put on the plate, so its result can be saved after printing. */
export const useCalibration = create<{ last: { id: CalibId; result: CalibResult } | null; choice: number }>(() => ({ last: null, choice: 0 }));

/** Replace the plate with a calibration test. */
export function startCalibration(id: CalibId, p: CalibParams) {
  const s = useStore.getState();
  if (s.objects.length && !confirm('Start a calibration? The current plate will be replaced (save your project first if needed).')) return null;
  const r = buildCalibration(id, p, s.printerId, s.filaments[0].presetId);
  s.set({
    objects: r.objects, selected: [], selectedPart: null, undoStack: [], redoStack: [],
    overrides: { ...s.overrides, ...r.overrides },
    plates: [{ id: 'plate1', name: 'Plate 1', layerActions: r.layerActions }], activePlate: 0,
    project: { ...emptyProject(), title: CALIBRATIONS.find((c) => c.id === id)!.title, notes: r.howTo },
    slice: { status: 'idle', stage: '', progress: 0, result: null, error: null, dirty: true, plate: 0 },
    workspace: 'prepare',
    toast: { kind: 'info', text: `${CALIBRATIONS.find((c) => c.id === id)!.title} is on the plate. Slice and print it, then come back to Calibration to save the result.` },
  });
  useCalibration.setState({ last: { id, result: r }, choice: 0 });
  return r;
}

export function applyTuning(slot: number, t: FilamentTuning) {
  const s = useStore.getState();
  const filaments = s.filaments.map((f, i) => (i === slot ? { ...f, tuning: { ...f.tuning, ...t } } : f));
  s.set({ filaments });
  s.markDirty();
}
