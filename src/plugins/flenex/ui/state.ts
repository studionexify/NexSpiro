// Flenex UI state: the design, the cuts, the paint and the last build. A change schedules a rebuild
// (base model → cuts → colours); the Studio and the dock panel read the result.
import { useSyncExternalStore } from 'react';
import { newId, plateOrigin, useStore, type SceneObject } from '../../../state/store';
import { centreOnBed } from '../../../state/ops';
import { centreMesh } from '../../../io/load';
import { openEdgeCount, repairTJunctions, weld, type IndexedMesh } from '../../../engine/mesh';
import { printerById } from '../../../profiles/printers';
import { bounds, initKernel, solid, free, meshOf, transform, dropDegenerate, type V3 } from '../csg';
import { autoCuts, buildCreature, chainCuts, stationAt, type Chain, type Mark, type Station } from '../creature';
import { buildFlexi, type Cut, type FlexiResult } from '../flexi';
import { defaultCreature, type CreatureDesign } from '../design';
import { designFromPreset, presetById } from '../presets';
import { applyPaint, PALETTE_DEFAULT, SCHEMES, type PaintOp } from '../paint';
import { machineFor, type MachineInfo } from '../fit';
import { fitToBed, rotateQuarters, type BedFit, type CutOrientation } from '../place';
import type { JointKind } from '../joints';
import { build3mf } from '../export3mf';
import { saveFile } from '../../../platform';
import * as THREE from 'three';

const KEY = 'nexspiro.flenex.v1';
const storage = typeof localStorage !== 'undefined' ? localStorage : null;

export type FxTab = 'design' | 'cuts' | 'paint' | 'print';
export type FxView = 'colour' | 'pieces' | 'plain';
export type FxTool = 'orbit' | 'place' | 'move' | 'brush' | 'bucket' | 'piece';

export interface FlenexUiState {
  source: 'creature' | 'import';
  design: CreatureDesign;
  presetId: string;
  cutsMode: 'auto' | 'manual';
  manualCuts: Cut[];
  importName: string;
  importRot: [number, number, number];
  importScale: number;
  palette: string[];
  paintOps: PaintOp[];
  tab: FxTab;
  view: FxView;
  tool: FxTool;
  selectedCut: string | null;
  orientation: CutOrientation;
  placeKind: JointKind;
  slot: number;
  brush: number;
  bucketAngle: number;
  /** Fit overrides (0 = from the machine). */
  clearance: number;
  gap: number;
  studioOpen: boolean;
  showCuts: boolean;
  showBed: boolean;
  /** Object ids this plugin placed on the plate (replaced on the next transfer). */
  placed: string[];
}

function load(): FlenexUiState {
  const design = designFromPreset(presetById('snake')!);
  const d: FlenexUiState = {
    source: 'creature', design, presetId: 'snake', cutsMode: 'auto', manualCuts: [], importName: '', importRot: [0, 0, 0], importScale: 1,
    palette: PALETTE_DEFAULT.slice(), paintOps: SCHEMES[0].ops(1), tab: 'design', view: 'colour', tool: 'orbit', selectedCut: null, orientation: 'limb', placeKind: 'ball',
    slot: 1, brush: 6, bucketAngle: 30, clearance: 0, gap: 0, studioOpen: false, showCuts: true, showBed: true, placed: [],
  };
  try {
    const s = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (s?.design?.version === 1) return { ...d, ...s, source: 'creature', importName: '', studioOpen: false, tool: 'orbit', manualCuts: s.cutsMode === 'manual' ? s.manualCuts ?? [] : [] };
  } catch { /* fresh start */ }
  return d;
}

export const fx: FlenexUiState = load();
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const useFx = () => useSyncExternalStore(subscribe, () => version);

// ---------------------------------------------------------------- imported model (kept out of local storage)
let importedMesh: IndexedMesh | null = null;
export const hasImport = () => importedMesh !== null;

// ---------------------------------------------------------------- build result
export interface Built {
  /** Base solid (before cuts) and the finished flexi. */
  base: IndexedMesh;
  flexi: FlexiResult;
  paint: Uint8Array;
  stations: Station[];
  marks: Mark[];
  chains: Chain[];
  cuts: Cut[];
  machine: MachineInfo;
  fit: BedFit;
  warnings: string[];
  ms: number;
  error?: string;
}
export let built: Built | null = null;
export let building = false;
/** Bumped when the mesh changed (viewer rebuilds geometry); paint-only changes bump `paintVersion`. */
export let meshVersion = 0;
export let paintVersion = 0;

