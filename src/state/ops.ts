// Scene operations: arrange, auto-orient, lay-on-face, centre.
import * as THREE from 'three';
import { printerById } from '../profiles/printers';
import { dropToBed, newId, objectMatrix, objectPlate, plateOrigin, useStore, worldBounds, type SceneObject, type ScenePart } from './store';
import { weld, type IndexedMesh } from '../engine/mesh';
import { adaptiveProfile, applyHeightRange, smoothProfile, uniformProfile } from '../engine/layers';
import type { PartType } from '../engine/types';
import { currentConfig } from './slicing';

const DEG = 180 / Math.PI;

/** Shelf bin-packing of bounding boxes centred on the bed (spacing in mm). */
export function arrange(spacing = 6, plate = useStore.getState().activePlate) {
  const s = useStore.getState();
  const objs = s.objects.filter((o) => objectPlate(o, s.printerId, s.plates.length) === plate);
  if (!objs.length) return;
  const p = printerById(s.printerId);
  const [ox, oy] = plateOrigin(plate, s.printerId);
  const items = objs.map((o) => ({ o, b: worldBounds(o) }))
    .map(({ o, b }) => ({ o, w: b.max[0] - b.min[0], d: b.max[1] - b.min[1], b }))
    .sort((a, b) => b.d - a.d);
  const rows: { items: typeof items; w: number; d: number }[] = [];
  let row = { items: [] as typeof items, w: 0, d: 0 };
  for (const it of items) {
    if (row.items.length && row.w + spacing + it.w > p.bed.x) { rows.push(row); row = { items: [], w: 0, d: 0 }; }
    row.w += (row.items.length ? spacing : 0) + it.w;
    row.d = Math.max(row.d, it.d);
    row.items.push(it);
  }
  rows.push(row);
  const totalD = rows.reduce((a, r) => a + r.d, 0) + spacing * (rows.length - 1);
  let y = oy + (p.bed.y + totalD) / 2;
  const placed = new Map<string, [number, number]>();
  for (const r of rows) {
    let x = ox + (p.bed.x - r.w) / 2;
    for (const it of r.items) {
      const cx = x + it.w / 2, cy = y - r.d / 2;
      const ocx = (it.b.min[0] + it.b.max[0]) / 2, ocy = (it.b.min[1] + it.b.max[1]) / 2;
      placed.set(it.o.id, [it.o.position[0] + cx - ocx, it.o.position[1] + cy - ocy]);
      x += it.w + spacing;
    }
    y -= r.d + spacing;
  }
  s.updateObjects((o) => {
    const xy = placed.get(o.id)!;
    return dropToBed({ ...o, position: [xy[0], xy[1], o.position[2]] });
  }, objs.map((o) => o.id));
}

/** Rotation (euler degrees) that turns `normal` (world) to face straight down, composed with current rotation. */
function rotationFacingDown(o: SceneObject, worldNormal: THREE.Vector3): [number, number, number] {
  const q = new THREE.Quaternion().setFromUnitVectors(worldNormal.clone().normalize(), new THREE.Vector3(0, 0, -1));
  const cur = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotation[0] / DEG, o.rotation[1] / DEG, o.rotation[2] / DEG, 'XYZ'));
  const e = new THREE.Euler().setFromQuaternion(q.multiply(cur), 'XYZ');
  return [e.x * DEG, e.y * DEG, e.z * DEG].map((v) => +v.toFixed(4)) as [number, number, number];
}

export function layOnFace(id: string, worldNormal: THREE.Vector3) {
  const s = useStore.getState();
  s.updateObjects((o) => dropToBed({ ...o, rotation: rotationFacingDown(o, worldNormal) }), [id]);
}

