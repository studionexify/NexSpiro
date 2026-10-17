// Lumonex UI state (saved in the browser and in project files), the Studio window state, and moving a
// design to the plate. "Transfer to plate" takes the lamp apart: every printed piece is stood on the bed
// in its print orientation, pieces are grouped by filament (material + colour) with one or more plates
// per group, and each group gets its own filament slot.
import { useSyncExternalStore } from 'react';
import { useStore, newId, worldBounds, plateOrigin, type SceneObject, type ScenePart } from '../../../state/store';
import { addPlate, arrange, centreOnBed, updatePlate } from '../../../state/ops';
import { centreMesh } from '../../../io/load';
import { openEdgeCount } from '../../../engine/mesh';
import { printerById } from '../../../profiles/printers';
import { assembled, buildLamp, rotateXYZ, type BuildResult, type BuiltPart } from '../build';
import { translate, toMesh, bounds, type Soup } from '../geom';
import { defaultDesign, type LampDesign } from '../model';

const KEY = 'nexspiro.lumonex.v1';
const SAVED = 'nexspiro.lumonex.designs.v1';
const storage = typeof localStorage !== 'undefined' ? localStorage : null;

export type StudioView = 'assembled' | 'exploded' | 'pieces';

export interface LumonexUiState {
  design: LampDesign;
  selected: string;
  /** Object ids this plugin placed last time (replaced on the next transfer). */
  placed: string[];
  /** Plates this plugin created last time (reused on the next transfer while still empty of other objects). */
  plates: string[];
  mode: 'assembled' | 'print';
  studioOpen: boolean;
  view: StudioView;
  lit: boolean;
  cutaway: boolean;
  showCuts: boolean;
}

function load(): LumonexUiState {
  const design = defaultDesign('table');
  const d: LumonexUiState = { design, selected: design.sections[0].id, placed: [], plates: [], mode: 'print', studioOpen: false, view: 'assembled', lit: true, cutaway: false, showCuts: false };
  try {
    const s = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (s?.design?.version === 1) return { ...d, ...s, studioOpen: false, design: { ...defaultDesign(s.design.kind), ...s.design } };
  } catch { /* fresh start */ }
  return d;
}

export const lx: LumonexUiState = load();
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const useLx = () => useSyncExternalStore(subscribe, () => version);
/** Bumped only when the geometry may have changed (the 3D view rebuilds on it). */
export let geometryVersion = 0;

export function changed(geometry = true): void {
  try { storage?.setItem(KEY, JSON.stringify(lx)); } catch { /* storage full */ }
  version++;
  if (geometry) geometryVersion++;
  listeners.forEach((l) => l());
}

export function setDesign(d: LampDesign): void {
  lx.design = d;
  lx.selected = d.sections[0]?.id ?? '';
  changed();
}

export function openStudio(open = true): void { lx.studioOpen = open; changed(false); }

export const bedOf = () => printerById(useStore.getState().printerId).bed;

/** Quick build for the report (draft quality). */
export function previewBuild(): BuildResult {
  return buildLamp({ ...lx.design, quality: 'draft' }, bedOf());
}

const centred = (s: Soup) => { const b = bounds(s); return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]] as [number, number, number]; };

/** Filament of a part: plates and slots are grouped by it. */
export const filamentKey = (p: Pick<BuiltPart, 'material' | 'color'>) => `${p.material} · ${p.color}`;

export interface FilamentGroup { key: string; material: string; color: string; hex: string; parts: BuiltPart[] }

/** Printed parts grouped by filament, in order of first use (copies expanded). */
export function groupByFilament(parts: BuiltPart[]): FilamentGroup[] {
  const out = new Map<string, FilamentGroup>();
  for (const p of parts) {
    if (p.ghost || !p.soup.length) continue;
    const k = filamentKey(p);
    let g = out.get(k);
    if (!g) { g = { key: k, material: p.material, color: p.color, hex: p.hex, parts: [] }; out.set(k, g); }
    for (let i = 0; i < p.copies; i++) g.parts.push(p);
  }
  return [...out.values()];
}

/** Filament preset for a Lumonex material. */
const presetFor = (material: string) => (material.startsWith('PETG') ? 'generic-petg' : material === 'PLA Matte' ? 'generic-pla-matte' : 'generic-pla');

