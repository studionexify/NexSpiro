// 3D view of the sliced print for the Select window: every printed line as a thin line, orbit / pan / zoom like
// the build plate, a cutaway that hides everything above a height, and picking of single lines on the CPU
// (nearest line to the mouse ray, front-most first).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MOVE_STRIDE } from '../../../engine/gcode';
import { FEATURE_ORDER, type FeatureType, type SliceOutput } from '../../../engine/types';
import { FEATURE_COLORS } from '../../../viewport/toolpaths';

export interface Segs {
  /** Per segment: start xyz, end xyz. */
  pos: Float32Array;
  /** Per segment: move index, layer index. */
  move: Uint32Array;
  layer: Uint32Array;
  feature: Uint8Array;
  tool: Uint8Array;
  count: number;
}

const TRAVEL = FEATURE_ORDER.indexOf('travel');
const SKIP = new Set(['travel', 'skirt', 'brim', 'prime_tower'].map((f) => FEATURE_ORDER.indexOf(f as FeatureType)));

/** Printed segments of a slice (travels, skirt, brim and the prime tower left out). */
export function segmentsOf(r: SliceOutput): Segs {
  const n = r.moves.length / MOVE_STRIDE;
  const layerOf = new Uint32Array(n);
  r.layers.forEach((L, li) => { for (let k = L.moveStart; k < L.moveEnd; k++) layerOf[k] = li; });
  let count = 0;
  for (let k = 1; k < n; k++) if (!SKIP.has(r.moveFeatures[k])) count++;
  const pos = new Float32Array(count * 6), move = new Uint32Array(count), layer = new Uint32Array(count), feature = new Uint8Array(count), tool = new Uint8Array(count);
  let s = 0;
  for (let k = 1; k < n; k++) {
    const f = r.moveFeatures[k];
    if (SKIP.has(f)) continue;
    const a = (k - 1) * MOVE_STRIDE, b = k * MOVE_STRIDE;
    pos[s * 6] = r.moves[a]; pos[s * 6 + 1] = r.moves[a + 1]; pos[s * 6 + 2] = r.moves[b + 2];
    pos[s * 6 + 3] = r.moves[b]; pos[s * 6 + 4] = r.moves[b + 1]; pos[s * 6 + 5] = r.moves[b + 2];
    move[s] = k; layer[s] = layerOf[k]; feature[s] = f; tool[s] = r.moves[b + 7];
    s++;
  }
  return { pos, move, layer, feature, tool, count };
}

/** The whole printed line a segment belongs to: neighbouring moves of the same feature with no travel between. */
export function runOf(r: SliceOutput, move: number): { from: number; to: number } {
  const f = r.moveFeatures[move];
  const L = r.layers.find((l) => move >= l.moveStart && move < l.moveEnd);
  const lo = L?.moveStart ?? 0, hi = (L?.moveEnd ?? r.moveFeatures.length) - 1;
  let from = move, to = move;
  while (from - 1 >= lo && r.moveFeatures[from - 1] === f) from--;
  while (to + 1 <= hi && r.moveFeatures[to + 1] === f) to++;
  return { from, to };
}

export const featureName = (f: number) => FEATURE_ORDER[f] as FeatureType;
export const isTravel = (f: number) => f === TRAVEL;

