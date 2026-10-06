import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  patterns, primitiveDefs, primitiveDefaults, buildPrimitive, PRIMITIVE_GROUPS, buildSelMesh, fillFaces, pickEdge, trianglesNearSegments, addRegion, stamp, toGcode, formatDuration, PresetRegistry, newPlate, newObject, clonePlate, cloneObject,
  objectBody, arrangePlate, footprint, normalizeMesh, bounds,
  type PatternParams, type PrimitiveName, type SelMesh, type FillMode, type Seg, type MotionPath, type SliceStats, type PlateIssue, type Plate, type PlateObject,
  type MachinePreset, type FilamentPreset, type ProcessPreset, type PresetKind, type Preset, type Thumbnail, type Mesh, type Body, type Project,
} from "../core/index.ts";
import type { SliceRequest, SliceResponse } from "./worker.ts";
import type { IORequest, IOResponse } from "./ioWorker.ts";
import { ACCEPT, type ImportResult } from "../io/importers/index.ts";
import type { Imported3MF } from "../io/importers/threemf.ts";
import { toolheadEnvelope, parseBedExclusionSVG } from "../io/importers/machineGeometry.ts";
import { toBambuSettings } from "../io/importers/profiles.ts";
import { paintMeshToMask, paintTriangles, surfaceProjector } from "../io/paintmap.ts";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PLATE_TYPES, bedLook, bedCanvasSize, BED_PAD, drawBed, defaultPlateType, type PlateType } from "./bed.ts";
import { export3MF } from "../io/exporters/threemf.ts";
import { writeProjectArchive, readProjectArchive } from "../io/exporters/project.ts";
import { writeSTL, writeOBJ, bakeToolpath, tessellateBody, profileMesh, transformMesh } from "../io/exporters/mesh.ts";
import { trajectoryCSV, trajectoryJSON } from "../io/exporters/trajectory.ts";
import { opt, esc, GROUPS, field, getPath, setPath } from "./ui.ts";
import { icon } from "./icons.ts";
import { rangeRow, numRow, switchRow, selectRow, textRow, seg, pct, materialOf, statusBadge, slicingKind, rampGradient, slug, DualSlider, type SegItem } from "./components.ts";
import { connectorFor, validatePrinter, mixedContentProblem, PRINTER_KINDS, type PrinterConfig, type PrinterStatus, type PrinterKind } from "../net/printers.ts";
import { initialTheme, setThemeAttr, PALETTE_3D, REGION_COLORS, hex, type ThemeMode } from "./theme/theme.ts";


// ======================= state =======================
type Dock = "select" | "move" | "rotate" | "scale" | "texture" | "faces" | "paint" | "arrange";
type PreviewMode = "feature" | "speed" | "height" | "layerTime" | "curvature";
const PREVIEW_LABELS: Record<PreviewMode, string> = {
  feature: "Feature type (paint region)", speed: "Speed", height: "Height", layerTime: "Layer time",
  curvature: "Curvature & Non-Linear Feedrate",
};
type SliceResult = Extract<SliceResponse, { ok: true }> & { key: string };
type ObjView = {
  obj: PlateObject; group: THREE.Group; surface: THREE.Mesh | null; solid: THREE.Mesh | null; shadow: THREE.Mesh | null; maskTex: THREE.DataTexture; maskVersion: number; footprintRing: THREE.Line | null;
  sel?: SelMesh; proj?: ReturnType<typeof surfaceProjector>; hoverMesh?: THREE.Mesh; hoverLines?: THREE.LineSegments;
};
type PlateView = {
  plate: Plate; group: THREE.Group; bed: THREE.Object3D; objs: ObjView[];
  lines: THREE.Line[]; status: "idle" | "slicing" | "done" | "error"; error?: string;
  result?: SliceResult; pendingKey?: string; worker: Worker; reqId: number; thumb?: string;
  marker: THREE.Mesh; head?: { k: number; idx: number };
};

const USER_PRESETS_KEY = "nexspiro.userPresets";
const registry = new PresetRegistry();
try { for (const p of JSON.parse(localStorage.getItem(USER_PRESETS_KEY) ?? "[]") as Preset[]) registry.add(p); } catch { /* storage unavailable */ }
const persistUserPresets = () => { try { localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(registry.user())); } catch { /* ignore */ } };

const meshes: Record<string, Mesh> = {};
const bodyCache = new Map<string, Body>();
const sourceKey = (o: PlateObject) => (o.source.kind === "mesh" ? `m:${o.source.meshId}` : `p:${o.source.primitive}:${JSON.stringify(o.source.params ?? {})}`);
function bodyOf(o: PlateObject): Body {
  const key = sourceKey(o);
  let b = bodyCache.get(key);
  if (!b) { if (bodyCache.size > 96) bodyCache.clear(); b = objectBody(o, meshes); bodyCache.set(key, b); }
  return b;
}
/** Triangles shown in the viewport and picked for faces/edges: the imported mesh, or the exact tessellation of a primitive. */
const displayCache = new Map<string, Mesh>();
function displayMesh(o: PlateObject): Mesh {
  if (o.source.kind === "mesh") return meshes[o.source.meshId];
  const key = sourceKey(o);
  let m = displayCache.get(key);
  if (!m) { if (displayCache.size > 48) displayCache.clear(); m = profileMesh(buildPrimitive(o.source.primitive, o.source.params), o.name); displayCache.set(key, m); }
  return m;
}

const ui = {
  mode: "prepare" as "prepare" | "preview" | "print",
  dock: "select" as Dock | null, modal: null as PresetKind | "printer" | null, tier: null as "quality" | "strength" | "speed" | null,
  livePaths: false, plateType: "textured-pei" as PlateType, plateTouched: false,
  faceKind: "face" as "face" | "edge", faceOp: "add" as "add" | "remove", faceFill: "flat" as FillMode, faceAngle: 25, edgeAngle: 35, edgeBand: 3, edgeChain: true,
  dragSlider: false, presetsOpen: false, nlOpen: false, drawerOpen: window.innerWidth >= 1100, uniform: true, paintErase: false,
  scrub: 1, playing: false, goPreview: false, theme: initialTheme() as ThemeMode, projectName: "Untitled project",
  selected: { machine: "machine/bambu-x1", filament: "filament/pla", process: "process/vase-0.4" } as Record<PresetKind, string>,
  edited: {} as Partial<Record<PresetKind, MachinePreset | FilamentPreset | ProcessPreset>>,
  active: 0, activeObj: 0, target: -1,
  tool: "orbit" as "orbit" | "move" | "paint" | "erase" | "faces", brush: 8, showSurface: true,
  preview: "feature" as PreviewMode, layerMin: 0, layerMax: 1,
  exportFormat: "gcode" as ExportFormat, developer: false,
  printerId: "", confirmPrint: false, netBusy: "", netMsg: null as null | { tone: "ok" | "err"; text: string },
  draft: null as null | (Partial<PrinterConfig> & { editing?: boolean; msg?: { tone: "ok" | "err"; text: string } }),
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
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
// background stays transparent: the CSS radial "studio light" gradient on #view shows through
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 10000);
camera.up.set(0, 0, 1);
camera.position.set(390, -450, 325);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(200, -150, 300); scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-250, 200, 120); scene.add(fill);

const pathMat = new THREE.LineBasicMaterial({ vertexColors: true });
const views: PlateView[] = [];
const PLATE_GAP = 60;
const plateOrigin = (i: number) => { const b = machine().bed; return new THREE.Vector3(i * (b[0] + PLATE_GAP) + b[0] / 2, b[1] / 2, 0); };

const P3 = () => PALETTE_3D[ui.theme];
const texCache = new Map<string, THREE.CanvasTexture>();
function cachedTexture(key: string, draw: (g: CanvasRenderingContext2D, n: number) => void, n = 128): THREE.CanvasTexture {
  const k = `${key}:${ui.theme}`;
  let t = texCache.get(k);
  if (!t) {
    const c = document.createElement("canvas"); c.width = c.height = n; draw(c.getContext("2d")!, n);
    t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; texCache.set(k, t);
  }
  return t;
}
/** Soft ambient-occlusion blob under each object. */
const blobTexture = () => cachedTexture("blob", (g, n) => {
  const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2), c = P3().shadow;
  gr.addColorStop(0, `${c}.34)`); gr.addColorStop(0.5, `${c}.16)`); gr.addColorStop(1, `${c}0)`);
  g.fillStyle = gr; g.fillRect(0, 0, n, n);
});
/** Diffuse drop shadow of the bed slab (blurred rounded rect, drawn via an offscreen-offset shadow). */
const slabTexture = () => cachedTexture("slab", (g, n) => {
  g.shadowColor = `${P3().shadow}.55)`; g.shadowBlur = n * 0.11; g.shadowOffsetX = 4000; g.shadowOffsetY = n * 0.02; g.fillStyle = "#000";
  const m = n * 0.19, r = n * 0.04; g.beginPath(); g.roundRect(m - 4000, m, n - 2 * m, n - 2 * m, r); g.fill();
}, 256);
function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh; m.geometry?.dispose();
    if (m.material && !Array.isArray(m.material)) { if (m.material.userData.ownMap) (m.material as THREE.MeshBasicMaterial).map?.dispose(); m.material.dispose(); }
  });
}

/** Build plate: a canvas-drawn replica of the selected printer's bed and plate type, on a soft clay slab shadow. */
function bedLines(active: boolean, locked: boolean, plateNo = 1) {
  const pal = P3(), M = machine(), [bx, by] = M.bed, hx = bx / 2, hy = by / 2, g = new THREE.Group();
  const look = bedLook(registry.get(ui.selected.machine)?.name ?? "", M.flavor, ui.plateType);
  const cv = document.createElement("canvas");
  drawBed(cv, { bed: M.bed, look, plateNo, active, locked, accent: hex(pal.bedActive), lockColor: hex(pal.bedLocked), nozzle: M.nozzle });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const { w, h } = bedCanvasSize(M.bed);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  plane.material.userData.ownMap = true;
  plane.position.set(0, -(BED_PAD.bottom - BED_PAD.top) / 2, -0.1); plane.renderOrder = -2; g.add(plane);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(bx * 1.55, by * 1.55), new THREE.MeshBasicMaterial({ map: slabTexture(), transparent: true, depthWrite: false }));
  shadow.position.set(0, -by * 0.03, -0.5); shadow.renderOrder = -3; g.add(shadow);
  const ex: number[] = []; // bed exclusion zones (bed-corner coordinates → bed-centre)
  for (const poly of M.bedExclude ?? []) poly.forEach(([x, y], i) => {
    const [nx, ny] = poly[(i + 1) % poly.length];
    ex.push(x - hx, y - hy, 0.1, nx - hx, ny - hy, 0.1);
  });
  if (ex.length) {
    const eg = new THREE.BufferGeometry(); eg.setAttribute("position", new THREE.Float32BufferAttribute(ex, 3));
    g.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: pal.exclude })));
  }
  if (bedTexture) {
    const over = new THREE.Mesh(new THREE.PlaneGeometry(bx, by), new THREE.MeshBasicMaterial({ map: bedTexture, transparent: true, opacity: 0.6, depthWrite: false }));
    over.position.z = -0.05; g.add(over);
  }
  // origin axes (X red, Y green, Z blue) at the front-left corner, as in Bambu Studio
  const ax = new THREE.BufferGeometry(); ax.setAttribute("position", new THREE.Float32BufferAttribute([-hx, -hy, 0.2, -hx + 24, -hy, 0.2, -hx, -hy, 0.2, -hx, -hy + 24, 0.2, -hx, -hy, 0.2, -hx, -hy, 24], 3));
  ax.setAttribute("color", new THREE.Float32BufferAttribute([0.9, 0.25, 0.25, 0.9, 0.25, 0.25, 0.3, 0.75, 0.35, 0.3, 0.75, 0.35, 0.3, 0.45, 0.95, 0.3, 0.45, 0.95], 3));
  g.add(new THREE.LineSegments(ax, new THREE.LineBasicMaterial({ vertexColors: true })));
  return g;
}
let bedTexture: THREE.Texture | null = null;

