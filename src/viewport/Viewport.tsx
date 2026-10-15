// The 3D workspace (Prepare + Preview share one renderer).
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { printerById, type PrinterProfile } from '../profiles/printers';
import { dropToBed, isOutOfBounds, objectMatrix, useStore, type SceneObject } from '../state/store';
import { layOnFace } from '../state/ops';
import { ToolpathView } from './toolpaths';

export interface ViewApi { setView: (v: 'iso' | 'top' | 'front' | 'left' | 'right' | 'back') => void; fit: () => void }
export const viewApi: { current: ViewApi | null } = { current: null };

const THEMES = {
  dark: { zenith: '#1E3442', nadir: '#0B1520', plate: '#1B2E3D', minor: '#284355', major: '#3B5F78', border: '#85A3B2', glow: 'rgba(115,37,83,0.35)' },
  light: { zenith: '#F7F1EA', nadir: '#DCC9B6', plate: '#E7D9CB', minor: '#CDB8A4', major: '#A88F7A', border: '#5E7684', glow: 'rgba(255,92,141,0.18)' },
};

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

function buildPlate(p: PrinterProfile, theme: 'dark' | 'light'): THREE.Group {
  const t = THEMES[theme];
  const g = new THREE.Group();
  const { x: X, y: Y } = p.bed;
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(X, Y, 1.2),
    new THREE.MeshStandardMaterial({ color: t.plate, roughness: 0.75, metalness: 0.2 }),
  );
  plate.position.set(X / 2, Y / 2, -0.62);
  plate.receiveShadow = true;
  plate.name = 'plate';
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
  g.add(lines([0, 0, 0.02, X, 0, 0.02, X, 0, 0.02, X, Y, 0.02, X, Y, 0.02, 0, Y, 0.02, 0, Y, 0.02, 0, 0, 0.02], t.border, 1));
  // origin axes
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
  // build volume outline
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(X, Y, p.bed.z)),
    new THREE.LineBasicMaterial({ color: t.border, transparent: true, opacity: 0.18 }),
  );
  box.position.set(X / 2, Y / 2, p.bed.z / 2);
  g.add(box);
  return g;
}

