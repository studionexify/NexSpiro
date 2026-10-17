// Application state (zustand). Scene objects are immutable records; meshes are shared by reference.
import type { CalibProgram } from '../engine/calibGcode';
import type { MeasureFeature, MeasureMode } from './measure';
import type { BrushType } from '../engine/brush';
import { DEFAULT_CONNECTOR, DEFAULT_GROOVE, type ConnectorSettings, type GrooveSettings } from './cutConnectors';
import { create } from 'zustand';
import * as THREE from 'three';
import type { IndexedMesh } from '../engine/mesh';
import type { LayerAction, PartType, SliceOutput } from '../engine/types';
import type { PlateType } from '../profiles/printers';
import { printerById } from '../profiles/printers';
import { CONFIG_VERSION, migrateConfig, type Config, type ProcessTab } from '../profiles/settings';
import type { ObjectPatternex } from '../plugins/patternex/ui/state';
import { filamentById } from '../profiles/filaments';

export type Workspace = 'home' | 'prepare' | 'preview' | 'motion' | 'device' | 'project' | 'calibration';
export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'face' | 'paint_support' | 'paint_seam' | 'paint_color' | 'paint_motion' | 'pick_motion' | 'lasso_motion' | 'band_motion' | 'object_motion' | 'place_pattern' | 'vlh' | 'cut' | 'text' | 'measure' | 'boolean' | 'paint_adv' | 'brim_ears';
export type Theme = 'dark' | 'light';
export type ColorScheme = 'feature' | 'filament' | 'speed' | 'height' | 'width' | 'flow' | 'layer_time' | 'layer_time_log' | 'fan' | 'temperature';

export type Vec3 = [number, number, number];

export interface ScenePart {
  id: string;
  name: string;
  type: PartType;
  mesh: IndexedMesh; // local, centred
  position: Vec3; // relative to the object origin (object frame)
  rotation: Vec3;
  scale: Vec3;
  overrides: Config; // modifier settings
}

/** motion: surface sets for plugins such as Motionex (0 none, n = surface set n). adv: Advanced mode (1 fixture, 2 load, 3 matte, 4 gloss). */
export interface ObjectPaint { support?: Uint8Array; seam?: Uint8Array; color?: Uint8Array; motion?: Uint8Array; adv?: Uint8Array }

export interface SceneObject {
  id: string;
  name: string;
  mesh: IndexedMesh; // local coordinates, centred, min z = 0
  position: Vec3; // world (scene) coordinates — plate origin included
  rotation: Vec3; // degrees, XYZ euler
  scale: Vec3;
  openEdges: number;
  filament?: number; // 0-based slot
  overrides?: Config;
  parts?: ScenePart[];
  paint?: ObjectPaint;
  layerHeights?: number[];
  /** false: kept on the plate but left out of slicing. */
  printable?: boolean;
  /** Patternex artwork on this object (object-local), so undo, project files and object operations carry it. */
  patternex?: ObjectPatternex;
  /** Height range modifiers: their own settings for a band of layers (object-relative mm). */
  heightRanges?: HeightRange[];
  /** Brim ear points painted with the brim ears tool (object-local XY, mm). */
  /** Painted brim ears, object-local points (z kept so tilted objects map correctly). */
  brimEars?: [number, number, number?][];
  /** Hidden in the 3D view (object list eye); still sliced unless not printable. */
  hidden?: boolean;
}

export interface HeightRange { id: string; z0: number; z1: number; overrides: Config }