function makeObjView(pv: PlateView, obj: PlateObject): ObjView {
  const maskTex = new THREE.DataTexture(new Uint8Array(obj.mask.cols * obj.mask.rows * 4), obj.mask.cols, obj.mask.rows);
  maskTex.wrapS = THREE.RepeatWrapping; maskTex.magFilter = THREE.LinearFilter;
  const ov: ObjView = { obj, group: new THREE.Group(), surface: null, solid: null, shadow: null, maskTex, maskVersion: 0, footprintRing: null };
  pv.group.add(ov.group);
  refreshMaskTexture(ov); buildSurface(ov);
  return ov;
}
function disposeObjView(pv: PlateView, ov: ObjView) {
  pv.group.remove(ov.group); clearHover(ov); ov.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); ov.maskTex.dispose();
}
function makeView(plate: Plate): PlateView {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const marker = new THREE.Mesh(new THREE.ConeGeometry(2.4, 8, 20).rotateX(-Math.PI / 2).translate(0, 0, 4), new THREE.MeshStandardMaterial({ color: 0xE2856E, roughness: 0.4, emissive: 0xE2856E, emissiveIntensity: 0.25 }));
  marker.visible = false; marker.renderOrder = 6;
  const v: PlateView = { plate, group: new THREE.Group(), bed: bedLines(false, false, views.length + 1), objs: [], lines: [], status: "idle", worker, reqId: 0, marker };
  v.group.add(marker);
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
  if (!ui.plateTouched) ui.plateType = defaultPlateType(registry.get(ui.selected.machine)?.name ?? "", machine().flavor);
  views.forEach((v, i) => {
    v.group.position.copy(plateOrigin(i));
    v.group.remove(v.bed); disposeTree(v.bed);
    v.bed = bedLines(i === ui.active, v.plate.locked, i + 1); v.group.add(v.bed);
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
  ov.surface = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: ov.maskTex, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  ov.group.add(ov.surface);
  buildSolid(ov); applyObjTransform(ov);
  // footprint circle (arrange / clearance envelope)
  if (ov.footprintRing) { ov.group.remove(ov.footprintRing); ov.footprintRing.geometry.dispose(); }
  const r = footprint(ov.obj, body, proc()), fp: number[] = [];
  for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; fp.push(r * Math.cos(a), r * Math.sin(a), 0.05); }
  const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
  ov.footprintRing = new THREE.Line(fg, new THREE.LineBasicMaterial({ color: P3().ring }));
  ov.group.add(ov.footprintRing);
  if (!ov.shadow) {
    ov.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
    ov.shadow.position.z = 0.02; ov.shadow.renderOrder = -1; ov.group.add(ov.shadow);
  }
  ov.shadow.scale.set(r * 1.2, r * 1.2, 1);
  updateSurfaceVisibility();
}
function applyObjTransform(ov: ObjView) { // cheap live update while a slider is dragged (full rebuild on release)
  const t = ov.obj.transform;
  for (const m of [ov.surface, ov.solid]) if (m) { m.scale.set(t.scaleXY, t.scaleXY, t.scaleZ); m.rotation.z = (t.rotation * Math.PI) / 180; }
}
/** Solid, shaded model of the object (the real mesh, or the exact tessellation of a primitive). Rebuilt only when its geometry changes. */
function buildSolid(ov: ObjView) {
  const key = sourceKey(ov.obj) + (ov.obj.source.kind === "mesh" ? "" : "");
  if (ov.solid && ov.solid.userData.key === key) return;
  clearHover(ov);
  if (ov.solid) { ov.group.remove(ov.solid); ov.solid.geometry.dispose(); (ov.solid.material as THREE.Material).dispose(); ov.solid = null; }
  ov.sel = undefined; ov.proj = undefined;
  let m: Mesh | undefined; try { m = displayMesh(ov.obj); } catch { m = undefined; }
  if (!m?.tris.length) return;
  const g0 = new THREE.BufferGeometry(); g0.setAttribute("position", new THREE.BufferAttribute(m.tris, 3));
  const g = toCreasedNormals(g0, Math.PI / 5);
  ov.solid = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: P3().model, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  ov.solid.userData.key = key; ov.group.add(ov.solid);
}
function clearHover(ov: ObjView) {
  for (const k of ["hoverMesh", "hoverLines"] as const) { const h = ov[k]; if (h) { h.parent?.remove(h); h.geometry.dispose(); (h.material as THREE.Material).dispose(); ov[k] = undefined; } }
}
/** Paths are drawn in Preview/Print, and in Prepare only while "Path preview" is on. */
const showPaths = () => ui.mode !== "prepare" || ui.livePaths;
function updateSurfaceVisibility() {
  const ghost = ui.mode === "prepare" && ui.livePaths, hideSolid = ui.mode !== "prepare";
  views.forEach((v, i) => v.objs.forEach((ov, k) => {
    const sel = i === ui.active && k === ui.activeObj;
    if (ov.surface) ov.surface.visible = ui.showSurface && sel && ui.mode === "prepare";
    if (ov.solid) {
      const m = ov.solid.material as THREE.MeshStandardMaterial;
      ov.solid.visible = !hideSolid; m.color.set(sel && views.length ? P3().modelSel : P3().model);
      if (m.transparent !== ghost) { m.transparent = ghost; m.needsUpdate = true; }
      m.opacity = ghost ? 0.14 : 1; m.depthWrite = !ghost;
    }
    if (ov.footprintRing) (ov.footprintRing.material as THREE.LineBasicMaterial).color.set(sel ? P3().ringSel : P3().ring);
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
const ramp = (t: number, c: THREE.Color) => c.setHSL((1 - Math.min(1, Math.max(0, t))) * 0.66, 0.7, 0.5);
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
  const c = new THREE.Color(), [lo, hi] = range, span = hi - lo || 1, pal = P3();
  let kMax = 0; if (mode === "curvature") for (let i = 0; i < mp.count; i++) kMax = Math.max(kMax, mp.curvature[i]);
  for (let k = 0; k < n; k++) {
    const i = k * stride;
    pos[k * 3] = mp.xyz[i * 3]; pos[k * 3 + 1] = mp.xyz[i * 3 + 1]; pos[k * 3 + 2] = mp.xyz[i * 3 + 2];
    switch (mode) {
      case "feature":
        if (mp.tag[i] === 0) c.set(selected ? pal.pathSel : pal.pathBase); else c.set(REGION_COLORS[(mp.tag[i] - 1) % REGION_COLORS.length]);
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
    const full = makeLine(mp, 1, ui.preview, range, sel); full.userData.lod = "full"; full.userData.k = k; v.lines.push(full);
    if (total > 400_000) { const lod = makeLine(mp, 4, ui.preview, range, sel); lod.userData.lod = "far"; lod.userData.k = k; v.lines.push(lod); }
  });
  v.lines.forEach((l) => v.group.add(l));
  applyLayerRange(v);
  v.thumb = trayThumb(v); // tray preview follows tint, colour mode and theme
}
function layerSpan(l: THREE.Line): [number, number] {
  const mp = l.userData.mp as MotionPath, { layer, count } = mp, layers = layer[count - 1] + 1;
  const lo = Math.floor(ui.layerMin * (layers - 1)), hi = Math.ceil(ui.layerMax * (layers - 1));
  const first = (L: number) => { let a = 0, b = count; while (a < b) { const m = (a + b) >> 1; if (layer[m] < L) a = m + 1; else b = m; } return a; };
  return [first(lo), first(hi + 1)];
}
/** Draw range per object in print order: the scrub position sweeps through objects one after another, like the machine does. */
function applyLayerRange(v: PlateView) {
  const order = v.result?.order ?? [], seq = order.map((k) => v.lines.find((l) => l.userData.k === k && l.userData.lod === "full")).filter((l): l is THREE.Line => !!l);
  const spans = seq.map((l) => layerSpan(l)), total = spans.reduce((a, [x, y]) => a + (y - x), 0);
  let remaining = Math.ceil(total * ui.scrub); const draw = new Map<number, number>(); let head: PlateView["head"];
  seq.forEach((l, i) => {
    const [a, b] = spans[i], n = Math.min(b - a, remaining); remaining -= n; draw.set(l.userData.k, n);
    if (n > 0) head = { k: l.userData.k, idx: a + n - 1 };
  });
  v.head = head;
  for (const l of v.lines) {
    const [a, b] = layerSpan(l), s = l.userData.stride as number, n = draw.get(l.userData.k) ?? b - a, end = a + Math.min(n, b - a);
    l.geometry.setDrawRange(Math.floor(a / s), Math.max(0, Math.ceil((end - a) / s)));
  }
  const mp = head && v.result?.mps[head.k];
  v.marker.visible = !!mp && ui.scrub < 1 && showPaths();
  if (mp && head) v.marker.position.set(mp.xyz[head.idx * 3], mp.xyz[head.idx * 3 + 1], mp.xyz[head.idx * 3 + 2]);
}

// ======================= slicing (worker per plate, cached) =======================
function sliceKey(v: PlateView) {
  return JSON.stringify([v.plate.objects.map((o) => [o.source, o.transform, o.base, o.regionParams, o.mask.regions.map((r) => r.pattern)]),
    v.objs.map((o) => o.maskVersion), machine(), filament(), proc()]);
}
function slice(v: PlateView) {
  const key = sliceKey(v);
  if (v.result?.key === key && v.status === "done") return;
  if (!v.plate.objects.length) { v.result = undefined; v.status = "idle"; v.thumb = undefined; ui.goPreview = false; redrawPaths(v); renderStatus(); renderPlateBar(); renderDrawer(); return; }
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
  if (!d.ok) { v.status = "error"; v.error = d.error; ui.goPreview = false; renderStatus(); renderPlateBar(); renderDrawer(); return; }
  v.result = { ...d, key: v.pendingKey! }; v.status = "done";
  redrawPaths(v);
  if (ui.goPreview && v === activeView()) { ui.goPreview = false; setMode("preview"); return; }
  renderStatus(); renderPlateBar(); renderDrawer();
}
let sliceTimer = 0;
const sliceActiveSoon = (ms = 150) => { clearTimeout(sliceTimer); sliceTimer = window.setTimeout(() => slice(activeView()), ms); };
const sliceAll = () => views.forEach(slice);

// ======================= pointer tools: select / move / paint =======================
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), nrm = new THREE.Vector3();
const bedPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let dragging: null | "paint" | "faces" | { dx: number; dy: number } = null;
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
/** Index of the object under the pointer ray (real surface hit), or -1. */
function pickSolid(): { k: number; hit: THREE.Intersection } | null {
  const v = activeView(), solids = v.objs.map((o) => o.solid).filter((m): m is THREE.Mesh => !!m && m.visible);
  const hit = ray.intersectObjects(solids, false)[0];
  if (!hit) return null;
  const k = v.objs.findIndex((o) => o.solid === hit.object);
  return k < 0 ? null : { k, hit };
}
function pickObject(p: THREE.Vector2): number {
  let best = -1, bestD = Infinity;
  activeView().plate.objects.forEach((o, k) => {
    const d = Math.hypot(o.transform.x - p.x, o.transform.y - p.y);
    if (d <= footprint(o, bodyOf(o), proc()) && d < bestD) { best = k; bestD = d; }
  });
  return best;
}
// ---- face / edge selection (non-linear + texture zones) ----
const selMeshOf = (ov: ObjView): SelMesh => (ov.sel ??= buildSelMesh({ tris: displayMesh(ov.obj).tris }));
type Pick = { tris: number[]; segs: Seg[] | null };
/** What a click at `hit` would select with the current Face/Edge settings. */
function computePick(ov: ObjView, hit: THREE.Intersection): Pick | null {
  if (hit.faceIndex == null || !ov.solid) return null;
  const sm = selMeshOf(ov);
  if (ui.faceKind === "face") return { tris: fillFaces(sm, hit.faceIndex, ui.faceFill, ui.faceAngle), segs: null };
  const local = ov.solid.worldToLocal(hit.point.clone()), pt: [number, number, number] = [local.x, local.y, local.z];
  const sc = ov.obj.transform.scaleXY || 1, segs = pickEdge(sm, hit.faceIndex, pt, ui.edgeAngle, Math.max(2.5, ui.edgeBand * 0.9) / sc, ui.edgeChain);
  return segs ? { tris: trianglesNearSegments(sm, segs, ui.edgeBand / sc), segs } : null;
}
function showHover(ov: ObjView, pick: Pick | null) {
  clearHover(ov);
  if (!pick || !ov.solid) return;
  const tris = displayMesh(ov.obj).tris, pos = new Float32Array(pick.tris.length * 9);
  pick.tris.forEach((f, i) => pos.set(tris.subarray(f * 9, f * 9 + 9), i * 9));
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const col = ui.faceOp === "remove" ? P3().hover : REGION_COLORS[Math.max(0, ui.target) % REGION_COLORS.length];
  ov.hoverMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
  ov.solid.add(ov.hoverMesh);
  if (pick.segs) {
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(pick.segs.flat(), 3));
    ov.hoverLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: col, depthTest: false })); ov.hoverLines.renderOrder = 5; ov.solid.add(ov.hoverLines);
  }
}
/** Make sure a zone (paint region) exists and is targeted; new zones start with a Z-wobbling knit texture. */
function ensureZone(ov: ObjView): number {
  const o = ov.obj;
  if (ui.target >= 0 && o.mask.regions[ui.target]) return ui.target;
  const k = o.mask.regions.length ? 0 : addRegion(o.mask, "knit");
  if (!o.regionParams[k]) o.regionParams[k] = { ...patterns[o.mask.regions[k].pattern].defaults };
  ui.target = k; return k;
}
let lastCommit = "";
function commitPick(ov: ObjView, hit: THREE.Intersection, force = false) {
  const key = `${ui.active}:${ui.activeObj}:${hit.faceIndex}:${ui.faceKind}:${ui.faceOp}`;
  if (!force && key === lastCommit) return; lastCommit = key;
  const pick = computePick(ov, hit); if (!pick || !pick.tris.length) return;
  const zone = ensureZone(ov), body = bodyOf(ov.obj);
  ov.proj ??= surfaceProjector(body);
  paintTriangles(displayMesh(ov.obj).tris, pick.tris, ov.proj, ov.obj.mask, zone, { erase: ui.faceOp === "remove", height: body.height, radius: body.footprintRadius });
  ov.maskVersion++; refreshMaskTexture(ov);
  showHover(ov, pick); renderStatus(); sliceActiveSoon(250);
}
let hoverRaf = 0, hoverEv: PointerEvent | null = null;
function hoverSelect(ev: PointerEvent) {
  hoverEv = ev; if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0; const e = hoverEv; if (!e || ui.tool !== "faces" || !activeView()) return;
    setRay(e); const hit = pickSolid(), ov = activeObjView();
    views.forEach((v) => v.objs.forEach((o) => { if (o !== ov || !hit) clearHover(o); }));
    if (!hit || !ov || hit.k !== ui.activeObj) { renderer.domElement.style.cursor = hit ? "pointer" : ""; return; }
    renderer.domElement.style.cursor = "crosshair"; showHover(ov, computePick(ov, hit.hit));
  });
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
  if (ui.tool === "faces" && !activeView().plate.locked) { // pick faces / edges on the real surface; empty space keeps orbiting
    const hit = pickSolid();
    if (hit) {
      if (hit.k !== ui.activeObj) { selectObject(hit.k); return; }
      dragging = "faces"; controls.enabled = false; lastCommit = ""; commitPick(activeObjView()!, hit.hit, true); return;
    }
    return;
  }
  const solidHit = pickSolid(), p = bedPoint(); if (!p && !solidHit) return;
  const k = solidHit ? solidHit.k : pickObject(p!);
  if (k >= 0 && k !== ui.activeObj) selectObject(k);
  if (ui.tool === "move" && k >= 0 && !activeView().plate.locked) {
    const t = activeView().plate.objects[k].transform;
    dragging = { dx: t.x - (p?.x ?? t.x), dy: t.y - (p?.y ?? t.y) }; controls.enabled = false;
  }
});
renderer.domElement.addEventListener("pointermove", (ev) => {
  if (!dragging) { if (ui.tool === "faces" && ev.buttons === 0) hoverSelect(ev); return; }
  setRay(ev);
  if (dragging === "paint") { paintAt(); return; }
  if (dragging === "faces") { const h = pickSolid(), ov = activeObjView(); if (h && ov && h.k === ui.activeObj) commitPick(ov, h.hit); return; }
  const p = bedPoint(), ov = activeObjView(); if (!p || !ov) return;
  ov.obj.transform.x = Math.round((p.x + dragging.dx) * 10) / 10; ov.obj.transform.y = Math.round((p.y + dragging.dy) * 10) / 10;
  placeObj(ov);
  for (const l of activeView().lines) l.visible = false; // stale until re-slice
});
window.addEventListener("pointerup", () => {
  if (!dragging) return;
  const wasFaces = dragging === "faces"; dragging = null; controls.enabled = true; renderPanel();
  if (wasFaces) renderToolCard(); else sliceActiveSoon(0);
});

