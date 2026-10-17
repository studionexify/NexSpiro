// Lumonex UI state (saved in the browser and in project files) and placing a design on the plate:
// "assembled" places every part where it sits in the finished lamp, with the bulb and holder as
// preview-only objects; "print" stands each part on the bed in its print orientation and arranges them.
import { useSyncExternalStore } from 'react';
import { useStore, newId, worldBounds, type SceneObject, type ScenePart } from '../../../state/store';
import { addPlate, arrange, centreOnBed } from '../../../state/ops';
import { centreMesh } from '../../../io/load';
import { openEdgeCount } from '../../../engine/mesh';
import { printerById } from '../../../profiles/printers';
import { plateOrigin } from '../../../state/store';
import { buildLamp, rotateXYZ, type BuildResult } from '../build';
import { translate, toMesh, bounds, type Soup } from '../geom';
import { defaultDesign, type LampDesign } from '../model';

const KEY = 'nexspiro.lumonex.v1';
const SAVED = 'nexspiro.lumonex.designs.v1';
const storage = typeof localStorage !== 'undefined' ? localStorage : null;

export interface LumonexUiState {
  design: LampDesign;
  selected: string;
  /** Object ids this plugin placed last time (replaced on the next placement). */
  placed: string[];
  mode: 'assembled' | 'print';
  auto: boolean;
}

function load(): LumonexUiState {
  const design = defaultDesign('table');
  const d: LumonexUiState = { design, selected: design.sections[0].id, placed: [], mode: 'print', auto: false };
  try {
    const s = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (s?.design?.version === 1) return { ...d, ...s, design: { ...defaultDesign(s.design.kind), ...s.design } };
  } catch { /* fresh start */ }
  return d;
}

export const lx: LumonexUiState = load();
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const useLx = () => useSyncExternalStore(subscribe, () => version);
let autoTimer: ReturnType<typeof setTimeout> | null = null;

export function changed(geometry = true): void {
  try { storage?.setItem(KEY, JSON.stringify(lx)); } catch { /* storage full */ }
  version++;
  listeners.forEach((l) => l());
  if (geometry && lx.auto && lx.placed.length) {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(() => place(lx.mode), 700);
  }
}

export function setDesign(d: LampDesign): void {
  lx.design = d;
  lx.selected = d.sections[0]?.id ?? '';
  changed();
}

export const bedOf = () => printerById(useStore.getState().printerId).bed;

/** Quick build for the report (draft quality). */
export function previewBuild(): BuildResult {
  return buildLamp({ ...lx.design, quality: 'draft' }, bedOf());
}

const centred = (s: Soup) => { const b = bounds(s); return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]] as [number, number, number]; };

/** Put the design on the active plate, replacing what Lumonex placed before. */
export function place(mode: 'assembled' | 'print'): { count: number; result: BuildResult } {
  const s = useStore.getState();
  const result = buildLamp(lx.design, bedOf());
  const bed = bedOf();
  const [ox, oy] = plateOrigin(s.activePlate, s.printerId);
  const objects: SceneObject[] = [];
  // assembly: whole lamp stands on the plate centre
  let lift = 0;
  if (mode === 'assembled') {
    const zs = result.parts.flatMap((p) => { const b = bounds(rotateXYZ([...p.soup], p.assemblyRot)); return p.soup.length ? [b.min[2]] : []; });
    lift = zs.length ? -Math.min(...zs) : 0;
  }
  for (const p of result.parts) {
    if (!p.soup.length) continue;
    if (mode === 'print' && p.ghost) continue;
    if (mode === 'assembled' && !p.ghost && !lx.design.showBulb && p.group === 'Preview') continue;
    const copies = mode === 'print' ? p.copies : 1;
    for (let k = 0; k < copies; k++) {
      const rot = mode === 'print' ? p.printRot : p.assemblyRot;
      const soup = rotateXYZ([...p.soup], rot);
      const cuts = p.cuts.map((c) => rotateXYZ([...c], rot));
      const off = centred(soup);
      translate(soup, -off[0], -off[1], -off[2]);
      for (const c of cuts) translate(c, -off[0], -off[1], -off[2]);
      const mesh = toMesh(soup);
      centreMesh(mesh);
      const parts: ScenePart[] = cuts.filter((c) => c.length).map((c, i) => ({
        id: newId('part'), name: `Lumonex cut ${i + 1}`, type: 'negative', mesh: toMesh(c), position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], overrides: {},
      }));
      let o: SceneObject = {
        id: newId(), name: `Lumonex · ${p.name}${copies > 1 ? ` #${k + 1}` : ''} · ${p.ghost ? 'preview only' : `${p.material} ${p.color}`}`,
        mesh, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], openEdges: openEdgeCount(mesh),
        parts: parts.length ? parts : undefined,
        overrides: p.overrides as SceneObject['overrides'],
        printable: mode === 'print' && !p.ghost,
      };
      if (mode === 'assembled') o = { ...o, position: [ox + bed.x / 2 + off[0], oy + bed.y / 2 + off[1], off[2] + lift] };
      else o = centreOnBed(o, s.printerId);
      objects.push(o);
    }
  }
  s.checkpoint();
  const keep = s.objects.filter((o) => !lx.placed.includes(o.id));
  useStore.setState({ objects: [...keep, ...objects], selected: [] });
  s.markDirty();
  lx.placed = objects.map((o) => o.id);
  lx.mode = mode;
  if (mode === 'print') spread(lx.placed, s.activePlate);
  changed(false);
  return { count: objects.length, result };
}

/** Arrange parts on a plate; whatever does not fit moves on to a new plate, and so on. */
function spread(ids: string[], plate: number): void {
  let left = ids, p = plate;
  for (let guard = 0; guard < 12 && left.length; guard++) {
    arrange(undefined, p, left);
    const s = useStore.getState(), bed = bedOf(), [ox, oy] = plateOrigin(p, s.printerId);
    const out = s.objects.filter((o) => left.includes(o.id)).filter((o) => {
      const b = worldBounds(o);
      return b.min[0] < ox - 0.5 || b.max[0] > ox + bed.x + 0.5 || b.min[1] < oy - 0.5 || b.max[1] > oy + bed.y + 0.5;
    });
    if (!out.length || out.length === left.length) break;
    addPlate();
    p = useStore.getState().plates.length - 1;
    const next = new Set(out.map((o) => o.id));
    useStore.getState().updateObjects((o) => (next.has(o.id) ? centreOnBed(o, s.printerId, p) : o), [...next], false);
    left = [...next];
  }
}

export function clearPlaced(): void {
  const s = useStore.getState();
  s.checkpoint();
  useStore.setState({ objects: s.objects.filter((o) => !lx.placed.includes(o.id)) });
  lx.placed = [];
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
  changed(false);
}