/** Values found with the Calibration workspace, applied on top of the filament preset. */
export interface FilamentTuning { flowRatio?: number; pressureAdvance?: number; maxVolumetricSpeed?: number; nozzleTemp?: number; retractionLength?: number }
/** A filament slot: preset, colour, the user's own setting edits and calibration results. */
export interface FilamentSlotState { presetId: string; color: string; tuning?: FilamentTuning; overrides?: Config }
export interface ProjectInfo { title: string; author: string; description: string; license: string; notes: string; photos: { name: string; dataUrl: string }[] }
export const emptyProject = (): ProjectInfo => ({ title: '', author: '', description: '', license: '', notes: '', photos: [] });
/** A build plate. bedType / spiralVase override the global settings for this plate (undefined = same as global). */
export interface Plate {
  id: string; name: string; layerActions: LayerAction[];
  /** Locked plates are skipped by arrange and auto orient. */
  locked?: boolean;
  bedType?: PlateType;
  spiralVase?: boolean;
  /** Print sequence of this plate (undefined = same as global). */
  printSequence?: 'by_layer' | 'by_object';
  /** Drawn calibration program printed instead of the plate's objects (PA line / pattern). */
  program?: CalibProgram;
}

/** Right-click menu: where it opened and what was under the cursor. */
export interface ContextMenuState { x: number; y: number; kind: 'plate' | 'object' | 'part'; plate: number; id?: string; partId?: string; world?: [number, number] }

export interface SliceState {
  status: 'idle' | 'slicing' | 'done' | 'error';
  stage: string;
  progress: number;
  result: SliceOutput | null;
  error: string | null;
  dirty: boolean; // scene/settings changed since last slice
  plate: number; // plate index the result belongs to
}

interface State {
  theme: Theme;
  workspace: Workspace;
  tool: Tool;
  objects: SceneObject[];
  selected: string[];
  selectedPart: string | null;
  /** Height range modifier being edited (object id is the single selection). */
  selectedRange: string | null;
  shortcutsOpen: boolean;
  /** Preview: show only the top layer (L), the bottom layer it replaced, the G-code beside the move slider. */
  oneLayer: boolean;
  savedLow?: number;
  showGcode: boolean;
  undoStack: SceneObject[][];
  redoStack: SceneObject[][];

  plates: Plate[];
  activePlate: number;

  printerId: string;
  plate: PlateType;
  filaments: FilamentSlotState[];
  presetId: string;
  overrides: Config;
  machineOverrides: Config;
  processTab: ProcessTab;
  processMode: 'global' | 'objects';
  showAdvanced: boolean;
  search: string;
  showOverhangs: boolean;

  brushSize: number; // mm
  brushType: BrushType;
  /** Smart fill: largest angle between neighbouring triangles the fill crosses (°). */
  smartFillAngle: number;
  /** Gap fill: largest unpainted area filled (mm²). */
  gapArea: number;
  /** Overhang highlight angle in support painting (°). */
  paintOverhangAngle: number;
  paintColor: number; // 1-based slot for colour painting
  /** Surface set being picked/painted for plugins (1-based). */
  motionSet: number;
  /** Click-to-pick spreads across edges flatter than this (degrees). */
  motionGrowAngle: number;
  /** Draw tool shape for Motionex: freehand lasso or a box. */
  motionDraw: 'lasso' | 'box';
  /** Installed plugins (ids) and the right dock. */
  plugins: string[];
  dock: { open: boolean; width: number; tab: string };
  overhangOnly: boolean;

