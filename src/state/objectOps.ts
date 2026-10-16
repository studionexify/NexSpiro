// Object commands used by the right-click menus: mirror, split, clone, fill bed, export STL, copy/paste.
import * as THREE from 'three';
import { reframePlacements } from '../plugins/patternex/ui/state';
import { openEdgeCount, transformVertices, type IndexedMesh } from '../engine/mesh';
import { centreMesh } from '../io/load';
import { saveFile } from '../platform';
import { printerById } from '../profiles/printers';
import { arrange, centreOnBed, primitive, SHAPES, type ShapeKind } from './ops';
import { objectFromWorld } from './tools';
import { dropToBed, newId, objectMatrix, objectPlate, plateOrigin, useStore, worldBounds, type SceneObject, type Vec3 } from './store';

const worldMesh = (o: SceneObject): IndexedMesh => ({ vertices: transformVertices(o.mesh.vertices, objectMatrix(o).elements), indices: o.mesh.indices });

/** Mirror the object along a world axis. Baked into the mesh so triangle winding stays outward. */
export function mirrorObjects(axis: 0 | 1 | 2, ids = useStore.getState().selected) {
  const s = useStore.getState();
  if (s.objects.some((o) => ids.includes(o.id) && o.parts?.length)) s.set({ toast: { kind: 'warn', text: 'Mirroring removed the parts and modifiers on the object. Add them again if you need them.' } });
  s.updateObjects((o) => {
    const b = worldBounds(o);
    const c = (b.min[axis] + b.max[axis]) / 2;
    const w = worldMesh(o);
    const v = w.vertices;
    for (let i = axis; i < v.length; i += 3) v[i] = 2 * c - v[i];
    const ix = w.indices.slice();
    for (let t = 0; t < ix.length; t += 3) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; }
    const m = { vertices: v, indices: ix };
    const [cx, cy, cz] = centreMesh(m);
    // paint is per triangle and the triangle order is kept, so it stays valid
    const next = dropToBed({ ...o, mesh: m, position: [cx, cy, cz], rotation: [0, 0, 0], scale: [1, 1, 1], parts: undefined, layerHeights: undefined });
    // Patternex artwork is mirrored with the object (same reflection, re-expressed in the new frame)
    if (o.patternex) {
      const reflect = (p: Vec3, isDir: boolean): Vec3 => { const q = [...p] as Vec3; q[axis] = isDir ? -q[axis] : 2 * c - q[axis]; return q; };
      next.patternex = reframePlacements(o.patternex, objectMatrix(o).elements, objectMatrix(next).invert().elements, reflect);
    }
    return next;
  }, ids);
}

/** Connected pieces of a mesh, as triangle lists. */
export function meshComponents(m: IndexedMesh): number[][] {
  const T = m.indices.length / 3;
  const parent = new Int32Array(m.vertices.length / 3).map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < T; t++) {
    const a = find(m.indices[t * 3]);
    for (let k = 1; k < 3; k++) { const b = find(m.indices[t * 3 + k]); if (a !== b) parent[b] = a; }
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < T; t++) { const r = find(m.indices[t * 3]); const g = groups.get(r); if (g) g.push(t); else groups.set(r, [t]); }
  return [...groups.values()];
}

