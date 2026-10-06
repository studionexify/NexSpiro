import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  patterns, primitives, addRegion, stamp, toGcode, formatDuration, PresetRegistry, newPlate, newObject, clonePlate, cloneObject,
  objectBody, arrangePlate, footprint, normalizeMesh, bounds,
  type PatternParams, type PrimitiveName, type MotionPath, type SliceStats, type PlateIssue, type Plate, type PlateObject,
  type MachinePreset, type FilamentPreset, type ProcessPreset, type PresetKind, type Preset, type Thumbnail, type Mesh, type Body, type Project,
} from "../core/index.ts";
import type { SliceRequest, SliceResponse } from "./worker.ts";
import type { IORequest, IOResponse } from "./ioWorker.ts";
import { ACCEPT, type ImportResult } from "../io/importers/index.ts";
import type { Imported3MF } from "../io/importers/threemf.ts";
import { toolheadEnvelope, parseBedExclusionSVG } from "../io/importers/machineGeometry.ts";
import { toBambuSettings } from "../io/importers/profiles.ts";
import { paintMeshToMask } from "../io/paintmap.ts";
import { export3MF } from "../io/exporters/threemf.ts";
import { writeProjectArchive, readProjectArchive } from "../io/exporters/project.ts";
import { writeSTL, writeOBJ, bakeToolpath, tessellateBody, transformMesh } from "../io/exporters/mesh.ts";
import { trajectoryCSV, trajectoryJSON } from "../io/exporters/trajectory.ts";
import { opt, esc, GROUPS, field, getPath, setPath } from "./ui.ts";


// ======================= state =======================
const REGION_COLORS = [0x4c8dff, 0xff6b5b, 0x3ccf91, 0xffb454, 0xc77dff, 0x2fd3e0, 0xf7768e];
const BASE_COLOR = new THREE.Color(0xd8dce4), SELECTED_TINT = new THREE.Color(0xfff2c0);
type PreviewMode = "feature" | "speed" | "height" | "layerTime" | "curvature";
const PREVIEW_LABELS: Record<PreviewMode, string> = {
  feature: "Feature type (paint region)", speed: "Speed", height: "Height", layerTime: "Layer time",
  curvature: "Curvature & Non-Linear Feedrate",
};
type SliceResult = Extract<SliceResponse, { ok: true }> & { key: string };
type ObjView = { obj: PlateObject; group: THREE.Group; surface: THREE.Mesh | null; maskTex: THREE.DataTexture; maskVersion: number; footprintRing: THREE.Line | null };
type PlateView = {
  plate: Plate; group: THREE.Group; bed: THREE.LineSegments; objs: ObjView[];
  lines: THREE.Line[]; status: "idle" | "slicing" | "done" | "error"; error?: string;
  result?: SliceResult; pendingKey?: string; worker: Worker; reqId: number;
};

const USER_PRESETS_KEY = "nexspiro.userPresets";
const registry = new PresetRegistry();
try { for (const p of JSON.parse(localStorage.getItem(USER_PRESETS_KEY) ?? "[]") as Preset[]) registry.add(p); } catch { /* storage unavailable */ }
const persistUserPresets = () => { try { localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(registry.user())); } catch { /* ignore */ } };

const meshes: Record<string, Mesh> = {};
const bodyCache = new Map<string, Body>();
function bodyOf(o: PlateObject): Body {
  const key = o.source.kind === "mesh" ? `m:${o.source.meshId}` : `p:${o.source.primitive}`;
  let b = bodyCache.get(key);
  if (!b) { b = objectBody(o, meshes); bodyCache.set(key, b); }
  return b;
}

const ui = {
  tab: "prepare" as "prepare" | PresetKind,
  selected: { machine: "machine/bambu-x1", filament: "filament/pla", process: "process/vase-0.4" } as Record<PresetKind, string>,
  edited: {} as Partial<Record<PresetKind, MachinePreset | FilamentPreset | ProcessPreset>>,
  active: 0, activeObj: 0, target: -1,
  tool: "orbit" as "orbit" | "move" | "paint" | "erase", brush: 8, showSurface: true,
  preview: "feature" as PreviewMode, layerMin: 0, layerMax: 1,
  exportFormat: "gcode" as ExportFormat, developer: false,
};
type ExportFormat = "gcode" | "3mf" | "nexspiro" | "stl" | "obj" | "baked" | "csv" | "json";
const EXPORT_LABELS: Record<ExportFormat, string> = {
  gcode: "G-code (active plate)", "3mf": "3MF project (all plates)", nexspiro: ".nexspiro project", stl: "STL (selected object)",
  obj: "OBJ (selected object)", baked: "Baked textured wall STL (active plate)", csv: "Trajectory CSV (developer)", json: "Trajectory JSON (developer)",
};
const presetValues = <K extends PresetKind>(k: K) =>
  (ui.edited[k] ?? registry.resolve<K>(ui.selected[k])) as K extends "machine" ? MachinePreset : K extends "filament" ? FilamentPreset : ProcessPreset;
const machine = () => presetValues("machine"), filament = () => presetValues("filament"), proc = () => presetValues("process");
const activeView = () => views[ui.active];
const activeObjView = (): ObjView | undefined => activeView()?.objs[ui.activeObj];

// ======================= scene =======================
const view = document.getElementById("view")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16181d);
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 10000);
camera.up.set(0, 0, 1);
camera.position.set(260, -300, 220);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(200, -150, 300); scene.add(sun);

const pathMat = new THREE.LineBasicMaterial({ vertexColors: true });
const views: PlateView[] = [];
const PLATE_GAP = 60;
const plateOrigin = (i: number) => { const b = machine().bed; return new THREE.Vector3(i * (b[0] + PLATE_GAP) + b[0] / 2, b[1] / 2, 0); };

function bedLines(active: boolean, locked: boolean) {
  const [bx, by] = machine().bed, pts: number[] = [], step = 32, hx = bx / 2, hy = by / 2;
  for (let x = -hx; x <= hx + 1e-6; x += step) pts.push(x, -hy, 0, x, hy, 0);
  for (let y = -hy; y <= hy + 1e-6; y += step) pts.push(-hx, y, 0, hx, y, 0);
  pts.push(-hx, -hy, 0, hx, -hy, 0, hx, -hy, 0, hx, hy, 0, hx, hy, 0, -hx, hy, 0, -hx, hy, 0, -hx, -hy, 0);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: locked ? 0x7a5c2e : active ? 0x4c8dff : 0x2e3440 }));
  const ex: number[] = []; // bed exclusion zones (bed-corner coordinates → bed-centre)
  for (const poly of machine().bedExclude ?? []) poly.forEach(([x, y], i) => {
    const [nx, ny] = poly[(i + 1) % poly.length];
    ex.push(x - hx, y - hy, 0.1, nx - hx, ny - hy, 0.1);
  });
  if (ex.length) {
    const eg = new THREE.BufferGeometry(); eg.setAttribute("position", new THREE.Float32BufferAttribute(ex, 3));
    lines.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xff5b5b })));
  }
  if (bedTexture) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(bx, by), new THREE.MeshBasicMaterial({ map: bedTexture, transparent: true, opacity: 0.6, depthWrite: false }));
    plane.position.z = -0.05; lines.add(plane);
  }
  return lines;
}
let bedTexture: THREE.Texture | null = null;