  slice: SliceState;
  colorScheme: ColorScheme;
  hiddenFeatures: string[];
  showTravel: boolean;
  layerRange: [number, number];
  moveCursor: number; // index within top layer, -1 = all
  toast: { kind: 'info' | 'error' | 'warn'; text: string } | null;
  project: ProjectInfo;
  /** Flushing volumes [from][to] in mm³; null = calculated from the filament colours. */
  flushMatrix: number[][] | null;
  flushMultiplier: number;
  /** Cut tool plane: world height and tilt (degrees). */
  cutPlane: { height: number; tiltX: number; tiltY: number };
  /** Cut connectors placed on the cut plane (plane coordinates), the connector settings and the placing mode. */
  cutConnectors: { x: number; y: number }[];
  cutConnector: ConnectorSettings;
  cutConnectorMode: boolean;
  cutMode: 'planar' | 'dovetail';
  cutGroove: GrooveSettings;
  /** Measure tool: picked world points (up to 2). */
  measureFeatures: MeasureFeature[];
  measureMode: MeasureMode;
  /** Arrange settings: spacing between objects, try rotations, where the group goes. */
  arrangeSettings: { spacing: number; rotate: boolean; align: 'center' | 'x' | 'y' };
  /** Surface point picked for Text / SVG volumes. */
  surfacePick: { objId: string; point: Vec3; normal: Vec3 } | null;
  contextMenu: ContextMenuState | null;
  /** Draw the plugins' quick motion preview on the model in Prepare (no slicing). */
  liveToolpaths: boolean;

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
export const newId = (p = 'obj') => `${p}${Date.now().toString(36)}${(idSeq++).toString(36)}`;

const LS = 'nexspiro.prefs.v1';
const loadPrefs = (): any => {
  try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); } catch { return {}; }
};
const prefs = typeof localStorage !== 'undefined' ? loadPrefs() : {};
const systemTheme: Theme = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
const defaultFilaments = (): FilamentSlotState[] => {
  if (Array.isArray(prefs.filaments) && prefs.filaments.length) return prefs.filaments;
  const id = prefs.filamentId ?? 'generic-pla';
  return [{ presetId: id, color: prefs.filamentColor ?? filamentById(id).color }];
};

export const useStore = create<State>((set, get) => ({
  theme: (prefs.theme as Theme) ?? systemTheme,
  workspace: 'prepare',
  tool: 'select',
  objects: [],
  selected: [],
  selectedPart: null,
  selectedRange: null,
  shortcutsOpen: false,
  oneLayer: false,
  showGcode: true,
  undoStack: [],
  redoStack: [],

  plates: [{ id: 'plate1', name: 'Plate 1', layerActions: [] }],
  activePlate: 0,
  project: emptyProject(),
  flushMatrix: null,
  flushMultiplier: 1,
  cutPlane: { height: 10, tiltX: 0, tiltY: 0 },
  cutConnectors: [],
  cutConnector: DEFAULT_CONNECTOR,
  cutConnectorMode: false,
  cutMode: 'planar',
  cutGroove: DEFAULT_GROOVE,
  measureFeatures: [],
  measureMode: 'auto',
  arrangeSettings: { spacing: 6, rotate: false, align: 'center' },
  surfacePick: null,
  contextMenu: null,
  liveToolpaths: !!prefs.liveToolpaths,

  printerId: prefs.printerId ?? 'bbl-p1s',
  plate: (prefs.plate as PlateType) ?? 'textured_pei_plate',
  filaments: defaultFilaments(),
  presetId: prefs.presetId ?? '0.20',
  overrides: migrateConfig(prefs.overrides, prefs.configVersion ?? 1),
  machineOverrides: prefs.machineOverrides ?? {},
  processTab: 'Quality',
  processMode: 'global',
  showAdvanced: false,
  search: '',
  showOverhangs: false,

  brushSize: 4,
  brushType: 'circle',
  smartFillAngle: 30,
  gapArea: 2,
  paintOverhangAngle: 30,
  paintColor: 2,
  motionSet: 1,
  motionGrowAngle: 15,
  motionDraw: 'lasso',
  plugins: Array.isArray(prefs.plugins) ? prefs.plugins : [],
  dock: { open: true, width: 340, tab: 'motionex', ...(prefs.dock ?? {}) },
  overhangOnly: false,

  slice: { status: 'idle', stage: '', progress: 0, result: null, error: null, dirty: true, plate: 0 },
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
    set((s) => ({ objects: [...s.objects, ...o], selected: o.map((x) => x.id), selectedPart: null }));
    get().markDirty();
  },
  updateObjects: (fn, ids, record = true) => {
    if (record) get().checkpoint();
    const sel = new Set(ids ?? get().selected);
    set((s) => ({ objects: s.objects.map((o) => (sel.has(o.id) ? fn(o) : o)) }));
    get().markDirty();
  },
  removeSelected: () => {
    const s = get();
    if (s.selectedPart) {
      s.checkpoint();
      const pid = s.selectedPart;
      set((st) => ({ objects: st.objects.map((o) => (o.parts?.some((p) => p.id === pid) ? { ...o, parts: o.parts.filter((p) => p.id !== pid) } : o)), selectedPart: null }));
      s.markDirty();
      return;
    }
    const sel = new Set(s.selected);
    if (!sel.size) return;
    s.checkpoint();
    set((st) => ({ objects: st.objects.filter((o) => !sel.has(o.id)), selected: [] }));
    s.markDirty();
  },
  duplicateSelected: () => {
    const sel = get().objects.filter((o) => get().selected.includes(o.id));
    if (!sel.length) return;
    const copies = sel.map((o) => ({ ...o, id: newId(), name: `${o.name} (copy)`, position: [o.position[0] + 10, o.position[1] + 10, o.position[2]] as Vec3 }));
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
      theme: s.theme, printerId: s.printerId, plate: s.plate, filaments: s.filaments,
      presetId: s.presetId, overrides: s.overrides, machineOverrides: s.machineOverrides,
      plugins: s.plugins, dock: s.dock, liveToolpaths: s.liveToolpaths, configVersion: CONFIG_VERSION,
    }));
  } catch { /* storage unavailable */ }
});

