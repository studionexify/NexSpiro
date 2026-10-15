// Application state (zustand). Scene objects are immutable records; meshes are shared by reference.
import { create } from 'zustand';
import * as THREE from 'three';
import type { IndexedMesh } from '../engine/mesh';
import type { SliceOutput } from '../engine/types';
import type { PlateType } from '../profiles/printers';
import { printerById } from '../profiles/printers';
import type { Config, ProcessTab } from '../profiles/settings';
import { filamentById } from '../profiles/filaments';

export type Workspace = 'home' | 'prepare' | 'preview' | 'device' | 'project' | 'calibration';
export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'face';
export type Theme = 'dark' | 'light';
export type ColorScheme = 'feature' | 'speed' | 'height' | 'width' | 'flow' | 'layer_time';

export interface SceneObject {
  id: string;
  name: string;
  mesh: IndexedMesh; // local coordinates, centred, min z = 0
  position: [number, number, number];
  rotation: [number, number, number]; // degrees, XYZ euler
  scale: [number, number, number];
  openEdges: number;
}

export interface SliceState {
  status: 'idle' | 'slicing' | 'done' | 'error';
  stage: string;
  progress: number;
  result: SliceOutput | null;
  error: string | null;
  dirty: boolean; // scene/settings changed since last slice
}

interface State {
  theme: Theme;
  workspace: Workspace;
  tool: Tool;
  objects: SceneObject[];
  selected: string[];
  undoStack: SceneObject[][];
  redoStack: SceneObject[][];

  printerId: string;
  plate: PlateType;
  filamentId: string;
  filamentColor: string;
  presetId: string;
  overrides: Config;
  machineOverrides: Config;
  processTab: ProcessTab;
  processMode: 'global' | 'objects';
  showAdvanced: boolean;
  search: string;
  showOverhangs: boolean;

  slice: SliceState;
  colorScheme: ColorScheme;
  hiddenFeatures: string[];
  showTravel: boolean;
  layerRange: [number, number];
  moveCursor: number; // index within top layer, -1 = all
  toast: { kind: 'info' | 'error' | 'warn'; text: string } | null;

  set: (p: Partial<State>) => void;
  addObjects: (o: SceneObject[]) => void;
  updateObjects: (fn: (o: SceneObject) => SceneObject, ids?: string[], record?: boolean) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  setOverride: (key: string, v: Config[string] | undefined) => void;
  setMachine: (key: string, v: Config[string] | undefined) => void;
  markDirty: () => void;
}

let idSeq = 0;
export const newId = () => `obj${Date.now().toString(36)}${(idSeq++).toString(36)}`;

const LS = 'nexspiro.prefs.v1';
const loadPrefs = (): Partial<State> => {
  try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); } catch { return {}; }
};
const prefs = typeof localStorage !== 'undefined' ? loadPrefs() : {};
const systemTheme: Theme = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