function makeObjView(pv: PlateView, obj: PlateObject): ObjView {
  const maskTex = new THREE.DataTexture(new Uint8Array(obj.mask.cols * obj.mask.rows * 4), obj.mask.cols, obj.mask.rows);
  maskTex.wrapS = THREE.RepeatWrapping; maskTex.magFilter = THREE.LinearFilter;
  const ov: ObjView = { obj, group: new THREE.Group(), surface: null, maskTex, maskVersion: 0, footprintRing: null };
  pv.group.add(ov.group);
  refreshMaskTexture(ov); buildSurface(ov);
  return ov;
}
function disposeObjView(pv: PlateView, ov: ObjView) {
  pv.group.remove(ov.group); ov.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); ov.maskTex.dispose();
}
function makeView(plate: Plate): PlateView {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const v: PlateView = { plate, group: new THREE.Group(), bed: bedLines(false, false), objs: [], lines: [], status: "idle", worker, reqId: 0 };
  worker.onmessage = (ev: MessageEvent<SliceResponse>) => onSliced(v, ev.data);
  v.group.add(v.bed); scene.add(v.group);
  v.objs = plate.objects.map((o) => makeObjView(v, o));
  return v;
}
function disposeView(v: PlateView) {
  v.worker.terminate(); scene.remove(v.group);
  v.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}
function layoutPlates() {
  views.forEach((v, i) => {
    v.group.position.copy(plateOrigin(i));
    v.group.remove(v.bed); v.bed.geometry.dispose();
    v.bed = bedLines(i === ui.active, v.plate.locked); v.group.add(v.bed);
    v.objs.forEach(placeObj);
  });
  updateSurfaceVisibility();
}
function placeObj(ov: ObjView) { ov.group.position.set(ov.obj.transform.x, ov.obj.transform.y, 0); }

/** Paint surface: rings of the body (primitive or sliced mesh) with (u, t) UVs matching the mask. */
function buildSurface(ov: ObjView) {
  const body = bodyOf(ov.obj), C = 128, R = 64, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= R; j++) {
    const t = j / R, ring = body.ring(Math.min(body.height - 1e-3, Math.max(1e-3, t * body.height)), C);
    for (let i = 0; i <= C; i++) {
      const k = i % C;
      pos.push(ring ? ring.x[k] : 0, ring ? ring.y[k] : 0, t * body.height); uv.push(i / C, t);
    }
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
    const a = j * (C + 1) + i, b = a + 1, c = a + C + 1, d = c + 1;
    idx.push(a, b, d, a, d, c); // CCW rings → outward normals
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  if (ov.surface) { ov.group.remove(ov.surface); ov.surface.geometry.dispose(); }
  ov.surface = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: ov.maskTex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  const t = ov.obj.transform;
  ov.surface.scale.set(t.scaleXY, t.scaleXY, t.scaleZ);
  ov.surface.rotation.z = (t.rotation * Math.PI) / 180;
  ov.group.add(ov.surface);
  // footprint circle (arrange / clearance envelope)
  if (ov.footprintRing) { ov.group.remove(ov.footprintRing); ov.footprintRing.geometry.dispose(); }
  const r = footprint(ov.obj, body, proc()), fp: number[] = [];
  for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; fp.push(r * Math.cos(a), r * Math.sin(a), 0.05); }
  const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
  ov.footprintRing = new THREE.Line(fg, new THREE.LineBasicMaterial({ color: 0x5a6375 }));
  ov.group.add(ov.footprintRing);
  updateSurfaceVisibility();
}
function updateSurfaceVisibility() {
  views.forEach((v, i) => v.objs.forEach((ov, k) => {
    const sel = i === ui.active && k === ui.activeObj;
    if (ov.surface) ov.surface.visible = ui.showSurface && sel;
    if (ov.footprintRing) (ov.footprintRing.material as THREE.LineBasicMaterial).color.set(sel ? 0xffd479 : 0x5a6375);
  }));
}
function refreshMaskTexture(ov: ObjView) {
  const d = ov.maskTex.image.data as Uint8Array, c = new THREE.Color();
  d.fill(0);
  ov.obj.mask.regions.forEach((reg, k) => {
    c.set(REGION_COLORS[k % REGION_COLORS.length]);
    for (let i = 0; i < reg.weight.length; i++) {
      const w = reg.weight[i]; if (w <= 0) continue;
      const o = i * 4;
      d[o] = Math.max(d[o], c.r * 255 * w); d[o + 1] = Math.max(d[o + 1], c.g * 255 * w);
      d[o + 2] = Math.max(d[o + 2], c.b * 255 * w); d[o + 3] = Math.max(d[o + 3], 220 * w);
    }
  });
  ov.maskTex.needsUpdate = true;
}