const machine = () => machineFor(useStore.getState().printerId, { clearance: fx.clearance || undefined, gap: fx.gap || undefined });
export const currentMachine = machine;

export function notify(): void {
  try {
    const { manualCuts, ...rest } = fx;
    storage?.setItem(KEY, JSON.stringify({ ...rest, manualCuts: fx.cutsMode === 'manual' && fx.source === 'creature' ? manualCuts : [], placed: [] }));
  } catch { /* storage full */ }
  version++;
  listeners.forEach((l) => l());
}

let timer: ReturnType<typeof setTimeout> | undefined;
let token = 0;
/** Rebuild after edits (debounced). `paintOnly` skips the geometry. */
export function schedule(paintOnly = false, delay = 220): void {
  notify();
  if (paintOnly && built) { repaint(); return; }
  clearTimeout(timer);
  building = true;
  listeners.forEach((l) => l());
  timer = setTimeout(() => { void rebuild(); }, delay);
}

function repaint(): void {
  if (!built) return;
  built.paint = applyPaint(fx.paintOps, { mesh: built.flexi.mesh, triPiece: built.flexi.triPiece, spine: spineOf(built), marks: built.marks });
  paintVersion++;
  notify();
}

const spineOf = (b: Built): V3[] | undefined => (fx.source === 'creature' ? b.stations.map((s) => [s.P.x, s.P.y, s.top * 0.5] as V3) : undefined);

/** Import → upright solid: rotation about z, scale, rest on z = 0, centred. Meshes from files are healed to be closed. */
function importBase(): IndexedMesh {
  let m = rotateQuarters(importedMesh!, fx.importRot);
  m = { vertices: m.vertices.map((v) => v * fx.importScale), indices: m.indices };
  const b = bounds(m);
  const v = m.vertices.slice();
  for (let i = 0; i < v.length; i += 3) { v[i] -= (b.min[0] + b.max[0]) / 2; v[i + 1] -= (b.min[1] + b.max[1]) / 2; v[i + 2] -= b.min[2]; }
  m = { vertices: v, indices: m.indices };
  try { const s = solid(m); const r = meshOf(s); free(s); return r; } catch { /* try healing */ }
  const healed = dropDegenerate(repairTJunctions(weld(soupOf(m), 1e-4)));
  const s = solid(healed); const r = meshOf(s); free(s);
  return r;
}
const soupOf = (m: IndexedMesh) => { const o = new Float32Array(m.indices.length * 3); for (let i = 0; i < m.indices.length; i++) for (let k = 0; k < 3; k++) o[i * 3 + k] = m.vertices[m.indices[i] * 3 + k]; return o; };

let baseKey = '', baseCache: { base: IndexedMesh; stations: Station[]; marks: Mark[]; chains: Chain[]; warnings: string[] } | null = null;

export async function rebuild(): Promise<void> {
  const my = ++token;
  building = true;
  const t0 = performance.now();
  try {
    await initKernel();
    const mac = machine();
    let base: IndexedMesh, stations: Station[] = [], marks: Mark[] = [], chains: Chain[] = [], warnings: string[] = [];
    if (fx.source === 'creature') {
      const key = JSON.stringify([fx.design.body, fx.design.addons]);
      if (key !== baseKey || !baseCache) {
        const r = buildCreature(fx.design);
        baseCache = { base: r.mesh, stations: r.stations, marks: r.marks, chains: r.chains, warnings: r.warnings };
        baseKey = key;
      }
      ({ base, stations, marks, chains, warnings } = baseCache);
    } else {
      if (!importedMesh) throw new Error('Import a model first.');
      base = importBase();
    }
    if (my !== token) return;
    let cuts: Cut[];
    if (fx.source === 'creature' && fx.cutsMode === 'auto') {
      const minInr = Math.max(2 * mac.fit.minPin, 8.5 * mac.fit.clearance) + mac.fit.clearance + mac.fit.wall + 0.2;
      cuts = [...autoCuts(fx.design, stations, minInr), ...chainCuts(fx.design, chains, 100, minInr)];
      if (cuts.length) fx.manualCuts = cuts.map((c) => structuredClone(c));
    } else cuts = fx.manualCuts;
    const flexi = cuts.length ? buildFlexi(base, cuts, mac.fit) : buildFlexi(base, [], mac.fit);
    const paint = applyPaint(fx.paintOps, { mesh: flexi.mesh, triPiece: flexi.triPiece, spine: stations.length ? stations.map((s) => [s.P.x, s.P.y, s.top * 0.5] as V3) : undefined, marks });
    const fit = fitToBed(flexi.mesh, mac.bed);
    if (my !== token) return;
    built = { base, flexi, paint, stations, marks, chains, cuts, machine: mac, fit, warnings: [...warnings, ...flexi.warnings], ms: performance.now() - t0 };
    meshVersion++; paintVersion++;
  } catch (e) {
    if (my !== token) return;
    built = built ? { ...built, error: (e as Error).message } : null;
    lastError = (e as Error).message;
  } finally {
    if (my === token) { building = false; notify(); }
  }
}
export let lastError = '';