// ======================= plates & objects =======================
function addPlate(p = newPlate(`Plate ${views.length + 1}`)) {
  const v = makeView(p); views.push(v);
  ui.active = views.length - 1; ui.activeObj = 0; ui.target = -1;
  layoutPlates(); views.forEach(redrawPaths); focusActive(); slice(v); renderAll();
}
function deletePlate(i: number) {
  if (views.length <= 1 || views[i].plate.locked) return;
  disposeView(views[i]); views.splice(i, 1);
  ui.active = Math.min(ui.active, views.length - 1); ui.activeObj = 0; ui.target = -1;
  layoutPlates(); views.forEach(redrawPaths); focusActive(); renderAll();
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
  toast(""); renderAll();
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
function status(msg: string) { toast(msg); }

let clipboard: PlateObject | null = null;
window.addEventListener("keydown", (ev) => {
  if ((ev.target as HTMLElement).closest("input:not([type=range]):not([type=checkbox]), textarea, select")) return; // sliders/switches don't take letter keys
  const mod = ev.ctrlKey || ev.metaKey, ov = activeObjView();
  if (mod && ev.key === "c" && ov) clipboard = cloneObject(ov.obj);
  else if (mod && ev.key === "v" && clipboard) addObject(cloneObject(clipboard));
  else if (mod && ev.key === "d" && ov) addObject(cloneObject(ov.obj));
  else if ((ev.key === "Delete" || ev.key === "Backspace") && ov) deleteObject(ui.activeObj);
  else if (ev.key === "a" && !mod) arrangeAndReport([activeView()]);
  else if (!mod && DOCK_KEYS[ev.key.toLowerCase()] && ui.mode === "prepare") setDock(DOCK_KEYS[ev.key.toLowerCase()], true);
  else if (ev.key === "Escape" && (ui.modal || pop.classList.contains("show") || ui.dock)) { if (ui.modal) closeModal(); else if (pop.classList.contains("show")) closePop(); else setDock(null); }
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
  download(`${slug(ui.projectName)}.nexspiro`, writeProjectArchive(currentProject(), views.map((v) => plateThumb(v) ?? new Uint8Array())), "application/zip");
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
/** Run `fn` with only plate `v`'s full-detail toolpath visible and a camera framing it (used for G-code and tray thumbnails). */
function isolatePlate<T>(v: PlateView, fn: (cam: THREE.PerspectiveCamera) => T): T | undefined {
  const full = v.lines.filter((l) => l.userData.lod === "full");
  if (!full.length) return undefined;
  const hidden = views.filter((o) => o !== v).map((o) => { const was = o.group.visible; o.group.visible = false; return [o, was] as const; });
  const extras: THREE.Object3D[] = [v.bed, v.marker, ...v.objs.flatMap((o) => [o.surface, o.solid, o.footprintRing, o.shadow].filter(Boolean) as THREE.Object3D[]), ...v.lines.filter((l) => l.userData.lod === "far")];
  const vis = extras.map((o) => o.visible), fullVis = full.map((l) => l.visible);
  extras.forEach((o) => (o.visible = false)); full.forEach((l) => (l.visible = true));
  const prevBg = scene.background; scene.background = null;
  try {
    scene.updateMatrixWorld(true); // lines created this tick have no world matrix yet
    const box = new THREE.Box3(); full.forEach((l) => box.expandByObject(l));
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 50;
    const cam = new THREE.PerspectiveCamera(35, 1, 0.5, 5000); cam.up.set(0, 0, 1);
    cam.position.copy(c).add(new THREE.Vector3(1, -1, 0.8).normalize().multiplyScalar(r / Math.sin((17.5 * Math.PI) / 180))); cam.lookAt(c);
    return fn(cam);
  } finally {
    scene.background = prevBg; extras.forEach((o, i) => (o.visible = vis[i])); full.forEach((l, i) => (l.visible = fullVis[i]));
    hidden.forEach(([o, was]) => (o.group.visible = was));
  }
}
function thumbnails(v: PlateView, sizes: readonly (readonly [number, number])[] = [[32, 32], [300, 300], [600, 600]]): Thumbnail[] {
  return isolatePlate(v, (cam) => {
    const out: Thumbnail[] = [], tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    for (const [w, h] of sizes) { tr.setSize(w, h, false); tr.render(scene, cam); out.push({ width: w, height: h, pngBase64: tr.domElement.toDataURL("image/png").split(",")[1] }); }
    tr.dispose();
    return out;
  }) ?? [];
}
/** Small preview for the plate tray. Renders into a render target of the main renderer (no extra WebGL context). */
function trayThumb(v: PlateView): string | undefined {
  return isolatePlate(v, (cam) => {
    const S = 168, rt = new THREE.WebGLRenderTarget(S, S, { samples: 4 }), px = new Uint8Array(S * S * 4);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prevRT = renderer.getRenderTarget(), prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, S, S, px);
    renderer.setRenderTarget(prevRT); renderer.setClearColor(prevColor, prevAlpha); rt.dispose();
    const cv = document.createElement("canvas"); cv.width = cv.height = S;
    const img = new ImageData(S, S);
    for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4); // GL rows are bottom-up
    cv.getContext("2d")!.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  });
}
/** G-code text for plate `i`, or null (with an alert/notice) when it can't be produced. `interactive` shows dialogs. */
function buildGcode(i = ui.active, interactive = true): { name: string; text: string } | null {
  const v = views[i], fail = (m: string) => { if (interactive) alert(m); else throw new Error(m); return null; };
  if (!v.result || v.status !== "done") return fail("Slice the plate first.");
  if (v.result.issues.some((x) => x.level === "error") && (!interactive || !confirm("This plate has errors. Export anyway?"))) return interactive ? null : fail("The plate has errors (see the estimate card) — fix them before printing.");
  const M = machine();
  try {
    return { name: `${v.plate.name.replace(/\W+/g, "_")}.gcode`, text: toGcode(v.result.order.map((k) => v.result!.mps[k]), {
      machine: M, filament: filament(), process: proc(), offset: [M.bed[0] / 2, M.bed[1] / 2], thumbnails: thumbnails(v), presetNames: presetNames(),
    }) };
  } catch (e) { return fail(`G-code export refused: ${e instanceof Error ? e.message : e}`); }
}
function exportGcode(i = ui.active) { const g = buildGcode(i); if (g) download(g.name, g.text, "text/plain"); }

// ======================= UI: "Soft Clay & Pill" workspace =======================
// Four decoupled floating layers over the canvas: top capsule, left tool dock (+ slide-out card), right drawer, bottom tray.
// Rendering is string-based per layer; behaviour is delegated: clicks via [data-act], inputs via [data-in] (ACT / IN tables below).
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const hud = byId("hud"), topbar = byId("topbar"), dock = byId("dock"), toolcard = byId("toolcard"), drawer = byId("drawer"), tray = byId("tray"),
  carousel = byId("carousel"), timeline = byId("timeline"), vlayerEl = byId("vlayer"), statsEl = byId("stats"), pop = byId("pop"), modal = byId("modal"),
  sheet = modal.firstElementChild as HTMLElement;
const lastHtml = new WeakMap<HTMLElement, string>();
/** Replace innerHTML only when it changed, so unchanged layers keep focus, scroll and in-flight drags. */
function setHtml(el: HTMLElement, html: string) { if (lastHtml.get(el) !== html) { lastHtml.set(el, html); el.innerHTML = html; } }
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const PARAM_UI: [keyof PatternParams, string, number, number, number][] = [
  ["amplitude", "Amplitude", 0, 4, 0.05], ["wavesPerRev", "Waves / rev", 0, 200, 1],
  ["phasePerLayer", "Phase / layer", 0, 360, 1], ["zAmplitude", "Z wobble", 0, 1.5, 0.01],
  ["extrusionPulse", "Extrusion pulse", 0, 1, 0.01],
];
const PARAM_UNIT: Partial<Record<keyof PatternParams, string>> = { amplitude: "mm", phasePerLayer: "°", zAmplitude: "mm" };

// ---------- toast / dev line ----------
let toastMsg = "";
const stats = { fps: 0 };
function renderToast() {
  const msg = toastMsg || (ui.developer ? `${stats.fps.toFixed(0)} fps${activeView()?.result ? ` · ${activeView().result!.mps.reduce((a, m) => a + m.count, 0).toLocaleString()} moves` : ""}` : "");
  statsEl.textContent = msg; statsEl.classList.toggle("show", !!msg);
}
function toast(msg: string) { toastMsg = msg; renderToast(); }

// ---------- popover ----------
let popKey = "";
function openPop(anchor: HTMLElement, html: string) {
  const key = anchor.dataset.act ?? "";
  if (pop.classList.contains("show") && popKey === key) return closePop();
  pop.innerHTML = html; pop.classList.add("show"); popKey = key;
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
  pop.style.top = `${r.bottom + 10 + h > innerHeight - 8 ? Math.max(8, r.top - h - 10) : r.bottom + 10}px`;
}
function closePop() { pop.classList.remove("show"); popKey = ""; }
document.addEventListener("pointerdown", (e) => {
  if (pop.classList.contains("show") && !(e.target as Element).closest("#pop, [data-act='plateMenu'], [data-act='exportMenu']")) closePop();
}, true);

// ======================= top capsule =======================
const MODES: SegItem[] = [
  { value: "prepare", label: "Prepare", icon: "cube" }, { value: "preview", label: "Preview", icon: "layers" }, { value: "print", label: "Print", icon: "printer" },
];
function isFresh(v: PlateView) { return v.status === "done" && v.result?.key === sliceKey(v); }
function renderTopbar() {
  const v = activeView(); if (!v) return;
  const badge = statusBadge(v.status, isFresh(v), v.result?.issues ?? []), nl = proc().nonLinear.enabled, busy = v.status === "slicing";
  setHtml(topbar, `
    <div class="brand" title="NexSpiro by Studio Nexify">${icon("spiral")}</div>
    <div class="titleblock"><button class="name" data-act="renameProject" title="Rename project">${esc(ui.projectName)}</button><span class="badge ${badge.tone}">${badge.text}</span></div>
    <span class="vr"></span>
    ${seg("setMode", MODES, ui.mode)}
    <span class="vr"></span>
    <button class="btn plate-btn" data-act="plateMenu" aria-haspopup="menu">${icon("layers")}<span class="nowrap">${esc(v.plate.name)}</span>${icon("chevdown")}</button>
    ${ui.mode === "prepare" ? `<button class="btn live${ui.livePaths ? " on" : ""}" data-act="livePaths" aria-pressed="${ui.livePaths}" title="${ui.livePaths ? "Hide" : "Show"} the toolpath while you edit — no need to leave Prepare">${icon(ui.livePaths ? "eye" : "eyeoff")}<span class="tx">Path preview</span></button>` : ""}
    <button class="btn primary slice${busy ? " busy" : ""}" data-act="sliceNow"${v.plate.objects.length ? "" : " disabled"} title="${nl ? "Slice this plate with non-linear surface toolpaths" : "Slice this plate (planar spiral)"}"><span class="spin"></span>${icon("bolt")}<span class="tx">${nl ? "Slice &amp; Non-Linear Path" : "Slice plate"}</span></button>
    <button class="icon-btn" data-act="exportMenu" title="Export & project" aria-label="Export and project" aria-haspopup="menu">${icon("export")}</button>
    <button class="icon-btn" data-act="toggleDrawer" title="${ui.drawerOpen ? "Hide" : "Show"} process panel" aria-label="Toggle process panel" aria-pressed="${ui.drawerOpen}">${icon("panel")}</button>
    <button class="icon-btn" data-act="toggleTheme" title="Switch to ${ui.theme === "dark" ? "light" : "dark"} mode" aria-label="Toggle theme">${icon(ui.theme === "dark" ? "sun" : "moon")}</button>`);
}

// ======================= left dock =======================
type DockItem = { id: Dock | "layflat" | "cut" | "text"; tip: string; icon: string; soon?: boolean };
const DOCK: DockItem[][] = [
  [{ id: "select", tip: "Select (V)", icon: "select" }, { id: "move", tip: "Move (M)", icon: "move" }, { id: "rotate", tip: "Rotate (R)", icon: "rotate" }, { id: "scale", tip: "Scale (S)", icon: "scale" }],
  [{ id: "texture", tip: "Wall texture (T)", icon: "texture" }, { id: "faces", tip: "Select faces & edges (F)", icon: "faces" }, { id: "paint", tip: "Paint zones with a brush (P)", icon: "paint" }],
  [{ id: "arrange", tip: "Auto-arrange (A)", icon: "arrange" }],
  [{ id: "layflat", tip: "Lay flat · needs mesh pipeline", icon: "layflat", soon: true }, { id: "cut", tip: "Cut · needs mesh pipeline", icon: "cut", soon: true }, { id: "text", tip: "Text · needs mesh pipeline", icon: "text", soon: true }],
];
const DOCK_KEYS: Record<string, Dock> = { v: "select", m: "move", r: "rotate", s: "scale", t: "texture", f: "faces", p: "paint" };
const DOCK_TITLES: Record<Dock, [string, string]> = {
  select: ["cube", "Objects"], move: ["move", "Move"], rotate: ["rotate", "Rotate"], scale: ["scale", "Scale"], texture: ["texture", "Wall texture"], faces: ["faces", "Faces & edges"], paint: ["paint", "Paint"], arrange: ["arrange", "Auto-arrange"],
};
function renderDock() {
  setHtml(dock, DOCK.map((g) => `<div class="grp">${g.map((t) =>
    `<button class="tool${ui.dock === t.id ? " on" : ""}" data-act="setDock" data-arg="${t.id}" data-tip="${t.tip}" aria-label="${t.tip}" aria-pressed="${ui.dock === t.id}"${t.soon ? " disabled" : ""}>${icon(t.icon)}</button>`).join("")}</div>`).join(""));
}
const toolFor = (d: Dock | null): typeof ui.tool => (d === "move" ? "move" : d === "faces" ? "faces" : d === "paint" ? (ui.paintErase ? "erase" : "paint") : "orbit");
function setDock(d: Dock | null, _fromKey = false) {
  ui.dock = d === ui.dock ? null : d;
  ui.tool = ui.mode === "prepare" ? toolFor(ui.dock) : "orbit";
  renderDock(); renderToolCard(); updateViewInsets();
}

function shapeParams(o: PlateObject | undefined, dis: string) {
  if (!o || o.source.kind !== "primitive") return "";
  const def = primitiveDefs[o.source.primitive] as (typeof primitiveDefs)[PrimitiveName], cur = { ...primitiveDefaults(o.source.primitive), ...o.source.params };
  return `<div class="sep"></div><h2 class="mini">${esc(def.label)} · dimensions</h2>${def.params.map((d) => rangeRow(d.label, `data-in="shape" data-key="${d.key}"${dis}`, cur[d.key], d.min, d.max, d.step, { unit: d.unit, disabled: !!dis })).join("")}
    <div class="actions"><button class="btn sm ghost" data-act="resetShape"${dis}>Reset shape</button></div>`;
}
/** Texture / non-linear controls of the targeted zone (or the base wall). */
function zoneControls(o: PlateObject, dis: string) {
  const P = ui.target < 0 ? o.base.params : o.regionParams[ui.target], pat = ui.target < 0 ? o.base.pattern : o.mask.regions[ui.target].pattern;
  return `${selectRow("Wall texture", `data-in="pattern"${dis}`, Object.entries(patterns).map(([k, x]) => opt(k, x.label, k === pat)).join(""))}
    ${PARAM_UI.map(([k, l, mn, mx, st]) => rangeRow(l, `data-in="param" data-key="${k}"`, P[k], mn, mx, st, { unit: PARAM_UNIT[k], disabled: !!dis })).join("")}`;
}
function facesCard(o: PlateObject, dis: string) {
  const zones = o.mask.regions.map((r, k) => `<div class="list-item${k === ui.target ? " on" : ""}" role="button" tabindex="0" data-act="selTarget" data-arg="${k}"><span class="obj-name"><span class="swatch" style="background:${hex(REGION_COLORS[k % REGION_COLORS.length])}"></span><span class="nowrap">Zone ${k + 1} · ${patterns[r.pattern].label}</span></span>
      <span class="acts"><button class="icon-btn sm flat" data-act="clearZone" data-arg="${k}" title="Clear zone" aria-label="Clear zone"${dis}>${icon("erase")}</button><button class="icon-btn sm flat" data-act="delZone" data-arg="${k}" title="Delete zone" aria-label="Delete zone"${dis}>${icon("trash")}</button></span></div>`).join("");
  const face = ui.faceKind === "face"
    ? `${seg("faceFill", [{ value: "flat", label: "Flat" }, { value: "smooth", label: "Smooth" }, { value: "single", label: "Single" }], ui.faceFill, { cls: "sm block" })}
       ${ui.faceFill === "single" ? "" : rangeRow("Angle tolerance", `data-in="faceAngle"`, ui.faceAngle, 1, 90, 1, { unit: "°", cls: "violet" })}`
    : `${rangeRow("Sharp-edge angle", `data-in="edgeAngle"`, ui.edgeAngle, 8, 85, 1, { unit: "°", cls: "violet" })}
       ${rangeRow("Band width", `data-in="edgeBand"`, ui.edgeBand, 0.5, 20, 0.5, { unit: "mm", cls: "violet" })}
       ${switchRow("Follow the whole edge", `data-in="edgeChain"`, ui.edgeChain)}`;
  return `${seg("faceKind", [{ value: "face", label: "Faces", icon: "faces" }, { value: "edge", label: "Edges", icon: "edge" }], ui.faceKind, { cls: "block" })}
    <div style="margin-top:8px">${seg("faceOp", [{ value: "add", label: "Add", icon: "plus" }, { value: "remove", label: "Remove", icon: "erase" }], ui.faceOp, { cls: "block sm" })}</div>
    <div style="margin-top:10px">${face}</div>
    <div class="sep"></div><h2 class="mini">Zones — textured &amp; non-linear</h2>
    <div class="objlist">${zones || `<div class="muted" style="padding:4px">Nothing selected yet — click a face on the model. Everything else prints as a plain wall.</div>`}</div>
    <div class="actions"><button class="btn sm" data-act="addRegion"${dis}>${icon("plus")}New zone</button><button class="btn sm" data-act="zoneAll" data-arg="${ui.target}"${dis}${ui.target < 0 ? " disabled" : ""}>Whole wall</button></div>
    ${ui.target >= 0 && o.mask.regions[ui.target] ? `<div class="sep"></div>${zoneControls(o, dis)}` : ""}
    <p class="hint">Hover to preview, click or drag to ${ui.faceOp === "add" ? "add to" : "remove from"} the active zone. Only surfaces that become printed wall can carry a texture; unselected walls print plain, like Bambu Studio.</p>`;
}

// ---------- slide-out tool card ----------
function renderToolCard() {
  const d = ui.dock, open = !!d && ui.mode === "prepare" && !!activeView();
  toolcard.classList.toggle("open", open);
  if (!d || !activeView()) return; // keep the last content while the card slides away
  const v = activeView(), p = v.plate, o = p.objects[ui.activeObj], dis = p.locked ? " disabled" : "";
  const [ic, title] = DOCK_TITLES[d];
  const head = `<header class="card-head">${icon(ic)}<h3>${title}${p.locked ? ` <span class="sub">· plate locked</span>` : ""}</h3><button class="icon-btn sm flat" data-act="closeCard" aria-label="Close panel">${icon("close")}</button></header>`;
  const needObj = `<div class="empty">No object selected.<br><label class="btn sm primary file-btn" for="fileImport">${icon("import")}Import model…</label></div>`;
  let body = "";
  switch (d) {
    case "select": {
      body = `<div class="objlist">${p.objects.map((ob, k) => `<div class="list-item${k === ui.activeObj ? " on" : ""}" role="button" tabindex="0" data-act="selectObj" data-arg="${k}">
          <span class="obj-name">${icon(ob.source.kind === "mesh" ? "cube" : "cylinder")}<span class="nowrap">${esc(ob.name)}</span></span>
          <span class="acts"><button class="icon-btn sm flat" data-act="dupObj" data-arg="${k}" title="Duplicate (Ctrl+D)" aria-label="Duplicate"${dis}>${icon("copy")}</button><button class="icon-btn sm flat" data-act="delObj" data-arg="${k}" title="Delete (Del)" aria-label="Delete"${dis}>${icon("trash")}</button></span></div>`).join("") || `<div class="muted" style="padding:6px 4px">Empty plate</div>`}</div>
        <div class="actions"><label class="btn sm primary file-btn${p.locked ? " disabled" : ""}" for="fileImport" title="STL, OBJ, PLY, 3MF, STEP/STP, .nexspiro, Bambu/Orca JSON or PrusaSlicer INI">${icon("import")}Import…</label></div>
        <div class="row" style="margin-top:10px"><select data-in="addPrim" aria-label="Add primitive"${dis}><option value="">+ Add shape…</option>${PRIMITIVE_GROUPS.map((g) => `<optgroup label="${g}">${(Object.keys(primitiveDefs) as PrimitiveName[]).filter((k) => primitiveDefs[k].group === g).map((k) => opt(k, primitiveDefs[k].label, false)).join("")}</optgroup>`).join("")}</select></div>
        ${shapeParams(o, dis)}
        <p class="hint">Click a footprint in the viewport to select. Drop files anywhere to import.</p>`;
      break;
    }
    case "move": body = !o ? needObj : `<div class="pair">${numRow("X", `data-in="tf" data-key="x"`, o.transform.x, { unit: "mm", step: 1, disabled: !!p.locked })}${numRow("Y", `data-in="tf" data-key="y"`, o.transform.y, { unit: "mm", step: 1, disabled: !!p.locked })}</div>
        <div class="actions"><button class="btn sm" data-act="centerObj"${dis}>${icon("arrange")}Center on bed</button></div><p class="hint">Or drag the selected object across the bed.</p>`; break;
    case "rotate": body = !o ? needObj : `${rangeRow("Rotate Z", `data-in="tf" data-key="rotation"`, o.transform.rotation, -180, 180, 1, { unit: "°", disabled: !!p.locked })}
        <div class="actions"><button class="btn sm" data-act="rotateBy" data-arg="-90"${dis}>−90°</button><button class="btn sm" data-act="rotateBy" data-arg="90"${dis}>+90°</button><button class="btn sm ghost" data-act="rotateBy" data-arg="0"${dis}>Reset</button></div>
        <p class="hint">The seam stays aligned on +X, so rotating changes where the seam faces.</p>`; break;
    case "scale": body = !o ? needObj : `${switchRow("Uniform scale", `data-in="uniform"`, ui.uniform)}
        ${rangeRow("Scale XY", `data-in="tf" data-key="scaleXY"`, Math.round(o.transform.scaleXY * 100), 10, 400, 1, { unit: "%", disabled: !!p.locked })}
        ${rangeRow("Scale Z", `data-in="tf" data-key="scaleZ"`, Math.round(o.transform.scaleZ * 100), 10, 400, 1, { unit: "%", disabled: !!p.locked })}`; break;
    case "texture": {
      if (!o) { body = needObj; break; }
      const P = ui.target < 0 ? o.base.params : o.regionParams[ui.target], pat = ui.target < 0 ? o.base.pattern : o.mask.regions[ui.target].pattern;
      body = `${selectRow("Target", `data-in="target"`, opt("-1", "Base wall", ui.target < 0) + o.mask.regions.map((_, k) => opt(String(k), `Region ${k + 1}`, k === ui.target)).join(""))}
        ${selectRow("Pattern", `data-in="pattern"${dis}`, Object.entries(patterns).map(([k, x]) => opt(k, x.label, k === pat)).join(""))}
        <div class="sep"></div>
        ${PARAM_UI.map(([k, l, mn, mx, st]) => rangeRow(l, `data-in="param" data-key="${k}"`, P[k], mn, mx, st, { unit: PARAM_UNIT[k], disabled: !!p.locked })).join("")}`;
      break;
    }
    case "faces": body = !o ? needObj : facesCard(o, dis); break;
    case "paint": {
      if (!o) { body = needObj; break; }
      body = `${seg("noop", [{ value: "color", label: "Color", icon: "paint" }, { value: "support", label: "Support", icon: "support", disabled: true, title: "Support enforce/block needs a support engine" }, { value: "seam", label: "Seam", icon: "seam", disabled: true, title: "Seam painting is not supported yet" }], "color", { cls: "sm block" })}
        <div style="margin-top:10px">${seg("paintMode", [{ value: "paint", label: "Paint", icon: "paint" }, { value: "erase", label: "Erase", icon: "erase" }], ui.paintErase ? "erase" : "paint", { cls: "block" })}</div>
        <div class="sep"></div>
        <div class="objlist">${o.mask.regions.map((r, k) => `<div class="list-item${k === ui.target ? " on" : ""}" role="button" tabindex="0" data-act="selTarget" data-arg="${k}"><span class="obj-name"><span class="swatch" style="background:${hex(REGION_COLORS[k % REGION_COLORS.length])}"></span><span class="nowrap">Region ${k + 1} · ${patterns[r.pattern].label}</span></span></div>`).join("") || `<div class="muted" style="padding:4px">No regions yet. The whole wall uses the base pattern.</div>`}</div>
        <div class="actions"><button class="btn sm" data-act="addRegion"${dis}>${icon("plus")}Add region</button></div>
        ${ui.target < 0 && o.mask.regions.length ? `<p class="hint">Pick a region to start painting.</p>` : ""}
        ${rangeRow("Brush size", `data-in="brush"`, ui.brush, 1, 40, 1)}
        ${switchRow("Show paint surface", `data-in="showSurface"`, ui.showSurface)}`;
      break;
    }
    case "arrange": body = `<p class="hint" style="margin-top:0">Packs objects with toolhead-clearance spacing and checks they fit the bed.</p>
        <div class="actions"><button class="btn primary" data-act="arrange" data-arg="plate"${dis}>This plate</button><button class="btn" data-act="arrange" data-arg="all">All plates</button></div>`; break;
  }
  setHtml(toolcard, head + body);
}

// ======================= right drawer =======================
const PREVIEW_SHORT: Record<PreviewMode, string> = { feature: "Feature", speed: "Speed", height: "Height", layerTime: "Layer time", curvature: "Curvature" };
const TIERS = [
  { id: "quality", label: "Quality", path: "layerHeight", min: 0.05, max: 0.8, step: 0.01, unit: "mm", sub: "Layer height", fmt: (n: number) => n.toFixed(2) },
  { id: "strength", label: "Strength", path: "lineWidth", min: 0.2, max: 1.6, step: 0.05, unit: "mm", sub: "Wall line width", fmt: (n: number) => n.toFixed(2) },
  { id: "speed", label: "Speed", path: "wallSpeed", min: 5, max: 150, step: 1, unit: "mm/s", sub: "Wall speed", fmt: (n: number) => String(n) },
] as const;
const tile = (k: string, n: string) => `<div class="tile"><div class="k">${k}</div><div class="n">${n}</div></div>`;

function cardSetup() {
  const M = machine(), F = filament(), mn = registry.get(ui.selected.machine)!.name, fn = registry.get(ui.selected.filament)!.name;
  const dot = (k: PresetKind) => (ui.edited[k] ? `<span class="dot" title="Modified"></span>` : "");
  return `<section class="card"><header class="card-head">${icon("gear")}<h3>Printer &amp; material</h3></header>
    <button class="chip" data-act="openModal" data-arg="machine"><span class="glyph">${icon("printer")}</span><span class="grow"><b class="nowrap">${esc(mn)}</b><small>⌀ ${M.nozzle} mm nozzle · ${M.bed[0]}×${M.bed[1]} mm</small></span>${dot("machine")}${icon("chevright", "end")}</button>
    <button class="chip" data-act="openModal" data-arg="filament"><span class="glyph sage">${icon("spool")}</span><span class="grow"><b class="nowrap">${esc(fn)}</b><small>${materialOf(fn)} · ${F.nozzleTemp} °C nozzle · ${F.bedTemp} °C bed</small></span>${dot("filament")}${icon("chevright", "end")}</button>
    <button class="chip" data-act="plateTypeMenu" aria-haspopup="menu"><span class="glyph violet">${icon("layers")}</span><span class="grow"><b class="nowrap">${esc(PLATE_TYPES.find((p) => p.id === ui.plateType)!.label)}</b><small>Build plate · shown on the bed</small></span>${icon("chevdown", "end")}</button></section>`;
}
function cardProcess() {
  const P = proc() as unknown as Record<string, number>, list = registry.list("process");
  const row = (pr: Preset<"process">, cur: boolean) => {
    const r = registry.resolve<"process">(pr.id);
    return `<button class="preset${cur ? " on" : ""}" data-act="${cur ? "presetsMore" : "pickProcess"}" data-arg="${esc(pr.id)}"${cur ? ` aria-expanded="${ui.presetsOpen}"` : ""}>${icon(r.nonLinear.enabled ? "nonlinear" : "planar")}
      <span class="grow"><b class="nowrap">${pr.system ? "" : "★ "}${esc(pr.name)}</b><small>${r.layerHeight.toFixed(2)} mm · ${r.wallSpeed} mm/s${r.nonLinear.enabled ? " · non-linear" : " · planar"}</small></span>${cur ? icon("chevdown", "disclose" + (ui.presetsOpen ? " open" : "")) : ""}</button>`;
  };
  const cur = list.find((p) => p.id === ui.selected.process) ?? list[0], others = list.filter((p) => p !== cur);
  const tiers = TIERS.map((t) => `<button class="tile${ui.tier === t.id ? " on" : ""}" data-act="tier" data-arg="${t.id}" aria-expanded="${ui.tier === t.id}"><div class="k">${t.label}</div><div class="n">${t.fmt(P[t.path])} <span class="unit">${t.unit}</span></div></button>`).join("")
    + `<button class="tile" disabled title="Supports are not generated in single-wall spiral mode"><div class="k">Supports</div><div class="n" style="font-size:12.5px;font-weight:500;color:var(--text-3)">Not needed</div></button>`;
  const sliders = TIERS.map((t) => `<div class="collapse${ui.tier === t.id ? " open" : ""}"><div class="inner">${rangeRow(t.sub, `data-in="path" data-kind="process" data-path="${t.path}"`, P[t.path], t.min, t.max, t.step, { unit: t.unit, cls: "sky" })}</div></div>`).join("");
  const mod = ui.edited.process ? `<div class="mod-row"><span class="grow"><span class="dot"></span>Modified</span><button class="btn sm" data-act="presetRevert" data-arg="process">Revert</button><button class="btn sm primary" data-act="presetSave" data-arg="process">Save as…</button></div>` : "";
  return `<section class="card"><header class="card-head">${icon("layers")}<h3>Process presets</h3></header>${row(cur, true)}
    <div class="collapse${ui.presetsOpen ? " open" : ""}"><div class="inner"><div class="preset-list">${others.map((p) => row(p, false)).join("")}</div></div></div>
    <div class="tier-grid">${tiers}</div>${sliders}${mod}</section>`;
}
function cardNonLinear(forceOpen = false) {
  const N = proc().nonLinear, r = activeView().result, viol = r ? r.mps.reduce((a, m) => a + m.inclinationViolations, 0) : -1, on = N.enabled;
  const health = viol < 0 ? `<span class="dot mute"></span>Slice to verify the limits` : viol === 0 ? `<span class="dot sage"></span>All segments within limits` : `<span class="dot coral"></span>${viol.toLocaleString()} segments exceed the tilt limit`;
  const k = `data-in="path" data-kind="process"`;
  return `<section class="card nl${on ? "" : " off"}">
    <header class="card-head"><span class="glyph">${icon("nonlinear")}</span><span class="titles grow"><b>NexSpiro Non-Linear</b><small>Enable non-linear surface toolpaths</small></span>
      <input type="checkbox" ${k} data-path="nonLinear.enabled"${on ? " checked" : ""} aria-label="Enable Non-Linear Surface Toolpaths"></header>
    <div class="summary">${tile("Tilt limit", `${N.maxInclination}°`)}${tile("Clearance", `+${N.collisionMargin} mm`)}${tile("Tolerance", `${N.deviationTol} mm`)}</div>
    <div class="health">${health}</div>
    <div class="collapse${on && (forceOpen || ui.nlOpen) ? " open" : ""}"><div class="inner" style="padding-top:6px">
      ${rangeRow("Spline deviation", `${k} data-path="nonLinear.deviationTol"`, N.deviationTol, 0.001, 0.2, 0.001, { unit: "mm", cls: "violet" })}
      ${rangeRow("Max toolhead tilt", `${k} data-path="nonLinear.maxInclination"`, N.maxInclination, 5, 80, 1, { unit: "°", cls: "violet" })}
      ${rangeRow("Collision clearance", `${k} data-path="nonLinear.collisionMargin"`, N.collisionMargin, 0, 10, 0.5, { unit: "mm", cls: "violet" })}
      ${rangeRow("Z-axis smoothing", `${k} data-path="nonLinear.zSmoothing"`, N.zSmoothing, 0, 1, 0.05, { cls: "violet" })}</div></div>
    ${forceOpen ? "" : `<button class="btn sm ghost toggle-more" data-act="nlMore" aria-expanded="${ui.nlOpen}">${ui.nlOpen ? "Hide" : "Fine-tune"} ${icon("chevdown", "disclose" + (ui.nlOpen ? " open" : ""))}</button>`}
    <p class="off-note">Planar spiral: layers stay flat and pattern Z motion is suppressed.</p></section>`;
}
/** Preview-side motion tuning: zone textures (the non-linear shape of the path) and path resolution, re-sliced live. */
function cardMotion() {
  const v = activeView(), o = v.plate.objects[ui.activeObj], dis = v.plate.locked ? " disabled" : "", P = proc(), k = `data-in="path" data-kind="process"`;
  const targets = o ? selectRow("Tune", `data-in="target"`, opt("-1", "Base wall", ui.target < 0) + o.mask.regions.map((_, i) => opt(String(i), `Zone ${i + 1}`, i === ui.target)).join("")) : "";
  return `<section class="card"><header class="card-head">${icon("nonlinear")}<h3>Motion tuning</h3></header>
    ${o ? `${targets}${zoneControls(o, dis)}` : `<div class="empty">Select an object to tune its wall motion.</div>`}
    <div class="sep"></div>
    ${rangeRow("Wall speed", `${k} data-path="wallSpeed"`, P.wallSpeed, 5, 150, 1, { unit: "mm/s", cls: "violet" })}
    ${rangeRow("Segments / rev", `${k} data-path="segmentsPerRev"`, P.segmentsPerRev, 120, 2400, 10, { cls: "violet" })}
    ${rangeRow("Pattern fade-in", `${k} data-path="fadeHeight"`, P.fadeHeight, 0, 20, 0.5, { unit: "mm", cls: "violet" })}
    ${switchRow("Fit arcs (G2/G3)", `${k} data-path="arcFitting"`, P.arcFitting)}
    <p class="hint">Changes re-slice automatically; scrub or press play to watch the nozzle follow the new motion.</p></section>`;
}
function cardView() {
  const v = activeView(), r = v.result, o = v.plate.objects[ui.activeObj];
  let legend = "";
  if (ui.preview === "feature") {
    legend = `<div class="legend-ends" style="flex-wrap:wrap;gap:6px 14px;margin-top:12px"><span><span class="swatch" style="background:${hex(P3().pathBase)}"></span>Base wall</span>${(o?.mask.regions ?? []).map((_, k) => `<span><span class="swatch" style="background:${hex(REGION_COLORS[k % REGION_COLORS.length])}"></span>Region ${k + 1}</span>`).join("")}</div>`;
  } else if (r) {
    const [lo, hi, unit] = legendRange(r.mps, ui.preview);
    legend = `<div class="legend-bar" style="background:${rampGradient()}"></div><div class="legend-ends"><span>${lo.toFixed(1)} ${unit}</span><span>${PREVIEW_LABELS[ui.preview]}</span><span>${hi.toFixed(1)} ${unit}</span></div>${ui.preview === "curvature" ? `<p class="hint">Hue = feedrate, lightness = curvature peaks.</p>` : ""}`;
  }
  return `<section class="card"><header class="card-head">${icon("layers")}<h3>Color by</h3></header>
    <div class="pills">${(Object.keys(PREVIEW_SHORT) as PreviewMode[]).map((m) => `<button class="btn sm${m === ui.preview ? " on" : ""}" data-act="previewMode" data-arg="${m}">${PREVIEW_SHORT[m]}</button>`).join("")}</div>${legend}</section>`;
}
function cardSummary() {
  const v = activeView(), r = v.result;
  if (!r || v.status !== "done") {
    const msg = v.status === "slicing" ? "Slicing…" : v.status === "error" ? `<span class="err">${esc(v.error ?? "Slicing failed")}</span>` : v.plate.objects.length ? "Slice the plate to see time, weight and the toolpath." : "Add or import an object to begin.";
    return `<section class="card"><header class="card-head">${icon("clock")}<h3>Estimate</h3></header><div class="empty">${msg}${v.plate.objects.length && v.status !== "slicing" ? `<br><button class="btn primary sm" data-act="sliceNow">${icon("bolt")}Slice now</button>` : ""}</div></section>`;
  }
  const S = r.stats, moves = r.mps.reduce((a, m) => a + m.count, 0), dec = r.mps.reduce((a, m) => a + m.decimated, 0), inc = r.mps.reduce((a, m) => a + m.inclinationViolations, 0);
  const stale = isFresh(v) ? "" : `<span class="badge amber plain" style="margin-left:6px">stale</span>`;
  const issues = [...r.issues.map((i) => ({ level: i.level, text: i.message })),
    ...(r.zClipped ? [{ level: "warn", text: `Z wobble capped at ±${machine().zWobbleMax} mm on ${r.zClipped.toLocaleString()} points` }] : []),
    ...(inc ? [{ level: "warn", text: `${inc.toLocaleString()} segments exceed max inclination ${proc().nonLinear.maxInclination}°` }] : [])];
  return `<section class="card"><header class="card-head">${icon("clock")}<h3>Estimate${stale}</h3></header>
    <div class="tiles">${tile("Print time", formatDuration(S.timeS))}${tile("Weight", `${S.grams.toFixed(1)} g`)}${tile("Filament", `${(S.filamentMm / 1000).toFixed(2)} m`)}${tile("Layers", String(S.layers))}${tile("Cost", S.cost.toFixed(2))}${tile("Non-linear path", `${(S.nonLinearMm / 1000).toFixed(2)} m`)}</div>
    <p class="hint">${r.mps.length} object${r.mps.length > 1 ? `s (sequential: ${r.order.map((k) => esc(v.plate.objects[k]?.name ?? "?")).join(" → ")})` : ""} · ${moves.toLocaleString()} moves (${dec.toLocaleString()} decimated) · ${r.ms.toFixed(0)} ms</p>
    ${issues.map((i) => `<div class="issue ${i.level === "error" ? "error" : "warn"}">${icon("warn")}<span>${esc(i.text)}</span></div>`).join("")}</section>`;
}
function cardExport() {
  const fmts = (Object.keys(EXPORT_LABELS) as ExportFormat[]).filter((f) => ui.developer || (f !== "csv" && f !== "json"));
  return `<section class="card"><header class="card-head">${icon("export")}<h3>Export</h3></header>
    <div class="format-list">${fmts.map((f) => `<div class="list-item${f === ui.exportFormat ? " on" : ""}" role="button" tabindex="0" data-act="pickFormat" data-arg="${f}"><span class="grow">${EXPORT_LABELS[f]}</span>${f === ui.exportFormat ? icon("check") : ""}</div>`).join("")}</div>
    <button class="btn primary block" data-act="doExport" data-arg="${ui.exportFormat}">${icon("export")}Export</button>
    <div class="actions"><button class="btn sm" data-act="saveProject">${icon("save")}Save project</button><button class="btn sm" data-act="openProject">${icon("folder")}Open…</button></div>
    ${switchRow("Developer mode", `data-in="developer"`, ui.developer)}</section>`;
}
function renderDrawer() {
  if (!activeView()) return;
  const html = ui.mode === "prepare" ? cardSetup() + cardProcess() + cardNonLinear() : ui.mode === "preview" ? cardView() + cardSummary() + cardNonLinear(true) + cardMotion() : cardPrinters() + cardSend() + cardSummary() + cardExport();
  // never swap the DOM under a slider that is being dragged; it refreshes on release
  if (drawer.contains(document.activeElement) && (document.activeElement as HTMLInputElement).type === "range" && ui.dragSlider) return;
  const top = drawer.scrollTop; setHtml(drawer, html); drawer.scrollTop = top;
}

// ======================= network printers (Print tab) =======================
const PRINTERS_KEY = "nexspiro.printers";
let printers: PrinterConfig[] = [];
try { printers = JSON.parse(localStorage.getItem(PRINTERS_KEY) ?? "[]"); } catch { /* storage unavailable */ }
ui.printerId = printers[0]?.id ?? "";
const persistPrinters = () => { try { localStorage.setItem(PRINTERS_KEY, JSON.stringify(printers)); } catch { /* ignore */ } };
const printerLive: Record<string, { status?: PrinterStatus; error?: string }> = {};
const curPrinter = () => printers.find((p) => p.id === ui.printerId);
const kindLabel = (k: PrinterKind) => PRINTER_KINDS.find((x) => x.id === k)?.label ?? k;
let pollTimer = 0, polling = false;
async function pollOnce() {
  const p = curPrinter(); if (!p || polling) return; polling = true;
  try { printerLive[p.id] = { status: await connectorFor(p).status() }; }
  catch (e) { printerLive[p.id] = { error: e instanceof Error ? e.message : String(e) }; }
  finally { polling = false; if (ui.mode === "print") renderDrawer(); }
}
function syncPolling() {
  clearInterval(pollTimer); pollTimer = 0;
  if (ui.mode === "print" && curPrinter()) { void pollOnce(); pollTimer = window.setInterval(pollOnce, 3000); }
}
const fmtTemp = (a?: number, t?: number) => (a === undefined ? "–" : `${a.toFixed(0)}${t ? ` / ${t.toFixed(0)}` : ""}°`);
function cardPrinters() {
  const rows = printers.map((p) => {
    const l = printerLive[p.id], st = l?.status?.state, tone = l?.error ? "coral" : st === "printing" ? "sage" : st === "paused" ? "amber" : st ? "sky" : "mute";
    return `<div class="list-item${p.id === ui.printerId ? " on" : ""}" role="button" tabindex="0" data-act="pickPrinter" data-arg="${esc(p.id)}">
      <span class="obj-name"><span class="dot ${tone}"></span><span class="grow"><b class="nowrap">${esc(p.name)}</b><small class="muted nowrap">${esc(p.host)} · ${esc(kindLabel(p.kind))}</small></span></span>
      <span class="acts"><button class="icon-btn sm flat" data-act="editPrinter" data-arg="${esc(p.id)}" title="Edit" aria-label="Edit printer">${icon("edit")}</button><button class="icon-btn sm flat" data-act="delPrinter" data-arg="${esc(p.id)}" title="Remove" aria-label="Remove printer">${icon("trash")}</button></span></div>`;
  }).join("");
  return `<section class="card"><header class="card-head">${icon("wifi")}<h3>Network printers</h3><button class="icon-btn sm" data-act="addPrinter" title="Add printer" aria-label="Add printer">${icon("plus")}</button></header>
    ${rows ? `<div class="objlist">${rows}</div>` : `<div class="empty">Connect a printer over your network to send G-code straight to it.<br><button class="btn primary sm" data-act="addPrinter">${icon("plus")}Add printer</button></div>`}</section>`;
}
function cardSend() {
  const p = curPrinter(); if (!p) return "";
  const l = printerLive[p.id] ?? {}, s = l.status, v = activeView(), ready = v.status === "done" && isFresh(v), prob = mixedContentProblem(p);
  const state = l.error ? "Unreachable" : !s ? "Connecting…" : { offline: "Offline", idle: "Ready", printing: "Printing", paused: "Paused", error: "Error" }[s.state];
  const tone = l.error ? "coral" : s?.state === "printing" ? "sage" : s?.state === "paused" ? "amber" : s?.state === "error" ? "coral" : "sky";
  const busy = !!ui.netBusy, active = s?.state === "printing" || s?.state === "paused";
  const prog = s?.progress !== undefined && active ? `<div class="meter"><i style="width:${Math.round(s.progress * 100)}%"></i></div><div class="legend-ends"><span>${Math.round(s.progress * 100)}%${s.layers ? ` · layer ${s.layer ?? "?"}/${s.layers}` : ""}</span><span>${s.remainingS ? `${formatDuration(s.remainingS)} left` : ""}</span></div>${s.file ? `<div class="muted nowrap" style="margin-top:4px">${esc(s.file)}</div>` : ""}` : "";
  const confirm_ = ui.confirmPrint ? `<div class="issue warn">${icon("warn")}<span>This starts printing on <b>${esc(p.name)}</b> right away. Is the build plate clear and the filament loaded?</span></div>
      <div class="actions"><button class="btn primary" data-act="sendPrint" data-arg="1"${busy ? " disabled" : ""}>${icon("play")}Start print</button><button class="btn" data-act="cancelConfirm">Cancel</button></div>` : "";
  return `<section class="card"><header class="card-head">${icon("send")}<h3>Send to ${esc(p.name)}</h3><span class="badge ${tone}">${state}</span></header>
    ${prob ? `<div class="issue error">${icon("warn")}<span>${esc(prob)}</span></div>` : ""}
    ${l.error ? `<div class="issue error">${icon("warn")}<span>${esc(l.error)}</span></div>` : ""}
    ${s ? `<div class="tiles">${tile("Nozzle", fmtTemp(s.nozzle, s.nozzleTarget))}${tile("Bed", fmtTemp(s.bed, s.bedTarget))}</div>${s.message ? `<div class="issue warn">${icon("warn")}<span>${esc(s.message)}</span></div>` : ""}${prog}` : ""}
    ${active ? `<div class="actions"><button class="btn" data-act="netCmd" data-arg="${s!.state === "paused" ? "resume" : "pause"}"${busy ? " disabled" : ""}>${icon(s!.state === "paused" ? "play" : "pause")}${s!.state === "paused" ? "Resume" : "Pause"}</button><button class="btn danger" data-act="netCmd" data-arg="cancel"${busy ? " disabled" : ""}>${icon("stop")}Stop</button></div>` : `
      ${confirm_ || `<div class="actions"><button class="btn" data-act="sendPrint" data-arg="0"${busy || !v.plate.objects.length ? " disabled" : ""}>${icon("send")}Send</button><button class="btn primary" data-act="askPrint"${busy || !v.plate.objects.length ? " disabled" : ""}>${icon("play")}Send &amp; print</button></div>`}
      <p class="hint">${ready ? `Plate “${esc(v.plate.name)}” is sliced and up to date.` : "The plate is re-sliced automatically before sending."}</p>`}
    ${ui.netBusy ? `<div class="muted" style="margin-top:8px"><span class="dot sky"></span>${esc(ui.netBusy)}</div>` : ""}
    ${ui.netMsg ? `<div class="issue ${ui.netMsg.tone === "ok" ? "ok" : "error"}">${icon(ui.netMsg.tone === "ok" ? "check" : "warn")}<span>${esc(ui.netMsg.text)}</span></div>` : ""}</section>`;
}
function renderPrinterForm() {
  const d = ui.draft ?? {}, k = (d.kind ?? "bambu") as PrinterKind, def = PRINTER_KINDS.find((x) => x.id === k)!, f = (key: string) => `data-in="pf" data-key="${key}"`, prob = d.host ? mixedContentProblem(d as PrinterConfig) : null;
  return `${selectRow("Type", f("kind"), PRINTER_KINDS.map((x) => opt(x.id, x.label, x.id === k)).join(""))}
    <p class="hint" style="margin-top:0">${esc(def.hint)}</p>
    ${textRow("Name", f("name"), d.name ?? "", { placeholder: "e.g. P1S on the desk" })}
    ${textRow("IP / hostname", f("host"), d.host ?? "", { placeholder: k === "moonraker" ? "192.168.1.50 (port 7125 assumed)" : "192.168.1.50" })}
    ${k === "bambu" ? `${textRow("Serial number", f("serial"), d.serial ?? "", { placeholder: "printer label / Device page" })}${textRow("LAN access code", f("accessCode"), d.accessCode ?? "", { type: "password", placeholder: "8 characters on the printer" })}${textRow("Bridge URL", f("bridge"), d.bridge ?? "", { placeholder: "http://localhost:8787" })}`
      : textRow(k === "moonraker" ? "API key (optional)" : "API key", f("apiKey"), d.apiKey ?? "", { type: "password" })}
    ${prob ? `<div class="issue error">${icon("warn")}<span>${esc(prob)}</span></div>` : ""}
    ${d.msg ? `<div class="issue ${d.msg.tone === "ok" ? "ok" : "error"}">${icon(d.msg.tone === "ok" ? "check" : "warn")}<span>${esc(d.msg.text)}</span></div>` : ""}
    <div class="actions"><button class="btn" data-act="testPrinter">${icon("link")}Test connection</button><button class="btn primary" data-act="savePrinter">${icon("check")}${d.editing ? "Save" : "Add printer"}</button></div>
    <p class="hint">Credentials are stored in this browser only. Prefer a LAN-only network; the bridge and printers speak plain LAN protocols.</p>`;
}
function draftConfig(): PrinterConfig {
  const d = ui.draft ?? {};
  return { id: d.id ?? `net-${Date.now().toString(36)}`, name: d.name?.trim() ?? "", kind: (d.kind ?? "bambu") as PrinterKind, host: d.host?.trim() ?? "", apiKey: d.apiKey?.trim(), accessCode: d.accessCode?.trim(), serial: d.serial?.trim(), bridge: d.bridge?.trim() };
}
async function sendToPrinter(print: boolean) {
  const p = curPrinter(), v = activeView(); if (!p || ui.netBusy) return;
  ui.netMsg = null; ui.confirmPrint = false;
  try {
    if (!isFresh(v)) { // slice on demand, then continue
      ui.netBusy = "Slicing the plate…"; renderDrawer();
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Slicing took too long")), 120_000);
        const check = () => { if (v.status === "done" && isFresh(v)) { clearTimeout(t); resolve(); } else if (v.status === "error") { clearTimeout(t); reject(new Error(v.error ?? "Slicing failed")); } else setTimeout(check, 150); };
        slice(v); check();
      });
    }
    const g = buildGcode(ui.active, false)!;
    ui.netBusy = `Uploading ${g.name} (${(g.text.length / 1048576).toFixed(1)} MB)…`; renderDrawer();
    await connectorFor(p).upload(g.name, g.text, print);
    ui.netMsg = { tone: "ok", text: print ? `Sent “${g.name}” — ${p.name} is starting the print.` : `Sent “${g.name}” to ${p.name}. Start it from the printer.` };
  } catch (e) { ui.netMsg = { tone: "err", text: e instanceof Error ? e.message : String(e) }; }
  ui.netBusy = ""; renderDrawer(); void pollOnce();
}
function netActions(): Record<string, (arg: string, el: HTMLElement) => void> {
  return {
    pickPrinter: (a) => { ui.printerId = a; ui.netMsg = null; ui.confirmPrint = false; renderDrawer(); syncPolling(); },
    addPrinter: () => { ui.draft = { kind: "bambu", bridge: "http://localhost:8787" }; ui.modal = "printer"; renderModal(); },
    editPrinter: (a) => { const p = printers.find((x) => x.id === a); if (!p) return; ui.draft = { ...p, editing: true }; ui.modal = "printer"; renderModal(); },
    delPrinter: (a) => { printers = printers.filter((p) => p.id !== a); persistPrinters(); if (ui.printerId === a) ui.printerId = printers[0]?.id ?? ""; renderDrawer(); syncPolling(); },
    testPrinter: async () => {
      const d = draftConfig(), bad = validatePrinter(d); if (!ui.draft) return;
      ui.draft.msg = bad ? { tone: "err", text: bad } : { tone: "ok", text: "Connecting…" }; renderModal(); if (bad) return;
      try { const s = await connectorFor(d).status(); ui.draft.msg = { tone: "ok", text: `Connected — printer is ${s.state}${s.nozzle !== undefined ? `, nozzle ${s.nozzle.toFixed(0)}°C` : ""}.` }; }
      catch (e) { ui.draft.msg = { tone: "err", text: e instanceof Error ? e.message : String(e) }; }
      renderModal();
    },
    savePrinter: () => {
      const d = draftConfig(), bad = validatePrinter(d); if (!ui.draft) return;
      if (bad) { ui.draft.msg = { tone: "err", text: bad }; renderModal(); return; }
      const i = printers.findIndex((p) => p.id === d.id); if (i >= 0) printers[i] = d; else printers.push(d);
      persistPrinters(); ui.printerId = d.id; closeModal(); renderDrawer(); syncPolling();
    },
    askPrint: () => { ui.confirmPrint = true; ui.netMsg = null; renderDrawer(); },
    cancelConfirm: () => { ui.confirmPrint = false; renderDrawer(); },
    sendPrint: (a) => void sendToPrinter(a === "1"),
    netCmd: async (a) => {
      const p = curPrinter(); if (!p) return;
      try { await connectorFor(p).command(a as "pause" | "resume" | "cancel"); ui.netMsg = { tone: "ok", text: a === "cancel" ? "Stop sent." : `${a === "pause" ? "Pause" : "Resume"} sent.` }; }
      catch (e) { ui.netMsg = { tone: "err", text: e instanceof Error ? e.message : String(e) }; }
      renderDrawer(); void pollOnce();
    },
  };
}

