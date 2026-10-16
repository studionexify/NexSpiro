// The 3D workspace (Prepare + Preview share one renderer).
import { useEffect, useRef } from 'react';
import { growFaces, triAdjacency, triNormals } from '../engine/facesets';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { printerById, type PrinterProfile } from '../profiles/printers';
import {
  dropToBed, isOutOfBounds, worldBounds, objectMatrix, plateAt, plateOrigin, slotColor, trsMatrix, useStore,
  type ObjectPaint, type Vec3, type SceneObject, type ScenePart, type Tool,
} from '../state/store';
import { layOnFace } from '../state/ops';
import { allTris, assignMotion, SURFACE_COLORS, trisInScreenPolygon } from '../state/motionPaint';
import { ToolpathView } from './toolpaths';
import { placeDown, placeMove, placeUp, placeDragging, syncPlacementOverlay, syncPreviewOverlay } from '../plugins/patternex/ui/overlay';
import type { PatternexReport } from '../plugins/patternex/engine';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { PLUGINS } from '../plugins/registry';

export interface ViewApi { setView: (v: 'iso' | 'top' | 'front' | 'left' | 'right' | 'back') => void; fit: () => void }
export const viewApi: { current: ViewApi | null } = { current: null };

const THEMES = {
  dark: { zenith: '#1E3442', nadir: '#0B1520', plate: '#1B2E3D', minor: '#284355', major: '#3B5F78', border: '#85A3B2', label: '#85A3B2' },
  light: { zenith: '#F7F1EA', nadir: '#DCC9B6', plate: '#E7D9CB', minor: '#CDB8A4', major: '#A88F7A', border: '#5E7684', label: '#4F6877' },
};

const PART_COLORS: Record<string, string> = { negative: '#FF3B30', modifier: '#FFC107', support_enforcer: '#1E88E5', support_blocker: '#E53935' };
const PAINT = { support: ['#1E88E5', '#E53935'], seam: ['#FFFFFF', '#E53935'] };

function backgroundTexture(theme: 'dark' | 'light') {
  const t = THEMES[theme];
  const c = document.createElement('canvas');
  c.width = 16; c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, t.zenith); grad.addColorStop(1, t.nadir);
  g.fillStyle = grad; g.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelSprite(text: string, color: string, active: boolean) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d')!;
  g.font = '600 56px "Segoe UI", system-ui, sans-serif';
  g.fillStyle = active ? '#FF5C8D' : color;
  g.textBaseline = 'middle';
  g.fillText(text, 8, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(64, 12), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
}

function buildPlate(p: PrinterProfile, theme: 'dark' | 'light', index: number, active: boolean, multi: boolean): THREE.Group {
  const t = THEMES[theme];
  const g = new THREE.Group();
  const { x: X, y: Y } = p.bed;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(X, Y, 1.2), new THREE.MeshStandardMaterial({ color: t.plate, roughness: 0.75, metalness: 0.2 }));
  plate.position.set(X / 2, Y / 2, -0.62);
  plate.userData.plateIndex = index;
  g.add(plate);
  const minor: number[] = [], major: number[] = [];
  for (let x = 0; x <= X + 1e-6; x += 10) (x % 50 === 0 ? major : minor).push(x, 0, 0.01, x, Y, 0.01);
  for (let y = 0; y <= Y + 1e-6; y += 10) (y % 50 === 0 ? major : minor).push(0, y, 0.01, X, y, 0.01);
  const lines = (pts: number[], color: string, opacity: number) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  };
  g.add(lines(minor, t.minor, 0.9));
  g.add(lines(major, t.major, 1));
  g.add(lines([0, 0, 0.02, X, 0, 0.02, X, 0, 0.02, X, Y, 0.02, X, Y, 0.02, 0, Y, 0.02, 0, Y, 0.02, 0, 0, 0.02], active && multi ? '#FF5C8D' : t.border, 1));
  const axis = (to: [number, number, number], color: string) => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.03), new THREE.Vector3(...to)]);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
  };
  g.add(axis([20, 0, 0.03], '#E53935'), axis([0, 20, 0.03], '#43A047'), axis([0, 0, 20], '#1E88E5'));
  for (const area of p.excludedAreas ?? []) {
    const shape = new THREE.Shape(area.map(([x, y]) => new THREE.Vector2(x, y)));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#FF3B30', transparent: true, opacity: 0.25, depthWrite: false }));
    m.position.z = 0.02;
    g.add(m);
  }
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(X, Y, p.bed.z)),
    new THREE.LineBasicMaterial({ color: t.border, transparent: true, opacity: active ? 0.18 : 0.07 }),
  );
  box.position.set(X / 2, Y / 2, p.bed.z / 2);
  g.add(box);
  if (multi) {
    const lbl = labelSprite(`Plate ${index + 1}`, t.label, active);
    lbl.position.set(32, -10, 0.05);
    g.add(lbl);
  }
  return g;
}

function overhangMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.55, metalness: 0.05 });
  const uniforms = { uOverhang: { value: 0 }, uCos: { value: Math.cos((30 * Math.PI) / 180) }, uOOB: { value: 0 } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;\nvarying vec3 vWP;\nuniform float uOverhang;\nuniform float uCos;\nuniform float uOOB;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uOverhang > 0.5 && normalize(vWN).z < -uCos && vWP.z > 0.05) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.09, 0.27), 0.6);
        if (uOOB > 0.5) { float s = step(0.5, fract((vWP.x + vWP.y + vWP.z) * 0.25)); diffuseColor.rgb = mix(vec3(1.0, 0.23, 0.19), vec3(0.45, 0.08, 0.08), s); }`);
  };
  return mat;
}

function geometryFor(mesh: SceneObject['mesh']): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  flat.setAttribute('color', new THREE.BufferAttribute(new Float32Array(flat.getAttribute('position').count * 3), 3));
  return flat;
}

/** Per-triangle colours: base filament colour + the paint layer relevant to the current tool. */
function paintColors(geo: THREE.BufferGeometry, o: SceneObject, tool: Tool, slots: string[]) {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const base = new THREE.Color(slots[Math.min(o.filament ?? 0, slots.length - 1)] ?? '#5DBE7A');
  const slotC = slots.map((c) => new THREE.Color(c));
  const tris = arr.length / 9;
  const p: ObjectPaint = o.paint ?? {};
  const motion = isMotionTool(tool);
  const layer = tool === 'paint_support' ? p.support : tool === 'paint_seam' ? p.seam : motion ? p.motion : undefined;
  const layerC = (tool === 'paint_support' ? PAINT.support : motion ? SURFACE_COLORS : PAINT.seam).map((c) => new THREE.Color(c));
  const dim = tool === 'paint_support' || tool === 'paint_seam' || motion ? 0.55 : 1;
  const c = new THREE.Color();
  for (let t = 0; t < tris; t++) {
    const cv = p.color?.[t] ?? 0;
    c.copy(cv ? slotC[Math.min(cv - 1, slotC.length - 1)] ?? base : base).multiplyScalar(dim);
    const lv = layer?.[t] ?? 0;
    if (lv) c.copy(layerC[(lv - 1) % layerC.length]);
    for (let k = 0; k < 3; k++) { arr[t * 9 + k * 3] = c.r; arr[t * 9 + k * 3 + 1] = c.g; arr[t * 9 + k * 3 + 2] = c.b; }
  }
  attr.needsUpdate = true;
}

/** Pattern lines drawn on the model: the Prepare toggle, and always in the Pattern tab. */
const showsPattern = (s: { workspace: string; liveToolpaths: boolean }) => (s.workspace === 'prepare' && s.liveToolpaths) || s.workspace === 'pattern';
export const isMotionTool = (t: Tool) => t === 'paint_motion' || t === 'pick_motion' || t === 'lasso_motion' || t === 'band_motion' || t === 'object_motion';
export const isPaintTool = (t: Tool) => t === 'paint_support' || t === 'paint_seam' || t === 'paint_color' || isMotionTool(t);

const adjCache = new WeakMap<object, { adj: Uint32Array[]; normals: Float32Array }>();

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.15;
    controls.screenSpacePanning = true;
    const normalButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    // while painting: left = enforce, right = block, middle-drag orbits
    const paintButtons = { LEFT: -1 as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: -1 as unknown as THREE.MOUSE };
    controls.mouseButtons = normalButtons;

    scene.add(new THREE.HemisphereLight('#ffffff', '#334455', 1.4));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(-150, -250, 400);
    scene.add(sun);
    const fill = new THREE.DirectionalLight('#FFD9E6', 0.5);
    fill.position.set(300, 300, 200);
    scene.add(fill);

    const plateGroup = new THREE.Group();
    scene.add(plateGroup);
    let printer = printerById(useStore.getState().printerId);
    const objGroup = new THREE.Group();
    scene.add(objGroup);
    const meshes = new Map<string, { mesh: THREE.Mesh; src: SceneObject['mesh']; colorKey: string }>();
    const partMeshes = new Map<string, { mesh: THREE.Mesh; src: ScenePart['mesh'] }>();
    const selBoxes = new THREE.Group();
    scene.add(selBoxes);
    const toolpaths = new ToolpathView();
    scene.add(toolpaths.group);
    // Patternex: placement outlines (prepare) and region/bleed/swap overlays (preview)
    const pxPrep = new THREE.Group();
    scene.add(pxPrep);
    const pxPrev = new THREE.Group();
    scene.add(pxPrev);
    const brush = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: '#FF5C8D', side: THREE.DoubleSide, depthTest: false, transparent: true }));
    brush.renderOrder = 10;
    brush.visible = false;
    scene.add(brush);
    // Lasso / box outline drawn over the canvas.
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'lasso-overlay');
    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    overlay.appendChild(outline);
    el.appendChild(overlay);
    // Height band preview for the band tool.
    const bandMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#FF5C8D', transparent: true, opacity: 0.22, depthWrite: false }));
    bandMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#FF5C8D' })));
    bandMesh.visible = false;
    bandMesh.renderOrder = 9;
    scene.add(bandMesh);

    const proxy = new THREE.Object3D();
    scene.add(proxy);
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.85);
    scene.add(gizmo.getHelper());
    let dragging = false;

    let needsRender = true;
    const invalidate = () => { needsRender = true; };

    // ---------------- cut plane & measure overlays
    const cutPlaneMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#FF5C8D', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    const cutEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: '#FF5C8D' }));
    cutPlaneMesh.add(cutEdge);
    cutPlaneMesh.visible = false;
    scene.add(cutPlaneMesh);
    const measureGroup = new THREE.Group();
    scene.add(measureGroup);
    const syncTools = () => {
      const s = useStore.getState();
      const o = s.objects.find((x) => x.id === s.selected[0]);
      cutPlaneMesh.visible = s.workspace === 'prepare' && s.tool === 'cut' && !!o;
      if (cutPlaneMesh.visible && o) {
        const b = worldBounds(o);
        const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * 1.4 + 10;
        const d = Math.PI / 180;
        cutPlaneMesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, s.cutPlane.height);
        cutPlaneMesh.rotation.set(s.cutPlane.tiltX * d, s.cutPlane.tiltY * d, 0, 'XYZ');
        cutPlaneMesh.scale.set(size, size, 1);
      }
      measureGroup.clear();
      if (s.workspace === 'prepare' && s.tool === 'measure') {
        const pts = s.measurePoints.map((p) => new THREE.Vector3(...p));
        for (const p of pts) {
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), new THREE.MeshBasicMaterial({ color: '#FF5C8D', depthTest: false }));
          dot.position.copy(p); dot.renderOrder = 10;
          measureGroup.add(dot);
        }
        if (pts.length === 2) {
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#FF5C8D', depthTest: false }));
          line.renderOrder = 10;
          measureGroup.add(line);
        }
      }
      invalidate();
    };
    controls.addEventListener('change', invalidate);

    const setView = (v: 'iso' | 'top' | 'front' | 'left' | 'right' | 'back') => {
      const s = useStore.getState();
      const { x: X, y: Y, z: Z } = printer.bed;
      const [ox, oy] = plateOrigin(s.activePlate, s.printerId);
      const c = new THREE.Vector3(ox + X / 2, oy + Y / 2, 0);
      const r = Math.max(X, Y) * 1.05;
      const dirs: Record<string, [number, number, number]> = {
        iso: [0, -0.85, 0.7], top: [0, -0.001, 1], front: [0, -1, 0.12], back: [0, 1, 0.12], left: [-1, 0, 0.12], right: [1, 0, 0.12],
      };
      const d = new THREE.Vector3(...dirs[v]).normalize().multiplyScalar(r);
      camera.position.copy(c).add(d);
      controls.target.copy(c).setZ(v === 'iso' ? Z * 0.06 : 0);
      controls.update();
      invalidate();
    };
    viewApi.current = { setView, fit: () => setView('iso') };
    (window as any).__nx = { camera, controls, invalidate, THREE };

    const rebuildPlates = () => {
      plateGroup.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
      plateGroup.clear();
      const s = useStore.getState();
      printer = printerById(s.printerId);
      s.plates.forEach((_, i) => {
        const g = buildPlate(printer, s.theme, i, i === s.activePlate, s.plates.length > 1);
        const [ox, oy] = plateOrigin(i, s.printerId);
        g.position.set(ox, oy, 0);
        plateGroup.add(g);
      });
      scene.background = backgroundTexture(s.theme);
      invalidate();
    };

    const disposeMesh = (m: THREE.Mesh) => { m.parent?.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); };

    const syncObjects = () => {
      const s = useStore.getState();
      const slots = s.filaments.map((f) => f.color);
      const keep = new Set(s.objects.map((o) => o.id));
      for (const [id, m] of meshes) if (!keep.has(id)) { disposeMesh(m.mesh); meshes.delete(id); }
      const keepParts = new Set(s.objects.flatMap((o) => (o.parts ?? []).map((p) => p.id)));
      for (const [id, m] of partMeshes) if (!keepParts.has(id)) { disposeMesh(m.mesh); partMeshes.delete(id); }
      for (const o of s.objects) {
        let entry = meshes.get(o.id);
        if (!entry || entry.src !== o.mesh) {
          if (entry) disposeMesh(entry.mesh);
          const mesh = new THREE.Mesh(geometryFor(o.mesh), overhangMaterial());
          mesh.userData.id = o.id;
          entry = { mesh, src: o.mesh, colorKey: '' };
          meshes.set(o.id, entry);
          objGroup.add(mesh);
        }
        const colorKey = `${s.tool}|${slots.join()}|${o.filament ?? 0}`;
        if (colorKey !== entry.colorKey || entry.mesh.userData.paint !== o.paint) {
          paintColors(entry.mesh.geometry, o, s.tool, slots);
          entry.colorKey = colorKey;
          entry.mesh.userData.paint = o.paint;
        }
        const mat = entry.mesh.material as THREE.MeshStandardMaterial;
        const sel = s.workspace === 'prepare' && s.selected.includes(o.id) && !s.selectedPart && !isPaintTool(s.tool);
        mat.emissive.set(sel ? slotColor(s, o.filament ?? 0) : '#000000');
        mat.emissiveIntensity = sel ? 0.28 : 0;
        // see-through while the live toolpath is shown on it, and for objects left out of the print
        const ghost = showsPattern(s) ? 0.45 : o.printable === false ? 0.45 : 1;
        if (mat.opacity !== ghost) { mat.transparent = ghost < 1; mat.opacity = ghost; mat.depthWrite = ghost === 1; mat.needsUpdate = true; }
        const u = mat.userData.uniforms;
        u.uOverhang.value = s.showOverhangs || s.tool === 'paint_support' ? 1 : 0;
        u.uCos.value = Math.cos(((Number(s.overrides.support_threshold_angle ?? 30)) * Math.PI) / 180);
        u.uOOB.value = isOutOfBounds(o, s.printerId, s.plates.length) ? 1 : 0;
        const om = objectMatrix(o);
        if (!dragging || !s.selected.includes(o.id)) {
          entry.mesh.matrixAutoUpdate = false;
          entry.mesh.matrix.copy(om);
          entry.mesh.matrixWorldNeedsUpdate = true;
        }
        for (const p of o.parts ?? []) {
          let pe = partMeshes.get(p.id);
          if (!pe || pe.src !== p.mesh) {
            if (pe) disposeMesh(pe.mesh);
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(p.mesh.vertices, 3));
            g.setIndex(new THREE.BufferAttribute(p.mesh.indices, 1));
            const flat = g.toNonIndexed(); flat.computeVertexNormals(); g.dispose();
            const m = new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ color: PART_COLORS[p.type], transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.6 }));
            m.renderOrder = 2;
            m.userData = { id: o.id, partId: p.id };
            pe = { mesh: m, src: p.mesh };
            partMeshes.set(p.id, pe);
            objGroup.add(m);
          }
          const pm = pe.mesh.material as THREE.MeshStandardMaterial;
          pm.color.set(PART_COLORS[p.type]);
          pm.opacity = s.selectedPart === p.id ? 0.7 : 0.4;
          pe.mesh.visible = !isPaintTool(s.tool);
          if (!dragging || !s.selected.includes(o.id)) {
            pe.mesh.matrixAutoUpdate = false;
            pe.mesh.matrix.copy(om.clone().multiply(trsMatrix(p)));
            pe.mesh.matrixWorldNeedsUpdate = true;
          }
        }
      }
      selBoxes.clear();
      if (!isPaintTool(s.tool)) for (const id of s.selected) {
        const e = meshes.get(id);
        if (!e) continue;
        e.mesh.updateMatrixWorld();
        selBoxes.add(new THREE.BoxHelper(e.mesh, s.theme === 'dark' ? '#E9D8C8' : '#142030'));
      }
      controls.mouseButtons = isPaintTool(s.tool) || s.tool === 'place_pattern' ? paintButtons : normalButtons;
      syncPatternex();
      if (!isPaintTool(s.tool)) brush.visible = false;
      syncGizmo();
      invalidate();
    };

    const gizmoTarget = () => {
      const s = useStore.getState();
      const o = s.objects.find((x) => x.id === s.selected[0]);
      if (!o) return null;
      const part = s.selectedPart ? o.parts?.find((p) => p.id === s.selectedPart) : undefined;
      return { o, part };
    };

    const syncGizmo = () => {
      const s = useStore.getState();
      const t = gizmoTarget();
      const mode = s.tool === 'move' ? 'translate' : s.tool === 'rotate' ? 'rotate' : s.tool === 'scale' ? 'scale' : null;
      if (!t || !mode || s.workspace !== 'prepare') { gizmo.detach(); return; }
      if (!dragging) {
        const m = t.part ? objectMatrix(t.o).multiply(trsMatrix(t.part)) : objectMatrix(t.o);
        m.decompose(proxy.position, proxy.quaternion, proxy.scale);
        proxy.updateMatrixWorld();
      }
      gizmo.setMode(mode);
      gizmo.setSpace(mode === 'scale' ? 'local' : 'world');
      if (gizmo.object !== proxy) gizmo.attach(proxy);
    };

    gizmo.addEventListener('dragging-changed', (e: any) => {
      controls.enabled = !e.value;
      dragging = e.value;
      if (e.value) return;
      const s = useStore.getState();
      const t = gizmoTarget();
      if (!t) return;
      const D = 180 / Math.PI;
      proxy.updateMatrixWorld();
      if (t.part) {
        const local = objectMatrix(t.o).invert().multiply(proxy.matrixWorld);
        const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        local.decompose(pos, q, sc);
        const eu = new THREE.Euler().setFromQuaternion(q, 'XYZ');
        const pid = t.part.id;
        s.updateObjects((o) => ({ ...o, parts: (o.parts ?? []).map((p) => (p.id === pid ? { ...p, position: [pos.x, pos.y, pos.z], rotation: [eu.x * D, eu.y * D, eu.z * D], scale: [sc.x, sc.y, sc.z] } : p)) }), [t.o.id]);
        return;
      }
      const eu = new THREE.Euler().setFromQuaternion(proxy.quaternion, 'XYZ');
      s.updateObjects((o) => {
        const n: SceneObject = {
          ...o,
          position: [proxy.position.x, proxy.position.y, proxy.position.z],
          rotation: [eu.x * D, eu.y * D, eu.z * D],
          scale: [proxy.scale.x, proxy.scale.y, proxy.scale.z],
        };
        return s.tool === 'move' && Math.abs(n.position[2] - o.position[2]) > 1e-6 ? n : dropToBed(n);
      }, [t.o.id]);
      // moving onto another plate makes it the active plate
      const pi = plateAt(proxy.position.x, proxy.position.y, s.printerId, s.plates.length);
      if (pi !== s.activePlate) s.set({ activePlate: pi });
    });
    gizmo.addEventListener('objectChange', () => {
      const t = gizmoTarget();
      if (!t) return;
      proxy.updateMatrixWorld();
      const e = t.part ? partMeshes.get(t.part.id) : meshes.get(t.o.id);
      if (!e) return;
      e.mesh.matrix.copy(proxy.matrixWorld);
      e.mesh.matrixWorldNeedsUpdate = true;
      if (!t.part) for (const p of t.o.parts ?? []) {
        const pe = partMeshes.get(p.id);
        if (pe) { pe.mesh.matrix.copy(proxy.matrixWorld.clone().multiply(trsMatrix(p))); pe.mesh.matrixWorldNeedsUpdate = true; }
      }
      invalidate();
    });
    gizmo.addEventListener('change', invalidate);

    // ---------------- picking & painting
    const ray = new THREE.Raycaster();
    const ndc = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    };
    const objectMeshes = () => [...meshes.values()].map((m) => m.mesh);
    let downAt: [number, number] | null = null;
    let painting: { id: string; value: number; layer: keyof ObjectPaint } | null = null;
    let drawing: { pts: [number, number][]; value: number; box: boolean } | null = null;
    let band: { id: string; z0: number; z1: number; value: number; anchor: THREE.Vector3 } | null = null;
    const showOutline = () => {
      const r = renderer.domElement.getBoundingClientRect();
      if (!drawing) { outline.setAttribute('points', ''); return; }
      let pts = drawing.pts;
      if (drawing.box && pts.length > 1) { const [a, b] = [pts[0], pts[pts.length - 1]]; pts = [a, [b[0], a[1]], b, [a[0], b[1]]]; }
      outline.setAttribute('points', pts.map(([x, y]) => `${x - r.left},${y - r.top}`).join(' '));
      outline.setAttribute('class', drawing.value ? '' : 'erase');
    };
    const showBand = () => {
      const s = useStore.getState();
      const o = band && s.objects.find((x) => x.id === band!.id);
      bandMesh.visible = !!o;
      if (o && band) {
        const b = worldBounds(o);
        const lo = Math.min(band.z0, band.z1), hi = Math.max(band.z0, band.z1, lo + 0.2);
        bandMesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (lo + hi) / 2);
        bandMesh.scale.set(b.max[0] - b.min[0] + 4, b.max[1] - b.min[1] + 4, hi - lo);
        (bandMesh.material as THREE.MeshBasicMaterial).color.set(band.value ? '#FF5C8D' : '#888888');
      }
      invalidate();
    };
    /** Height under the cursor on a vertical plane through the band's start point, facing the camera. */
    const bandHeight = (ev: PointerEvent) => {
      ray.setFromCamera(ndc(ev), camera);
      const n = new THREE.Vector3(camera.position.x - band!.anchor.x, camera.position.y - band!.anchor.y, 0);
      if (n.lengthSq() < 1e-9) n.set(0, -1, 0);
      const hitP = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), band!.anchor), new THREE.Vector3());
      return hitP ? Math.max(0, hitP.z) : band!.z1;
    };
    // per-triangle bounding spheres (centre xyz + radius) for fast brush culling
    const sphereCache = new WeakMap<object, Float32Array>();
    const spheres = (mesh: SceneObject['mesh']) => {
      let c = sphereCache.get(mesh);
      if (c) return c;
      const v = mesh.vertices, ix = mesh.indices;
      const n = ix.length / 3;
      c = new Float32Array(n * 4);
      for (let t = 0; t < n; t++) {
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < 3; k++) { const i = ix[t * 3 + k] * 3; cx += v[i] / 3; cy += v[i + 1] / 3; cz += v[i + 2] / 3; }
        let r = 0;
        for (let k = 0; k < 3; k++) { const i = ix[t * 3 + k] * 3; r = Math.max(r, Math.hypot(v[i] - cx, v[i + 1] - cy, v[i + 2] - cz)); }
        c[t * 4] = cx; c[t * 4 + 1] = cy; c[t * 4 + 2] = cz; c[t * 4 + 3] = r;
      }
      sphereCache.set(mesh, c);
      return c;
    };
    const tri = new THREE.Triangle();
    const closest = new THREE.Vector3();

    const paintAt = (ev: PointerEvent) => {
      const s = useStore.getState();
      if (s.tool === 'lasso_motion' || s.tool === 'band_motion' || s.tool === 'object_motion') return;
      ray.setFromCamera(ndc(ev), camera);
      const hit = ray.intersectObjects(objectMeshes(), false)[0];
      if (!hit) { if (brush.visible) { brush.visible = false; invalidate(); } return; }
      const n = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);
      brush.position.copy(hit.point).addScaledVector(n, 0.05);
      brush.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      brush.scale.setScalar(s.brushSize / 2);
      brush.visible = true;
      invalidate();
      if (!painting) return;
      if (s.tool === 'pick_motion') return; // click-to-pick fills the whole surface on press
      const id = hit.object.userData.id as string;
      if (id !== painting.id) return;
      const o = s.objects.find((x) => x.id === id);
      const arr = o?.paint?.[painting.layer];
      if (!o || !arr) return;
      const local = hit.point.clone().applyMatrix4(objectMatrix(o).invert());
      const scale = (Math.abs(o.scale[0]) + Math.abs(o.scale[1]) + Math.abs(o.scale[2])) / 3;
      const rad = s.brushSize / 2 / scale;
      const r2 = rad * rad;
      const c = spheres(o.mesh);
      const thr = Math.cos(((Number(s.overrides.support_threshold_angle ?? 30)) * Math.PI) / 180);
      const nm = new THREE.Matrix3().getNormalMatrix(objectMatrix(o));
      const v = o.mesh.vertices, ix = o.mesh.indices;
      const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
      let changed = false;
      for (let t = 0; t < arr.length; t++) {
        const dx = c[t * 4] - local.x, dy = c[t * 4 + 1] - local.y, dz = c[t * 4 + 2] - local.z;
        const reach = rad + c[t * 4 + 3];
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        tri.set(A.fromArray(v, ix[t * 3] * 3), B.fromArray(v, ix[t * 3 + 1] * 3), Cc.fromArray(v, ix[t * 3 + 2] * 3));
        if (tri.closestPointToPoint(local, closest).distanceToSquared(local) > r2) continue;
        if (s.overhangOnly && painting.layer === 'support' && painting.value === 1) {
          A.fromArray(v, ix[t * 3] * 3); B.fromArray(v, ix[t * 3 + 1] * 3); Cc.fromArray(v, ix[t * 3 + 2] * 3);
          const nn = B.sub(A).cross(Cc.sub(A)).applyMatrix3(nm).normalize();
          if (nn.z > -thr) continue;
        }
        // erasing a pattern's surfaces leaves other patterns' surfaces alone
        if (painting.layer === 'motion' && !painting.value && arr[t] !== s.motionSet) continue;
        if (arr[t] !== painting.value) { arr[t] = painting.value; changed = true; }
      }
      if (changed) {
        paintColors(meshes.get(id)!.mesh.geometry, o, s.tool, s.filaments.map((f) => f.color));
        invalidate();
      }
    };

    const onDown = (ev: PointerEvent) => {
      downAt = [ev.clientX, ev.clientY];
      const s = useStore.getState();
      if (s.tool === 'place_pattern' && s.workspace === 'prepare' && ev.button === 0) {
        ray.setFromCamera(ndc(ev), camera);
        const hit = ray.intersectObjects(objectMeshes(), false)[0];
        if (hit?.face && hit.faceIndex != null && placeDown(hit.object.userData.id, hit.point, hit.face.normal.clone().transformDirection(hit.object.matrixWorld), hit.faceIndex)) {
          renderer.domElement.setPointerCapture(ev.pointerId);
        }
        return;
      }
      if (!isPaintTool(s.tool) || s.workspace !== 'prepare' || ev.button === 1) return;
      const erase = ev.shiftKey || ev.button === 2;
      if (s.tool === 'lasso_motion') {
        drawing = { pts: [[ev.clientX, ev.clientY]], value: erase ? 0 : s.motionSet, box: s.motionDraw === 'box' };
        renderer.domElement.setPointerCapture(ev.pointerId);
        showOutline();
        return;
      }
      ray.setFromCamera(ndc(ev), camera);
      const hit = ray.intersectObjects(objectMeshes(), false)[0];
      if (!hit) return;
      const id = hit.object.userData.id as string;
      if (s.tool === 'object_motion') {
        // click an object: the whole object; clicking it again (or right click) takes it off
        const o = s.objects.find((x) => x.id === id)!;
        const all = !!o.paint?.motion?.every((v) => v === s.motionSet);
        assignMotion(new Map([[id, allTris(o)]]), erase || all ? 0 : s.motionSet);
        return;
      }
      if (s.tool === 'band_motion') {
        band = { id, z0: hit.point.z, z1: hit.point.z, value: erase ? 0 : s.motionSet, anchor: hit.point.clone() };
        renderer.domElement.setPointerCapture(ev.pointerId);
        showBand();
        return;
      }
      const motion = s.tool === 'paint_motion' || s.tool === 'pick_motion';
      const layer: keyof ObjectPaint = s.tool === 'paint_support' ? 'support' : s.tool === 'paint_seam' ? 'seam' : motion ? 'motion' : 'color';
      const value = ev.shiftKey ? 0 : layer === 'color' ? (ev.button === 2 ? 0 : s.paintColor) : motion ? (ev.button === 2 ? 0 : s.motionSet) : ev.button === 2 ? 2 : 1;
      // copy-on-write so undo keeps the previous paint
      s.updateObjects((o) => {
        const tris = o.mesh.indices.length / 3;
        const prev = o.paint?.[layer];
        return { ...o, paint: { ...(o.paint ?? {}), [layer]: prev ? prev.slice() : new Uint8Array(tris) } };
      }, [id]);
      painting = { id, value, layer };
      if (s.tool === 'pick_motion' && hit.faceIndex != null) {
        // click a surface: take it and every smoothly joined neighbour (a flat side, or a whole curved wall)
        const o = useStore.getState().objects.find((x) => x.id === id)!;
        let a = adjCache.get(o.mesh);
        if (!a) { a = { adj: triAdjacency(o.mesh), normals: triNormals(o.mesh) }; adjCache.set(o.mesh, a); }
        const arr = o.paint!.motion!;
        for (const t of growFaces(o.mesh, hit.faceIndex, s.motionGrowAngle, a.adj, a.normals)) if (value || arr[t] === s.motionSet) arr[t] = value;
        paintColors(meshes.get(id)!.mesh.geometry, o, s.tool, s.filaments.map((f) => f.color));
        invalidate();
      }
      renderer.domElement.setPointerCapture(ev.pointerId);
      paintAt(ev);
    };
    const onMove = (ev: PointerEvent) => {
      const s = useStore.getState();
      if (placeDragging()) {
        ray.setFromCamera(ndc(ev), camera);
        const hit = ray.intersectObjects(objectMeshes(), false)[0];
        if (hit?.face && hit.faceIndex != null) placeMove(hit.object.userData.id, hit.point, hit.face.normal.clone().transformDirection(hit.object.matrixWorld), hit.faceIndex);
        return;
      }
      if (drawing) {
        const last = drawing.pts[drawing.pts.length - 1];
        if (drawing.box) drawing.pts = [drawing.pts[0], [ev.clientX, ev.clientY]];
        else if (Math.hypot(ev.clientX - last[0], ev.clientY - last[1]) > 3) drawing.pts.push([ev.clientX, ev.clientY]);
        showOutline();
        return;
      }
      if (band) { band.z1 = bandHeight(ev); showBand(); return; }
      if (s.tool === 'lasso_motion' || s.tool === 'band_motion' || s.tool === 'object_motion') return;
      if (isPaintTool(s.tool) && s.workspace === 'prepare') paintAt(ev);
    };
    const onUp = (ev: PointerEvent) => {
      if (placeUp()) { downAt = null; return; }
      if (useStore.getState().tool === 'place_pattern') { downAt = null; return; }
      if (drawing) {
        const d = drawing;
        drawing = null;
        showOutline();
        downAt = null;
        let poly = d.pts;
        if (d.box && poly.length > 1) { const [a, b] = [poly[0], poly[poly.length - 1]]; poly = [a, [b[0], a[1]], b, [a[0], b[1]]]; }
        const s = useStore.getState();
        const rect = renderer.domElement.getBoundingClientRect();
        camera.updateMatrixWorld();
        const sel = new Map<string, number[]>();
        for (const o of s.objects) sel.set(o.id, trisInScreenPolygon(o, poly, camera, rect));
        assignMotion(sel, d.value);
        return;
      }
      if (band) {
        const b = band;
        band = null;
        downAt = null;
        showBand();
        const s = useStore.getState();
        const o = s.objects.find((x) => x.id === b.id);
        const lo = Math.min(b.z0, b.z1), hi = Math.max(b.z0, b.z1);
        // A band is a height range, not a set of triangles (one triangle can span the whole height
        // of a low-poly model), so it is handed to the plugin panel to set the pattern's heights.
        if (o && (hi - lo > 0.05 || !b.value)) {
          window.dispatchEvent(new CustomEvent('nx-motion-band', { detail: { id: o.id, from: lo, to: hi, erase: !b.value } }));
        }
        return;
      }
      if (painting) {
        painting = null;
        const s = useStore.getState();
        s.set({ objects: s.objects.map((o) => (o.paint ? { ...o, paint: { ...o.paint } } : o)) }); // paint arrays were mutated in place
        s.markDirty();
        return;
      }
      if (!downAt) return;
      if (ev.button === 2) { openMenu(ev); return; }
      if (ev.button !== 0) return;
      const moved = Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]);
      downAt = null;
      if (moved > 4 || dragging) return;
      const s = useStore.getState();
      if (s.workspace !== 'prepare' || isPaintTool(s.tool)) return;
      ray.setFromCamera(ndc(ev), camera);
      const parts = [...partMeshes.values()].map((p) => p.mesh);
      const hit = ray.intersectObjects([...parts, ...objectMeshes()], false)[0];
      if (!hit) {
        const plates = plateGroup.children.flatMap((g) => g.children.filter((c) => c.userData.plateIndex !== undefined));
        const ph = ray.intersectObjects(plates, false)[0];
        const patch: any = gizmo.dragging ? {} : { selected: [], selectedPart: null };
        if (ph) patch.activePlate = ph.object.userData.plateIndex;
        s.set(patch);
        return;
      }
      const id = hit.object.userData.id as string;
      const partId = hit.object.userData.partId as string | undefined;
      if (s.tool === 'measure') {
        const p: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
        s.set({ measurePoints: s.measurePoints.length >= 2 ? [p] : [...s.measurePoints, p] });
        return;
      }
      if (s.tool === 'face' && hit.face && !partId) {
        layOnFace(id, hit.face.normal.clone().transformDirection(hit.object.matrixWorld));
        s.set({ selected: [id], selectedPart: null });
        return;
      }
      if (partId) { s.set({ selected: [id], selectedPart: partId }); return; }
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) s.set({ selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id], selectedPart: null });
      else s.set({ selected: [id], selectedPart: null });
      const pi = plateAt(hit.point.x, hit.point.y, s.printerId, s.plates.length);
      if (pi !== s.activePlate) s.set({ activePlate: pi });
    };
    // Right click without dragging (right drag pans): menu for the object, part or plate spot under the cursor.
    const openMenu = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - downAt![0], ev.clientY - downAt![1]);
      downAt = null;
      const s = useStore.getState();
      if (moved > 4 || s.workspace !== 'prepare' || isPaintTool(s.tool)) return;
      ray.setFromCamera(ndc(ev), camera);
      const parts = [...partMeshes.values()].filter((p) => p.mesh.visible).map((p) => p.mesh);
      const hit = ray.intersectObjects([...parts, ...objectMeshes()], false)[0];
      const plates = plateGroup.children.flatMap((g) => g.children.filter((c) => c.userData.plateIndex !== undefined));
      const at = { x: ev.clientX, y: ev.clientY };
      if (hit) {
        const id = hit.object.userData.id as string;
        const partId = hit.object.userData.partId as string | undefined;
        const plate = plateAt(hit.point.x, hit.point.y, s.printerId, s.plates.length);
        if (partId) { s.set({ selected: [id], selectedPart: partId, contextMenu: { ...at, kind: 'part', plate, id, partId } }); return; }
        s.set({ selected: s.selected.includes(id) ? s.selected : [id], selectedPart: null, activePlate: plate, contextMenu: { ...at, kind: 'object', plate, id } });
        return;
      }
      const ph = ray.intersectObjects(plates, false)[0];
      // Off the plate the menu still opens for the active plate, like Bambu Studio.
      const plate = ph ? ph.object.userData.plateIndex as number : s.activePlate;
      const world: [number, number] | undefined = ph ? [ph.point.x, ph.point.y] : undefined;
      s.set({ selected: [], selectedPart: null, activePlate: plate, contextMenu: { ...at, kind: 'plate', plate, world } });
    };
    const onContext = (ev: Event) => ev.preventDefault();
    const onLeave = () => { brush.visible = false; invalidate(); };
    const onCancel = () => { drawing = null; band = null; showOutline(); showBand(); };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('contextmenu', onContext);
    renderer.domElement.addEventListener('pointercancel', onCancel);

    // ---------------- pattern preview in Prepare: plugin lines drawn on the model, no slicing
    const patternMat = new LineMaterial({ linewidth: 2, vertexColors: true, worldUnits: false, depthTest: true, transparent: true });
    const patternLines = new LineSegments2(new LineSegmentsGeometry(), patternMat);
    patternLines.renderOrder = 5;
    patternLines.visible = false;
    patternLines.frustumCulled = false;
    scene.add(patternLines);
    let previewTimer: ReturnType<typeof setTimeout> | null = null;
    const rebuildPatternPreview = () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        previewTimer = null;
        const s = useStore.getState();
        if (!showsPattern(s)) return;
        const t0 = performance.now();
        let lines: { positions: Float32Array; colors: Float32Array } | null = null;
        for (const p of PLUGINS) if (s.plugins.includes(p.id) && p.preview) { lines = p.preview(); if (lines) break; }
        const geo = new LineSegmentsGeometry();
        if (lines && lines.positions.length) { geo.setPositions(lines.positions); geo.setColors(lines.colors); }
        patternLines.geometry.dispose();
        patternLines.geometry = geo;
        (window as any).__nxPreviewMs = performance.now() - t0;
        window.dispatchEvent(new Event('nx-preview-built'));
        invalidate();
      }, 120);
    };
    window.addEventListener('nx-plugin-preview', rebuildPatternPreview);

    // ---------------- preview
    let lastColorKey = '';
    const legendHook = () => {
      const s = useStore.getState();
      const key = `${s.colorScheme}|${s.hiddenFeatures.join(',')}|${s.slice.result ? s.slice.result.moves.length : 0}|${s.filaments.map((f) => f.color).join()}`;
      if (key === lastColorKey) return;
      lastColorKey = key;
      const range = toolpaths.colorize(s.colorScheme, new Set(s.hiddenFeatures), s.filaments.map((f) => f.color));
      (window as any).__nxLegend = range;
      window.dispatchEvent(new Event('nx-legend'));
    };
    const syncPreview = () => {
      const s = useStore.getState();
      const preview = s.workspace === 'preview';
      objGroup.visible = !preview;
      selBoxes.visible = s.workspace === 'prepare';
      toolpaths.group.visible = preview;
      patternLines.visible = showsPattern(s);
      if (preview) {
        if (toolpaths.result !== s.slice.result) { toolpaths.setResult(s.slice.result); lastColorKey = ''; }
        const [ox, oy] = plateOrigin(s.slice.plate, s.printerId);
        toolpaths.group.position.set(ox, oy, 0);
        legendHook();
        toolpaths.setRange(s.layerRange[0], s.layerRange[1], s.moveCursor);
        toolpaths.showTravel(s.showTravel);
      }
      pxPrev.visible = preview;
      if (preview) {
        const [ox, oy] = plateOrigin(s.slice.plate, s.printerId);
        pxPrev.position.set(ox, oy, 0);
        const r = s.slice.result;
        syncPreviewOverlay(pxPrev, r?.pluginReports?.patternex as PatternexReport | undefined, s.layerRange, r ? r.layers.map((l) => l.z) : [], s.filaments.map((f) => f.color));
      }
      syncGizmo();
      invalidate();
    };

    function syncPatternex() {
      const s = useStore.getState();
      pxPrep.visible = s.workspace === 'prepare' && s.plugins.includes('patternex');
      if (pxPrep.visible) syncPlacementOverlay(pxPrep, s.objects);
      invalidate();
    }
    const onPatternex = () => { syncPatternex(); if (useStore.getState().workspace === 'preview') syncPreview(); };
    window.addEventListener('nx-patternex', onPatternex);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + 'px';
      renderer.domElement.style.height = h + 'px';
      camera.aspect = w / Math.max(h, 1);
      patternMat.resolution.set(w, h);
      camera.updateProjectionMatrix();
      invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    rebuildPlates();
    resize();
    setView('iso');
    syncObjects();
    syncPreview();

    const unsub = useStore.subscribe((s, prev) => {
      if (s.printerId !== prev.printerId || s.theme !== prev.theme || s.plates.length !== prev.plates.length || s.activePlate !== prev.activePlate) {
        rebuildPlates();
        if (s.printerId !== prev.printerId || s.activePlate !== prev.activePlate || s.plates.length !== prev.plates.length) setView('iso');
      }
      if (s.objects !== prev.objects || s.selected !== prev.selected || s.selectedPart !== prev.selectedPart || s.filaments !== prev.filaments || s.showOverhangs !== prev.showOverhangs
        || s.tool !== prev.tool || s.printerId !== prev.printerId || s.theme !== prev.theme || s.overrides !== prev.overrides || s.plates !== prev.plates || s.workspace !== prev.workspace) syncObjects();
      if (s.liveToolpaths !== prev.liveToolpaths) syncObjects();
      if (showsPattern(s) && (s.liveToolpaths !== prev.liveToolpaths || s.workspace !== prev.workspace || s.objects !== prev.objects || s.activePlate !== prev.activePlate
        || s.printerId !== prev.printerId || s.presetId !== prev.presetId || s.overrides !== prev.overrides || s.plugins !== prev.plugins)) rebuildPatternPreview();
      if (s.liveToolpaths !== prev.liveToolpaths || s.workspace !== prev.workspace || s.slice.result !== prev.slice.result || s.layerRange !== prev.layerRange || s.moveCursor !== prev.moveCursor
        || s.colorScheme !== prev.colorScheme || s.hiddenFeatures !== prev.hiddenFeatures || s.showTravel !== prev.showTravel || s.filaments !== prev.filaments) syncPreview();
      if (s.brushSize !== prev.brushSize) { brush.scale.setScalar(s.brushSize / 2); invalidate(); }
      if (s.cutPlane !== prev.cutPlane || s.measurePoints !== prev.measurePoints || s.tool !== prev.tool || s.selected !== prev.selected || s.objects !== prev.objects || s.workspace !== prev.workspace) syncTools();
    });

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (controls.update()) needsRender = true;
      if (needsRender) { renderer.render(scene, camera); needsRender = false; }
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('nx-patternex', onPatternex);
      unsub();
      ro.disconnect();
      gizmo.dispose();
      controls.dispose();
      toolpaths.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      el.removeChild(overlay);
      window.removeEventListener('nx-plugin-preview', rebuildPatternPreview);
      patternLines.geometry.dispose(); patternMat.dispose();
      viewApi.current = null;
    };
  }, []);

  return <div className="viewport-canvas" ref={host} />;
}
