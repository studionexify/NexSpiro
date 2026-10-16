// Patternex in the 3D view: pattern outlines on the model while preparing, placement by click/drag,
// and region / transition / bleed / swap overlays in the preview.
import * as THREE from 'three';
import type { SceneObject } from '../../../state/store';
import { objectMatrix } from '../../../state/store';
import { frameOf, fromPattern, type V3 } from '../projection';
import { newPlacement } from '../model';
import type { PatternexReport } from '../engine';
import { patternInkKey, toWorldPlacements, type ObjPlacement } from './state';
import { inkActions } from '../library/apply';
import { printerById } from '../../../profiles/printers';
import { px, changed } from './PatternexPanel';
import { useStore } from '../../../state/store';

const disposeGroup = (g: THREE.Group) => {
  for (const c of [...g.children]) {
    g.remove(c);
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose?.();
  }
};

/** Max ring points drawn per placement (keeps dragging interactive for big SVGs). */
const DRAW_CAP = 20_000;

/** Outlines of every visible placement, projected onto its object (world coordinates). */
export function syncPlacementOverlay(group: THREE.Group, objects: SceneObject[]): void {
  disposeGroup(group);
  const objs = objects.map((o) => ({ id: o.id, matrix: objectMatrix(o).elements }));
  const world = toWorldPlacements(px.placements, objs);
  for (const wp of world) {
    const pat = px.patterns.find((p) => p.id === wp.pattern_id);
    if (!pat) continue;
    const f = frameOf(wp, pat);
    const lift = 0.08;
    const total = pat.shapes.reduce((n, s) => n + s.polygon_rings.reduce((a, r) => a + r.length, 0), 0);
    const step = Math.max(1, Math.ceil(total / DRAW_CAP));
    for (const s of pat.shapes) {
      const pts: number[] = [];
      for (const r of s.polygon_rings) {
        const n = r.length;
        for (let k = 0; k < n; k += step) {
          const a = r[k], b = r[Math.min(n, k + step) % n];
          for (const q of [a, b]) {
            const p = fromPattern(f, q[0], q[1]);
            // lift off the surface so the lines are not hidden in it
            const nx = f.kind === 'planar' ? f.axis : radial(f.origin, f.axis, p);
            pts.push(p[0] + nx[0] * lift, p[1] + nx[1] * lift, p[2] + nx[2] * lift);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const sel = wp.id === px.selected;
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: s.fill_color === '#ffffff' && !sel ? '#dddddd' : s.fill_color, transparent: true, opacity: sel ? 1 : 0.75 }));
      line.renderOrder = 5;
      group.add(line);
    }
    // anchor marker
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), new THREE.MeshBasicMaterial({ color: wp.id === px.selected ? '#FF5C8D' : '#85A3B2' }));
    dot.position.set(...wp.position_xyz);
    group.add(dot);
  }
}

function radial(o: V3, a: V3, p: V3): V3 {
  const d: V3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const h = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
  const r: V3 = [d[0] - a[0] * h, d[1] - a[1] * h, d[2] - a[2] * h];
  const l = Math.hypot(...r) || 1;
  return [r[0] / l, r[1] / l, r[2] / l];
}

let dragId: string | null = null;

/**
 * Place tool: pointer down on an object. Places the armed pattern there, or starts moving the selected
 * placement. Returns true when the event was used.
 */