/** Evaluate candidate "down" directions; minimise overhang area, maximise bed contact. */
export function autoOrient(ids?: string[]) {
  const s = useStore.getState();
  const targets = s.objects.filter((o) => (ids ?? s.selected).includes(o.id));
  if (!targets.length) return;
  const updates = new Map<string, [number, number, number]>();
  for (const o of targets) {
    const m = objectMatrix(o);
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = o.mesh.vertices, ix = o.mesh.indices;
    // world-space face normals & areas
    const faces: { n: THREE.Vector3; a: number; c: THREE.Vector3 }[] = [];
    const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
    for (let t = 0; t < ix.length; t += 3) {
      A.fromArray(v, ix[t] * 3).applyMatrix4(m); B.fromArray(v, ix[t + 1] * 3).applyMatrix4(m); Cc.fromArray(v, ix[t + 2] * 3).applyMatrix4(m);
      const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(Cc, A));
      const a = n.length() / 2;
      if (a < 1e-9) continue;
      faces.push({ n: n.normalize(), a, c: A.clone().add(B).add(Cc).divideScalar(3) });
    }
    void nm;
    // candidate directions: 6 axes + 24 largest normal clusters
    const clusters: { n: THREE.Vector3; a: number }[] = [];
    for (const f of faces) {
      const c = clusters.find((k) => k.n.dot(f.n) > 0.996);
      if (c) c.a += f.a; else clusters.push({ n: f.n.clone(), a: f.a });
    }
    clusters.sort((a, b) => b.a - a.a);
    const cands = [
      new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      ...clusters.slice(0, 24).map((c) => c.n),
    ];
    let best = cands[0], bestCost = Infinity;
    const cos45 = Math.cos(Math.PI / 4);
    for (const d of cands) {
      // in rotated frame "down" = d. height along -d of each point: h = -(p·d)
      let minH = Infinity, maxH = -Infinity;
      for (const f of faces) { const h = -f.c.dot(d); if (h < minH) minH = h; if (h > maxH) maxH = h; }
      let bottom = 0, overhang = 0;
      for (const f of faces) {
        const nd = f.n.dot(d); // 1 = facing straight down
        const h = -f.c.dot(d) - minH;
        if (nd > 0.999 && h < 0.1) bottom += f.a;
        else if (nd > cos45) overhang += f.a * nd;
      }
      const cost = overhang - 3 * bottom + 0.05 * (maxH - minH) * Math.sqrt(bottom + 1);
      if (cost < bestCost) { bestCost = cost; best = d; }
    }
    updates.set(o.id, rotationFacingDown(o, best));
  }
  s.updateObjects((o) => dropToBed({ ...o, rotation: updates.get(o.id)! }), [...updates.keys()]);
}

export function centreOnBed(o: SceneObject, printerId: string, plate = useStore.getState().activePlate): SceneObject {
  const p = printerById(printerId);
  const [ox, oy] = plateOrigin(plate, printerId);
  const b = worldBounds(o);
  return dropToBed({ ...o, position: [o.position[0] + ox + p.bed.x / 2 - (b.min[0] + b.max[0]) / 2, o.position[1] + oy + p.bed.y / 2 - (b.min[1] + b.max[1]) / 2, o.position[2]] });
}

// ---------------------------------------------------------------- plates
export function addPlate() {
  const s = useStore.getState();
  const n = s.plates.length;
  s.set({ plates: [...s.plates, { id: newId('plate'), name: `Plate ${n + 1}`, layerActions: [] }], activePlate: n });
}

export function deletePlate(index = useStore.getState().activePlate) {
  const s = useStore.getState();
  if (s.plates.length <= 1) return;
  const count = s.plates.length;
  const onPlate = s.objects.filter((o) => objectPlate(o, s.printerId, count) === index);
  if (onPlate.length && !confirm(`Delete ${s.plates[index].name} and its ${onPlate.length} object(s)?`)) return;
  s.checkpoint();
  // shift objects on later plates one cell back so they stay on their plate
  const dropIds = new Set(onPlate.map((o) => o.id));
  const objects = s.objects.filter((o) => !dropIds.has(o.id)).map((o) => {
    const pi = objectPlate(o, s.printerId, count);
    if (pi <= index) return o;
    const [ax, ay] = plateOrigin(pi, s.printerId), [bx, by] = plateOrigin(pi - 1, s.printerId);
    return { ...o, position: [o.position[0] + bx - ax, o.position[1] + by - ay, o.position[2]] as SceneObject['position'] };
  });
  const plates = s.plates.filter((_, i) => i !== index).map((p, i) => ({ ...p, name: `Plate ${i + 1}` }));
  s.set({ objects, plates, activePlate: Math.min(index, plates.length - 1), selected: [] });
  s.markDirty();
}

/** Move selected objects to another plate, keeping their position relative to the plate. */
export function moveToPlate(target: number) {
  const s = useStore.getState();
  s.updateObjects((o) => {
    const from = objectPlate(o, s.printerId, s.plates.length);
    const [ax, ay] = plateOrigin(from, s.printerId), [bx, by] = plateOrigin(target, s.printerId);
    return { ...o, position: [o.position[0] + bx - ax, o.position[1] + by - ay, o.position[2]] };
  });
}

// ---------------------------------------------------------------- primitive parts
export function primitive(shape: 'box' | 'cylinder' | 'sphere', size: number): IndexedMesh {
  const out: number[] = [];
  const r = size / 2;
  if (shape === 'box') {
    const v = [[-r, -r, -r], [r, -r, -r], [r, r, -r], [-r, r, -r], [-r, -r, r], [r, -r, r], [r, r, r], [-r, r, r]];
    const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    for (const t of f) for (const i of t) out.push(...v[i]);
  } else if (shape === 'cylinder') {
    const seg = 48;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [r * Math.cos(a0), r * Math.sin(a0)], p1 = [r * Math.cos(a1), r * Math.sin(a1)];
      out.push(0, 0, -r, p1[0], p1[1], -r, p0[0], p0[1], -r, 0, 0, r, p0[0], p0[1], r, p1[0], p1[1], r);
      out.push(p0[0], p0[1], -r, p1[0], p1[1], -r, p1[0], p1[1], r, p0[0], p0[1], -r, p1[0], p1[1], r, p0[0], p0[1], r);
    }
  } else {
    const st = 16, sl = 32;
    const P = (i: number, j: number) => {
      const th = (i / st) * Math.PI, ph = (j / sl) * Math.PI * 2;
      return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
    };
    for (let i = 0; i < st; i++) for (let j = 0; j < sl; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (i > 0) out.push(...a, ...b, ...d);
      if (i < st - 1) out.push(...b, ...c, ...d);
    }
  }
  return weld(new Float32Array(out));
}