// ======================= bottom tray =======================
function plateCard(v: PlateView, i: number) {
  const r = v.result, kind = slicingKind(v.status === "done" ? r?.stats.nonLinearMm : undefined), fresh = isFresh(v);
  const badge = v.status === "slicing" ? `<span class="badge amber">Slicing…</span>` : v.status === "error" ? `<span class="badge coral">Error</span>`
    : kind === "nonlinear" ? `<span class="badge violet">${icon("nonlinear")}Non-linear</span>` : kind === "planar" ? `<span class="badge sky">${icon("planar")}Planar</span>` : `<span class="badge">Not sliced</span>`;
  const est = r && v.status === "done" ? `${formatDuration(r.stats.timeS)} · ${r.stats.grams.toFixed(1)} g${fresh ? "" : " · stale"}` : `${v.plate.objects.length} object${v.plate.objects.length === 1 ? "" : "s"}`;
  return `<div class="plate-card${i === ui.active ? " on" : ""}" role="button" tabindex="0" data-act="selectPlate" data-arg="${i}" aria-label="${esc(v.plate.name)}">
    <div class="thumb">${v.thumb ? `<img src="${v.thumb}" alt="" draggable="false">` : icon("cylinder")}</div>
    <div class="meta"><div class="nm"><span>${esc(v.plate.name)}</span>${v.plate.locked ? icon("lock") : ""}</div><div class="est">${est}</div><div class="row2">${badge}</div></div>
    <div class="acts"><button class="icon-btn sm" data-act="lockPlate" data-arg="${i}" title="${v.plate.locked ? "Unlock" : "Lock"} plate" aria-label="Lock plate">${icon(v.plate.locked ? "lock" : "unlock")}</button>
      <button class="icon-btn sm" data-act="dupPlate" data-arg="${i}" title="Duplicate plate" aria-label="Duplicate plate">${icon("copy")}</button>
      <button class="icon-btn sm" data-act="delPlate" data-arg="${i}" title="Delete plate" aria-label="Delete plate"${views.length < 2 || v.plate.locked ? " disabled" : ""}>${icon("trash")}</button></div></div>`;
}
let lastScrolledPlate = -1;
function renderTray() {
  setHtml(carousel, views.map(plateCard).join("") + `<button class="add-plate" data-act="addPlate" title="Add plate" aria-label="Add plate">${icon("plus")}</button>`);
  const on = carousel.querySelector<HTMLElement>(".plate-card.on");
  if (on && lastScrolledPlate !== ui.active) { // keep the active plate in view without scrolling any ancestor
    lastScrolledPlate = ui.active;
    const a = on.getBoundingClientRect(), c = carousel.getBoundingClientRect();
    if (a.left < c.left) carousel.scrollLeft -= c.left - a.left + 8; else if (a.right > c.right) carousel.scrollLeft += a.right - c.right + 8;
  }
  updateReadout();
}
// ---------- preview scrubbing controls (static DOM, built once) ----------
timeline.innerHTML = `<button class="icon-btn" id="playBtn" data-act="play" aria-label="Play toolpath">${icon("play")}</button>
  <div class="scrub"><input type="range" id="scrub" class="violet" min="0" max="1" step="0.001" value="1" aria-label="Toolpath step" style="--p:100%"></div><div class="readout" id="readout"></div>`;