// ======================= preview colouring =======================
const ramp = (t: number, c: THREE.Color) => c.setHSL((1 - Math.min(1, Math.max(0, t))) * 0.66, 0.85, 0.55);
function legendRange(mps: MotionPath[], mode: PreviewMode): [number, number, string] {
  let lo = Infinity, hi = -Infinity;
  for (const mp of mps) {
    if (mode === "speed" || mode === "curvature") for (let i = 1; i < mp.count; i++) { lo = Math.min(lo, mp.feed[i]); hi = Math.max(hi, mp.feed[i]); }
    else if (mode === "height") for (let i = 0; i < mp.count; i++) { lo = 0; hi = Math.max(hi, mp.xyz[i * 3 + 2]); }
    else if (mode === "layerTime") for (const t of mp.layerTime) { lo = Math.min(lo, t); hi = Math.max(hi, t); }
  }
  return Number.isFinite(lo) ? [lo, hi, mode === "height" ? "mm" : mode === "layerTime" ? "s" : "mm/s"] : [0, 0, ""];
}
function makeLine(mp: MotionPath, stride: number, mode: PreviewMode, range: [number, number, string], selected: boolean): THREE.Line {
  const n = Math.floor((mp.count - 1) / stride) + 1, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const c = new THREE.Color(), [lo, hi] = range, span = hi - lo || 1;
  let kMax = 0; if (mode === "curvature") for (let i = 0; i < mp.count; i++) kMax = Math.max(kMax, mp.curvature[i]);
  for (let k = 0; k < n; k++) {
    const i = k * stride;
    pos[k * 3] = mp.xyz[i * 3]; pos[k * 3 + 1] = mp.xyz[i * 3 + 1]; pos[k * 3 + 2] = mp.xyz[i * 3 + 2];
    switch (mode) {
      case "feature":
        if (mp.tag[i] === 0) c.copy(selected ? SELECTED_TINT : BASE_COLOR); else c.set(REGION_COLORS[(mp.tag[i] - 1) % REGION_COLORS.length]);
        break;
      case "speed": ramp((mp.feed[Math.max(1, i)] - lo) / span, c); break;
      case "height": ramp((mp.xyz[i * 3 + 2] - lo) / span, c); break;
      case "layerTime": ramp((mp.layerTime[mp.layer[i]] - lo) / span, c); break;
      case "curvature": // hue = feedrate, lightness = curvature
        ramp((mp.feed[Math.max(1, i)] - lo) / span, c);
        c.offsetHSL(0, 0, 0.3 * (kMax > 0 ? mp.curvature[i] / kMax : 0) - 0.1); break;
    }
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const line = new THREE.Line(g, pathMat);
  line.userData.stride = stride; line.userData.mp = mp; line.frustumCulled = false;
  return line;
}
function redrawPaths(v: PlateView) {
  for (const l of v.lines) { v.group.remove(l); l.geometry.dispose(); }
  v.lines = [];
  if (!v.result) return;
  const range = legendRange(v.result.mps, ui.preview), total = v.result.mps.reduce((s, m) => s + m.count, 0);
  v.result.mps.forEach((mp, k) => {
    const sel = views.indexOf(v) === ui.active && k === ui.activeObj;
    const full = makeLine(mp, 1, ui.preview, range, sel); full.userData.lod = "full"; v.lines.push(full);
    if (total > 400_000) { const lod = makeLine(mp, 4, ui.preview, range, sel); lod.userData.lod = "far"; v.lines.push(lod); }
  });
  v.lines.forEach((l) => v.group.add(l));
  applyLayerRange(v);
}
function applyLayerRange(v: PlateView) {
  for (const l of v.lines) {
    const mp = l.userData.mp as MotionPath, { layer, count } = mp, layers = layer[count - 1] + 1;
    const lo = Math.floor(ui.layerMin * (layers - 1)), hi = Math.ceil(ui.layerMax * (layers - 1));
    const first = (L: number) => { let a = 0, b = count; while (a < b) { const m = (a + b) >> 1; if (layer[m] < L) a = m + 1; else b = m; } return a; };
    const a = first(lo), b = first(hi + 1), s = l.userData.stride as number;
    l.geometry.setDrawRange(Math.floor(a / s), Math.max(0, Math.ceil((b - a) / s)));
  }
}

// ======================= slicing (worker per plate, cached) =======================
function sliceKey(v: PlateView) {
  return JSON.stringify([v.plate.objects.map((o) => [o.source, o.transform, o.base, o.regionParams, o.mask.regions.map((r) => r.pattern)]),
    v.objs.map((o) => o.maskVersion), machine(), filament(), proc()]);
}
function slice(v: PlateView) {
  const key = sliceKey(v);
  if (v.result?.key === key && v.status === "done") return;
  if (!v.plate.objects.length) { v.result = undefined; v.status = "idle"; redrawPaths(v); renderStatus(); renderPlateBar(); return; }
  v.status = "slicing"; v.reqId++; v.pendingKey = key;
  const used = new Set(v.plate.objects.flatMap((o) => (o.source.kind === "mesh" ? [o.source.meshId] : [])));
  const req: SliceRequest = {
    id: v.reqId, machine: machine(), filament: filament(), process: proc(),
    plate: { ...v.plate, objects: v.plate.objects.map((o) => ({ ...o, mask: { ...o.mask, regions: o.mask.regions.map((r) => ({ ...r, weight: r.weight.slice() })) } })) },
    meshes: Object.fromEntries([...used].map((id) => [id, meshes[id]])),
  };
  v.worker.postMessage(req);
  renderStatus(); renderPlateBar();
}
function onSliced(v: PlateView, d: SliceResponse) {
  if (d.id !== v.reqId) return;
  if (!d.ok) { v.status = "error"; v.error = d.error; renderStatus(); renderPlateBar(); return; }
  v.result = { ...d, key: v.pendingKey! }; v.status = "done";
  redrawPaths(v); renderStatus(); renderPlateBar();
}
let sliceTimer = 0;
const sliceActiveSoon = (ms = 150) => { clearTimeout(sliceTimer); sliceTimer = window.setTimeout(() => slice(activeView()), ms); };
const sliceAll = () => views.forEach(slice);

// ======================= pointer tools: select / move / paint =======================
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), nrm = new THREE.Vector3();
const bedPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let dragging: null | "paint" | { dx: number; dy: number } = null;
function setRay(ev: PointerEvent) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function bedPoint(): THREE.Vector2 | null { // in active plate coordinates (mm from bed centre)
  const p = ray.ray.intersectPlane(bedPlane, new THREE.Vector3());
  if (!p) return null;
  const o = plateOrigin(ui.active);
  return new THREE.Vector2(p.x - o.x, p.y - o.y);
}
function pickObject(p: THREE.Vector2): number {
  let best = -1, bestD = Infinity;
  activeView().plate.objects.forEach((o, k) => {
    const d = Math.hypot(o.transform.x - p.x, o.transform.y - p.y);
    if (d <= footprint(o, bodyOf(o), proc()) && d < bestD) { best = k; bestD = d; }
  });
  return best;
}
function paintAt() {
  const ov = activeObjView();
  if (!ov?.surface || ui.target < 0 || activeView().plate.locked) return;
  const hit = ray.intersectObject(ov.surface).find((h) => h.face && nrm.copy(h.face.normal).transformDirection(ov.surface!.matrixWorld).dot(ray.ray.direction) < 0);
  if (!hit?.uv) return;
  stamp(ov.obj.mask, ui.target, hit.uv.x, hit.uv.y, ui.brush, ui.tool === "erase");
  ov.maskVersion++; refreshMaskTexture(ov);
}
renderer.domElement.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 || !activeView()) return;
  setRay(ev);
  if ((ui.tool === "paint" || ui.tool === "erase") && ui.target >= 0) { dragging = "paint"; controls.enabled = false; paintAt(); return; }
  const p = bedPoint(); if (!p) return;
  const k = pickObject(p);
  if (k >= 0 && k !== ui.activeObj) selectObject(k);
  if (ui.tool === "move" && k >= 0 && !activeView().plate.locked) {
    const t = activeView().plate.objects[k].transform;
    dragging = { dx: t.x - p.x, dy: t.y - p.y }; controls.enabled = false;
  }
});
renderer.domElement.addEventListener("pointermove", (ev) => {
  if (!dragging) return;
  setRay(ev);
  if (dragging === "paint") { paintAt(); return; }
  const p = bedPoint(), ov = activeObjView(); if (!p || !ov) return;
  ov.obj.transform.x = Math.round((p.x + dragging.dx) * 10) / 10; ov.obj.transform.y = Math.round((p.y + dragging.dy) * 10) / 10;
  placeObj(ov);
  for (const l of activeView().lines) l.visible = false; // stale until re-slice
});
window.addEventListener("pointerup", () => {
  if (!dragging) return;
  dragging = null; controls.enabled = true; renderPanel(); sliceActiveSoon(0);
});