/** Slot index for a filament, adding a slot when the colour/material is not loaded yet. */
function slotFor(material: string, hex: string): number {
  const s = useStore.getState();
  const preset = presetFor(material);
  const i = s.filaments.findIndex((f) => f.color.toLowerCase() === hex.toLowerCase() && f.presetId === preset);
  if (i >= 0) return i;
  if (s.filaments.length >= 16) return 0;
  s.set({ filaments: [...s.filaments, { presetId: preset, color: hex }] });
  return useStore.getState().filaments.length - 1;
}

function objectFor(p: BuiltPart, soupIn: Soup, cutsIn: Soup[], name: string, printable: boolean): { o: SceneObject; off: [number, number, number] } {
  const soup = [...soupIn], cuts = cutsIn.map((c) => [...c]);
  const off = centred(soup);
  translate(soup, -off[0], -off[1], -off[2]);
  for (const c of cuts) translate(c, -off[0], -off[1], -off[2]);
  const mesh = toMesh(soup);
  centreMesh(mesh);
  const parts: ScenePart[] = cuts.filter((c) => c.length).map((c, i) => ({
    id: newId('part'), name: `Lumonex cut ${i + 1}`, type: 'negative', mesh: toMesh(c), position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], overrides: {},
  }));
  return {
    o: { id: newId(), name, mesh, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], openEdges: openEdgeCount(mesh), parts: parts.length ? parts : undefined, overrides: p.overrides as SceneObject['overrides'], printable },
    off,
  };
}

/** Remove what Lumonex placed before, and the plates it made that are now empty. */
function clearPrevious(): void {
  const s = useStore.getState();
  const objects = s.objects.filter((o) => !lx.placed.includes(o.id));
  useStore.setState({ objects, selected: [] });
  lx.placed = [];
}

/** Plates that hold no objects. */
function emptyPlates(): number[] {
  const s = useStore.getState();
  const used = new Set(s.objects.map((o) => objectPlateIndex(o)));
  return s.plates.map((_, i) => i).filter((i) => !used.has(i));
}

function objectPlateIndex(o: SceneObject): number {
  const s = useStore.getState(), bed = bedOf();
  const b = worldBounds(o), cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  for (let i = 0; i < s.plates.length; i++) { const [ox, oy] = plateOrigin(i, s.printerId); if (cx >= ox && cx <= ox + bed.x && cy >= oy && cy <= oy + bed.y) return i; }
  return -1;
}

/** Arrange ids on a plate; whatever does not fit moves on to a new plate, and so on. Returns the plates used. */
function spread(ids: string[], plate: number, label: string): number[] {
  let left = ids, p = plate;
  const used = [p];
  for (let guard = 0; guard < 16 && left.length; guard++) {
    arrange(undefined, p, left);
    const s = useStore.getState(), bed = bedOf(), [ox, oy] = plateOrigin(p, s.printerId);
    const out = s.objects.filter((o) => left.includes(o.id)).filter((o) => {
      const b = worldBounds(o);
      return b.min[0] < ox - 0.5 || b.max[0] > ox + bed.x + 0.5 || b.min[1] < oy - 0.5 || b.max[1] > oy + bed.y + 0.5;
    });
    if (!out.length || out.length === left.length) break;
    p = nextPlate(label);
    used.push(p);
    const next = new Set(out.map((o) => o.id));
    useStore.getState().updateObjects((o) => (next.has(o.id) ? centreOnBed(o, s.printerId, p) : o), [...next], false);
    left = [...next];
  }
  return used;
}

function nextPlate(label: string): number {
  const free = emptyPlates();
  const p = free.length ? free[0] : (addPlate(), useStore.getState().plates.length - 1);
  updatePlate(p, { name: label });
  return p;
}

export interface TransferResult { objects: number; plates: { index: number; name: string; parts: number }[]; result: BuildResult }

/**
 * Take the lamp apart onto the plate: every printed piece in its print orientation, one or more plates
 * per filament, a filament slot per filament, arranged with the plate's arrange settings.
 */