vlayerEl.innerHTML = `<span class="cap">Top</span><span class="lbl" id="vTop">–</span><div id="vDual"></div><span class="lbl" id="vBot">–</span><span class="cap">Layer</span>`;
const layerSlider = new DualSlider(byId("vDual"), true, (lo, hi) => { ui.layerMin = lo; ui.layerMax = hi; views.forEach(applyLayerRange); updateReadout(); }, ["Lowest layer", "Highest layer"]);
const scrubEl = byId<HTMLInputElement>("scrub");
scrubEl.addEventListener("input", () => { ui.scrub = Number(scrubEl.value); ui.playing = false; scrubEl.style.setProperty("--p", `${ui.scrub * 100}%`); views.forEach(applyLayerRange); updateReadout(); syncPlay(); });
function syncPlay() { const b = byId("playBtn"); b.innerHTML = icon(ui.playing ? "pause" : "play"); b.setAttribute("aria-label", ui.playing ? "Pause" : "Play toolpath"); }
function updateReadout() {
  const v = activeView(), r = v?.result; if (!v) return;
  const layers = r ? Math.max(...r.mps.map((m) => m.layer[m.count - 1] + 1)) : 0;
  const L = (f: number) => Math.round(f * Math.max(0, layers - 1)) + 1;
  byId("vTop").textContent = layers ? String(L(ui.layerMax)) : "–"; byId("vBot").textContent = layers ? String(L(ui.layerMin)) : "–";
  layerSlider.set(ui.layerMin, ui.layerMax);
  let total = 0; for (const l of v.lines) if (l.userData.lod !== "far") { const [a, b] = layerSpan(l); total += b - a; }
  const shown = Math.ceil(total * ui.scrub);
  const hd = v.head && r ? { mp: r.mps[v.head.k], i: v.head.idx } : null;
  const motion = hd && ui.scrub < 1 ? `<br>Nozzle <b>${hd.mp.feed[Math.max(1, hd.i)].toFixed(1)}</b> mm/s · Z <b>${hd.mp.xyz[hd.i * 3 + 2].toFixed(2)}</b> mm (${hd.mp.zOff[hd.i] >= 0 ? "+" : ""}${hd.mp.zOff[hd.i].toFixed(2)} wobble)` : "";
  byId("readout").innerHTML = layers ? `Layers <b>${L(ui.layerMin)}–${L(ui.layerMax)}</b> / ${layers} · Step <b>${shown.toLocaleString()}</b> / ${total.toLocaleString()}${motion}` : "Slice the plate to preview";
}

