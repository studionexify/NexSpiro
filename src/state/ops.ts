// Scene operations: arrange, auto-orient, lay-on-face, centre.
import * as THREE from 'three';
import { printerById } from '../profiles/printers';
import { dropToBed, objectMatrix, useStore, worldBounds, type SceneObject } from './store';

const DEG = 180 / Math.PI;

/** Shelf bin-packing of bounding boxes centred on the bed (spacing in mm). */
export function arrange(spacing = 6) {
  const s = useStore.getState();
  if (!s.objects.length) return;
  const p = printerById(s.printerId);
  const items = s.objects.map((o) => ({ o, b: worldBounds(o) }))
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
  let y = (p.bed.y + totalD) / 2;
  const placed = new Map<string, [number, number]>();
  for (const r of rows) {
    let x = (p.bed.x - r.w) / 2;
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
  }, s.objects.map((o) => o.id));
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

export function centreOnBed(o: SceneObject, printerId: string): SceneObject {
  const p = printerById(printerId);
  const b = worldBounds(o);
  return dropToBed({ ...o, position: [o.position[0] + p.bed.x / 2 - (b.min[0] + b.max[0]) / 2, o.position[1] + p.bed.y / 2 - (b.min[1] + b.max[1]) / 2, o.position[2]] });
}