function overhangMaterial(color: string): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
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
        if (uOverhang > 0.5 && normalize(vWN).z < -uCos && vWP.z > 0.05) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.09, 0.27), 0.85);
        if (uOOB > 0.5) { float s = step(0.5, fract((vWP.x + vWP.y + vWP.z) * 0.25)); diffuseColor.rgb = mix(vec3(1.0, 0.23, 0.19), vec3(0.45, 0.08, 0.08), s); }`);
  };
  return mat;
}

function geometryFor(o: SceneObject): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.mesh.vertices, 3));
  g.setIndex(new THREE.BufferAttribute(o.mesh.indices, 1));
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 10000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.15;
    controls.screenSpacePanning = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

    scene.add(new THREE.HemisphereLight('#ffffff', '#334455', 1.4));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(-150, -250, 400);
    scene.add(sun);
    const fill = new THREE.DirectionalLight('#FFD9E6', 0.5);
    fill.position.set(300, 300, 200);
    scene.add(fill);

    let plate: THREE.Group | null = null;
    let printer = printerById(useStore.getState().printerId);
    const objGroup = new THREE.Group();
    scene.add(objGroup);
    const meshes = new Map<string, { mesh: THREE.Mesh; src: SceneObject['mesh'] }>();
    const selBoxes = new THREE.Group();
    scene.add(selBoxes);
    const toolpaths = new ToolpathView();
    scene.add(toolpaths.group);

    const proxy = new THREE.Object3D();
    scene.add(proxy);
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.85);
    scene.add(gizmo.getHelper());
    let dragging = false;

    let needsRender = true;
    const invalidate = () => { needsRender = true; };
    controls.addEventListener('change', invalidate);

    const setView = (v: 'iso' | 'top' | 'front' | 'left' | 'right' | 'back') => {
      const { x: X, y: Y, z: Z } = printer.bed;
      const c = new THREE.Vector3(X / 2, Y / 2, 0);
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
    const fit = () => setView('iso');
    viewApi.current = { setView, fit };
    (window as any).__nx = { camera, controls, invalidate };

    const rebuildPlate = () => {
      if (plate) { scene.remove(plate); plate.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
      const s = useStore.getState();
      printer = printerById(s.printerId);
      plate = buildPlate(printer, s.theme);
      scene.add(plate);
      scene.background = backgroundTexture(s.theme);
      invalidate();
    };

    const syncObjects = () => {
      const s = useStore.getState();
      const keep = new Set(s.objects.map((o) => o.id));
      for (const [id, m] of meshes) if (!keep.has(id)) { objGroup.remove(m.mesh); m.mesh.geometry.dispose(); (m.mesh.material as THREE.Material).dispose(); meshes.delete(id); }
      for (const o of s.objects) {
        let entry = meshes.get(o.id);
        if (!entry || entry.src !== o.mesh) {
          if (entry) { objGroup.remove(entry.mesh); entry.mesh.geometry.dispose(); }
          const mesh = new THREE.Mesh(geometryFor(o), overhangMaterial(s.filamentColor));
          mesh.userData.id = o.id;
          entry = { mesh, src: o.mesh };
          meshes.set(o.id, entry);
          objGroup.add(mesh);
        }
        const mat = entry.mesh.material as THREE.MeshStandardMaterial;
        const sel = s.selected.includes(o.id);
        mat.color.set(s.filamentColor);
        mat.emissive.set(sel ? s.filamentColor : '#000000');
        mat.emissiveIntensity = sel ? 0.28 : 0;
        const u = mat.userData.uniforms;
        u.uOverhang.value = s.showOverhangs ? 1 : 0;
        u.uCos.value = Math.cos(((Number(s.overrides.support_threshold_angle ?? 30)) * Math.PI) / 180);
        u.uOOB.value = isOutOfBounds(o, s.printerId) ? 1 : 0;
        if (!dragging || !sel) {
          entry.mesh.matrixAutoUpdate = false;
          entry.mesh.matrix.copy(objectMatrix(o));
          entry.mesh.matrixWorldNeedsUpdate = true;
        }
      }
      // selection boxes
      selBoxes.clear();
      for (const id of s.selected) {
        const e = meshes.get(id);
        if (!e) continue;
        e.mesh.updateMatrixWorld();
        const h = new THREE.BoxHelper(e.mesh, s.theme === 'dark' ? '#E9D8C8' : '#142030');
        selBoxes.add(h);
      }
      syncGizmo();
      invalidate();
    };

    const syncGizmo = () => {
      const s = useStore.getState();
      const o = s.objects.find((x) => x.id === s.selected[0]);
      const mode = s.tool === 'move' ? 'translate' : s.tool === 'rotate' ? 'rotate' : s.tool === 'scale' ? 'scale' : null;
      if (!o || !mode || s.workspace !== 'prepare') { gizmo.detach(); return; }
      if (!dragging) {
        proxy.position.set(...o.position);
        const d = Math.PI / 180;
        proxy.rotation.set(o.rotation[0] * d, o.rotation[1] * d, o.rotation[2] * d, 'XYZ');
        proxy.scale.set(...o.scale);
        proxy.updateMatrixWorld();
      }
      gizmo.setMode(mode);
      gizmo.setSpace(mode === 'scale' ? 'local' : 'world');
      if (gizmo.object !== proxy) gizmo.attach(proxy);
    };

    gizmo.addEventListener('dragging-changed', (e: any) => {
      controls.enabled = !e.value;
      dragging = e.value;
      if (!e.value) {
        // commit
        const s = useStore.getState();
        const id = s.selected[0];
        const D = 180 / Math.PI;
        s.updateObjects((o) => {
          const n: SceneObject = {
            ...o,
            position: [proxy.position.x, proxy.position.y, proxy.position.z],
            rotation: [proxy.rotation.x * D, proxy.rotation.y * D, proxy.rotation.z * D],
            scale: [proxy.scale.x, proxy.scale.y, proxy.scale.z],
          };
          return s.tool === 'move' && Math.abs(n.position[2] - o.position[2]) > 1e-6 ? n : dropToBed(n);
        }, [id]);
      }
    });
    gizmo.addEventListener('objectChange', () => {
      const s = useStore.getState();
      const e = meshes.get(s.selected[0]);
      if (!e) return;
      proxy.updateMatrixWorld();
      e.mesh.matrix.copy(proxy.matrixWorld);
      e.mesh.matrixWorldNeedsUpdate = true;
      invalidate();
    });
    gizmo.addEventListener('change', invalidate);

    // picking
    const ray = new THREE.Raycaster();
    let downAt: [number, number] | null = null;
    const onDown = (ev: PointerEvent) => { downAt = [ev.clientX, ev.clientY]; };
    const onUp = (ev: PointerEvent) => {
      if (!downAt || ev.button !== 0) return;
      const moved = Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]);
      downAt = null;
      if (moved > 4 || dragging) return;
      const s = useStore.getState();
      if (s.workspace !== 'prepare') return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(objGroup.children, false)[0];
      if (!hit) { if (!gizmo.dragging) s.set({ selected: [] }); return; }
      const id = hit.object.userData.id as string;
      if (s.tool === 'face' && hit.face) {
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        layOnFace(id, n);
        s.set({ selected: [id] });
        return;
      }
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) s.set({ selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id] });
      else s.set({ selected: [id] });
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    // preview sync
    let legendHook = () => {};
    const syncPreview = () => {
      const s = useStore.getState();
      const preview = s.workspace === 'preview';
      objGroup.visible = !preview;
      selBoxes.visible = !preview;
      toolpaths.group.visible = preview;
      if (preview) {
        if (toolpaths.result !== s.slice.result) toolpaths.setResult(s.slice.result);
        legendHook();
        toolpaths.setRange(s.layerRange[0], s.layerRange[1], s.moveCursor);
        toolpaths.showTravel(s.showTravel);
      }
      syncGizmo();
      invalidate();
    };
    let lastColorKey = '';
    legendHook = () => {
      const s = useStore.getState();
      const key = `${s.colorScheme}|${s.hiddenFeatures.join(',')}|${s.slice.result ? s.slice.result.moves.length : 0}|${s.filamentColor}`;
      if (key === lastColorKey && toolpaths.result === s.slice.result) return;
      lastColorKey = key;
      const range = toolpaths.colorize(s.colorScheme, new Set(s.hiddenFeatures));
      (window as any).__nxLegend = range;
      window.dispatchEvent(new Event('nx-legend'));
    };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + 'px';
      renderer.domElement.style.height = h + 'px';
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    rebuildPlate();
    resize();
    setView('iso');
    syncObjects();
    syncPreview();

    const unsub = useStore.subscribe((s, prev) => {
      if (s.printerId !== prev.printerId || s.theme !== prev.theme) { rebuildPlate(); if (s.printerId !== prev.printerId) setView('iso'); }
      if (s.objects !== prev.objects || s.selected !== prev.selected || s.filamentColor !== prev.filamentColor || s.showOverhangs !== prev.showOverhangs
        || s.tool !== prev.tool || s.printerId !== prev.printerId || s.theme !== prev.theme || s.overrides !== prev.overrides) syncObjects();
      if (s.workspace !== prev.workspace || s.slice.result !== prev.slice.result || s.layerRange !== prev.layerRange || s.moveCursor !== prev.moveCursor
        || s.colorScheme !== prev.colorScheme || s.hiddenFeatures !== prev.hiddenFeatures || s.showTravel !== prev.showTravel) syncPreview();
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
      unsub();
      ro.disconnect();
      gizmo.dispose();
      controls.dispose();
      toolpaths.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      viewApi.current = null;
    };
  }, []);

  return <div className="viewport-canvas" ref={host} />;
}