// ======================= modal preset editor =======================
const MODAL_TITLES: Record<PresetKind | "printer", [string, string]> = { machine: ["printer", "Printer preset"], filament: ["spool", "Filament preset"], process: ["layers", "Process preset"], printer: ["wifi", "Network printer"] };
function machineGeometryUI(m: MachinePreset) {
  const n = (m.bedExclude ?? []).length;
  return `<h2>Machine geometry</h2><div class="actions" style="margin-top:6px">
    <label class="btn sm file-btn" for="fileToolhead" title="Hotend + carriage mesh, nozzle tip lowest">${icon("import")}Toolhead mesh…</label>
    <label class="btn sm file-btn" for="fileExclude" title="Polygons/rects/straight paths in mm, origin top-left">${icon("import")}Bed exclusion SVG…</label>
    <label class="btn sm file-btn" for="fileBedPng">${icon("import")}Bed texture…</label></div>
    <div class="muted" style="margin-top:8px">${n} exclusion zone(s)${n ? ` <button class="btn sm ghost" data-act="clearExclude">Clear</button>` : ""}</div>`;
}
function renderPresetBody(kind: PresetKind) {
  const vals = presetValues(kind) as unknown as Record<string, unknown>, dirty = !!ui.edited[kind], cur = registry.get(ui.selected[kind])!;
  return `${selectRow("Preset", `data-in="presetSel"`, registry.list(kind).map((p) => opt(p.id, `${p.system ? "" : "★ "}${p.name}`, p.id === ui.selected[kind])).join(""))}
    <div class="muted">${cur.inherits ? `inherits ${esc(registry.get(cur.inherits)?.name ?? cur.inherits)}` : "root preset"}${dirty ? ' · <span style="color:var(--amber-deep)">modified</span>' : ""}</div>
    <div class="actions"><button class="btn sm primary" data-act="presetSave" data-arg="${kind}">Save as…</button>${dirty ? `<button class="btn sm" data-act="presetRevert" data-arg="${kind}">Revert</button>` : ""}${!cur.system ? `<button class="btn sm danger" data-act="presetDelete" data-arg="${kind}">Delete</button>` : ""}
      <label class="btn sm file-btn" for="fileProfile" title="Bambu Studio / OrcaSlicer .json or PrusaSlicer .ini">${icon("import")}Import profile…</label></div>
    ${kind === "machine" ? machineGeometryUI(vals as unknown as MachinePreset) : ""}
    ${GROUPS[kind].map(([g, keys]) => `<h2>${g}</h2>${keys.map((k) => field(k, getPath(vals, k))).join("")}`).join("")}`;
}
function renderModal() {
  const kind = ui.modal;
  modal.classList.toggle("show", !!kind);
  if (!kind) return;
  const body = sheet.querySelector<HTMLElement>(".body"), top = body?.scrollTop ?? 0, [ic, title] = MODAL_TITLES[kind];
  setHtml(sheet, `<div class="head"><span class="glyph-s">${icon(ic)}</span><h1>${title}</h1><button class="icon-btn sm" data-act="closeModal" aria-label="Close">${icon("close")}</button></div><div class="body">${kind === "printer" ? renderPrinterForm() : renderPresetBody(kind)}</div>`);
  const nb = sheet.querySelector<HTMLElement>(".body"); if (nb) nb.scrollTop = top;
}
const closeModal = () => { ui.modal = null; ui.draft = null; renderModal(); };
modal.addEventListener("pointerdown", (e) => { if (e.target === modal) closeModal(); });