export const PART_LABELS: Record<PartType, string> = {
  negative: 'Negative part', modifier: 'Modifier', support_enforcer: 'Support enforcer', support_blocker: 'Support blocker',
};

export function addPart(objectId: string, type: PartType, shape: 'box' | 'cylinder' | 'sphere') {
  const s = useStore.getState();
  const o = s.objects.find((x) => x.id === objectId);
  if (!o) return;
  const b = worldBounds(o);
  const size = Math.max(4, Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * 0.5);
  // place at the object's centre, expressed in the object frame (undo object scale)
  const centre = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2)
    .applyMatrix4(objectMatrix(o).invert());
  const part: ScenePart = {
    id: newId('part'), name: `${PART_LABELS[type]} (${shape})`, type, mesh: primitive(shape, size),
    position: [centre.x, centre.y, centre.z], rotation: [0, 0, 0], scale: [1 / o.scale[0], 1 / o.scale[1], 1 / o.scale[2]],
    overrides: type === 'modifier' ? { sparse_infill_density: 50 } : {},
  };
  s.updateObjects((x) => ({ ...x, parts: [...(x.parts ?? []), part] }), [objectId]);
  s.set({ selectedPart: part.id, selected: [objectId], processMode: 'objects' });
}

export function updatePart(objectId: string, partId: string, fn: (p: ScenePart) => ScenePart, record = true) {
  useStore.getState().updateObjects((o) => ({ ...o, parts: (o.parts ?? []).map((p) => (p.id === partId ? fn(p) : p)) }), [objectId], record);
}

// ---------------------------------------------------------------- variable layer height
function worldMesh(o: SceneObject): IndexedMesh {
  const m = objectMatrix(o).elements;
  const v = o.mesh.vertices, out = new Float32Array(v.length);
  let minZ = Infinity;
  for (let i = 0; i < v.length; i += 3) {
    out[i] = m[0] * v[i] + m[4] * v[i + 1] + m[8] * v[i + 2] + m[12];
    out[i + 1] = m[1] * v[i] + m[5] * v[i + 1] + m[9] * v[i + 2] + m[13];
    out[i + 2] = m[2] * v[i] + m[6] * v[i + 1] + m[10] * v[i + 2] + m[14];
    minZ = Math.min(minZ, out[i + 2]);
  }
  for (let i = 2; i < out.length; i += 3) out[i] -= minZ;
  return { vertices: out, indices: o.mesh.indices };
}

export function profileBounds() {
  const c = currentConfig();
  const nz = Number(c.nozzle_diameter);
  return { minHeight: +(nz * 0.2).toFixed(2), maxHeight: +(nz * 0.7).toFixed(2), firstLayer: Number(c.initial_layer_print_height), nominal: Number(c.layer_height) };
}

export function objectHeight(o: SceneObject) { const b = worldBounds(o); return b.max[2] - b.min[2]; }

export function currentProfile(o: SceneObject): number[] {
  const pb = profileBounds();
  return o.layerHeights?.length ? o.layerHeights : uniformProfile(objectHeight(o), pb.firstLayer, pb.nominal);
}

export function vlhAdaptive(id: string, quality: number) {
  const o = useStore.getState().objects.find((x) => x.id === id);
  if (!o) return;
  const pb = profileBounds();
  const prof = adaptiveProfile(worldMesh(o), { ...pb, quality });
  useStore.getState().updateObjects((x) => ({ ...x, layerHeights: prof }), [id]);
}
export function vlhSmooth(id: string, radius: number, keepMin: boolean) {
  const o = useStore.getState().objects.find((x) => x.id === id);
  if (!o) return;
  useStore.getState().updateObjects((x) => ({ ...x, layerHeights: smoothProfile(currentProfile(x), radius, keepMin) }), [id]);
}
export function vlhRange(id: string, z0: number, z1: number, h: number) {
  const o = useStore.getState().objects.find((x) => x.id === id);
  if (!o) return;
  useStore.getState().updateObjects((x) => ({ ...x, layerHeights: applyHeightRange(currentProfile(x), z0, z1, h, objectHeight(x)) }), [id]);
}
export function vlhReset(id: string) {
  useStore.getState().updateObjects((x) => ({ ...x, layerHeights: undefined }), [id]);
}