// ---------------------------------------------------------------- edits
export const changed = () => schedule(false);

export function loadPreset(id: string): void {
  const def = presetById(id); if (!def) return;
  fx.source = 'creature'; importedMesh = null; fx.importName = '';
  fx.design = designFromPreset(def); fx.presetId = id; fx.cutsMode = 'auto'; fx.manualCuts = []; fx.selectedCut = null;
  schedule();
}

/** Switch to editing the cuts by hand: the automatic cuts become a list the user can change. */
export function freezeCuts(): void { if (built) fx.manualCuts = built.cuts.map((c) => structuredClone(c)); fx.cutsMode = 'manual'; schedule(); }
export function autoCutsAgain(): void { fx.cutsMode = 'auto'; fx.selectedCut = null; schedule(); }

export function addCut(c: Cut): void {
  if (fx.source === 'creature' && fx.cutsMode === 'auto') freezeCutsQuiet();
  fx.manualCuts = [...fx.manualCuts, c]; fx.selectedCut = c.id; schedule();
}
function freezeCutsQuiet() { if (built) fx.manualCuts = built.cuts.map((c) => structuredClone(c)); fx.cutsMode = 'manual'; }
export function removeCut(id: string): void { if (fx.cutsMode === 'auto' && fx.source === 'creature') freezeCutsQuiet(); fx.manualCuts = fx.manualCuts.filter((c) => c.id !== id); if (fx.selectedCut === id) fx.selectedCut = null; schedule(); }
export function editCut(id: string, f: (c: Cut) => void): void { if (fx.cutsMode === 'auto' && fx.source === 'creature') freezeCutsQuiet(); const c = fx.manualCuts.find((x) => x.id === id); if (c) f(c); schedule(); }
export const nextCutId = () => String(1 + Math.max(0, ...fx.manualCuts.map((c) => +c.id || 0)));

export async function importModel(name: string, mesh: IndexedMesh): Promise<void> {
  await initKernel();
  const m = { vertices: mesh.vertices.slice(), indices: mesh.indices.slice() };
  importedMesh = m;
  fx.source = 'import'; fx.importName = name; fx.importRot = [0, 0, 0]; fx.importScale = 1;
  fx.cutsMode = 'manual'; fx.manualCuts = []; fx.selectedCut = null; fx.tab = 'cuts'; fx.tool = 'place';
  schedule(false, 10);
}

// ---------------------------------------------------------------- paint
export function setPaint(ops: PaintOp[]): void { fx.paintOps = ops; schedule(true); }
export function addPaint(op: PaintOp): void { fx.paintOps = [...fx.paintOps, op]; schedule(true); }
export function undoPaint(): void { if (fx.paintOps.length > 1) { fx.paintOps = fx.paintOps.slice(0, -1); schedule(true); } }
export function setPalette(i: number, hex: string): void { fx.palette = fx.palette.map((c, k) => (k === i ? hex : c)); notify(); }
export function addColour(hex = '#cccccc'): void { if (fx.palette.length < 16) { fx.palette = [...fx.palette, hex]; notify(); } }

export function coloursUsed(): number[] { return built ? Array.from(new Set(built.paint)).sort((a, b) => a - b) : [1]; }

