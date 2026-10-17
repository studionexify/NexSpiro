// Scene operations: arrange, auto-orient, lay-on-face, centre.
import * as THREE from 'three';
import { printerById } from '../profiles/printers';
import { dropToBed, newId, objectMatrix, objectPlate, plateOrigin, useStore, worldBounds, type Plate, type SceneObject, type ScenePart } from './store';
import { weld, type IndexedMesh } from '../engine/mesh';
import { adaptiveProfile, applyHeightRange, smoothProfile, uniformProfile } from '../engine/layers';
import type { PartType } from '../engine/types';
import type { Config } from '../profiles/settings';
import { arrangeItems, convexHull, type Pt } from '../engine/arrange';
import { currentConfig } from './slicing';

const DEG = 180 / Math.PI;

/** Shelf bin-packing of bounding boxes centred on the bed (spacing in mm). */
/** Silhouette of an object on the bed: convex hull of its world vertices (sampled on big meshes). */
export function silhouette(o: SceneObject): Pt[] {
  const m = objectMatrix(o).elements, v = o.mesh.vertices, n = v.length / 3;
  const stride = Math.max(1, Math.floor(n / 6000));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i += stride) {
    const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
    pts.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13]]);
  }
  return convexHull(pts);
}

/**
 * Arrange the objects on a plate (Bambu's arrange): pack their silhouettes with the arrange settings' spacing,
 * trying rotations when auto-rotate is on, then centre the group (or align it to an axis).
 * Objects that do not fit are placed past the plate's right edge and reported.
 */
export function arrange(spacing?: number, plate = useStore.getState().activePlate, only?: string[]) {
  const s = useStore.getState();
  if (s.plates[plate]?.locked) return;
  const objs = s.objects.filter((o) => objectPlate(o, s.printerId, s.plates.length) === plate && (!only || only.includes(o.id)));
  if (!objs.length) return;
  const p = printerById(s.printerId);
  const [ox, oy] = plateOrigin(plate, s.printerId);
  const st = s.arrangeSettings;
  const gap = spacing ?? st.spacing;
  const hulls = new Map(objs.map((o) => [o.id, silhouette(o)]));
  // objects not being arranged stay where they are: arrange the rest around nothing (Bambu re-packs the whole plate)
  const res = arrangeItems(objs.map((o) => ({ id: o.id, hull: hulls.get(o.id)!.map(([x, y]) => [x - ox, y - oy] as Pt) })), { x: p.bed.x, y: p.bed.y },
    { spacing: gap, rotations: st.rotate ? [0, 45, 90, 135, 180, 225, 270, 315] : [0], align: st.align, edge: 2 });
  let over = 0;
  s.updateObjects((o) => {
    const r = res.get(o.id);
    if (!r) {
      // no room: park it to the right of the plate
      const b = worldBounds(o);
      const nx = ox + p.bed.x + 10 + (b.max[0] - b.min[0]) / 2 + over * 5;
      over++;
      return dropToBed({ ...o, position: [o.position[0] + nx - (b.min[0] + b.max[0]) / 2, o.position[1] + oy + p.bed.y / 2 - (b.min[1] + b.max[1]) / 2, o.position[2]] });
    }
    // rotate about world Z, then move so the silhouette's centroid lands where the arranger put it
    let rot = o.rotation;
    if (r.rotation) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), r.rotation / DEG);
      const cur = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotation[0] / DEG, o.rotation[1] / DEG, o.rotation[2] / DEG, 'XYZ'));
      const e = new THREE.Euler().setFromQuaternion(q.multiply(cur), 'XYZ');
      rot = [e.x * DEG, e.y * DEG, e.z * DEG].map((v) => +v.toFixed(4)) as [number, number, number];
    }
    const turned = { ...o, rotation: rot };
    const hc = hullCentroid(silhouette(turned));
    return dropToBed({ ...turned, position: [o.position[0] + ox + r.x - hc[0], o.position[1] + oy + r.y - hc[1], o.position[2]] });
  }, objs.map((o) => o.id));
  if (over) s.set({ toast: { kind: 'warn', text: `${over} object${over > 1 ? 's do' : ' does'} not fit on the plate and ${over > 1 ? 'were' : 'was'} placed beside it.` } });
}