// ======================= status, layout, theme =======================
function renderStatus() { renderTopbar(); renderToast(); }
function renderPlateBar() { renderTray(); renderTopbar(); }
function renderPanel() { renderToolCard(); renderTray(); }
function renderAll() {
  hud.dataset.mode = ui.mode; hud.dataset.drawer = ui.drawerOpen ? "open" : "closed";
  renderTopbar(); renderDock(); renderToolCard(); renderDrawer(); renderTray(); renderModal(); renderToast(); updateViewInsets();
}
function setMode(m: typeof ui.mode) {
  ui.mode = m; ui.playing = false; ui.tool = m === "prepare" ? toolFor(ui.dock) : "orbit"; syncPlay();
  hoverReset(); updateSurfaceVisibility(); views.forEach(applyLayerRange);
  closePop(); renderAll(); syncPolling();
}
function applyTheme(mode: ThemeMode) {
  ui.theme = mode; setThemeAttr(mode);
  layoutPlates();
  views.forEach((v) => v.objs.forEach((ov) => { if (ov.shadow) { (ov.shadow.material as THREE.MeshBasicMaterial).map = blobTexture(); (ov.shadow.material as THREE.Material).needsUpdate = true; } }));
  updateSurfaceVisibility(); views.forEach(redrawPaths); renderAll();
}
/** Shift the 3D view centre so the bed sits in the free area between the floating layers (eased in the render loop). */
const viewShift = { x: 0, y: 0, tx: 0, ty: 0, dirty: true };
function updateViewInsets() {
  const W = view.clientWidth, H = view.clientHeight;
  let l = 0, r = 0;
  if (ui.mode === "prepare") l = 14 + 56 + (toolcard.classList.contains("open") ? 10 + 288 : 0);
  if (ui.drawerOpen) r = 14 + 316;
  if (ui.mode === "preview") r += 72; // vertical layer slider
  const t = topbar.getBoundingClientRect().bottom + 8, b = H - tray.getBoundingClientRect().top + 8;
  const narrow = W - l - r < 420; // too little free width: don't shift, nothing useful fits
  viewShift.tx = narrow ? 0 : (l - r) / 2; viewShift.ty = narrow ? 0 : (t - b) / 2;
}
function stepViewShift() {
  const dx = viewShift.tx - viewShift.x, dy = viewShift.ty - viewShift.y;
  if (!viewShift.dirty && Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return;
  viewShift.dirty = false;
  viewShift.x = Math.abs(dx) < 0.3 ? viewShift.tx : viewShift.x + dx * 0.16; viewShift.y = Math.abs(dy) < 0.3 ? viewShift.ty : viewShift.y + dy * 0.16;
  const W = view.clientWidth, H = view.clientHeight;
  if (viewShift.x === 0 && viewShift.y === 0) camera.clearViewOffset(); else camera.setViewOffset(W, H, -viewShift.x, -viewShift.y, W, H);
}
hud.addEventListener("transitionend", (e) => { if (e.target === toolcard || e.target === drawer || e.target === tray) updateViewInsets(); });

// ======================= actions (clicks) =======================
function afterPresetEdit(kind: PresetKind) {
  views.forEach((v) => v.objs.forEach(buildSurface));
  if (kind === "machine") { layoutPlates(); focusActive(); }
  renderAll(); sliceActiveSoon();
}
function onPresetsChanged() { afterPresetEdit("machine"); }
function setPresetValue(kind: PresetKind, path: string, val: unknown) {
  const edited = structuredClone(presetValues(kind)) as unknown as Record<string, unknown>;
  setPath(edited, path, val); ui.edited[kind] = edited as never;
}
function sliceNow() {
  const v = activeView(); if (!v.plate.objects.length) return;
  if (isFresh(v)) { setMode("preview"); return; }
  ui.goPreview = true; slice(v); renderTopbar();
}
const pickPlateMenu = (anchor: HTMLElement) => openPop(anchor, `<div class="menu-head">Plates</div>${views.map((v, i) => `<div class="list-item${i === ui.active ? " on" : ""}" role="menuitem" tabindex="0" data-act="selectPlate" data-arg="${i}"><span class="obj-name">${icon(v.plate.locked ? "lock" : "layers")}<span class="nowrap">${esc(v.plate.name)}</span></span><span class="muted">${v.plate.objects.length} obj</span></div>`).join("")}
  <div class="sep"></div><div class="list-item" role="menuitem" tabindex="0" data-act="addPlate"><span class="obj-name">${icon("plus")}New plate</span></div>`);
const exportMenu = (anchor: HTMLElement) => openPop(anchor, `<div class="menu-head">Export</div>${(Object.keys(EXPORT_LABELS) as ExportFormat[]).filter((f) => ui.developer || (f !== "csv" && f !== "json")).map((f) =>
  `<div class="list-item" role="menuitem" tabindex="0" data-act="doExport" data-arg="${f}"><span class="obj-name">${icon("export")}<span>${EXPORT_LABELS[f]}</span></span></div>`).join("")}
  <div class="sep"></div><div class="menu-head">Project</div>
  <div class="list-item" role="menuitem" tabindex="0" data-act="saveProject"><span class="obj-name">${icon("save")}Save project</span></div>
  <div class="list-item" role="menuitem" tabindex="0" data-act="openProject"><span class="obj-name">${icon("folder")}Open project…</span></div>
  <div class="list-item" role="menuitem" tabindex="0" data-act="importProfile"><span class="obj-name">${icon("import")}Import profile…</span></div>`);
function hoverReset() { views.forEach((v) => v.objs.forEach(clearHover)); lastCommit = ""; }
function zoneFill(k: number, w: number) {
  const ov = activeObjView(); if (!ov || objLocked() || !ov.obj.mask.regions[k]) return;
  ov.obj.mask.regions[k].weight.fill(w);
  if (w > 0) for (const [i, r] of ov.obj.mask.regions.entries()) if (i !== k) r.weight.fill(0);
  ov.maskVersion++; refreshMaskTexture(ov); renderStatus(); sliceActiveSoon(0);
}
let shapeRaf = 0;
function rebuildShape(ov: ObjView) {
  cancelAnimationFrame(shapeRaf);
  buildSurface(ov); placeObj(ov); focusActive(); ov.proj = undefined; renderStatus(); sliceActiveSoon();
}
const ACT: Record<string, (arg: string, el: HTMLElement) => void> = {
  noop: () => {},
  setMode: (a) => setMode(a as typeof ui.mode),
  toggleTheme: () => applyTheme(ui.theme === "dark" ? "light" : "dark"),
  toggleDrawer: () => { ui.drawerOpen = !ui.drawerOpen; renderAll(); },
  renameProject: () => { const n = prompt("Project name", ui.projectName); if (n?.trim()) { ui.projectName = n.trim(); renderTopbar(); } },
  plateMenu: (_, el) => pickPlateMenu(el), exportMenu: (_, el) => exportMenu(el),
  sliceNow,
  setDock: (a) => setDock(a as Dock), closeCard: () => setDock(null),
  selectObj: (a) => selectObject(Number(a)),
  dupObj: (a) => addObject(cloneObject(activeView().plate.objects[Number(a)])),
  delObj: (a) => deleteObject(Number(a)),
  centerObj: () => { const ov = activeObjView(); if (!ov || activeView().plate.locked) return; ov.obj.transform.x = 0; ov.obj.transform.y = 0; placeObj(ov); renderToolCard(); sliceActiveSoon(0); },
  rotateBy: (a) => { const ov = activeObjView(); if (!ov || activeView().plate.locked) return; const t = ov.obj.transform; t.rotation = a === "0" ? 0 : ((t.rotation + Number(a) + 540) % 360) - 180; buildSurface(ov); renderToolCard(); sliceActiveSoon(0); },
  arrange: (a) => arrangeAndReport(a === "all" ? views : [activeView()]),
  paintMode: (a) => { ui.paintErase = a === "erase"; ui.tool = toolFor(ui.dock); renderToolCard(); },
  selTarget: (a) => { ui.target = Number(a); ui.tool = toolFor(ui.dock); renderToolCard(); },
  addRegion: () => {
    const o = activeObjView()?.obj; if (!o) return;
    const pat = ui.dock === "faces" ? "knit" : "sine", k = addRegion(o.mask, pat); o.regionParams[k] = { ...patterns[pat].defaults };
    ui.target = k; ui.paintErase = false; ui.tool = toolFor(ui.dock); renderToolCard(); renderDrawer();
  },
  faceKind: (a) => { ui.faceKind = a as typeof ui.faceKind; hoverReset(); renderToolCard(); },
  faceOp: (a) => { ui.faceOp = a as typeof ui.faceOp; hoverReset(); renderToolCard(); },
  faceFill: (a) => { ui.faceFill = a as FillMode; hoverReset(); renderToolCard(); },
  clearZone: (a) => zoneFill(Number(a), 0),
  zoneAll: (a) => zoneFill(Number(a), 1),
  delZone: (a) => {
    const ov = activeObjView(); if (!ov || objLocked()) return; const k = Number(a);
    ov.obj.mask.regions.splice(k, 1); ov.obj.regionParams.splice(k, 1);
    ui.target = Math.min(ui.target, ov.obj.mask.regions.length - 1); if (ui.target < k && ui.target >= 0) ui.target = Math.max(0, ui.target);
    ov.maskVersion++; refreshMaskTexture(ov); renderToolCard(); renderDrawer(); renderStatus(); sliceActiveSoon(0);
  },
  resetShape: () => { const ov = activeObjView(); if (!ov || objLocked() || ov.obj.source.kind !== "primitive") return; delete ov.obj.source.params; rebuildShape(ov); renderToolCard(); },
  livePaths: () => { ui.livePaths = !ui.livePaths; if (ui.livePaths) sliceActiveSoon(0); updateSurfaceVisibility(); renderTopbar(); renderDrawer(); },
  plateTypeMenu: (_, el) => openPop(el, `<div class="menu-head">Build plate</div>${PLATE_TYPES.map((p) => `<div class="list-item${p.id === ui.plateType ? " on" : ""}" role="menuitem" tabindex="0" data-act="pickPlateType" data-arg="${p.id}"><span class="obj-name">${icon(p.id === ui.plateType ? "check" : "layers")}<span><b>${p.label}</b><br><small class="muted">${p.hint}</small></span></span></div>`).join("")}`),
  pickPlateType: (a) => { ui.plateType = a as PlateType; ui.plateTouched = true; layoutPlates(); renderDrawer(); },
  openModal: (a) => { ui.modal = a as PresetKind; renderModal(); },
  ...netActions(),
  closeModal,
  pickProcess: (a) => { ui.selected.process = a; delete ui.edited.process; ui.presetsOpen = false; afterPresetEdit("process"); },
  tier: (a) => { ui.tier = ui.tier === a ? null : (a as typeof ui.tier); renderDrawer(); },
  presetsMore: () => { ui.presetsOpen = !ui.presetsOpen; renderDrawer(); },
  nlMore: () => { ui.nlOpen = !ui.nlOpen; renderDrawer(); },
  presetSave: (kind) => {
    const k = kind as PresetKind, name = prompt("Preset name", `${registry.get(ui.selected[k])!.name} (custom)`); if (!name) return;
    const cur = registry.get(ui.selected[k])!, parent = cur.system ? cur.id : cur.inherits ?? cur.id, id = `user/${k}/${name.toLowerCase().replace(/\W+/g, "-")}`;
    registry.saveDelta(id, name, k, parent, presetValues(k) as never);
    ui.selected[k] = id; delete ui.edited[k]; persistUserPresets(); afterPresetEdit(k);
  },
  presetRevert: (kind) => { delete ui.edited[kind as PresetKind]; afterPresetEdit(kind as PresetKind); },
  presetDelete: (kind) => { const k = kind as PresetKind, cur = registry.get(ui.selected[k])!; registry.remove(cur.id); ui.selected[k] = cur.inherits ?? registry.list(k)[0].id; delete ui.edited[k]; persistUserPresets(); afterPresetEdit(k); },
  clearExclude: () => editMachine({ bedExclude: [] }),
  previewMode: (a) => { ui.preview = a as PreviewMode; views.forEach(redrawPaths); renderDrawer(); renderTray(); },
  play: () => { ui.playing = !ui.playing; if (ui.playing && ui.scrub >= 1) { ui.scrub = 0; } syncPlay(); },
  pickFormat: (a) => { ui.exportFormat = a as ExportFormat; renderDrawer(); },
  doExport: (a) => { ui.exportFormat = (a || ui.exportFormat) as ExportFormat; doExport(); },
  saveProject, openProject: () => byId("fileProject").click(), importProfile: () => byId("fileProfile").click(),
  selectPlate: (a) => selectPlate(Number(a)),
  lockPlate: (a) => { const v = views[Number(a)]; v.plate.locked = !v.plate.locked; layoutPlates(); renderAll(); },
  dupPlate: (a) => addPlate(clonePlate(views[Number(a)].plate)),
  delPlate: (a) => deletePlate(Number(a)),
  addPlate: () => addPlate(),
};
document.addEventListener("click", (e) => {
  const t = (e.target as Element).closest<HTMLElement>("[data-act]");
  if (!t || (t as HTMLButtonElement).disabled) return;
  const act = t.dataset.act!;
  if (t.closest("#pop") && act !== "plateMenu" && act !== "exportMenu") closePop();
  ACT[act]?.(t.dataset.arg ?? "", t);
});
document.addEventListener("keydown", (e) => { // keyboard activation for role="button" rows
  const t = e.target as HTMLElement, role = t.getAttribute?.("role");
  if ((e.key !== "Enter" && e.key !== " ") || (role !== "button" && role !== "menuitem") || !t.dataset.act) return;
  e.preventDefault(); t.click();
});
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.modal) closeModal(); });