// ----- plates
export const PLATE_GAP = 40;
export const PLATE_COLS = 4;
export function plateOrigin(index: number, printerId: string): [number, number] {
  const p = printerById(printerId);
  return [(index % PLATE_COLS) * (p.bed.x + PLATE_GAP), -Math.floor(index / PLATE_COLS) * (p.bed.y + PLATE_GAP)];
}
/** Plate index containing a world XY point (nearest plate cell). */
export function plateAt(x: number, y: number, printerId: string, plateCount: number): number {
  const p = printerById(printerId);
  let best = 0, bd = Infinity;
  for (let i = 0; i < plateCount; i++) {
    const [ox, oy] = plateOrigin(i, printerId);
    const cx = ox + p.bed.x / 2, cy = oy + p.bed.y / 2;
    const d = Math.max(Math.abs(x - cx) - p.bed.x / 2, 0) ** 2 + Math.max(Math.abs(y - cy) - p.bed.y / 2, 0) ** 2 + ((x - cx) ** 2 + (y - cy) ** 2) * 1e-6;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
export function objectPlate(o: SceneObject, printerId: string, plateCount: number): number {
  const b = worldBounds(o);
  return plateAt((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, printerId, plateCount);
}

// ----- geometry helpers on scene objects
export function trsMatrix(o: { position: Vec3; rotation: Vec3; scale: Vec3 }): THREE.Matrix4 {
  const d = Math.PI / 180;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...o.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotation[0] * d, o.rotation[1] * d, o.rotation[2] * d, 'XYZ')),
    new THREE.Vector3(...o.scale),
  );
}
export const objectMatrix = (o: Pick<SceneObject, 'position' | 'rotation' | 'scale'>) => trsMatrix(o);
export const partWorldMatrix = (o: SceneObject, p: ScenePart) => trsMatrix(o).multiply(trsMatrix(p));

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

export function isOutOfBounds(o: SceneObject, printerId: string, plateCount = 1): boolean {
  const p = printerById(printerId);
  const b = worldBounds(o);
  const [ox, oy] = plateOrigin(objectPlate(o, printerId, plateCount), printerId);
  const e = 0.01;
  return b.min[0] - ox < -e || b.min[1] - oy < -e || b.max[0] - ox > p.bed.x + e || b.max[1] - oy > p.bed.y + e || b.max[2] > p.bed.z + e;
}

export const slotColor = (s: State | ReturnType<typeof useStore.getState>, k: number) => s.filaments[Math.min(k, s.filaments.length - 1)]?.color ?? '#5DBE7A';
