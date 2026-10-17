// Plantex UI state: the design being edited, the scene objects it owns (body + saucer), the user's own
// design library, and putting the generated meshes on the plate (live drafts, full-quality final).
import { useSyncExternalStore } from 'react';
import { centreMesh } from '../../../io/load';
import { openEdgeCount } from '../../../engine/mesh';
import { arrange, centreOnBed } from '../../../state/ops';
import { dropToBed, isOutOfBounds, newId, useStore, worldBounds, type SceneObject } from '../../../state/store';
import { buildBody, buildInsert, buildSaucer, type BuildResult } from '../mesh';
import { defaultSpec, normalizeSpec, type PlantexSpec } from '../model';
import { patternMask } from '../patternLink';

const KEY = 'nexspiro.plantex.v1';
const storage = typeof localStorage !== 'undefined' ? localStorage : null;

export interface SavedDesign { id: string; name: string; spec: PlantexSpec }

export interface PlantexState {
  spec: PlantexSpec;
  objectId: string | null;
  saucerId: string | null;
  insertId: string | null;
  /** Rebuild a draft mesh on every change. */
  live: boolean;
  /** The object on the plate is a draft (low resolution). */
  draft: boolean;
  designs: SavedDesign[];
  warnings: string[];
  triangles: number;
  /** Texture layer open in the editor. */
  openLayer: string | null;
}

function load(): PlantexState {
  const d: PlantexState = { spec: defaultSpec(), objectId: null, saucerId: null, insertId: null, live: true, draft: false, designs: [], warnings: [], triangles: 0, openLayer: null };
  try {
    const s = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (s) return { ...d, ...s, spec: normalizeSpec(s.spec ?? {}), designs: (s.designs ?? []).map((x: SavedDesign) => ({ ...x, spec: normalizeSpec(x.spec) })) };
  } catch { /* fresh start */ }
  return d;
}

export const pt: PlantexState = load();
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const usePt = () => useSyncExternalStore(subscribe, () => version);

function persist() {
  try { storage?.setItem(KEY, JSON.stringify({ spec: pt.spec, objectId: pt.objectId, saucerId: pt.saucerId, insertId: pt.insertId, live: pt.live, designs: pt.designs })); } catch { /* storage unavailable */ }
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** After an edit of the design: save, redraw, and (live) rebuild the draft on the plate. */
export function changed(geometry = true) {
  persist();
  version++;
  listeners.forEach((l) => l());
  if (geometry && pt.live && ownedObject()) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; generate(true); }, 280);
  }
}

export const ownedObject = (): SceneObject | undefined => useStore.getState().objects.find((o) => o.id === pt.objectId);
const byId = (id: string | null): SceneObject | undefined => (id ? useStore.getState().objects.find((o) => o.id === id) : undefined);

const masks = (key: string) => patternMask(key);

/** Build and place the body (and saucer). `draft` = fast preview mesh, not recorded in undo. */
export function generate(draft: boolean, asNew = false): BuildResult {
  const spec = pt.spec;
  const r = buildBody(spec, masks, draft);
  const s = useStore.getState();
  const mesh = r.mesh;
  centreMesh(mesh);
  const existing = asNew ? undefined : ownedObject();
  let body: SceneObject;
  if (existing) {
    body = dropToBed({ ...existing, name: spec.name, mesh, openEdges: openEdgeCount(mesh), paint: undefined, patternex: undefined, layerHeights: undefined });
    s.updateObjects(() => body, [existing.id], !draft);
  } else {
    body = centreOnBed({ id: newId(), name: spec.name, mesh, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], openEdges: openEdgeCount(mesh) }, s.printerId);
    s.addObjects([body]);
    pt.objectId = body.id;
  }
  // accessories beside the body (saucer to the right, self-watering insert to the left)
  let created = false;
  const accessory = (key: 'saucerId' | 'insertId', want: boolean, build: () => BuildResult, label: string, side: 1 | -1) => {
    const cur = asNew ? undefined : byId(pt[key]);
    if (!want) {
      if (cur) { const st = useStore.getState(); st.set({ objects: st.objects.filter((o) => o.id !== cur.id) }); }
      pt[key] = null;
      return;
    }
    const ar = build();
    r.warnings.push(...ar.warnings);
    centreMesh(ar.mesh);
    if (cur) {
      const next = dropToBed({ ...cur, name: `${spec.name} ${label}`, mesh: ar.mesh, openEdges: openEdgeCount(ar.mesh) });
      useStore.getState().updateObjects(() => next, [cur.id], false);
      return;
    }
    const bb = worldBounds(body);
    let o: SceneObject = { id: newId(), name: `${spec.name} ${label}`, mesh: ar.mesh, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], openEdges: openEdgeCount(ar.mesh) };
    const ob = worldBounds(o);
    const x = side > 0 ? bb.max[0] + 8 - ob.min[0] : bb.min[0] - 8 - ob.max[0];
    o = dropToBed({ ...o, position: [x, (bb.min[1] + bb.max[1]) / 2 - (ob.min[1] + ob.max[1]) / 2, 0] });
    useStore.getState().addObjects([o]);
    pt[key] = o.id;
    created = true;
  };
  const planter = spec.kind === 'planter' && !spec.vaseMode;
  accessory('saucerId', planter && spec.saucer.enabled, () => buildSaucer(spec, draft), 'saucer', 1);
  accessory('insertId', planter && spec.selfWater.enabled, () => buildInsert(spec, masks, draft), 'insert', -1);
  // new pieces: lay the set out together on the plate
  const set = [body.id, pt.saucerId, pt.insertId].filter((x): x is string => !!x);
  if (created) arrange(undefined, useStore.getState().activePlate, set);
  const after = useStore.getState();
  if (set.some((id) => { const o = after.objects.find((x) => x.id === id); return o && isOutOfBounds(o, after.printerId, after.plates.length); }))
    r.warnings.push('The pot and its accessories do not all fit on this plate: move one to another plate or print them separately.');
  // spiral vase mode follows the design
  const st = useStore.getState();
  if (!!st.overrides.spiral_mode !== spec.vaseMode) st.set({ overrides: { ...st.overrides, spiral_mode: spec.vaseMode } });
  // keep the body selected for editing
  useStore.getState().set({ selected: [body.id], selectedPart: null });
  pt.draft = draft;
  pt.warnings = r.warnings;
  pt.triangles = r.triangles;
  changed(false);
  return r;
}

export function loadSpec(spec: Partial<PlantexSpec>) {
  pt.spec = normalizeSpec(structuredClone(spec));
  pt.openLayer = null;
  changed();
}

export function saveDesign(name: string) {
  pt.designs = [...pt.designs, { id: newId(), name, spec: structuredClone({ ...pt.spec, name }) }];
  changed(false);
}

export function deleteDesign(id: string) {
  pt.designs = pt.designs.filter((d) => d.id !== id);
  changed(false);
}

/** Project file data. */
export const plantexProject = () => ({ spec: pt.spec, objectId: pt.objectId, saucerId: pt.saucerId, insertId: pt.insertId });
export function loadPlantexProject(d: unknown) {
  const x = d as Partial<ReturnType<typeof plantexProject>> | undefined;
  if (!x) return;
  if (x.spec) pt.spec = normalizeSpec(x.spec);
  pt.objectId = x.objectId ?? null;
  pt.saucerId = x.saucerId ?? null;
  pt.insertId = x.insertId ?? null;
  changed(false);
}