// ======================= plates & objects =======================
function addPlate(p = newPlate(`Plate ${views.length + 1}`)) {
  const v = makeView(p); views.push(v);
  ui.active = views.length - 1; ui.activeObj = 0; ui.target = -1;
  layoutPlates(); focusActive(); slice(v); renderAll();
}
function deletePlate(i: number) {
  if (views.length <= 1 || views[i].plate.locked) return;
  disposeView(views[i]); views.splice(i, 1);
  ui.active = Math.min(ui.active, views.length - 1); ui.activeObj = 0; ui.target = -1;
  layoutPlates(); focusActive(); renderAll();
}
function selectPlate(i: number) { ui.active = i; ui.activeObj = 0; ui.target = -1; layoutPlates(); views.forEach(redrawPaths); focusActive(); renderAll(); }
function selectObject(k: number) { ui.activeObj = k; ui.target = -1; updateSurfaceVisibility(); redrawPaths(activeView()); renderAll(); }
function addObject(o: PlateObject, arrange = true) {
  const v = activeView(); if (v.plate.locked) return;
  v.plate.objects.push(o); v.objs.push(makeObjView(v, o));
  ui.activeObj = v.plate.objects.length - 1; ui.target = -1;
  if (arrange) arrange_(v); else layoutPlates();
  updateSurfaceVisibility(); slice(v); renderAll();
}
function deleteObject(k: number) {
  const v = activeView(); if (v.plate.locked) return;
  disposeObjView(v, v.objs[k]); v.objs.splice(k, 1); v.plate.objects.splice(k, 1);
  ui.activeObj = Math.max(0, Math.min(ui.activeObj, v.objs.length - 1)); ui.target = -1;
  updateSurfaceVisibility(); slice(v); renderAll();
}
function arrange_(v: PlateView): string[] {
  if (v.plate.locked) return [];
  const failed = arrangePlate(v.plate, v.plate.objects.map(bodyOf), machine(), proc());
  v.objs.forEach(placeObj);
  return failed;
}
function arrangeAndReport(vs: PlateView[]) {
  const failed = vs.flatMap((v) => arrange_(v).map((n) => `${v.plate.name}: ${n}`));
  vs.forEach(slice); renderAll();
  if (failed.length) alert(`Could not fit on the bed (with toolhead clearance):\n${failed.join("\n")}`);
}
function focusActive() {
  const o = plateOrigin(ui.active), v = activeView();
  const h = Math.max(20, ...v.plate.objects.map((ob) => bodyOf(ob).height * ob.transform.scaleZ));
  const delta = camera.position.clone().sub(controls.target);
  controls.target.set(o.x, o.y, h / 2); camera.position.copy(controls.target).add(delta);
}
// ---- imports (parsed in the IO worker; OCCT loads lazily for STEP) ----
const ioWorker = new Worker(new URL("./ioWorker.ts", import.meta.url), { type: "module" });
let ioSeq = 0;
const ioPending = new Map<number, (r: IOResponse) => void>();
ioWorker.onmessage = (ev: MessageEvent<IOResponse>) => { ioPending.get(ev.data.id)?.(ev.data); ioPending.delete(ev.data.id); };
async function parseInWorker(file: File): Promise<ImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer()), id = ++ioSeq;
  const res = await new Promise<IOResponse>((resolve) => {
    ioPending.set(id, resolve);
    ioWorker.postMessage({ id, name: file.name, bytes, bed: machine().bed } satisfies IORequest, [bytes.buffer]);
  });
  if (!res.ok) throw new Error(res.error);
  return res.result;
}
const newMeshId = () => `mesh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
function meshObject(m: Mesh): PlateObject {
  const id = newMeshId(), n = normalizeMesh(m);
  meshes[id] = n;
  const o = newObject({ kind: "mesh", meshId: id }, n.name);
  o.base = { pattern: "none", params: { ...patterns.none.defaults } };
  if (n.paint?.color?.some(Boolean)) {
    const r = paintMeshToMask(n, bodyOf(o), o.mask);
    for (let k = 0; k < o.mask.regions.length; k++) o.regionParams[k] = { ...patterns[o.mask.regions[k].pattern].defaults };
    if (r.facets) notes.push(`${n.name}: ${r.facets} colour-painted facets → paint regions 1–${r.maxState} (set each region's texture in Wall pattern → Target)`);
  }
  return o;
}
const notes: string[] = [];
async function importFiles(files: FileList | File[]) {
  notes.length = 0;
  for (const f of Array.from(files)) {
    try {
      const ext = f.name.toLowerCase().split(".").pop();
      if (ext === "nexspiro") { applyProject(readProjectArchive(new Uint8Array(await f.arrayBuffer())), "replace"); continue; }
      status(`Importing ${f.name}…`);
      const r = await parseInWorker(f);
      notes.push(...r.warnings.map((w) => `${f.name}: ${w}`));
      if (r.kind === "meshes") {
        for (const m of r.meshes) {
          const b = bounds(m.tris);
          addObject(meshObject(m));
          console.info(`Imported ${m.name}: ${m.tris.length / 9} triangles, ${(b.max[0] - b.min[0]).toFixed(1)}×${(b.max[1] - b.min[1]).toFixed(1)}×${(b.max[2] - b.min[2]).toFixed(1)} mm`);
        }
      } else if (r.kind === "3mf") apply3MF(r.data, f.name);
      else if (r.kind === "presets") addPresets(r.presets);
      else applyProject(r.project, "replace");
    } catch (e) { notes.push(`${f.name}: ${e instanceof Error ? e.message : e}`); }
  }
  renderAll();
  if (notes.length) alert(notes.join("\n"));
}
function addPresets(ps: Preset[]) {
  for (const p of ps) { registry.add(p); ui.selected[p.kind] = p.id; delete ui.edited[p.kind]; }
  persistUserPresets();
  if (ps.length) { notes.push(`Imported presets: ${ps.map((p) => `${p.name} (${p.kind})`).join(", ")}`); onPresetsChanged(); }
}
function apply3MF(d: Imported3MF, file: string) {
  if (d.project) { applyProject(d.project, "append"); notes.push(`${file}: NexSpiro project restored from the 3MF`); return; }
  addPresets(d.presets);
  const first = views.length;
  d.plates.forEach((pl, i) => {
    const objs = d.objects.filter((o) => o.plate === i).map((io) => { const o = meshObject(io.mesh); o.transform.x = io.x; o.transform.y = io.y; return o; });
    if (!objs.length) return;
    const plate = newPlate(`${pl.name} (${file})`, objs); plate.locked = pl.locked;
    const v = makeView(plate); views.push(v);
  });
  ui.active = Math.min(first, views.length - 1); ui.activeObj = 0; ui.target = -1;
  layoutPlates(); focusActive(); sliceAll();
}
function applyProject(proj: Project, mode: "replace" | "append") {
  for (const p of proj.userPresets) registry.add(p);
  persistUserPresets();
  if (mode === "replace") {
    for (const k of ["machine", "filament", "process"] as const) if (registry.get(proj.presets[k])) ui.selected[k] = proj.presets[k];
    ui.edited = {};
    views.splice(0).forEach(disposeView);
  }
  Object.assign(meshes, proj.meshes);
  const first = views.length;
  for (const p of proj.plates) views.push(makeView(p));
  ui.active = mode === "replace" ? 0 : first; ui.activeObj = 0; ui.target = -1;
  layoutPlates(); focusActive(); sliceAll(); renderAll();
}
function status(msg: string) { statsEl.textContent = msg; }

let clipboard: PlateObject | null = null;
window.addEventListener("keydown", (ev) => {
  if ((ev.target as HTMLElement).closest("input, textarea, select")) return;
  const mod = ev.ctrlKey || ev.metaKey, ov = activeObjView();
  if (mod && ev.key === "c" && ov) clipboard = cloneObject(ov.obj);
  else if (mod && ev.key === "v" && clipboard) addObject(cloneObject(clipboard));
  else if (mod && ev.key === "d" && ov) addObject(cloneObject(ov.obj));
  else if ((ev.key === "Delete" || ev.key === "Backspace") && ov) deleteObject(ui.activeObj);
  else if (ev.key === "a" && !mod) arrangeAndReport([activeView()]);
  else if (ev.key === "m" && !mod) { ui.tool = ui.tool === "move" ? "orbit" : "move"; renderPanel(); }
  else return;
  ev.preventDefault();
});

