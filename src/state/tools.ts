// Prepare tools that change geometry: Cut, Mesh Boolean and Text.
import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { cutAtZ0 } from '../engine/meshops';
import { openEdgeCount, repairTJunctions, transformVertices, weld, type IndexedMesh } from '../engine/mesh';
import { centreMesh } from '../io/load';
import { dropToBed, newId, objectMatrix, useStore, worldBounds, type SceneObject } from './store';

// ---------------------------------------------------------------- helpers
const worldMesh = (o: SceneObject): IndexedMesh => ({ vertices: transformVertices(o.mesh.vertices, objectMatrix(o).elements), indices: o.mesh.indices });

/** Turn a world-space mesh into a scene object placed where the geometry is. */
export function objectFromWorld(name: string, m: IndexedMesh, base: Partial<SceneObject> = {}): SceneObject {
  const [cx, cy, cz] = centreMesh(m);
  return { id: newId(), name, mesh: m, position: [cx, cy, cz], rotation: [0, 0, 0], scale: [1, 1, 1], openEdges: openEdgeCount(m), ...base };
}

const toGeometry = (m: IndexedMesh) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.vertices, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
};
const fromGeometry = (g: THREE.BufferGeometry): IndexedMesh => {
  const ng = g.index ? g.toNonIndexed() : g;
  return repairTJunctions(weld(new Float32Array(ng.getAttribute('position').array as ArrayLike<number>)));
};

// ---------------------------------------------------------------- cut
export interface CutOptions { height: number; tiltX: number; tiltY: number; keepAbove: boolean; keepBelow: boolean; flipAbove: boolean }

/** Cut the object with a plane through world height `height` (tilted by tiltX/tiltY degrees). */
export function cutObject(id: string, o: CutOptions) {
  const s = useStore.getState();
  const obj = s.objects.find((x) => x.id === id);
  if (!obj) return;
  const d = Math.PI / 180;
  const b = worldBounds(obj);
  const centre = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, o.height);
  const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.tiltX * d, o.tiltY * d, 0, 'XYZ'));
  const toPlane = new THREE.Matrix4().compose(centre, rot, new THREE.Vector3(1, 1, 1)).invert();
  const fromPlane = toPlane.clone().invert();
  const local = transformVertices(obj.mesh.vertices, toPlane.clone().multiply(objectMatrix(obj)).elements);
  const r = cutAtZ0({ vertices: local, indices: obj.mesh.indices });
  if (!r.below || !r.above) { s.set({ toast: { kind: 'warn', text: 'The cut plane does not cross the object.' } }); return; }
  const out: SceneObject[] = [];
  const keep = { filament: obj.filament, overrides: obj.overrides };
  if (o.keepBelow) out.push(objectFromWorld(`${obj.name} (lower)`, { vertices: transformVertices(r.below.vertices, fromPlane.elements), indices: r.below.indices }, keep));
  if (o.keepAbove) {
    let up = { vertices: transformVertices(r.above.vertices, fromPlane.elements), indices: r.above.indices };
    // the upper part's cut face points down the plane normal: undo the tilt so it lies flat on the bed
    if (o.flipAbove) up = { vertices: transformVertices(up.vertices, new THREE.Matrix4().makeRotationFromQuaternion(rot.clone().invert()).elements), indices: up.indices };
    const upper = objectFromWorld(`${obj.name} (upper)`, up, keep);
    upper.position[0] = b.max[0] + (b.max[0] - b.min[0]) / 2 + 8; // beside the lower part
    upper.position[1] = (b.min[1] + b.max[1]) / 2;
    out.push(upper);
  }
  s.checkpoint();
  s.set({ objects: [...s.objects.filter((x) => x.id !== id), ...out.map(dropToBed)], selected: out.map((x) => x.id), selectedPart: null, tool: 'select' });
  s.markDirty();
  if (r.openLoops) s.set({ toast: { kind: 'warn', text: `The mesh is not watertight at the cut: ${r.openLoops} section(s) could not be capped.` } });
}

// ---------------------------------------------------------------- boolean
export type BoolOp = 'union' | 'difference' | 'intersection';

export function booleanMeshes(a: IndexedMesh, b: IndexedMesh, op: BoolOp): IndexedMesh {
  const ev = new Evaluator();
  ev.attributes = ['position'];
  ev.useGroups = false;
  const A = new Brush(toGeometry(a)), B = new Brush(toGeometry(b));
  A.updateMatrixWorld(); B.updateMatrixWorld();
  const res = ev.evaluate(A, B, op === 'union' ? ADDITION : op === 'difference' ? SUBTRACTION : INTERSECTION);
  return fromGeometry(res.geometry);
}