/** Split an object into one object per separate piece. */
export function splitObject(id: string) {
  const s = useStore.getState();
  const o = s.objects.find((x) => x.id === id);
  if (!o) return;
  const comps = meshComponents(o.mesh);
  if (comps.length < 2) { s.set({ toast: { kind: 'info', text: `${o.name} is a single piece, so there is nothing to split.` } }); return; }
  const w = worldMesh(o);
  const out = comps.map((tris, k) => {
    const remap = new Map<number, number>();
    const verts: number[] = [], ix = new Uint32Array(tris.length * 3);
    tris.forEach((t, j) => {
      for (let c = 0; c < 3; c++) {
        const vi = w.indices[t * 3 + c];
        let n = remap.get(vi);
        if (n === undefined) { n = remap.size; remap.set(vi, n); verts.push(w.vertices[vi * 3], w.vertices[vi * 3 + 1], w.vertices[vi * 3 + 2]); }
        ix[j * 3 + c] = n;
      }
    });
    return objectFromWorld(`${o.name} (${k + 1})`, { vertices: new Float32Array(verts), indices: ix }, { filament: o.filament, overrides: o.overrides });
  });
  // Patternex: each placement goes to the piece nearest its anchor point, re-expressed in that piece's frame
  if (o.patternex) {
    const toWorld = objectMatrix(o).elements;
    for (const p of o.patternex.placements) {
      const a = new THREE.Vector3(...p.position_xyz).applyMatrix4(objectMatrix(o));
      let best = 0, bd = Infinity;
      out.forEach((piece, k) => {
        const v = piece.mesh.vertices, mm = objectMatrix(piece);
        for (let i = 0; i < v.length; i += 3) { const d = new THREE.Vector3(v[i], v[i + 1], v[i + 2]).applyMatrix4(mm).distanceToSquared(a); if (d < bd) { bd = d; best = k; } }
      });
      const piece = out[best];
      const one = { placements: [p], actions: o.patternex.actions.filter((x) => x.region_ref.placement_id === p.id), patterns: o.patternex.patterns };
      const moved = reframePlacements(one, toWorld, objectMatrix(piece).invert().elements);
      const cur = piece.patternex ?? { placements: [], actions: [], patterns: o.patternex.patterns };
      piece.patternex = { placements: [...cur.placements, ...moved.placements.map((q) => ({ ...q, object_id: piece.id }))], actions: [...cur.actions, ...moved.actions], patterns: cur.patterns };
    }
  }
  s.checkpoint();
  s.set({ objects: [...s.objects.filter((x) => x.id !== id), ...out], selected: out.map((x) => x.id), selectedPart: null });
  s.markDirty();
}

export function centreObjects(ids = useStore.getState().selected) {
  const s = useStore.getState();
  s.updateObjects((o) => centreOnBed(o, s.printerId, objectPlate(o, s.printerId, s.plates.length)), ids);
}

export function dropObjects(ids = useStore.getState().selected) {
  useStore.getState().updateObjects((o) => dropToBed(o), ids);
}

/** Add count copies of each object, then arrange the plate. */
export function cloneObjects(count: number, ids = useStore.getState().selected) {
  const s = useStore.getState();
  const src = s.objects.filter((o) => ids.includes(o.id));
  if (!src.length || count < 1) return;
  const copies = src.flatMap((o) => Array.from({ length: count }, (_, k) => ({ ...o, id: newId(), name: `${o.name} (${k + 2})`, position: [o.position[0] + 6 * (k + 1), o.position[1] + 6 * (k + 1), o.position[2]] as Vec3 })));
  s.addObjects(copies);
  arrange();
}

/** Add copies of the object until the plate is full (by footprint area), then arrange. */
export function fillBed(id: string) {
  const s = useStore.getState();
  const o = s.objects.find((x) => x.id === id);
  if (!o) return;
  const p = printerById(s.printerId);
  const plate = objectPlate(o, s.printerId, s.plates.length);
  const foot = (x: SceneObject) => { const b = worldBounds(x); return (b.max[0] - b.min[0] + 6) * (b.max[1] - b.min[1] + 6); };
  const used = s.objects.filter((x) => objectPlate(x, s.printerId, s.plates.length) === plate).reduce((a, x) => a + foot(x), 0);
  const n = Math.floor((p.bed.x * p.bed.y * 0.8 - used) / foot(o));
  if (n < 1) { s.set({ toast: { kind: 'info', text: 'The plate has no room for another copy.' } }); return; }
  cloneObjects(n, [id]);
  // arrange can push copies past the edge on awkward shapes; drop those back off
  const st = useStore.getState();
  const [ox, oy] = plateOrigin(plate, st.printerId);
  const off = st.objects.filter((x) => x.name.startsWith(`${o.name} (`) && (() => { const b = worldBounds(x); return b.min[0] < ox - 0.01 || b.min[1] < oy - 0.01 || b.max[0] > ox + p.bed.x + 0.01 || b.max[1] > oy + p.bed.y + 0.01; })());
  if (off.length) st.set({ objects: st.objects.filter((x) => !off.includes(x)), selected: st.selected.filter((x) => !off.some((y) => y.id === x)) });
}

export function setObjectFilament(slot: number, ids = useStore.getState().selected) {
  useStore.getState().updateObjects((o) => ({ ...o, filament: slot }), ids);
}