export const useStore = create<State>((set, get) => ({
  theme: (prefs.theme as Theme) ?? systemTheme,
  workspace: 'prepare',
  tool: 'select',
  objects: [],
  selected: [],
  undoStack: [],
  redoStack: [],

  printerId: prefs.printerId ?? 'bbl-p1s',
  plate: (prefs.plate as PlateType) ?? 'textured_pei_plate',
  filamentId: prefs.filamentId ?? 'generic-pla',
  filamentColor: prefs.filamentColor ?? filamentById(prefs.filamentId ?? 'generic-pla').color,
  presetId: prefs.presetId ?? '0.20',
  overrides: prefs.overrides ?? {},
  machineOverrides: prefs.machineOverrides ?? {},
  processTab: 'Quality',
  processMode: 'global',
  showAdvanced: false,
  search: '',
  showOverhangs: false,

  slice: { status: 'idle', stage: '', progress: 0, result: null, error: null, dirty: true },
  colorScheme: 'feature',
  hiddenFeatures: [],
  showTravel: false,
  layerRange: [0, 0],
  moveCursor: -1,
  toast: null,

  set: (p) => set(p),
  checkpoint: () => set((s) => ({ undoStack: [...s.undoStack.slice(-49), s.objects], redoStack: [] })),
  addObjects: (o) => {
    get().checkpoint();
    set((s) => ({ objects: [...s.objects, ...o], selected: o.map((x) => x.id) }));
    get().markDirty();
  },
  updateObjects: (fn, ids, record = true) => {
    if (record) get().checkpoint();
    const sel = new Set(ids ?? get().selected);
    set((s) => ({ objects: s.objects.map((o) => (sel.has(o.id) ? fn(o) : o)) }));
    get().markDirty();
  },
  removeSelected: () => {
    const sel = new Set(get().selected);
    if (!sel.size) return;
    get().checkpoint();
    set((s) => ({ objects: s.objects.filter((o) => !sel.has(o.id)), selected: [] }));
    get().markDirty();
  },
  duplicateSelected: () => {
    const sel = get().objects.filter((o) => get().selected.includes(o.id));
    if (!sel.length) return;
    const copies = sel.map((o) => ({ ...o, id: newId(), name: `${o.name} (copy)`, position: [o.position[0] + 10, o.position[1] + 10, o.position[2]] as [number, number, number] }));
    get().addObjects(copies);
  },
  undo: () => {
    const s = get();
    if (!s.undoStack.length) return;
    set({ objects: s.undoStack[s.undoStack.length - 1], undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, s.objects] });
    get().markDirty();
  },
  redo: () => {
    const s = get();
    if (!s.redoStack.length) return;
    set({ objects: s.redoStack[s.redoStack.length - 1], redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, s.objects] });
    get().markDirty();
  },
  setOverride: (key, v) => {
    set((s) => {
      const o = { ...s.overrides };
      if (v === undefined) delete o[key]; else o[key] = v;
      return { overrides: o };
    });
    get().markDirty();
  },
  setMachine: (key, v) => {
    set((s) => {
      const o = { ...s.machineOverrides };
      if (v === undefined) delete o[key]; else o[key] = v;
      return { machineOverrides: o };
    });
    get().markDirty();
  },
  markDirty: () => set((s) => (s.slice.dirty ? {} : { slice: { ...s.slice, dirty: true } })),
}));

// persist preferences
useStore.subscribe((s) => {
  try {
    localStorage.setItem(LS, JSON.stringify({
      theme: s.theme, printerId: s.printerId, plate: s.plate, filamentId: s.filamentId, filamentColor: s.filamentColor,
      presetId: s.presetId, overrides: s.overrides, machineOverrides: s.machineOverrides,
    }));
  } catch { /* storage unavailable */ }
});

// ----- geometry helpers on scene objects
export function objectMatrix(o: Pick<SceneObject, 'position' | 'rotation' | 'scale'>): THREE.Matrix4 {
  const d = Math.PI / 180;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...o.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotation[0] * d, o.rotation[1] * d, o.rotation[2] * d, 'XYZ')),
    new THREE.Vector3(...o.scale),
  );
}

export function worldBounds(o: SceneObject) {
  const m = objectMatrix(o).elements;
  const v = o.mesh.vertices;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
  }
  return { min, max };
}

/** Shift z so the object rests on the bed. */
export function dropToBed(o: SceneObject): SceneObject {
  const b = worldBounds(o);
  return { ...o, position: [o.position[0], o.position[1], o.position[2] - b.min[2]] };
}

export function isOutOfBounds(o: SceneObject, printerId: string): boolean {
  const p = printerById(printerId);
  const b = worldBounds(o);
  const e = 0.01;
  return b.min[0] < -e || b.min[1] < -e || b.max[0] > p.bed.x + e || b.max[1] > p.bed.y + e || b.max[2] > p.bed.z + e;
}