export function placeDown(objectId: string, pointWorld: THREE.Vector3, normalWorld: THREE.Vector3, faceIndex: number): boolean {
  const s = useStore.getState();
  const o = s.objects.find((x) => x.id === objectId);
  if (!o) return false;
  const inv = objectMatrix(o).invert();
  const local = pointWorld.clone().applyMatrix4(inv);
  const nLocal = normalWorld.clone().transformDirection(inv).normalize();
  if (px.armed) {
    const pat = px.patterns.find((p) => p.id === px.armed);
    if (!pat) return false;
    const id = `pl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const p: ObjPlacement = { ...newPlacement(id, pat, `${objectId}:${faceIndex}`, local.toArray() as V3, nLocal.toArray() as V3), object_id: objectId, anchor_normal: nLocal.toArray() as V3 };
    // keep the pattern a sensible size on small models: fit it inside ~60% of the object
    const size = Math.max(pat.bounds[2] - pat.bounds[0], pat.bounds[3] - pat.bounds[1]);
    const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(o.mesh.vertices, 3));
    const dims = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].sort((a, b) => a - b);
    const objSize = dims[1] || size; // the middle dimension: a face of a box, not its thinnest side
    if (size > objSize * 0.8) { const k = +(objSize * 0.6 / size).toFixed(3); p.scale_xy = [k, k]; }
    px.placements.push(p);
    // patterns arrive uninked unless inks were chosen in the library; the user inks each region
    // inks picked in the library win; otherwise the inks saved for this pattern; otherwise uninked
    px.actions.push(...inkActions(id, pat, px.armedInks ?? px.savedInks[patternInkKey(pat.id)] ?? {}, printerById(s.printerId).machine.has_ams === true));
    px.armedInks = undefined;
    px.selected = id;
    px.armed = null;
    dragId = id;
    changed();
    return true;
  }
  const sel = px.placements.find((p) => p.id === px.selected);
  if (sel && !sel.locked && sel.object_id === objectId) { dragId = sel.id; movePlacement(sel, local, nLocal, faceIndex); return true; }
  // clicking another placement's object selects the nearest placement on it
  const near = px.placements.filter((p) => p.object_id === objectId).sort((a, b) => dist(a.position_xyz, local) - dist(b.position_xyz, local))[0];
  if (near) { px.selected = near.id; changed(false); return true; }
  return false;
}

const dist = (a: V3, b: THREE.Vector3) => Math.hypot(a[0] - b.x, a[1] - b.y, a[2] - b.z);

function movePlacement(p: ObjPlacement, local: THREE.Vector3, nLocal: THREE.Vector3, faceIndex: number) {
  p.position_xyz = local.toArray() as V3;
  p.anchor_face_ref = `${p.object_id}:${faceIndex}`;
  p.anchor_normal = nLocal.toArray() as V3;
  if (p.projection === 'planar') p.projection_axis = p.anchor_normal;
  changed(false);
}

/** Drag: snap the placement to the face under the cursor. */
export function placeMove(objectId: string, pointWorld: THREE.Vector3, normalWorld: THREE.Vector3, faceIndex: number): void {
  if (!dragId) return;
  const p = px.placements.find((x) => x.id === dragId);
  const o = useStore.getState().objects.find((x) => x.id === objectId);
  if (!p || !o || p.object_id !== objectId) return;
  const inv = objectMatrix(o).invert();
  movePlacement(p, pointWorld.clone().applyMatrix4(inv), normalWorld.clone().transformDirection(inv).normalize(), faceIndex);
}

export function placeUp(): boolean {
  if (!dragId) return false;
  dragId = null;
  changed(true);
  return true;
}
export const placeDragging = () => dragId !== null;

/** Preview overlays (plate coordinates; the caller positions the group at the plate origin). */
export function syncPreviewOverlay(group: THREE.Group, rep: PatternexReport | undefined, range: [number, number], layerZ: number[], slotColors: string[]): void {
  disposeGroup(group);
  if (!rep) return;
  const ov = px.overlays;
  const [lo, hi] = range;
  const lines = (pts: number[], color: string, opacity = 1) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }));
    l.renderOrder = 6;
    group.add(l);
  };
  if (ov.outlines) {
    // region outlines on the top visible layer only, so they read as a cross-section
    const pts: Record<string, number[]> = {};
    for (const o of rep.outlines) {
      if (o.layer !== hi) continue;
      const z = (layerZ[o.layer] ?? 0) + 0.02;
      const col = rep.regions.find((r) => r.id === o.regionId)?.color ?? '#ffffff';
      const arr = (pts[col] ??= []);
      for (const r of o.rings) for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; arr.push(a[0], a[1], z, b[0], b[1], z); }
    }
    for (const [col, p] of Object.entries(pts)) lines(p, col);
  }
  if (ov.bleed) {
    const pts: number[] = [];
    for (const b of rep.bleedZones) {
      if (b.layer < lo || b.layer > hi) continue;
      for (let k = 2; k < b.pts.length; k += 2) pts.push(b.pts[k - 2], b.pts[k - 1], b.z + 0.05, b.pts[k], b.pts[k + 1], b.z + 0.05);
    }
    if (pts.length) lines(pts, '#FFB020');
  }
  if (ov.transitions) {
    // a small cross at each change point (start of a bleed zone, or the first move after a change)
    const pts: number[] = [];
    for (const b of rep.bleedZones) {
      if (b.layer < lo || b.layer > hi || b.pts.length < 2) continue;
      const [x, y] = b.pts, z = b.z + 0.05, d = 0.8;
      pts.push(x - d, y, z, x + d, y, z, x, y - d, z, x, y + d, z);
    }
    if (pts.length) lines(pts, '#FF5C8D');
  }
  if (ov.swaps && rep.swaps.length) {
    // a ring around the print at each manual swap height, in the colour being loaded
    const xs = rep.outlines.flatMap((o) => o.rings.flat().map((p) => p[0])), ys = rep.outlines.flatMap((o) => o.rings.flat().map((p) => p[1]));
    if (xs.length) {
      const x0 = Math.min(...xs) - 3, x1 = Math.max(...xs) + 3, y0 = Math.min(...ys) - 3, y1 = Math.max(...ys) + 3;
      for (const sw of rep.swaps) {
        if (sw.layer < lo || sw.layer > hi) continue;
        const z = sw.z;
        lines([x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z], slotColors[sw.to] ?? '#ffffff', 0.9);
      }
    }
  }
}
