// Advanced-mode state (engine mode, intent, technology overrides, machine overrides, Zone Inspector)
// and the bridge to the analysis worker. Kept apart from the main store so Basic mode is untouched.
import { create } from 'zustand';
import type { AdvancedConfig, CausticTarget, EngineMode, FieldId, IntentId, MachineOverrides, ObjectAnalysis, ParamValue, TechId, TechOverride } from '../engine/advanced/types';
import { RESOLUTION_CELLS } from '../engine/advanced/analysis';
import { transformVertices } from '../engine/mesh';
import { objectMatrix, useStore } from './store';
import { resolveConfig } from '../profiles/resolve';

export interface AdvancedState {
  engineMode: EngineMode;
  intent: IntentId;
  techs: Partial<Record<TechId, TechOverride>>;
  machine: MachineOverrides;
  resolution: 'draft' | 'normal' | 'fine';
  load: { dir: [number, number, number]; newtons: number };
  caustic: CausticTarget | null;
  /** Zone Inspector. */
  field: FieldId;
  heatmap: boolean;
  showVoxels: boolean;
  /** Paint value for the Advanced paint tool: 1 fixture, 2 load, 3 matte, 4 gloss. */
  paintValue: 1 | 2 | 3 | 4;
  analysis: Record<string, ObjectAnalysis & { mesh: unknown }>;
  /** Bumped whenever the analysis changes (the viewport recolours on it). */
  analysisVersion: number;
  analysing: boolean;
  analysisError: string | null;
  /** Expanded technology rows and the node-graph modal. */
  expanded: TechId | null;
  graphOpen: boolean;
  set: (p: Partial<AdvancedState>) => void;
}

const LS = 'nexspiro.advanced.v1';
const prefs: any = (() => { try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); } catch { return {}; } })();

export const useAdvanced = create<AdvancedState>((set) => ({
  engineMode: prefs.engineMode === 'advanced' ? 'advanced' : 'basic',
  intent: prefs.intent ?? 'aesthetic',
  techs: prefs.techs ?? {},
  machine: prefs.machine ?? {},
  resolution: prefs.resolution ?? 'normal',
  load: prefs.load ?? { dir: [0, 0, -1], newtons: 50 },
  caustic: null,
  field: prefs.field ?? 'zones',
  heatmap: prefs.heatmap ?? true,
  showVoxels: prefs.showVoxels ?? false,
  paintValue: 1,
  analysis: {},
  analysisVersion: 0,
  analysing: false,
  analysisError: null,
  expanded: null,
  graphOpen: false,
  set: (p) => set(p),
}));

useAdvanced.subscribe((s, prev) => {
  try {
    localStorage.setItem(LS, JSON.stringify({ engineMode: s.engineMode, intent: s.intent, techs: s.techs, machine: s.machine, resolution: s.resolution, load: s.load, field: s.field, heatmap: s.heatmap, showVoxels: s.showVoxels }));
  } catch { /* storage unavailable */ }
  // anything that changes the G-code marks the slice dirty
  if (s.engineMode !== prev.engineMode || s.intent !== prev.intent || s.techs !== prev.techs || s.machine !== prev.machine || s.resolution !== prev.resolution || s.load !== prev.load || s.caustic !== prev.caustic) {
    useStore.getState().markDirty();
  }
});

export const isAdvanced = () => useAdvanced.getState().engineMode === 'advanced';

/** Config sent to the slicer in Advanced mode, or undefined in Basic mode. */
export function advancedSliceConfig(): AdvancedConfig | undefined {
  const a = useAdvanced.getState();
  if (a.engineMode !== 'advanced') return undefined;
  return {
    intent: a.intent, printerId: useStore.getState().printerId, techs: a.techs, machine: a.machine, resolution: a.resolution,
    load: a.load, ...(a.caustic ? { caustic: a.caustic } : {}),
  };
}

export function setTech(id: TechId, patch: { enabled?: boolean; param?: [string, ParamValue] }) {
  const a = useAdvanced.getState();
  const cur = a.techs[id] ?? {};
  const next: TechOverride = { ...cur };
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.param) next.params = { ...(cur.params ?? {}), [patch.param[0]]: patch.param[1] };
  a.set({ techs: { ...a.techs, [id]: next } });
}

export function resetTech(id: TechId) {
  const a = useAdvanced.getState();
  const t = { ...a.techs };
  delete t[id];
  a.set({ techs: t });
}

// ---------------- analysis worker (Zone Inspector)
let worker: Worker | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Re-analyse the plate's objects shortly after the scene settles. */
export function scheduleAnalysis(delay = 450) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(runAnalysis, delay);
}

export function runAnalysis() {
  const a = useAdvanced.getState();
  if (a.engineMode !== 'advanced') return;
  const s = useStore.getState();
  const objs = s.objects.filter((o) => o.printable !== false);
  if (!objs.length) { a.set({ analysis: {}, analysing: false, analysisVersion: a.analysisVersion + 1 }); return; }
  worker?.terminate();
  worker = new Worker(new URL('../engine/advanced/analysisWorker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const cfg = resolveConfig({ printerId: s.printerId, plate: s.plate, filamentId: s.filaments[0].presetId, presetId: s.presetId, overrides: s.overrides, machineOverrides: s.machineOverrides });
  const num = (k: string, d: number) => (typeof cfg[k] === 'number' && cfg[k] ? (cfg[k] as number) : d);
  const lw = (k: string) => num(k, num('line_width', 0.42));
  const objects = objs.map((o) => ({
    id: o.id, name: o.name, vertices: transformVertices(o.mesh.vertices, objectMatrix(o).elements), indices: o.mesh.indices,
    color: o.paint?.color, advPaint: o.paint?.adv, meshRef: o.mesh,
  }));
  const refs = new Map(objects.map((o) => [o.id, o.meshRef]));
  a.set({ analysing: true, analysisError: null });
  worker.onmessage = (ev) => {
    if (ev.data.id !== id) return;
    if (ev.data.type === 'error') { useAdvanced.getState().set({ analysing: false, analysisError: ev.data.message }); return; }
    const out: Record<string, ObjectAnalysis & { mesh: unknown }> = {};
    for (const r of ev.data.results as ObjectAnalysis[]) out[r.id] = { ...r, mesh: refs.get(r.id) };
    useAdvanced.getState().set({ analysis: out, analysing: false, analysisVersion: useAdvanced.getState().analysisVersion + 1 });
  };
  worker.postMessage({
    id,
    objects: objects.map(({ meshRef: _m, ...o }) => o),
    params: {
      cells: RESOLUTION_CELLS[a.resolution],
      shell: lw('outer_wall_line_width') + Math.max(0, Math.round(num('wall_loops', 2)) - 1) * lw('inner_wall_line_width'),
      lineWidth: lw('line_width'), layerHeight: num('layer_height', 0.2), overhangDeg: num('support_threshold_angle', 30),
      // the stress field of the inspector uses the same load case as the slice
      load: a.load,
    },
  });
}

// keep the inspector current while Advanced mode is on
useStore.subscribe((s, prev) => {
  if (useAdvanced.getState().engineMode !== 'advanced') return;
  if (s.objects !== prev.objects || s.printerId !== prev.printerId) scheduleAnalysis();
});
useAdvanced.subscribe((s, prev) => {
  if (s.engineMode === 'advanced' && (prev.engineMode !== 'advanced' || s.resolution !== prev.resolution || s.load !== prev.load)) scheduleAnalysis(50);
});
