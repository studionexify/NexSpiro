// Three.js viewport: build plate from the machine profile, object meshes and toolpath preview.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MachineProfile } from "../core/profiles.ts";
import { contourAt, type SceneObject } from "../core/primitives.ts";
import type { Layer } from "../core/types.ts";

export type ColorMode = "feature" | "speed" | "flow" | "updown" | "problems";
export type ViewMode = "3d" | "front" | "side";

export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  private orthoControls: OrbitControls;
  private mode: ViewMode = "3d";
  private plate = new THREE.Group();
  private objects = new THREE.Group();
  private paths = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  onPick: (id: string | null) => void = () => {};

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: false });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.setClearColor(0xeef0f3);
    host.prepend(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("start", () => { this.userMoved = true; });
    this.ortho.up.set(0, 0, 1);
    this.orthoControls = new OrbitControls(this.ortho, this.renderer.domElement);
    this.orthoControls.enableRotate = false; this.orthoControls.enabled = false; this.orthoControls.screenSpacePanning = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(200, -300, 500); this.scene.add(sun);
    this.scene.add(this.plate, this.objects, this.paths);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.domElement.addEventListener("pointerdown", (e) => this.pick(e));
    const loop = () => { const ortho = this.mode !== "3d"; (ortho ? this.orthoControls : this.controls).update(); this.renderer.render(this.scene, ortho ? this.ortho : this.camera); requestAnimationFrame(loop); };
    loop();
  }

  private bed: MachineProfile["bed"] | null = null;
  private userMoved = false;

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    if (!this.userMoved) this.frame();
    if (this.mode !== "3d") this.setView(this.mode);
  }

  /** Flat front or side view (no perspective) shows the wall profile; 3D turns freely. */
  setView(mode: ViewMode): void {
    this.mode = mode;
    this.controls.enabled = mode === "3d"; this.orthoControls.enabled = mode !== "3d";
    if (mode === "3d" || !this.bed) return;
    const box = new THREE.Box3().setFromObject(this.paths.children.length ? this.paths : this.objects);
    if (box.isEmpty()) box.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(this.bed.x, this.bed.y, 50));
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const aspect = this.camera.aspect, wide = mode === "front" ? size.x : size.y;
    const half = Math.max(size.z * 0.6, (wide * 0.6) / aspect, 10);
    Object.assign(this.ortho, { left: -half * aspect, right: half * aspect, top: half, bottom: -half, zoom: 1 });
    this.ortho.position.set(mode === "side" ? c.x + 1000 : c.x, mode === "front" ? c.y - 1000 : c.y, c.z);
    this.orthoControls.target.copy(c);
    this.ortho.lookAt(c); this.ortho.updateProjectionMatrix();
  }

  /** Point the camera at the whole plate; on tall, narrow screens step back so the plate still fits. */
  private frame(): void {
    if (!this.bed) return;
    const { x: W, y: D } = this.bed, r = Math.max(W, D) / Math.min(1, Math.max(0.35, this.camera.aspect));
    this.camera.position.set(W / 2 + r * 0.05, -r * 1.25, r * 1.0);
    this.controls.target.set(W / 2, D / 2, 0);
    this.camera.far = r * 20; this.camera.updateProjectionMatrix();
  }

  private downAt = { x: 0, y: 0 };
  private pick(e: PointerEvent): void {
    this.downAt = { x: e.clientX, y: e.clientY };
    const up = (u: PointerEvent) => {
      this.renderer.domElement.removeEventListener("pointerup", up);
      if (Math.hypot(u.clientX - this.downAt.x, u.clientY - this.downAt.y) > 4) return; // was an orbit drag
      const r = this.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((u.clientX - r.left) / r.width) * 2 - 1, -((u.clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects([...this.meshes.values()])[0];
      this.onPick(hit ? (hit.object.userData.id as string) : null);
    };
    this.renderer.domElement.addEventListener("pointerup", up);
  }

  /** Rebuilds the plate for a machine and frames the camera on it. */
  setMachine(m: MachineProfile): void {
    this.plate.clear();
    const { x: W, y: D } = m.bed;
    const shape = roundedRect(-8, -8, W + 16, D + 16, 10);
    const base = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.8 }));
    base.position.z = -4.01; this.plate.add(base);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x3a414c, roughness: 0.95 }));
    top.position.set(W / 2, D / 2, 0); this.plate.add(top);
    const minor: number[] = [], major: number[] = [];
    for (let x = 0; x <= W + 1e-6; x += 10) (x % 50 === 0 ? major : minor).push(x, 0, 0.02, x, D, 0.02);
    for (let y = 0; y <= D + 1e-6; y += 10) (y % 50 === 0 ? major : minor).push(0, y, 0.02, W, y, 0.02);
    this.plate.add(lines(minor, 0x4a525e), lines(major, 0x667080));
    this.plate.add(lines([0, 0, 0.05, W, 0, 0.05, W, 0, 0.05, W, D, 0.05, W, D, 0.05, 0, D, 0.05, 0, D, 0.05, 0, 0, 0.05], 0x5fd3b0));
    // origin axes
    this.plate.add(lines([0, 0, 0.1, 20, 0, 0.1], 0xe5484d), lines([0, 0, 0.1, 0, 20, 0.1], 0x30a46c), lines([0, 0, 0.1, 0, 0, 20], 0x3e63dd));
    const label = textSprite(`${m.name}  ·  ${W}×${D}`, W);
    label.position.set(W / 2, -2.5, 0.03); this.plate.add(label);
    this.bed = m.bed; this.userMoved = false;
    this.frame();
  }

  setObjects(objs: SceneObject[], selected: string | null): void {
    this.objects.clear(); this.meshes.clear();
    for (const o of objs) {
      const mesh = new THREE.Mesh(objectGeometry(o), new THREE.MeshStandardMaterial({
        color: o.id === selected ? 0x35c497 : 0xd9dde3, roughness: 0.55, metalness: 0.05,
        emissive: o.id === selected ? 0x0b3d2c : 0x000000,
      }));
      mesh.position.set(o.x, o.y, 0); mesh.rotation.z = (o.rotation * Math.PI) / 180;
      mesh.userData.id = o.id;
      this.objects.add(mesh); this.meshes.set(o.id, mesh);
    }
  }

  setToolpaths(layers: Layer[] | null, mode: ColorMode, maxLayer = Infinity): void {
    this.paths.clear();
    this.objects.visible = !layers;
    if (!layers) return;
    const pos: number[] = [], col: number[] = [];
    let fLo = Infinity, fHi = -Infinity;
    let zSpan = 1e-6;
    for (const l of layers) for (const p of l.paths) for (const q of p.points) { fLo = Math.min(fLo, q.f); fHi = Math.max(fHi, q.f); zSpan = Math.max(zSpan, Math.abs(q.zOff ?? 0)); }
    const c = new THREE.Color();
    for (const l of layers) {
      if (l.index > maxLayer) break;
      for (const p of l.paths) for (let i = 1; i < p.points.length; i++) {
        const a = p.points[i - 1], b = p.points[i];
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        if (b.travel) c.set(0xd1d5db);
        else if (mode === "problems") c.set(b.flag === "collision" ? 0xe5484d : b.flag === "loop" ? 0xf59e0b : 0x9aa3ae);
        else if (b.flag === "collision") c.set(0xe5484d);
        else if (mode === "feature") c.set(p.feature === "outer_wall" ? (p.modifiedBy ? 0x8b5cf6 : 0xf97316) : 0xfacc15);
        else if (mode === "speed") ramp(c, (b.f - fLo) / Math.max(1e-9, fHi - fLo));
        else if (mode === "updown") ramp(c, 0.5 + (b.zOff ?? 0) / (2 * zSpan));
        else ramp(c, (b.flow - 0.5) / 1.1);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    this.paths.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true })));
  }
}