// ======================= inputs =======================
type Phase = "input" | "change";
const syncRange = (el: HTMLInputElement) => {
  const out = el.closest(".row")?.querySelector(".v"), unit = out?.querySelector(".unit");
  if (out) { out.textContent = el.value; if (unit) out.append(unit); }
  el.style.setProperty("--p", `${pct(Number(el.value), Number(el.min), Number(el.max)).toFixed(1)}%`);
};
const objLocked = () => !!activeView()?.plate.locked;
const IN: Record<string, (el: HTMLInputElement, phase: Phase) => void> = {
  tf(el, phase) {
    const ov = activeObjView(); if (!ov || objLocked()) return;
    const t = ov.obj.transform, k = el.dataset.key as keyof typeof t, n = Number(el.value);
    if (k === "scaleXY" || k === "scaleZ") {
      t[k] = Math.max(0.1, n / 100);
      if (ui.uniform) {
        const other = k === "scaleXY" ? "scaleZ" : "scaleXY"; t[other] = t[k];
        const o2 = toolcard.querySelector<HTMLInputElement>(`[data-key="${other}"]`); if (o2) { o2.value = String(n); syncRange(o2); }
      }
    } else t[k] = n;
    if (el.type === "range") syncRange(el);
    if (el.type === "range" && phase === "input") applyObjTransform(ov); else buildSurface(ov);
    placeObj(ov); renderStatus(); sliceActiveSoon();
  },
  uniform: (el) => { ui.uniform = el.checked; },
  target: (el) => { ui.target = Number(el.value); ui.tool = toolFor(ui.dock); renderToolCard(); renderDrawer(); },
  pattern(el) {
    const ov = activeObjView(); if (!ov || objLocked()) return;
    const o = ov.obj, defs = { ...patterns[el.value].defaults };
    if (ui.target < 0) o.base = { pattern: el.value, params: defs }; else { o.mask.regions[ui.target].pattern = el.value; o.regionParams[ui.target] = defs; }
    buildSurface(ov); renderToolCard(); renderDrawer(); renderStatus(); sliceActiveSoon();
  },
  param(el) {
    const ov = activeObjView(); if (!ov || objLocked()) return;
    (ui.target < 0 ? ov.obj.base.params : ov.obj.regionParams[ui.target])[el.dataset.key as keyof PatternParams] = Number(el.value);
    syncRange(el); ui.dragSlider = true; renderStatus(); sliceActiveSoon();
  },
  brush: (el) => { ui.brush = Number(el.value); syncRange(el); },
  showSurface: (el) => { ui.showSurface = el.checked; updateSurfaceVisibility(); },
  addPrim(el) {
    const k = el.value as PrimitiveName;
    if (k) { const o = newObject({ kind: "primitive", primitive: k, params: primitiveDefaults(k) }); o.base = { pattern: "none", params: { ...patterns.none.defaults } }; addObject(o); }
    el.value = "";
  },
  shape(el, phase) {
    const ov = activeObjView(); if (!ov || objLocked() || ov.obj.source.kind !== "primitive") return;
    const src = ov.obj.source; src.params = { ...primitiveDefaults(src.primitive), ...src.params, [el.dataset.key!]: Number(el.value) };
    syncRange(el); ui.dragSlider = true;
    if (phase === "input") { cancelAnimationFrame(shapeRaf); shapeRaf = requestAnimationFrame(() => rebuildShape(ov)); } else rebuildShape(ov);
  },
  pf(el) {
    if (!ui.draft) return; const key = el.dataset.key as string;
    (ui.draft as Record<string, unknown>)[key] = el.value; ui.draft.msg = undefined;
    if (key === "kind") renderModal(); // other fields must not re-render: it would swallow the click that caused the blur
  },
  faceAngle: (el) => { ui.faceAngle = Number(el.value); syncRange(el); hoverReset(); },
  edgeAngle: (el) => { ui.edgeAngle = Number(el.value); syncRange(el); hoverReset(); },
  edgeBand: (el) => { ui.edgeBand = Number(el.value); syncRange(el); hoverReset(); },
  edgeChain: (el) => { ui.edgeChain = el.checked; hoverReset(); },
  developer: (el) => { ui.developer = el.checked; if (!ui.developer && (ui.exportFormat === "csv" || ui.exportFormat === "json")) ui.exportFormat = "gcode"; renderAll(); },
  presetSel(el) { if (!ui.modal || ui.modal === "printer") return; const kind = ui.modal; ui.selected[kind] = el.value; delete ui.edited[kind]; afterPresetEdit(kind); },
  path(el, phase) {
    const kind = (el.dataset.kind as PresetKind | undefined) ?? (ui.modal === "printer" ? null : ui.modal); if (!kind) return;
    const val = el.type === "checkbox" ? el.checked : el.type === "number" || el.type === "range" ? Number(el.value) : el.dataset.array ? el.value.split(",").map(Number) : el.value;
    setPresetValue(kind, el.dataset.path!, val);
    if (el.type === "range" && phase === "input") { syncRange(el); ui.dragSlider = true; renderStatus(); sliceActiveSoon(); return; }
    ui.dragSlider = false; afterPresetEdit(kind);
  },
};
for (const phase of ["input", "change"] as const) document.addEventListener(phase, (e) => {
  const el = e.target as HTMLInputElement, name = el.dataset?.in; if (!name) return;
  if (phase === "input" && el.type !== "range") return; // text/number/select commit on change; sliders are live
  IN[name]?.(el, phase);
});
document.addEventListener("pointerup", () => { if (ui.dragSlider) { ui.dragSlider = false; renderDrawer(); } });

// ---------- hidden file inputs ----------
const fileHandler = (id: string, fn: (files: FileList) => void) => { const el = byId<HTMLInputElement>(id); el.onchange = () => { if (el.files?.length) fn(el.files); el.value = ""; }; };
byId<HTMLInputElement>("fileImport").accept = ACCEPT;
fileHandler("fileImport", (f) => importFiles(f)); fileHandler("fileProject", (f) => importFiles([f[0]])); fileHandler("fileProfile", (f) => importFiles(f));
fileHandler("fileToolhead", async (fl) => {
  try {
    const r = await parseInWorker(fl[0]);
    const mesh = r.kind === "meshes" ? r.meshes[0] : r.kind === "3mf" ? r.data.objects[0]?.mesh : undefined;
    if (!mesh) throw new Error("No geometry in file");
    const g = prompt("Gantry height above nozzle tip (mm). Geometry above it is treated as gantry, not toolhead:", String(machine().clearanceHeight));
    if (g === null) return;
    const env = toolheadEnvelope(mesh, Number(g) > 0 ? Number(g) : undefined);
    editMachine({ clearanceRadius: env.clearanceRadius, clearanceHeight: env.clearanceHeight });
    alert(`Toolhead envelope: radius ${env.clearanceRadius} mm, gantry ${env.clearanceHeight} mm.\nRadius by height: ${env.profile.map((b) => `${b.z}mm:${b.r.toFixed(0)}`).join(" ")}\nSave the printer preset to keep it.`);
  } catch (err) { alert(`Toolhead import failed: ${err instanceof Error ? err.message : err}`); }
});
fileHandler("fileExclude", async (fl) => {
  try { const r = parseBedExclusionSVG(await fl[0].text()); editMachine({ bedExclude: r.polygons }); if (r.warnings.length) alert(r.warnings.join("\n")); }
  catch (err) { alert(`Bed exclusion import failed: ${err instanceof Error ? err.message : err}`); }
});
fileHandler("fileBedPng", (fl) => {
  const url = URL.createObjectURL(fl[0]);
  new THREE.TextureLoader().load(url, (t) => { bedTexture = t; layoutPlates(); }, undefined, () => alert("Could not read image"));
});
function editMachine(patch: Partial<MachinePreset>) {
  ui.edited.machine = { ...structuredClone(machine()), ...patch };
  onPresetsChanged();
}


// drag & drop STL onto the viewport
view.addEventListener("dragover", (e) => e.preventDefault());
view.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer?.files.length) importFiles(e.dataTransfer.files); });

// ======================= loop =======================
function resize() {
  const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  viewShift.dirty = true; // re-apply the view offset for the new size
  updateViewInsets();
}
new ResizeObserver(resize).observe(view);
let frames = 0, last = performance.now(), lastFrame = last;
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  stepViewShift();
  controls.update();
  if (ui.playing) { // toolpath playback: a full pass takes ~10 s
    ui.scrub = Math.min(1, ui.scrub + dt / 10); if (ui.scrub >= 1) { ui.playing = false; syncPlay(); }
    scrubEl.value = String(ui.scrub); scrubEl.style.setProperty("--p", `${ui.scrub * 100}%`); views.forEach(applyLayerRange); updateReadout();
  }
  for (const v of views) {
    const far = camera.position.distanceTo(v.group.position) > 450, hasLod = v.lines.some((l) => l.userData.lod === "far");
    if (!dragging) for (const l of v.lines) l.visible = showPaths() && (!hasLod || (l.userData.lod === "far") === far);
  }
  renderer.render(scene, camera);
  frames++;
  if (now - last > 1000) { stats.fps = (frames * 1000) / (now - last); frames = 0; last = now; if (ui.developer) renderToast(); }
});

applyThemeBoot();
addPlate(newPlate("Plate 1"));
resize();
function applyThemeBoot() { setThemeAttr(ui.theme); }
if (import.meta.env?.DEV) (window as unknown as Record<string, unknown>).__ns = { ui, views, scene, camera, THREE };