export function renameObject(id: string) {
  const s = useStore.getState();
  const o = s.objects.find((x) => x.id === id);
  if (!o) return;
  const name = prompt('Object name', o.name)?.trim();
  if (name) s.updateObjects((x) => ({ ...x, name }), [id]);
}

export function togglePrintable(ids = useStore.getState().selected) {
  const s = useStore.getState();
  const on = !s.objects.filter((o) => ids.includes(o.id)).every((o) => o.printable === false);
  s.updateObjects((o) => ({ ...o, printable: on ? false : undefined }), ids);
}

/** Binary STL of the objects in world coordinates. */
export function stlBytes(objs: SceneObject[]): ArrayBuffer {
  const meshes = objs.map(worldMesh);
  const T = meshes.reduce((a, m) => a + m.indices.length / 3, 0);
  const buf = new ArrayBuffer(84 + T * 50);
  const dv = new DataView(buf);
  new TextEncoder().encodeInto('NexSpiro STL export', new Uint8Array(buf, 0, 80));
  dv.setUint32(80, T, true);
  let o = 84;
  for (const m of meshes) {
    const v = m.vertices, ix = m.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (const val of [nx, ny, nz]) { dv.setFloat32(o, val, true); o += 4; }
      for (const i of [a, b, c]) for (let k = 0; k < 3; k++) { dv.setFloat32(o, v[i + k], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return buf;
}

export async function exportStl(ids = useStore.getState().selected) {
  const s = useStore.getState();
  const objs = s.objects.filter((o) => ids.includes(o.id));
  if (!objs.length) return;
  const name = (objs.length === 1 ? objs[0].name : 'objects').replace(/[^\w.-]+/g, '_');
  const saved = await saveFile(`${name}.stl`, stlBytes(objs), 'stl');
  if (saved) s.set({ toast: { kind: 'info', text: `STL exported: ${saved}` } });
}

// ----- copy / paste
let clipboard: SceneObject[] = [];
export const hasClipboard = () => clipboard.length > 0;
export function copyObjects(ids = useStore.getState().selected) {
  clipboard = useStore.getState().objects.filter((o) => ids.includes(o.id));
}
/** Paste copies; with at, the copies are centred on that world point. */
export function pasteObjects(at?: [number, number]) {
  if (!clipboard.length) return;
  const b = clipboard.map(worldBounds);
  const cx = (Math.min(...b.map((x) => x.min[0])) + Math.max(...b.map((x) => x.max[0]))) / 2;
  const cy = (Math.min(...b.map((x) => x.min[1])) + Math.max(...b.map((x) => x.max[1]))) / 2;
  const [dx, dy] = at ? [at[0] - cx, at[1] - cy] : [10, 10];
  useStore.getState().addObjects(clipboard.map((o) => ({ ...o, id: newId(), position: [o.position[0] + dx, o.position[1] + dy, o.position[2]] as Vec3 })));
}

/** Delete every object on a plate. */
export function clearPlate(plate = useStore.getState().activePlate) {
  const s = useStore.getState();
  const ids = new Set(s.objects.filter((o) => objectPlate(o, s.printerId, s.plates.length) === plate).map((o) => o.id));
  if (!ids.size) return;
  s.checkpoint();
  s.set({ objects: s.objects.filter((o) => !ids.has(o.id)), selected: [], selectedPart: null });
  s.markDirty();
}

export function selectPlate(plate = useStore.getState().activePlate) {
  const s = useStore.getState();
  s.set({ selected: s.objects.filter((o) => objectPlate(o, s.printerId, s.plates.length) === plate).map((o) => o.id), selectedPart: null });
}

/** Add a primitive shape as a new object on the plate (at a world point when given). */
export function addShape(shape: ShapeKind, at?: [number, number]) {
  const s = useStore.getState();
  const mesh = primitive(shape, 20);
  centreMesh(mesh);
  let o: SceneObject = { id: newId(), name: SHAPES.find(([k]) => k === shape)?.[1] ?? 'Shape', mesh, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], openEdges: openEdgeCount(mesh) };
  o = centreOnBed(o, s.printerId);
  if (at) o = { ...o, position: [at[0], at[1], o.position[2]] };
  s.addObjects([o]);
}