// ======================= project I/O & export =======================
function download(name: string, data: string | Uint8Array, type = "application/octet-stream") {
  const part: BlobPart = typeof data === "string" ? data : (data.slice().buffer as ArrayBuffer);
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([part], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function currentProject(): Project {
  return { version: 2, presets: { ...ui.selected } as never, userPresets: registry.user(), plates: views.map((v) => v.plate), meshes };
}
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function plateThumb(v: PlateView): Uint8Array | undefined {
  const t = thumbnails(v, [[300, 300]])[0];
  return t ? b64ToBytes(t.pngBase64) : undefined;
}
function saveProject() {
  download("project.nexspiro", writeProjectArchive(currentProject(), views.map((v) => plateThumb(v) ?? new Uint8Array())), "application/zip");
}
function presetNames() {
  return { machine: registry.get(ui.selected.machine)!.name, filament: registry.get(ui.selected.filament)!.name, process: registry.get(ui.selected.process)!.name };
}
function selectedObjectMesh(): Mesh | null {
  const ov = activeObjView(); if (!ov) { alert("Select an object first."); return null; }
  const o = ov.obj, src = o.source.kind === "mesh" ? meshes[o.source.meshId] : tessellateBody(bodyOf(o), o.name);
  const M = machine();
  return transformMesh(src, o.transform, [M.bed[0] / 2, M.bed[1] / 2]);
}
function doExport() {
  const v = activeView(), M = machine(), name = v.plate.name.replace(/\W+/g, "_"), off: [number, number] = [M.bed[0] / 2, M.bed[1] / 2];
  const sliced = () => { if (!v.result || v.status !== "done") { alert("Slice the plate first."); return null; } return v.result; };
  try {
    switch (ui.exportFormat) {
      case "gcode": return exportGcode();
      case "nexspiro": return saveProject();
      case "3mf": {
        const thumbs = views.map((pv) => plateThumb(pv) ?? new Uint8Array());
        const bytes = export3MF({
          plates: views.map((pv) => pv.plate), meshes, bed: M.bed,
          projectSettings: toBambuSettings({ machine: M, filament: filament() as never, process: proc() as never }, presetNames()),
          nexspiroArchive: writeProjectArchive(currentProject()), thumbnails: thumbs,
        });
        return download("project.3mf", bytes, "model/3mf");
      }
      case "stl": { const m = selectedObjectMesh(); if (m) download(`${m.name}.stl`, writeSTL([m]), "model/stl"); return; }
      case "obj": { const m = selectedObjectMesh(); if (m) download(`${m.name}.obj`, writeOBJ([m]), "model/obj"); return; }
      case "baked": {
        const r = sliced(); if (!r) return;
        const P = proc();
        const walls = r.mps.map((mp, k) => transformMesh(bakeToolpath(mp, P.lineWidth, P.layerHeight, v.plate.objects[k]?.name ?? `wall_${k}`), { x: 0, y: 0, scaleXY: 1, scaleZ: 1, rotation: 0 }, off));
        return download(`${name}-baked.stl`, writeSTL(walls, "NexSpiro baked textured wall"), "model/stl");
      }
      case "csv": { const r = sliced(); if (r) download(`${name}-trajectory.csv`, trajectoryCSV(r.order.map((k) => r.mps[k]), off), "text/csv"); return; }
      case "json": { const r = sliced(); if (r) download(`${name}-trajectory.json`, trajectoryJSON(r.order.map((k) => r.mps[k]), off), "application/json"); return; }
    }
  } catch (e) { alert(`Export failed: ${e instanceof Error ? e.message : e}`); }
}
function thumbnails(v: PlateView, sizes: readonly (readonly [number, number])[] = [[32, 32], [300, 300], [600, 600]]): Thumbnail[] {
  const out: Thumbnail[] = [];
  const hidden = views.filter((o) => o !== v).map((o) => { const was = o.group.visible; o.group.visible = false; return [o, was] as const; });
  if (!v.lines.length) return out;
  const extras: THREE.Object3D[] = [v.bed, ...v.objs.flatMap((o) => [o.surface, o.footprintRing].filter(Boolean) as THREE.Object3D[]), ...v.lines.filter((l) => l.userData.lod === "far")];
  const vis = extras.map((o) => o.visible); extras.forEach((o) => (o.visible = false));
  const full = v.lines.filter((l) => l.userData.lod === "full"), fullVis = full.map((l) => l.visible); full.forEach((l) => (l.visible = true));
  const prevBg = scene.background; scene.background = null;
  const box = new THREE.Box3(); full.forEach((l) => box.expandByObject(l));
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 50;
  const cam = new THREE.PerspectiveCamera(35, 1, 0.5, 5000); cam.up.set(0, 0, 1);
  cam.position.copy(c).add(new THREE.Vector3(1, -1, 0.8).normalize().multiplyScalar(r / Math.sin((17.5 * Math.PI) / 180))); cam.lookAt(c);
  const tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  for (const [w, h] of sizes) { tr.setSize(w, h, false); tr.render(scene, cam); out.push({ width: w, height: h, pngBase64: tr.domElement.toDataURL("image/png").split(",")[1] }); }
  tr.dispose();
  scene.background = prevBg; extras.forEach((o, i) => (o.visible = vis[i])); full.forEach((l, i) => (l.visible = fullVis[i]));
  hidden.forEach(([o, was]) => (o.group.visible = was));
  return out;
}
function exportGcode(i = ui.active) {
  const v = views[i];
  if (!v.result || v.status !== "done") { alert("Slice the plate first."); return; }
  if (v.result.issues.some((x) => x.level === "error") && !confirm("This plate has errors. Export anyway?")) return;
  const M = machine();
  let g: string;
  try { g = toGcode(v.result.order.map((k) => v.result!.mps[k]), {
    machine: M, filament: filament(), process: proc(), offset: [M.bed[0] / 2, M.bed[1] / 2], thumbnails: thumbnails(v), presetNames: presetNames(),
  }); } catch (e) { alert(`G-code export refused: ${e instanceof Error ? e.message : e}`); return; }
  download(`${v.plate.name.replace(/\W+/g, "_")}.gcode`, g, "text/plain");
}

// ======================= UI =======================
const panel = document.getElementById("panel")!, statsEl = document.getElementById("stats")!;
const PARAM_UI: [keyof PatternParams, string, number, number, number][] = [
  ["amplitude", "Amplitude mm", 0, 4, 0.05], ["wavesPerRev", "Waves / rev", 0, 200, 1],
  ["phasePerLayer", "Phase / layer °", 0, 360, 1], ["zAmplitude", "Z wobble mm", 0, 1.5, 0.01],
  ["extrusionPulse", "Extrusion pulse", 0, 1, 0.01],
];
const TOOLS: [typeof ui.tool, string, string][] = [["orbit", "Select", "Click an object's footprint to select"], ["move", "Move (M)", "Drag objects on the bed"], ["paint", "Paint", "Paint the selected region"], ["erase", "Erase", "Erase the selected region"]];

function renderPrepareTab() {
  const v = activeView(), p = v.plate, dis = p.locked ? " disabled" : "";
  const objList = p.objects.map((o, k) => `<div class="obj${k === ui.activeObj ? " on" : ""}" data-obj="${k}">
      <span>${o.source.kind === "mesh" ? "▲" : "●"} ${esc(o.name)}</span>
      <span><button data-objdup="${k}" title="Duplicate"${dis}>⧉</button><button data-objdel="${k}" title="Delete"${dis}>✕</button></span></div>`).join("");
  let html = `
    <h2>Plate · ${esc(p.name)}${p.locked ? " 🔒" : ""}</h2>
    <div class="objlist">${objList || '<div class="muted">Empty plate</div>'}</div>
    <label class="file-btn${p.locked ? " disabled" : ""}" title="STL, OBJ, PLY, 3MF, STEP/STP, .nexspiro, Bambu/Orca JSON or PrusaSlicer INI profiles">Import…<input type="file" id="importFile" accept="${ACCEPT}" multiple hidden${dis}></label>
    <select id="addPrim"${dis}><option value="">+ Add primitive…</option>${Object.keys(primitives).map((k) => opt(k, k, false)).join("")}</select>
    <div><button id="arrange"${dis}>Arrange plate (A)</button><button id="arrangeAll">Arrange all</button></div>
    <div class="tools">${TOOLS.map(([t, l, title]) => `<button data-tool="${t}" title="${title}" class="${ui.tool === t ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const o = p.objects[ui.activeObj];
  if (o) {
    const P = ui.target < 0 ? o.base.params : o.regionParams[ui.target];
    const pat = ui.target < 0 ? o.base.pattern : o.mask.regions[ui.target].pattern;
    html += `
    <h2>Object · ${esc(o.name)}</h2>
    <label>X mm <input type="number" data-tf="x" step="1" value="${o.transform.x}"${dis}></label>
    <label>Y mm <input type="number" data-tf="y" step="1" value="${o.transform.y}"${dis}></label>
    <label>Scale XY % <input type="number" data-tf="scaleXY" step="1" min="10" max="400" value="${Math.round(o.transform.scaleXY * 100)}"${dis}></label>
    <label>Scale Z % <input type="number" data-tf="scaleZ" step="1" min="10" max="400" value="${Math.round(o.transform.scaleZ * 100)}"${dis}></label>
    <label>Rotate Z ° <input type="number" data-tf="rotation" step="5" value="${o.transform.rotation}"${dis}></label>

    <h2>Wall pattern</h2>
    <label>Target <select id="target">${opt("-1", "Base wall", ui.target < 0)}${o.mask.regions.map((_, k) => opt(String(k), `Region ${k + 1}`, k === ui.target)).join("")}</select></label>
    <label>Pattern <select id="pattern"${dis}>${Object.entries(patterns).map(([k, x]) => opt(k, x.label, k === pat)).join("")}</select></label>
    ${PARAM_UI.map(([k, l, mn, mx, st]) => `<label>${l} <input type="range" data-param="${k}" min="${mn}" max="${mx}" step="${st}" value="${P[k]}"${dis}><span class="v">${P[k]}</span></label>`).join("")}

    <h2>Paint regions</h2>
    ${o.mask.regions.map((r, k) => `<div><span class="swatch" style="background:#${REGION_COLORS[k % REGION_COLORS.length].toString(16).padStart(6, "0")}"></span>Region ${k + 1} · ${patterns[r.pattern].label}</div>`).join("") || '<div class="muted">No regions. The whole wall uses the base pattern.</div>'}
    <button id="addRegion"${dis}>+ Add region</button>
    <label>Brush size <input type="range" id="brush" min="1" max="40" step="1" value="${ui.brush}"><span class="v">${ui.brush}</span></label>
    <label>Show paint surface <input type="checkbox" id="showSurface"${ui.showSurface ? " checked" : ""}></label>`;
  }
  html += `
    <h2>Preview</h2>
    <label>Color by <select id="previewMode">${(Object.keys(PREVIEW_LABELS) as PreviewMode[]).map((m) => opt(m, PREVIEW_LABELS[m], m === ui.preview)).join("")}</select></label>
    <label>Layer from <input type="range" id="layerMin" min="0" max="1" step="0.001" value="${ui.layerMin}"></label>
    <label>Layer to <input type="range" id="layerMax" min="0" max="1" step="0.001" value="${ui.layerMax}"></label>`;
  return html;
}
function machineGeometryUI(m: MachinePreset) {
  return `<h2>Machine geometry</h2>
    <label class="file-btn" title="Hotend + carriage mesh, nozzle tip lowest">Toolhead mesh (STL/STEP)…<input type="file" id="toolheadFile" accept=".stl,.step,.stp,.obj,.3mf" hidden></label>
    <label class="file-btn" title="Polygons/rects/straight paths in mm, origin top-left">Bed exclusion SVG…<input type="file" id="excludeFile" accept=".svg" hidden></label>
    <label class="file-btn">Bed texture PNG…<input type="file" id="bedPng" accept="image/png,image/jpeg" hidden></label>
    <div class="muted">${(m.bedExclude ?? []).length} exclusion zone(s)${(m.bedExclude ?? []).length ? ' <button id="clearExclude">Clear</button>' : ""}</div>`;
}
function editMachine(patch: Partial<MachinePreset>) {
  ui.edited.machine = { ...structuredClone(machine()), ...patch };
  onPresetsChanged();
}
function renderPresetTab(kind: PresetKind) {
  const vals = presetValues(kind) as unknown as Record<string, unknown>, dirty = !!ui.edited[kind];
  const cur = registry.get(ui.selected[kind])!;
  const list = registry.list(kind);
  return `
    <label>Preset <select id="presetSel">${list.map((p) => opt(p.id, `${p.system ? "" : "★ "}${p.name}`, p.id === ui.selected[kind])).join("")}</select></label>
    <div class="muted">${cur.inherits ? `inherits ${registry.get(cur.inherits)?.name ?? cur.inherits}` : "root preset"}${dirty ? ' · <span class="warn">modified</span>' : ""}</div>
    <button id="presetSave" class="primary">Save as…</button>${dirty ? '<button id="presetRevert">Revert</button>' : ""}${!cur.system ? '<button id="presetDelete">Delete</button>' : ""}
    <label class="file-btn" title="Bambu Studio / OrcaSlicer .json or PrusaSlicer .ini">Import profile…<input type="file" id="profileFile" accept=".json,.ini" multiple hidden></label>
    ${kind === "machine" ? machineGeometryUI(vals as unknown as MachinePreset) : ""}
    ${GROUPS[kind].map(([g, keys]) => `<h2>${g}</h2>${keys.map((k) => field(k, getPath(vals, k))).join("")}`).join("")}`;
}


function renderPanel() {
  const tabs: [typeof ui.tab, string][] = [["prepare", "Prepare"], ["machine", "Printer"], ["filament", "Filament"], ["process", "Process"]];
  panel.innerHTML = `
    <div class="tabs">${tabs.map(([t, l]) => `<button data-tab="${t}" class="${ui.tab === t ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="summary">
      <div>🖨 ${esc(registry.get(ui.selected.machine)!.name)}${ui.edited.machine ? "*" : ""}</div>
      <div>🧵 ${esc(registry.get(ui.selected.filament)!.name)}${ui.edited.filament ? "*" : ""}</div>
      <div>⚙ ${esc(registry.get(ui.selected.process)!.name)}${ui.edited.process ? "*" : ""}</div>
    </div>
    ${ui.tab === "prepare" ? renderPrepareTab() : renderPresetTab(ui.tab)}
    <h2>Project</h2>
    <button id="slicePlate" class="primary">Slice plate</button><button id="sliceAll">Slice all</button>
    <h2>Export</h2>
    <label>Format <select id="exportFormat">${(Object.keys(EXPORT_LABELS) as ExportFormat[]).filter((f) => ui.developer || (f !== "csv" && f !== "json")).map((f) => opt(f, EXPORT_LABELS[f], f === ui.exportFormat)).join("")}</select></label>
    <button id="export" class="primary">Export</button>
    <button id="saveProject">Save project</button><button id="openProject">Open…</button>
    <label>Developer mode <input type="checkbox" id="developer"${ui.developer ? " checked" : ""}></label>
    <input type="file" id="projectFile" accept=".nexspiro,.3mf,application/json" hidden>`;
  bindPanel();
}

function renderPlateBar() {
  let bar = document.getElementById("plates");
  if (!bar) { bar = document.createElement("div"); bar.id = "plates"; view.append(bar); }
  bar.innerHTML = views.map((v, i) => {
    const st = v.status === "done" ? (v.result!.issues.some((x) => x.level === "error") ? "⚠" : "✓") : v.status === "slicing" ? "…" : v.status === "error" ? "✕" : "";
    return `<div class="plate${i === ui.active ? " on" : ""}" data-plate="${i}">
      <span>${esc(v.plate.name)} (${v.plate.objects.length}) ${st}</span>
      <button data-lock="${i}" title="Lock plate">${v.plate.locked ? "🔒" : "🔓"}</button>
      <button data-dup="${i}" title="Duplicate plate">⧉</button>
      <button data-del="${i}" title="Delete plate"${views.length < 2 || v.plate.locked ? " disabled" : ""}>✕</button></div>`;
  }).join("") + `<button id="addPlate">+ Plate</button>`;
  bar.querySelectorAll<HTMLElement>("[data-plate]").forEach((el) => el.onclick = (e) => { if (!(e.target as HTMLElement).closest("button")) selectPlate(Number(el.dataset.plate)); });
  bar.querySelectorAll<HTMLElement>("[data-lock]").forEach((el) => el.onclick = () => { const v = views[Number(el.dataset.lock)]; v.plate.locked = !v.plate.locked; layoutPlates(); renderAll(); });
  bar.querySelectorAll<HTMLElement>("[data-dup]").forEach((el) => el.onclick = () => addPlate(clonePlate(views[Number(el.dataset.dup)].plate)));
  bar.querySelectorAll<HTMLElement>("[data-del]").forEach((el) => el.onclick = () => deletePlate(Number(el.dataset.del)));
  document.getElementById("addPlate")!.onclick = () => addPlate();
}

const stats = { fps: 0 };
function renderStatus() {
  const v = activeView(); if (!v) return;
  const r = v.result, M = machine();
  let s = `${v.plate.name} · ${v.status}${v.status === "error" ? ": " + esc(v.error ?? "") : ""} · ${stats.fps.toFixed(0)} fps\n`;
  if (r && v.status !== "error") {
    s += `${formatDuration(r.stats.timeS)} · ${r.stats.grams.toFixed(1)} g · ${(r.stats.filamentMm / 1000).toFixed(2)} m · ${r.stats.layers} layers · cost ${r.stats.cost.toFixed(2)}\n`;
    const moves = r.mps.reduce((a, m) => a + m.count, 0), dec = r.mps.reduce((a, m) => a + m.decimated, 0);
    s += `${r.mps.length} object${r.mps.length > 1 ? "s (sequential: " + r.order.map((k) => esc(v.plate.objects[k]?.name ?? "?")).join(" → ") + ")" : ""} · ${moves.toLocaleString()} moves (${dec.toLocaleString()} decimated) · ${r.ms.toFixed(0)} ms\n`;
    if (ui.preview !== "feature") { const [lo, hi, unit] = legendRange(r.mps, ui.preview); s += `${PREVIEW_LABELS[ui.preview]}: <span style="color:hsl(240,85%,60%)">${lo.toFixed(1)}</span> → <span style="color:hsl(0,85%,60%)">${hi.toFixed(1)}</span> ${unit}\n`; }
    if (r.zClipped) s += `<span class="warn">Z wobble capped at ±${M.zWobbleMax} mm on ${r.zClipped.toLocaleString()} points</span>\n`;
    const inc = r.mps.reduce((a, m) => a + m.inclinationViolations, 0);
    if (inc) s += `<span class="warn">${inc.toLocaleString()} segments exceed max inclination ${proc().nonLinear.maxInclination}°</span>\n`;
    for (const i of r.issues) s += `<span class="${i.level === "error" ? "err" : "warn"}">${esc(i.message)}</span>\n`;
  }
  statsEl.innerHTML = s;
}
function renderAll() { renderPanel(); renderPlateBar(); renderStatus(); }

function bindPanel() {
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T | null;
  panel.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.onclick = () => { ui.tab = b.dataset.tab as typeof ui.tab; renderPanel(); });
  const v = activeView();
  const changed = () => { renderStatus(); sliceActiveSoon(); };

  if (ui.tab === "prepare") {
    panel.querySelectorAll<HTMLElement>("[data-obj]").forEach((el) => el.onclick = (e) => { if (!(e.target as HTMLElement).closest("button")) selectObject(Number(el.dataset.obj)); });
    panel.querySelectorAll<HTMLElement>("[data-objdup]").forEach((el) => el.onclick = () => addObject(cloneObject(v.plate.objects[Number(el.dataset.objdup)])));
    panel.querySelectorAll<HTMLElement>("[data-objdel]").forEach((el) => el.onclick = () => deleteObject(Number(el.dataset.objdel)));
    $("importFile")!.onchange = (e) => { const fl = (e.target as HTMLInputElement).files; if (fl?.length) importFiles(fl); };
    $<HTMLSelectElement>("addPrim")!.onchange = (e) => { const k = (e.target as HTMLSelectElement).value as PrimitiveName; if (k) addObject(newObject({ kind: "primitive", primitive: k })); };
    $("arrange")!.onclick = () => arrangeAndReport([v]);
    $("arrangeAll")!.onclick = () => arrangeAndReport(views);
    panel.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => b.onclick = () => {
      ui.tool = b.dataset.tool as typeof ui.tool;
      if ((ui.tool === "paint" || ui.tool === "erase") && ui.target < 0) alert("Add or select a paint region first (Wall pattern → Target).");
      renderPanel();
    });
    const ov = activeObjView();
    if (ov) {
      const o = ov.obj;
      panel.querySelectorAll<HTMLInputElement>("[data-tf]").forEach((el) => el.onchange = () => {
        const k = el.dataset.tf as keyof typeof o.transform, n = Number(el.value);
        o.transform[k] = k === "scaleXY" || k === "scaleZ" ? Math.max(0.1, n / 100) : n;
        buildSurface(ov); placeObj(ov); changed();
      });
      $<HTMLSelectElement>("target")!.onchange = (e) => { ui.target = Number((e.target as HTMLSelectElement).value); renderPanel(); };
      $<HTMLSelectElement>("pattern")!.onchange = (e) => {
        const name = (e.target as HTMLSelectElement).value, defs = { ...patterns[name].defaults };
        if (ui.target < 0) o.base = { pattern: name, params: defs }; else { o.mask.regions[ui.target].pattern = name; o.regionParams[ui.target] = defs; }
        buildSurface(ov); renderPanel(); changed();
      };
      panel.querySelectorAll<HTMLInputElement>("input[data-param]").forEach((inp) => inp.oninput = () => {
        (ui.target < 0 ? o.base.params : o.regionParams[ui.target])[inp.dataset.param as keyof PatternParams] = Number(inp.value);
        (inp.nextElementSibling as HTMLElement).textContent = inp.value; changed();
      });
      $("addRegion")!.onclick = () => { const k = addRegion(o.mask, "sine"); o.regionParams[k] = { ...patterns.sine.defaults }; ui.target = k; ui.tool = "paint"; renderPanel(); };
      $("brush")!.oninput = (e) => { const el = e.target as HTMLInputElement; ui.brush = Number(el.value); (el.nextElementSibling as HTMLElement).textContent = el.value; };
      $("showSurface")!.onchange = (e) => { ui.showSurface = (e.target as HTMLInputElement).checked; updateSurfaceVisibility(); };
    }
    $<HTMLSelectElement>("previewMode")!.onchange = (e) => { ui.preview = (e.target as HTMLSelectElement).value as PreviewMode; views.forEach(redrawPaths); renderStatus(); };
    $("layerMin")!.oninput = (e) => { ui.layerMin = Math.min(Number((e.target as HTMLInputElement).value), ui.layerMax); views.forEach(applyLayerRange); };
    $("layerMax")!.oninput = (e) => { ui.layerMax = Math.max(Number((e.target as HTMLInputElement).value), ui.layerMin); views.forEach(applyLayerRange); };
  } else {
    const kind = ui.tab;
    $<HTMLSelectElement>("presetSel")!.onchange = (e) => { ui.selected[kind] = (e.target as HTMLSelectElement).value; delete ui.edited[kind]; onPresetsChanged(); };
    panel.querySelectorAll<HTMLInputElement>("[data-path]").forEach((el) => el.onchange = () => {
      const edited = structuredClone(presetValues(kind)) as unknown as Record<string, unknown>;
      const val = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.dataset.array ? el.value.split(",").map(Number) : el.value;
      setPath(edited, el.dataset.path!, val);
      ui.edited[kind] = edited as never;
      onPresetsChanged();
    });
    $("presetSave")!.onclick = () => {
      const name = prompt("Preset name", `${registry.get(ui.selected[kind])!.name} (custom)`); if (!name) return;
      const cur = registry.get(ui.selected[kind])!, parent = cur.system ? cur.id : cur.inherits ?? cur.id;
      const id = `user/${kind}/${name.toLowerCase().replace(/\W+/g, "-")}`;
      registry.saveDelta(id, name, kind, parent, presetValues(kind) as never);
      ui.selected[kind] = id; delete ui.edited[kind]; persistUserPresets(); onPresetsChanged();
    };
    $("profileFile")!.onchange = (e) => { const fl = (e.target as HTMLInputElement).files; if (fl?.length) importFiles(fl); };
    const th = $("toolheadFile"); if (th) th.onchange = async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      try {
        const r = await parseInWorker(f);
        const mesh = r.kind === "meshes" ? r.meshes[0] : r.kind === "3mf" ? r.data.objects[0]?.mesh : undefined;
        if (!mesh) throw new Error("No geometry in file");
        const g = prompt("Gantry height above nozzle tip (mm). Geometry above it is treated as gantry, not toolhead:", String(machine().clearanceHeight));
        if (g === null) return;
        const env = toolheadEnvelope(mesh, Number(g) > 0 ? Number(g) : undefined);
        editMachine({ clearanceRadius: env.clearanceRadius, clearanceHeight: env.clearanceHeight });
        alert(`Toolhead envelope: radius ${env.clearanceRadius} mm, gantry ${env.clearanceHeight} mm.\nRadius by height: ${env.profile.map((b) => `${b.z}mm:${b.r.toFixed(0)}`).join(" ")}\nSave the printer preset to keep it.`);
      } catch (err) { alert(`Toolhead import failed: ${err instanceof Error ? err.message : err}`); }
    };
    const ex = $("excludeFile"); if (ex) ex.onchange = async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      try { const r = parseBedExclusionSVG(await f.text()); editMachine({ bedExclude: r.polygons }); if (r.warnings.length) alert(r.warnings.join("\n")); }
      catch (err) { alert(`Bed exclusion import failed: ${err instanceof Error ? err.message : err}`); }
    };
    const ce = $("clearExclude"); if (ce) ce.onclick = () => editMachine({ bedExclude: [] });
    const bp = $("bedPng"); if (bp) bp.onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      const url = URL.createObjectURL(f);
      new THREE.TextureLoader().load(url, (t) => { bedTexture = t; layoutPlates(); }, undefined, () => alert("Could not read image"));
    };
    const rev = $("presetRevert"); if (rev) rev.onclick = () => { delete ui.edited[kind]; onPresetsChanged(); };
    const del = $("presetDelete"); if (del) del.onclick = () => {
      const cur = registry.get(ui.selected[kind])!; registry.remove(cur.id); ui.selected[kind] = cur.inherits ?? registry.list(kind)[0].id;
      delete ui.edited[kind]; persistUserPresets(); onPresetsChanged();
    };
  }
  $("slicePlate")!.onclick = () => slice(activeView());
  $("sliceAll")!.onclick = sliceAll;
  $("export")!.onclick = doExport;
  $<HTMLSelectElement>("exportFormat")!.onchange = (e) => { ui.exportFormat = (e.target as HTMLSelectElement).value as ExportFormat; };
  $("developer")!.onchange = (e) => { ui.developer = (e.target as HTMLInputElement).checked; if (!ui.developer && (ui.exportFormat === "csv" || ui.exportFormat === "json")) ui.exportFormat = "gcode"; renderPanel(); };
  $("saveProject")!.onclick = saveProject;
  $("openProject")!.onclick = () => $("projectFile")!.click();
  $("projectFile")!.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importFiles([f]); };
}
function onPresetsChanged() { views.forEach((v) => v.objs.forEach(buildSurface)); layoutPlates(); focusActive(); renderAll(); sliceActiveSoon(); }

// drag & drop STL onto the viewport
view.addEventListener("dragover", (e) => e.preventDefault());
view.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer?.files.length) importFiles(e.dataTransfer.files); });

// ======================= loop =======================
function resize() { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(view);
let frames = 0, last = performance.now();
renderer.setAnimationLoop(() => {
  controls.update();
  for (const v of views) {
    const far = camera.position.distanceTo(v.group.position) > 450, hasLod = v.lines.some((l) => l.userData.lod === "far");
    if (!dragging) for (const l of v.lines) l.visible = !hasLod || (l.userData.lod === "far") === far;
  }
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - last > 1000) { stats.fps = (frames * 1000) / (now - last); frames = 0; last = now; renderStatus(); }
});

addPlate(newPlate("Plate 1"));
resize();