export class SelectView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  readonly controls: OrbitControls;
  private lines: THREE.LineSegments | null = null;
  private colors: Float32Array | null = null;
  private cut = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e4);
  private brush = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff3d7f, transparent: true, opacity: 0.25, depthWrite: false }));
  segs: Segs | null = null;
  private raf = 0;
  private ro: ResizeObserver;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.localClippingEnabled = true;
    host.appendChild(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.zoomToCursor = true;
    this.brush.visible = false;
    this.scene.add(this.brush);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }

  setBackground(css: string) { this.scene.background = new THREE.Color(css); }

  private resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Left button picks (true) or orbits (false); the right button orbits and the middle one pans while picking. */
  setPickMode(pick: boolean) {
    this.controls.mouseButtons = pick
      ? { LEFT: -1 as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }

  setData(segs: Segs, keepCamera: boolean) {
    this.segs = segs;
    if (this.lines) { this.scene.remove(this.lines); this.lines.geometry.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(segs.pos, 3));
    this.colors = new Float32Array(segs.count * 6);
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, clippingPlanes: [this.cut] });
    this.lines = new THREE.LineSegments(g, m);
    this.scene.add(this.lines);
    g.computeBoundingBox();
    if (!keepCamera && g.boundingBox) this.frame(g.boundingBox);
  }

  frame(b: THREE.Box3 = this.lines?.geometry.boundingBox ?? new THREE.Box3()) {
    const c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z, 5);
    this.controls.target.copy(c);
    this.camera.position.set(c.x, c.y - r * 2.2, c.z + r * 0.35);
    this.camera.near = r / 200; this.camera.far = r * 50;
    this.camera.updateProjectionMatrix();
  }

  /** Views from a side: front / right / back / left / top. */
  look(side: 'front' | 'right' | 'back' | 'left' | 'top') {
    const t = this.controls.target, d = this.camera.position.distanceTo(t);
    const v = { front: [0, -1, 0.15], right: [1, 0, 0.15], back: [0, 1, 0.15], left: [-1, 0, 0.15], top: [0, -0.001, 1] }[side];
    this.camera.position.set(t.x + v[0] * d, t.y + v[1] * d, t.z + v[2] * d);
  }

  /** Writes per-segment colours (rgb per segment, both ends the same). */
  paint(fill: (seg: number, out: Float32Array, at: number) => void) {
    if (!this.segs || !this.colors || !this.lines) return;
    const c = this.colors;
    for (let s = 0; s < this.segs.count; s++) { fill(s, c, s * 6); c[s * 6 + 3] = c[s * 6]; c[s * 6 + 4] = c[s * 6 + 1]; c[s * 6 + 5] = c[s * 6 + 2]; }
    (this.lines.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Hide every line above z. */
  setCut(z: number) { this.cut.constant = z + 1e-3; }

  showBrush(at: THREE.Vector3 | null, r = 1) {
    this.brush.visible = !!at;
    if (at) { this.brush.position.copy(at); this.brush.scale.setScalar(r); }
  }

  /** The front-most line under the mouse: segment index and the point on it, or null. */
  pick(clientX: number, clientY: number, cutZ: number): { seg: number; point: THREE.Vector3 } | null {
    const segs = this.segs;
    if (!segs) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const pxWorld = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / rect.height;
    const P = segs.pos;
    let best = -1, bestT = Infinity, bx = 0, by = 0, bz = 0;
    for (let s = 0; s < segs.count; s++) {
      const i = s * 6;
      const az = P[i + 2];
      if (az > cutZ + 1e-3) continue;
      const ax = P[i], ay = P[i + 1], ex = P[i + 3] - ax, ey = P[i + 4] - ay, ez = P[i + 5] - az;
      // closest points between the ray and the segment
      const wx = o.x - ax, wy = o.y - ay, wz = o.z - az;
      const b = d.x * ex + d.y * ey + d.z * ez, c = ex * ex + ey * ey + ez * ez;
      const dd = d.x * wx + d.y * wy + d.z * wz, e = ex * wx + ey * wy + ez * wz;
      const den = c - b * b;
      let u = den > 1e-12 ? (e - b * dd) / den : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const qx = ax + ex * u, qy = ay + ey * u, qz = az + ez * u;
      const t = (qx - o.x) * d.x + (qy - o.y) * d.y + (qz - o.z) * d.z;
      if (t <= 0 || t > bestT + 0.3) continue;
      const rx = o.x + d.x * t - qx, ry = o.y + d.y * t - qy, rz = o.z + d.z * t - qz;
      const dist2 = rx * rx + ry * ry + rz * rz;
      const tol = Math.max(0.2, 5 * pxWorld * t);
      if (dist2 > tol * tol) continue;
      // front-most wins; lines at nearly the same depth go to the one nearest the ray
      if (t < bestT - 0.3 || dist2 < 0.01) { best = s; bestT = t; bx = qx; by = qy; bz = qz; }
    }
    return best < 0 ? null : { seg: best, point: new THREE.Vector3(bx, by, bz) };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    if (this.lines) this.lines.geometry.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

const tmp = new THREE.Color();
/** Feature colour as rgb 0..1. */
export const FEATURE_RGB: [number, number, number][] = FEATURE_ORDER.map((f) => { tmp.set(FEATURE_COLORS[f]); return [tmp.r, tmp.g, tmp.b]; });
export function hexRgb(hex: string): [number, number, number] { tmp.set(hex); return [tmp.r, tmp.g, tmp.b]; }