function ramp(c: THREE.Color, t: number): void { c.setHSL((1 - Math.min(1, Math.max(0, t))) * 0.66, 0.8, 0.5); }

function lines(v: number[], color: number): THREE.LineSegments {
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function textSprite(text: string, width: number): THREE.Mesh {
  const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 48;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#9aa6b6"; g.font = "600 28px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text.toUpperCase(), 512, 24);
  const tex = new THREE.CanvasTexture(cv);
  const w = Math.min(width * 0.8, 200);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, (w * 48) / 1024), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
}

function objectGeometry(o: SceneObject): THREE.BufferGeometry {
  if (o.kind === "cube") { const g = new THREE.BoxGeometry(o.size.x, o.size.y, o.size.z); g.translate(0, 0, o.size.z / 2); return g; }
  // Revolve the primitive's own contour so the mesh matches exactly what gets sliced.
  const local = { ...o, x: 0, y: 0, rotation: 0 };
  const prof: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  const steps = o.kind === "vase" ? 48 : 1;
  for (let i = 0; i <= steps; i++) { const z = (o.size.z * i) / steps; prof.push(new THREE.Vector2(contourAt(local, z, 4)[0][0], z)); }
  prof.push(new THREE.Vector2(0, o.size.z));
  const g = new THREE.LatheGeometry(prof, 96);
  g.rotateX(Math.PI / 2);
  return g;
}