/** Combine the first selected object with the others. Difference subtracts the others from the first. */
export function booleanSelected(op: BoolOp) {
  const s = useStore.getState();
  const objs = s.selected.map((id) => s.objects.find((o) => o.id === id)!).filter(Boolean);
  if (objs.length < 2) { s.set({ toast: { kind: 'warn', text: 'Select two or more objects (Shift+click). The first one is the base.' } }); return; }
  let m = worldMesh(objs[0]);
  try {
    for (const o of objs.slice(1)) m = booleanMeshes(m, worldMesh(o), op);
  } catch (e: any) { s.set({ toast: { kind: 'error', text: `Boolean failed: ${e?.message ?? e}` } }); return; }
  if (!m.indices.length) { s.set({ toast: { kind: 'warn', text: 'The result is empty (the objects do not overlap).' } }); return; }
  const res = objectFromWorld(`${objs[0].name} (${op})`, m, { filament: objs[0].filament, overrides: objs[0].overrides });
  s.checkpoint();
  const ids = new Set(objs.map((o) => o.id));
  s.set({ objects: [...s.objects.filter((o) => !ids.has(o.id)), dropToBed(res)], selected: [res.id], selectedPart: null });
  s.markDirty();
}

// ---------------------------------------------------------------- text
export const FONTS: Record<string, { label: string; load: () => Promise<any> }> = {
  helvetiker: { label: 'Helvetiker', load: () => import('three/examples/fonts/helvetiker_regular.typeface.json') },
  helvetiker_bold: { label: 'Helvetiker Bold', load: () => import('three/examples/fonts/helvetiker_bold.typeface.json') },
  optimer: { label: 'Optimer', load: () => import('three/examples/fonts/optimer_regular.typeface.json') },
  optimer_bold: { label: 'Optimer Bold', load: () => import('three/examples/fonts/optimer_bold.typeface.json') },
  gentilis: { label: 'Gentilis', load: () => import('three/examples/fonts/gentilis_regular.typeface.json') },
  droid_sans: { label: 'Droid Sans', load: () => import('three/examples/fonts/droid/droid_sans_regular.typeface.json') },
  droid_mono: { label: 'Droid Sans Mono', load: () => import('three/examples/fonts/droid/droid_sans_mono_regular.typeface.json') },
};

export async function textMesh(text: string, font: string, size: number, depth: number): Promise<IndexedMesh> {
  const [{ FontLoader }, { TextGeometry }] = await Promise.all([import('three/examples/jsm/loaders/FontLoader.js'), import('three/examples/jsm/geometries/TextGeometry.js')]);
  const data = await FONTS[font].load();
  const f = new FontLoader().parse(data.default ?? data);
  const g = new TextGeometry(text, { font: f, size, depth, curveSegments: 6, bevelEnabled: false });
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, 0);
  return fromGeometry(g);
}

export interface TextOptions { text: string; font: string; size: number; depth: number; mode: 'object' | 'emboss' | 'engrave' }

/** Add text as its own object, or emboss / engrave it into the top of the selected object. */
export async function addText(o: TextOptions) {
  const s = useStore.getState();
  if (!o.text.trim()) return;
  let t: IndexedMesh;
  try {
    t = await textMesh(o.text, o.font, o.size, o.mode === 'engrave' ? o.depth + 0.01 : o.depth);
    if (!t.indices.length) throw new Error(`the font has no shapes for "${o.text}"`);
  } catch (e: any) {
    console.error('Text failed', e);
    s.set({ toast: { kind: 'error', text: `Text failed: ${e?.message ?? e}` } });
    return;
  }
  const target = s.objects.find((x) => x.id === s.selected[0]);
  if (o.mode === 'object' || !target) {
    try {
      const { centreOnBed } = await import('./ops');
      const obj = centreOnBed(objectFromWorld(`Text "${o.text}"`, t), useStore.getState().printerId);
      useStore.getState().addObjects([obj]);
    } catch (e: any) {
      console.error('Text failed', e);
      s.set({ toast: { kind: 'error', text: `Text failed: ${e?.message ?? e}` } });
    }
    return;
  }
  // place on the top face of the target, centred
  const b = worldBounds(target);
  const top = b.max[2];
  const place = new THREE.Matrix4().makeTranslation((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, o.mode === 'engrave' ? top - o.depth : top - 0.01);
  const tw = { vertices: transformVertices(t.vertices, place.elements), indices: t.indices };
  let m: IndexedMesh;
  try { m = booleanMeshes(worldMesh(target), tw, o.mode === 'engrave' ? 'difference' : 'union'); }
  catch (e: any) { s.set({ toast: { kind: 'error', text: `Text failed: ${e?.message ?? e}` } }); return; }
  const res = objectFromWorld(target.name, m, { id: target.id, filament: target.filament, overrides: target.overrides });
  s.checkpoint();
  s.set({ objects: s.objects.map((x) => (x.id === target.id ? dropToBed({ ...res, paint: undefined, layerHeights: undefined }) : x)) });
  s.markDirty();
}