// ---------------------------------------------------------------- output
function baseName() { return (fx.source === 'import' ? fx.importName.replace(/\.[^.]+$/, '') : fx.design.name) || 'flexi'; }

export async function export3mf(): Promise<string | null> {
  if (!built) return null;
  const mac = built.machine, b = bounds(built.flexi.mesh);
  const mesh = built.flexi.mesh, v = mesh.vertices.slice();
  for (let i = 0; i < v.length; i += 3) { v[i] -= (b.min[0] + b.max[0]) / 2; v[i + 1] -= (b.min[1] + b.max[1]) / 2; v[i + 2] -= b.min[2]; }
  const bytes = await build3mf({ name: baseName(), mesh: { vertices: v, indices: mesh.indices }, paint: built.paint, palette: fx.palette, place: [mac.bed.x / 2, mac.bed.y / 2], printerName: `${mac.printer.vendor} ${mac.printer.model}` });
  return saveFile(`${baseName().replace(/[^\w.-]+/g, '_')}.3mf`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '3mf');
}

const presetFilament = () => 'generic-pla';
function slotFor(hex: string): number {
  const s = useStore.getState();
  const i = s.filaments.findIndex((f) => f.color.toLowerCase() === hex.toLowerCase() && f.presetId === presetFilament());
  if (i >= 0) return i;
  if (s.filaments.length >= 16) return 0;
  s.set({ filaments: [...s.filaments, { presetId: presetFilament(), color: hex }] });
  return useStore.getState().filaments.length - 1;
}

/** Put the flexi on the plate (centred, painted with filament slots) and open Prepare. */
export function sendToPlate(): { objects: number; colours: number } | null {
  if (!built) return null;
  const s = useStore.getState();
  s.checkpoint();
  s.set({ objects: s.objects.filter((o) => !fx.placed.includes(o.id)), selected: [] });
  const mesh = { vertices: built.flexi.mesh.vertices.slice(), indices: built.flexi.mesh.indices.slice() };
  centreMesh(mesh);
  const used = coloursUsed();
  const slotOf = new Map<number, number>(used.map((u) => [u, slotFor(fx.palette[u - 1] ?? '#808080')]));
  const colour = new Uint8Array(built.paint.length);
  for (let t = 0; t < colour.length; t++) colour[t] = (slotOf.get(built.paint[t]) ?? 0) + 1;
  const o: SceneObject = {
    id: newId(), name: `Flenex · ${baseName()}`, mesh, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], openEdges: openEdgeCount(mesh),
    filament: slotOf.get(used[0]) ?? 0, paint: used.length > 1 ? { color: colour } : undefined, printable: true,
  };
  const placed = centreOnBed(o, s.printerId, s.activePlate);
  useStore.setState({ objects: [...useStore.getState().objects, placed], selected: [placed.id] });
  fx.placed = [placed.id];
  s.set({ workspace: 'prepare' } as never);
  s.markDirty();
  fx.studioOpen = false;
  notify();
  return { objects: 1, colours: used.length };
}

export function openStudio(open = true): void {
  fx.studioOpen = open;
  if (open && !built) schedule(false, 10);
  notify();
}

export function setPrinter(id: string): void {
  const s = useStore.getState(), p = printerById(id);
  s.set({ printerId: p.id, plate: p.plates.some((x) => x.type === s.plate) ? s.plate : p.plates[0].type, machineOverrides: {} });
  s.markDirty();
  schedule();
}

export const projectData = () => ({ design: fx.design, presetId: fx.presetId, cutsMode: fx.cutsMode, manualCuts: fx.manualCuts, palette: fx.palette, paintOps: fx.paintOps, source: fx.source === 'creature' ? 'creature' : 'creature', clearance: fx.clearance, gap: fx.gap });
export function loadProject(data: unknown): void {
  const d = data as Partial<FlenexUiState> | undefined;
  if (!d?.design || d.design.version !== 1) return;
  Object.assign(fx, { design: d.design, presetId: d.presetId ?? fx.presetId, cutsMode: d.cutsMode ?? 'auto', manualCuts: d.manualCuts ?? [], palette: d.palette ?? fx.palette, paintOps: d.paintOps ?? fx.paintOps, clearance: d.clearance ?? 0, gap: d.gap ?? 0, source: 'creature' });
  schedule();
}

export { stationAt, THREE };
void plateOrigin;