function hullCentroid(h: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < h.length; i++) {
    const [x0, y0] = h[i], [x1, y1] = h[(i + 1) % h.length];
    const c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  return Math.abs(a) < 1e-9 ? h[0] ?? [0, 0] : [cx / (3 * a), cy / (3 * a)];
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
/** Arrange every unlocked plate, like Bambu Studio's toolbar Arrange. */
export function arrangeAll(spacing?: number) {
  const s = useStore.getState();
  s.plates.forEach((p, i) => { if (!p.locked) arrange(spacing, i); });
}

/** Arrange only the selected objects, each group on its own plate. */
export function arrangeSelected(spacing?: number) {
  const s = useStore.getState();
  const plates = new Set(s.objects.filter((o) => s.selected.includes(o.id)).map((o) => objectPlate(o, s.printerId, s.plates.length)));
  for (const p of plates) arrange(spacing, p, s.selected);
}

/** Auto orient every object on a plate (skipped while the plate is locked). */
export function orientPlate(plate = useStore.getState().activePlate) {
  const s = useStore.getState();
  if (s.plates[plate]?.locked) return;
  const ids = s.objects.filter((o) => objectPlate(o, s.printerId, s.plates.length) === plate).map((o) => o.id);
  if (ids.length) autoOrient(ids);
}

export function updatePlate(index: number, patch: Partial<Plate>) {
  const s = useStore.getState();
  s.set({ plates: s.plates.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
  s.markDirty();
}

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

// ---------------------------------------------------------------- primitive shapes
export type ShapeKind = 'box' | 'cylinder' | 'sphere' | 'cone' | 'disc' | 'torus' | 'tube' | 'hemisphere' | 'pyramid' | 'prism' | 'capsule';

/** Shapes offered by "Add primitive", in menu order. */
export const SHAPES: [ShapeKind, string][] = [
  ['box', 'Cube'], ['cylinder', 'Cylinder'], ['sphere', 'Sphere'], ['cone', 'Cone'], ['disc', 'Disc'], ['torus', 'Torus'],
  ['tube', 'Tube'], ['hemisphere', 'Hemisphere'], ['pyramid', 'Pyramid'], ['prism', 'Triangular prism'], ['capsule', 'Capsule'],
];

/** Closed surface of revolution around Z. profile: [radius, z] points; open profiles start and end on the axis, closed ones repeat their first point. */
function revolve(profile: [number, number][], seg: number, a0 = 0): number[] {
  const out: number[] = [];
  const P = (k: number, j: number) => { const a = a0 + (j / seg) * Math.PI * 2, [r, z] = profile[k]; return [r * Math.cos(a), r * Math.sin(a), z]; };
  for (let k = 0; k < profile.length - 1; k++) for (let j = 0; j < seg; j++) {
    const a = P(k, j), b = P(k, j + 1), c = P(k + 1, j + 1), d = P(k + 1, j);
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return out;
}

export function signedVolume(m: IndexedMesh) {
  const v = m.vertices, ix = m.indices;
  let vol = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    vol += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return vol / 6;
}

/** A closed, outward-facing primitive about `size` mm across, centred on the origin. */
export function primitive(shape: ShapeKind, size: number): IndexedMesh {
  const r = size / 2;
  let out: number[] = [];
  const arc = (cx: number, cz: number, rad: number, from: number, to: number, n: number) =>
    Array.from({ length: n + 1 }, (_, i) => { const a = from + ((to - from) * i) / n; return [cx + rad * Math.cos(a), cz + rad * Math.sin(a)] as [number, number]; });
  if (shape === 'box') {
    const v = [[-r, -r, -r], [r, -r, -r], [r, r, -r], [-r, r, -r], [-r, -r, r], [r, -r, r], [r, r, r], [-r, r, r]];
    const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    for (const t of f) for (const i of t) out.push(...v[i]);
  } else if (shape === 'cylinder') out = revolve([[0, -r], [r, -r], [r, r], [0, r]], 48);
  else if (shape === 'prism') out = revolve([[0, -r], [r, -r], [r, r], [0, r]], 3, Math.PI / 2);
  else if (shape === 'disc') out = revolve([[0, -r * 0.15], [r, -r * 0.15], [r, r * 0.15], [0, r * 0.15]], 64);
  else if (shape === 'cone') out = revolve([[0, -r], [r, -r], [0, r]], 48);
  else if (shape === 'pyramid') out = revolve([[0, -r], [r * Math.SQRT2, -r], [0, r]], 4, Math.PI / 4);
  else if (shape === 'sphere') out = revolve(arc(0, 0, r, -Math.PI / 2, Math.PI / 2, 24), 48);
  else if (shape === 'hemisphere') out = revolve([[0, 0], ...arc(0, 0, r, 0, Math.PI / 2, 12)], 48);
  else if (shape === 'capsule') out = revolve([...arc(0, -r * 0.5, r * 0.5, -Math.PI / 2, 0, 8), ...arc(0, r * 0.5, r * 0.5, 0, Math.PI / 2, 8)], 48);
  else if (shape === 'tube') out = revolve([[r * 0.6, -r], [r, -r], [r, r], [r * 0.6, r], [r * 0.6, -r]], 48);
  else if (shape === 'torus') out = revolve(arc(r * 0.68, 0, r * 0.32, 0, Math.PI * 2, 24), 48);
  const m = weld(new Float32Array(out));
  if (signedVolume(m) < 0) for (let t = 0; t < m.indices.length; t += 3) { const k = m.indices[t + 1]; m.indices[t + 1] = m.indices[t + 2]; m.indices[t + 2] = k; }
  return m;
}

export const PART_LABELS: Record<PartType, string> = {
  part: 'Part',
  negative: 'Negative part', modifier: 'Modifier', support_enforcer: 'Support enforcer', support_blocker: 'Support blocker',
};

export function addPart(objectId: string, type: PartType, shape: ShapeKind) {
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

/** Bambu's "Height range modifier": a Z band of the object with its own settings (starts as the middle third). */
export function addHeightRange(id: string) {
  const s = useStore.getState();
  const o = s.objects.find((x) => x.id === id);
  if (!o) return;
  const h = objectHeight(o);
  const r = { id: newId('range'), z0: +(h / 3).toFixed(2), z1: +((2 * h) / 3).toFixed(2), overrides: {} };
  s.updateObjects((x) => ({ ...x, heightRanges: [...(x.heightRanges ?? []), r] }), [id]);
  s.set({ selected: [id], selectedPart: null, selectedRange: r.id, processMode: 'objects' });
  s.markDirty();
}

export function updateHeightRange(id: string, rangeId: string, patch: Partial<{ z0: number; z1: number; overrides: Config }> | null) {
  const s = useStore.getState();
  s.updateObjects((x) => {
    const rs = (x.heightRanges ?? []).flatMap((r) => (r.id !== rangeId ? [r] : patch ? [{ ...r, ...patch }] : []));
    return { ...x, heightRanges: rs.length ? rs : undefined };
  }, [id]);
  if (!patch && s.selectedRange === rangeId) s.set({ selectedRange: null });
  s.markDirty();
}