export function transferToPlate(): TransferResult {
  const s = useStore.getState();
  s.checkpoint();
  clearPrevious();
  const result = buildLamp(lx.design, bedOf());
  const groups = groupByFilament(result.parts);
  const platesOut: TransferResult['plates'] = [];
  const all: string[] = [];
  for (const g of groups) {
    const label = `Lumonex · ${g.key}`;
    const plate = nextPlate(label);
    const slot = slotFor(g.material, g.hex);
    const objs: SceneObject[] = [];
    const count = new Map<string, number>();
    for (const p of g.parts) {
      const k = (count.get(p.key) ?? 0) + 1;
      count.set(p.key, k);
      const n = g.parts.filter((x) => x === p).length;
      const { o } = objectFor(p, rotateXYZ([...p.soup], p.printRot), p.cuts.map((c) => rotateXYZ([...c], p.printRot)), `Lumonex · ${p.name}${n > 1 ? ` #${k}` : ''}`, true);
      objs.push(centreOnBed({ ...o, filament: slot }, useStore.getState().printerId, plate));
    }
    useStore.setState({ objects: [...useStore.getState().objects, ...objs] });
    const ids = objs.map((o) => o.id);
    all.push(...ids);
    for (const pi of spread(ids, plate, label)) {
      const st = useStore.getState();
      platesOut.push({ index: pi, name: st.plates[pi].name, parts: st.objects.filter((o) => ids.includes(o.id) && objectPlateIndex(o) === pi).length });
    }
  }
  lx.placed = all;
  lx.plates = platesOut.map((p) => useStore.getState().plates[p.index].id);
  lx.mode = 'print';
  useStore.getState().set({ activePlate: platesOut[0]?.index ?? 0, workspace: 'prepare' } as never);
  useStore.getState().markDirty();
  changed(false);
  return { objects: all.length, plates: platesOut, result };
}

/** Show the finished lamp on the active plate (preview only, nothing is printable). */
export function placeAssembled(): { count: number; result: BuildResult } {
  const s = useStore.getState();
  s.checkpoint();
  clearPrevious();
  const result = buildLamp(lx.design, bedOf());
  const bed = bedOf();
  const [ox, oy] = plateOrigin(s.activePlate, s.printerId);
  const zs = result.parts.filter((p) => p.soup.length).map((p) => bounds(assembled(p)).min[2]);
  const lift = zs.length ? -Math.min(...zs) : 0;
  const objects: SceneObject[] = [];
  for (const p of result.parts) {
    if (!p.soup.length || (p.ghost && !lx.design.showBulb)) continue;
    const { o, off } = objectFor(p, assembled(p), p.cuts.map((c) => assembled(p, c)), `Lumonex · ${p.name} · ${p.ghost ? 'preview only' : 'assembled preview'}`, false);
    objects.push({ ...o, position: [ox + bed.x / 2 + off[0], oy + bed.y / 2 + off[1], off[2] + lift] });
  }
  useStore.setState({ objects: [...useStore.getState().objects, ...objects], selected: [] });
  s.markDirty();
  lx.placed = objects.map((o) => o.id);
  lx.mode = 'assembled';
  changed(false);
  return { count: objects.length, result };
}

export function clearPlaced(): void {
  useStore.getState().checkpoint();
  clearPrevious();
  changed(false);
}

/** Ids of placed objects that are shades / bodies (targets for Motionex / Patternex). */
export function placedShadeIds(): string[] {
  const names = lx.design.sections.filter((x) => x.role === 'shade' || x.role === 'body').map((x) => x.name);
  return useStore.getState().objects.filter((o) => lx.placed.includes(o.id) && names.some((n) => o.name.startsWith(`Lumonex · ${n}`))).map((o) => o.id);
}

// ---------------------------------------------------------------- saved designs
export function savedDesigns(): LampDesign[] {
  try { return JSON.parse(storage?.getItem(SAVED) ?? '[]'); } catch { return []; }
}
export function saveDesign(): void {
  const list = savedDesigns().filter((d) => d.name !== lx.design.name);
  list.unshift(structuredClone(lx.design));
  try { storage?.setItem(SAVED, JSON.stringify(list.slice(0, 50))); } catch { /* storage full */ }
  changed(false);
}
export function deleteSaved(name: string): void {
  try { storage?.setItem(SAVED, JSON.stringify(savedDesigns().filter((d) => d.name !== name))); } catch { /* ignore */ }
  changed(false);
}

export const projectData = () => ({ design: lx.design, placed: lx.placed, mode: lx.mode });
export function loadProject(data: unknown): void {
  const d = data as Partial<LumonexUiState> | undefined;
  if (!d?.design || d.design.version !== 1) return;
  lx.design = { ...defaultDesign(d.design.kind), ...d.design };
  lx.selected = lx.design.sections[0]?.id ?? '';
  lx.placed = d.placed ?? [];
  lx.mode = d.mode ?? 'print';
  changed();
}
