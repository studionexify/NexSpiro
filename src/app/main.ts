import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  patterns, primitives, addRegion, stamp, toGcode, formatDuration, PresetRegistry, newPlate, clonePlate,
  serializeProject, deserializeProject,
  type PatternParams, type PrimitiveName, type MotionPath, type SliceStats, type PlateIssue, type Plate,
  type MachinePreset, type FilamentPreset, type ProcessPreset, type PresetKind, type Preset, type Thumbnail,
} from "../core/index.ts";
import type { SliceRequest } from "./worker.ts";

// ======================= state =======================
const REGION_COLORS = [0x4c8dff, 0xff6b5b, 0x3ccf91, 0xffb454, 0xc77dff, 0x2fd3e0, 0xf7768e];
const BASE_COLOR = new THREE.Color(0xd8dce4);
type PreviewMode = "feature" | "speed" | "height" | "layerTime" | "curvature";
const PREVIEW_LABELS: Record<PreviewMode, string> = {
  feature: "Feature type (paint region)", speed: "Speed", height: "Height", layerTime: "Layer time",
  curvature: "Curvature & Non-Linear Feedrate",
};
type SliceResult = { mp: MotionPath; stats: SliceStats; issues: PlateIssue[]; zClipped: number; ms: number; key: string };
type PlateView = {
  plate: Plate; group: THREE.Group; bed: THREE.LineSegments; surface: THREE.Mesh | null;
  line: THREE.Line | null; lod: THREE.Line | null;
  maskTex: THREE.DataTexture; status: "idle" | "slicing" | "done" | "error"; error?: string;
  result?: SliceResult; maskVersion: number; worker: Worker; reqId: number;
};

const USER_PRESETS_KEY = "nexspiro.userPresets";
const registry = new PresetRegistry();
try { for (const p of JSON.parse(localStorage.getItem(USER_PRESETS_KEY) ?? "[]") as Preset[]) registry.add(p); } catch { /* storage unavailable */ }
const persistUserPresets = () => { try { localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(registry.user())); } catch { /* ignore */ } };

const ui = {
  tab: "prepare" as "prepare" | PresetKind,
  selected: { machine: "machine/bambu-x1", filament: "filament/pla", process: "process/vase-0.4" } as Record<PresetKind, string>,
  edited: {} as Partial<Record<PresetKind, MachinePreset | FilamentPreset | ProcessPreset>>, // unsaved edits
  active: 0, target: -1, painting: false, erase: false, brush: 8, showSurface: true,
  preview: "feature" as PreviewMode, layerMin: 0, layerMax: 1,
};
const presetValues = <K extends PresetKind>(k: K) =>
  (ui.edited[k] ?? registry.resolve<K>(ui.selected[k])) as K extends "machine" ? MachinePreset : K extends "filament" ? FilamentPreset : ProcessPreset;
const machine = () => presetValues("machine"), filament = () => presetValues("filament"), proc = () => presetValues("process");

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
  const [bx, by] = machine().bed, pts: number[] = [], step = 32;
  const hx = bx / 2, hy = by / 2;
  for (let x = -hx; x <= hx + 1e-6; x += step) pts.push(x, -hy, 0, x, hy, 0);
  for (let y = -hy; y <= hy + 1e-6; y += step) pts.push(-hx, y, 0, hx, y, 0);
  pts.push(-hx, -hy, 0, hx, -hy, 0, hx, -hy, 0, hx, hy, 0, hx, hy, 0, -hx, hy, 0, -hx, hy, 0, -hx, -hy, 0);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: locked ? 0x7a5c2e : active ? 0x4c8dff : 0x2e3440 }));
}

function makeView(plate: Plate): PlateView {
  const maskTex = new THREE.DataTexture(new Uint8Array(plate.mask.cols * plate.mask.rows * 4), plate.mask.cols, plate.mask.rows);
  maskTex.wrapS = THREE.RepeatWrapping; maskTex.magFilter = THREE.LinearFilter;
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const v: PlateView = { plate, group: new THREE.Group(), bed: bedLines(false, false), surface: null, line: null, lod: null, maskTex, status: "idle", maskVersion: 0, worker, reqId: 0 };
  worker.onmessage = (ev) => onSliced(v, ev.data);
  v.group.add(v.bed);
  scene.add(v.group);
  refreshMaskTexture(v);
  return v;
}
function disposeView(v: PlateView) {
  v.worker.terminate(); scene.remove(v.group);
  v.group.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); });
}
function layoutPlates() {
  views.forEach((v, i) => {
    v.group.position.copy(plateOrigin(i));
    v.group.remove(v.bed); v.bed.geometry.dispose();
    v.bed = bedLines(i === ui.active, v.plate.locked); v.group.add(v.bed);
  });
}

function buildSurface(v: PlateView) {
  const prof = primitives[v.plate.primitive](), C = 128, R = 64, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= R; j++) for (let i = 0; i <= C; i++) {
    const u = i / C, t = j / R, r = prof.radius(t), a = u * Math.PI * 2;
    pos.push(r * Math.cos(a), r * Math.sin(a), t * prof.height); uv.push(u, t);
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
    const a = j * (C + 1) + i, b = a + 1, c = a + C + 1, d = c + 1;
    idx.push(a, b, d, a, d, c); // winding → outward normals
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  if (v.surface) { v.group.remove(v.surface); v.surface.geometry.dispose(); }
  v.surface = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: v.maskTex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  const t = v.plate.transform;
  v.surface.scale.set(t.scaleXY, t.scaleXY, t.scaleZ);
  v.surface.rotation.z = (t.rotation * Math.PI) / 180;
  v.group.add(v.surface);
  updateSurfaceVisibility();
}
const updateSurfaceVisibility = () => views.forEach((v, i) => { if (v.surface) v.surface.visible = ui.showSurface && i === ui.active; });

function refreshMaskTexture(v: PlateView) {
  const d = v.maskTex.image.data as Uint8Array, c = new THREE.Color();
  d.fill(0);
  v.plate.mask.regions.forEach((reg, k) => {
    c.set(REGION_COLORS[k % REGION_COLORS.length]);
    for (let i = 0; i < reg.weight.length; i++) {
      const w = reg.weight[i]; if (w <= 0) continue;
      const o = i * 4;
      d[o] = Math.max(d[o], c.r * 255 * w); d[o + 1] = Math.max(d[o + 1], c.g * 255 * w);
      d[o + 2] = Math.max(d[o + 2], c.b * 255 * w); d[o + 3] = Math.max(d[o + 3], 220 * w);
    }
  });
  v.maskTex.needsUpdate = true;
}

// ======================= preview colouring =======================
const ramp = (t: number, c: THREE.Color) => c.setHSL((1 - Math.min(1, Math.max(0, t))) * 0.66, 0.85, 0.55); // blue→red
function legendRange(mp: MotionPath, mode: PreviewMode): [number, number, string] {
  if (mode === "speed" || mode === "curvature") { let lo = Infinity, hi = 0; for (let i = 1; i < mp.count; i++) { lo = Math.min(lo, mp.feed[i]); hi = Math.max(hi, mp.feed[i]); } return [lo, hi, "mm/s"]; }
  if (mode === "height") { let hi = 0; for (let i = 0; i < mp.count; i++) hi = Math.max(hi, mp.xyz[i * 3 + 2]); return [0, hi, "mm"]; }
  if (mode === "layerTime") { let lo = Infinity, hi = 0; for (const t of mp.layerTime) { lo = Math.min(lo, t); hi = Math.max(hi, t); } return [lo, hi, "s"]; }
  return [0, 0, ""];
}
function makeLine(mp: MotionPath, stride: number, mode: PreviewMode): THREE.Line {
  const n = Math.floor((mp.count - 1) / stride) + 1, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const c = new THREE.Color(), [lo, hi] = legendRange(mp, mode), span = hi - lo || 1;
  let kMax = 0; if (mode === "curvature") for (let i = 0; i < mp.count; i++) kMax = Math.max(kMax, mp.curvature[i]);
  for (let k = 0; k < n; k++) {
    const i = k * stride;
    pos[k * 3] = mp.xyz[i * 3]; pos[k * 3 + 1] = mp.xyz[i * 3 + 1]; pos[k * 3 + 2] = mp.xyz[i * 3 + 2];
    switch (mode) {
      case "feature": if (mp.tag[i] === 0) c.copy(BASE_COLOR); else c.set(REGION_COLORS[(mp.tag[i] - 1) % REGION_COLORS.length]); break;
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
  line.userData.stride = stride; line.frustumCulled = false;
  return line;
}
function redrawPaths(v: PlateView) {
  for (const l of [v.line, v.lod]) if (l) { v.group.remove(l); l.geometry.dispose(); }
  v.line = v.lod = null;
  if (!v.result) return;
  v.line = makeLine(v.result.mp, 1, ui.preview); v.group.add(v.line);
  if (v.result.mp.count > 400_000) { v.lod = makeLine(v.result.mp, 4, ui.preview); v.group.add(v.lod); }
  applyLayerRange(v);
}
function applyLayerRange(v: PlateView) {
  if (!v.result) return;
  const { layer, count } = v.result.mp, layers = layer[count - 1] + 1;
  const lo = Math.floor(ui.layerMin * (layers - 1)), hi = Math.ceil(ui.layerMax * (layers - 1));
  const first = (L: number) => { let a = 0, b = count; while (a < b) { const m = (a + b) >> 1; if (layer[m] < L) a = m + 1; else b = m; } return a; };
  const a = first(lo), b = first(hi + 1);
  for (const l of [v.line, v.lod]) if (l) { const s = l.userData.stride as number; l.geometry.setDrawRange(Math.floor(a / s), Math.max(0, Math.ceil((b - a) / s))); }
}

// ======================= slicing (worker per plate, cached) =======================
function sliceKey(v: PlateView) {
  const p = v.plate;
  return JSON.stringify([p.primitive, p.transform, p.base, p.regionParams, p.mask.regions.map((r) => r.pattern), v.maskVersion, machine(), filament(), proc()]);
}
function slice(v: PlateView) {
  const key = sliceKey(v);
  if (v.result?.key === key && v.status === "done") return; // cached
  v.status = "slicing"; v.reqId++;
  const plate: Plate = { ...v.plate, mask: { ...v.plate.mask, regions: v.plate.mask.regions.map((r) => ({ ...r, weight: r.weight.slice() })) } };
  const req: SliceRequest = { id: v.reqId, plateId: v.plate.id, plate, machine: machine(), filament: filament(), process: proc() };
  (v as PlateView & { pendingKey?: string }).pendingKey = key;
  v.worker.postMessage(req);
  renderStatus();
}
function onSliced(v: PlateView, d: { id: number; ok: boolean; error?: string } & Omit<SliceResult, "key">) {
  if (d.id !== v.reqId) return; // superseded
  if (!d.ok) { v.status = "error"; v.error = d.error; renderStatus(); return; }
  v.result = { mp: d.mp, stats: d.stats, issues: d.issues, zClipped: d.zClipped, ms: d.ms, key: (v as PlateView & { pendingKey?: string }).pendingKey! };
  v.status = "done";
  redrawPaths(v); renderStatus(); renderPlateBar();
}
let sliceTimer = 0;
const sliceActiveSoon = (ms = 150) => { clearTimeout(sliceTimer); sliceTimer = window.setTimeout(() => slice(views[ui.active]), ms); };
const sliceAll = () => views.forEach(slice);

// ======================= painting (outer surface only) =======================
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), nrm = new THREE.Vector3();
let stroking = false;
function paintAt(ev: PointerEvent) {
  const v = views[ui.active];
  if (!v.surface || ui.target < 0 || v.plate.locked) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(v.surface).find((h) => h.face && nrm.copy(h.face.normal).transformDirection(v.surface!.matrixWorld).dot(ray.ray.direction) < 0);
  if (!hit?.uv) return;
  stamp(v.plate.mask, ui.target, hit.uv.x, hit.uv.y, ui.brush, ui.erase);
  v.maskVersion++; refreshMaskTexture(v);
}
renderer.domElement.addEventListener("pointerdown", (ev) => {
  if (!ui.painting || ev.button !== 0 || ui.target < 0) return;
  stroking = true; controls.enabled = false; paintAt(ev);
});
renderer.domElement.addEventListener("pointermove", (ev) => { if (stroking) paintAt(ev); });
window.addEventListener("pointerup", () => { if (stroking) { stroking = false; controls.enabled = true; sliceActiveSoon(0); } });

// ======================= plates =======================
function addPlate(p = newPlate(`Plate ${views.length + 1}`)) {
  const v = makeView(p); views.push(v); buildSurface(v);
  ui.active = views.length - 1; ui.target = -1;
  layoutPlates(); focusActive(); slice(v); renderAll();
}
function deletePlate(i: number) {
  if (views.length <= 1 || views[i].plate.locked) return;
  disposeView(views[i]); views.splice(i, 1);
  ui.active = Math.min(ui.active, views.length - 1); ui.target = -1;
  layoutPlates(); focusActive(); renderAll();
}
function selectPlate(i: number) { ui.active = i; ui.target = -1; layoutPlates(); updateSurfaceVisibility(); focusActive(); renderAll(); }
function focusActive() {
  const o = plateOrigin(ui.active), v = views[ui.active];
  const h = primitives[v.plate.primitive]().height * v.plate.transform.scaleZ;
  const delta = camera.position.clone().sub(controls.target);
  controls.target.set(o.x, o.y, h / 2); camera.position.copy(controls.target).add(delta);
}
let clipboard: Plate | null = null;
window.addEventListener("keydown", (ev) => {
  if ((ev.target as HTMLElement).closest("input, textarea, select")) return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key === "c") clipboard = clonePlate(views[ui.active].plate);
  else if (mod && ev.key === "v" && clipboard) addPlate(clonePlate(clipboard));
  else if (mod && ev.key === "d") addPlate(clonePlate(views[ui.active].plate));
  else if (ev.key === "Delete") deletePlate(ui.active);
  else return;
  ev.preventDefault();
});

// ======================= project I/O & export =======================
function download(name: string, data: BlobPart, type = "application/octet-stream") {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function saveProject() {
  const userPresets = registry.user();
  download("project.nexspiro", serializeProject({ version: 1, presets: { ...ui.selected } as never, userPresets, plates: views.map((v) => v.plate) }), "application/json");
}
async function loadProject(file: File) {
  try {
    const proj = deserializeProject(await file.text());
    for (const p of proj.userPresets) registry.add(p);
    persistUserPresets();
    for (const k of ["machine", "filament", "process"] as const) if (registry.get(proj.presets[k])) ui.selected[k] = proj.presets[k];
    ui.edited = {};
    views.splice(0).forEach(disposeView);
    for (const p of proj.plates) { const v = makeView(p); views.push(v); buildSurface(v); }
    ui.active = 0; ui.target = -1; layoutPlates(); focusActive(); sliceAll(); renderAll();
  } catch (e) { alert(`Could not open project: ${e}`); }
}
function thumbnails(v: PlateView): Thumbnail[] {
  // Render the plate alone from a fixed 3/4 view into an offscreen renderer at each size.
  const sizes = [[300, 300], [96, 96]] as const, out: Thumbnail[] = [];
  const hidden = views.filter((o) => o !== v).map((o) => { const was = o.group.visible; o.group.visible = false; return [o, was] as const; });
  const surfVis = v.surface?.visible; if (v.surface) v.surface.visible = false;
  const prevBg = scene.background; scene.background = null;
  const box = new THREE.Box3().setFromObject(v.line ?? v.group), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  const cam = new THREE.PerspectiveCamera(35, 1, 0.5, 5000); cam.up.set(0, 0, 1);
  cam.position.copy(c).add(new THREE.Vector3(1, -1, 0.8).normalize().multiplyScalar(r / Math.sin((17.5 * Math.PI) / 180))); cam.lookAt(c);
  v.bed.visible = false;
  const tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  for (const [w, h] of sizes) { tr.setSize(w, h, false); tr.render(scene, cam); out.push({ width: w, height: h, pngBase64: tr.domElement.toDataURL("image/png").split(",")[1] }); }
  tr.dispose();
  v.bed.visible = true; scene.background = prevBg; if (v.surface) v.surface.visible = !!surfVis;
  hidden.forEach(([o, was]) => (o.group.visible = was));
  return out;
}
function exportGcode(i = ui.active) {
  const v = views[i];
  if (!v.result || v.status !== "done") { alert("Slice the plate first."); return; }
  if (v.result.issues.some((x) => x.level === "error")) { if (!confirm("This plate has errors. Export anyway?")) return; }
  const M = machine();
  const g = toGcode(v.result.mp, {
    machine: M, filament: filament(), process: proc(), offset: [M.bed[0] / 2, M.bed[1] / 2], thumbnails: thumbnails(v),
    presetNames: { machine: registry.get(ui.selected.machine)!.name, filament: registry.get(ui.selected.filament)!.name, process: registry.get(ui.selected.process)!.name },
  });
  download(`${v.plate.name.replace(/\W+/g, "_")}-${v.plate.primitive}.gcode`, g, "text/plain");
}

// ======================= UI =======================
const panel = document.getElementById("panel")!, statsEl = document.getElementById("stats")!;
const opt = (v: string, label: string, sel: boolean) => `<option value="${v}"${sel ? " selected" : ""}>${label}</option>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const PARAM_UI: [keyof PatternParams, string, number, number, number][] = [
  ["amplitude", "Amplitude mm", 0, 4, 0.05], ["wavesPerRev", "Waves / rev", 0, 200, 1],
  ["phasePerLayer", "Phase / layer °", 0, 360, 1], ["zAmplitude", "Z wobble mm", 0, 1.5, 0.01],
  ["extrusionPulse", "Extrusion pulse", 0, 1, 0.01],
];
const LABELS: Record<string, string> = {
  flavor: "G-code flavor", bed: "Bed size X,Y (mm)", maxHeight: "Max height (mm)", nozzle: "Nozzle Ø (mm)",
  zWobbleMax: "Max Z wobble / clearance (mm)", maxZSpeed: "Max Z speed (mm/s)", maxAccel: "Max acceleration (mm/s²)",
  travelSpeed: "Travel speed (mm/s)", retractLength: "Retraction length (mm)", retractSpeed: "Retraction speed (mm/s)",
  clearanceRadius: "Toolhead clearance radius (mm)", clearanceHeight: "Toolhead clearance height (mm)",
  startGcode: "Start G-code", endGcode: "End G-code", layerChangeGcode: "Layer change G-code",
  diameter: "Diameter (mm)", flowRatio: "Flow ratio", density: "Density (g/cm³)", costPerKg: "Cost per kg",
  nozzleTempFirst: "Nozzle temp, first layer (°C)", nozzleTemp: "Nozzle temp, other layers (°C)",
  bedTempFirst: "Bed temp, first layer (°C)", bedTemp: "Bed temp, other layers (°C)", maxVolumetric: "Max volumetric speed (mm³/s)",
  fanMin: "Fan min (%)", fanMax: "Fan max (%)", fanOffFirstLayers: "No cooling for first N layers",
  fanMaxBelowLayerTime: "Full fan if layer time below (s)", slowdownLayerTime: "Slow down if layer time below (s)", minSpeed: "Min print speed (mm/s)",
  layerHeight: "Layer height (mm)", firstLayerHeight: "First layer height (mm)", lineWidth: "Line width (mm)",
  wallSpeed: "Wall speed (mm/s)", firstLayerSpeed: "First layer speed (mm/s)", segmentsPerRev: "Segments per revolution", fadeHeight: "Pattern fade-in height (mm)",
  enabled: "Enable non-linear motion (off = planar)", deviationTol: "Curve deviation tolerance (mm)", maxInclination: "Max surface inclination (°)",
  collisionMargin: "Toolhead collision margin (mm)", zSmoothing: "Z feedrate / jerk smoothing (0–1)",
};
const GROUPS: Record<PresetKind, [string, string[]][]> = {
  machine: [["Basic", ["flavor", "bed", "maxHeight", "nozzle"]], ["Motion", ["maxZSpeed", "maxAccel", "travelSpeed", "retractLength", "retractSpeed"]],
    ["Toolhead clearance", ["zWobbleMax", "clearanceRadius", "clearanceHeight"]], ["Machine G-code", ["startGcode", "layerChangeGcode", "endGcode"]]],
  filament: [["Basic", ["diameter", "flowRatio", "density", "costPerKg"]], ["Temperature", ["nozzleTempFirst", "nozzleTemp", "bedTempFirst", "bedTemp"]],
    ["Volumetric speed", ["maxVolumetric"]], ["Cooling", ["fanMin", "fanMax", "fanOffFirstLayers", "fanMaxBelowLayerTime", "slowdownLayerTime", "minSpeed"]]],
  process: [["Quality", ["layerHeight", "firstLayerHeight", "lineWidth", "segmentsPerRev", "fadeHeight"]], ["Speed", ["wallSpeed", "firstLayerSpeed"]],
    ["NexSpiro Non-Linear Motion", ["nonLinear.enabled", "nonLinear.deviationTol", "nonLinear.maxInclination", "nonLinear.collisionMargin", "nonLinear.zSmoothing"]]],
};

function field(path: string, value: unknown): string {
  const key = path.split(".").pop()!, label = LABELS[key] ?? key;
  if (typeof value === "boolean") return `<label>${label} <input type="checkbox" data-path="${path}"${value ? " checked" : ""}></label>`;
  if (typeof value === "number") return `<label>${label} <input type="number" step="any" data-path="${path}" value="${value}"></label>`;
  if (key === "flavor") return `<label>${label} <select data-path="${path}">${["marlin", "klipper", "bambu"].map((f) => opt(f, f, f === value)).join("")}</select></label>`;
  if (Array.isArray(value)) return `<label>${label} <input type="text" data-path="${path}" data-array="1" value="${value.join(",")}"></label>`;
  return `<div class="field-block">${label}<textarea data-path="${path}" rows="5">${esc(String(value))}</textarea></div>`;
}
const getPath = (o: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], o);
function setPath(o: Record<string, unknown>, path: string, v: unknown) {
  const ks = path.split("."), last = ks.pop()!;
  (ks.reduce<Record<string, unknown>>((a, k) => a[k] as Record<string, unknown>, o))[last] = v;
}

function renderPresetTab(kind: PresetKind) {
  const vals = presetValues(kind) as unknown as Record<string, unknown>, dirty = !!ui.edited[kind];
  const cur = registry.get(ui.selected[kind])!;
  const list = registry.list(kind);
  return `
    <label>Preset <select id="presetSel">${list.map((p) => opt(p.id, `${p.system ? "" : "★ "}${p.name}`, p.id === ui.selected[kind])).join("")}</select></label>
    <div class="muted">${cur.inherits ? `inherits ${registry.get(cur.inherits)?.name ?? cur.inherits}` : "root preset"}${dirty ? ' · <span class="warn">modified</span>' : ""}</div>
    <button id="presetSave" class="primary">Save as…</button>${dirty ? '<button id="presetRevert">Revert</button>' : ""}${!cur.system ? '<button id="presetDelete">Delete</button>' : ""}
    ${GROUPS[kind].map(([g, keys]) => `<h2>${g}</h2>${keys.map((k) => field(k, getPath(vals, k))).join("")}`).join("")}`;
}

function renderPrepareTab() {
  const v = views[ui.active], p = v.plate, P = ui.target < 0 ? p.base.params : p.regionParams[ui.target];
  const pat = ui.target < 0 ? p.base.pattern : p.mask.regions[ui.target].pattern, dis = p.locked ? " disabled" : "";
  return `
    <h2>Object · ${esc(p.name)}${p.locked ? " 🔒" : ""}</h2>
    <label>Model <select id="primitive"${dis}>${Object.keys(primitives).map((k) => opt(k, k, k === p.primitive)).join("")}</select></label>
    <label>Scale XY % <input type="number" id="scaleXY" step="1" min="10" max="400" value="${Math.round(p.transform.scaleXY * 100)}"${dis}></label>
    <label>Scale Z % <input type="number" id="scaleZ" step="1" min="10" max="400" value="${Math.round(p.transform.scaleZ * 100)}"${dis}></label>
    <label>Rotate Z ° <input type="number" id="rotation" step="5" value="${p.transform.rotation}"${dis}></label>

    <h2>Wall pattern</h2>
    <label>Target <select id="target">${opt("-1", "Base wall", ui.target < 0)}${p.mask.regions.map((_, k) => opt(String(k), `Region ${k + 1}`, k === ui.target)).join("")}</select></label>
    <label>Pattern <select id="pattern"${dis}>${Object.entries(patterns).map(([k, x]) => opt(k, x.label, k === pat)).join("")}</select></label>
    ${PARAM_UI.map(([k, l, mn, mx, st]) => `<label>${l} <input type="range" data-param="${k}" min="${mn}" max="${mx}" step="${st}" value="${P[k]}"${dis}><span class="v">${P[k]}</span></label>`).join("")}

    <h2>Paint regions</h2>
    ${p.mask.regions.map((r, k) => `<div><span class="swatch" style="background:#${REGION_COLORS[k % REGION_COLORS.length].toString(16).padStart(6, "0")}"></span>Region ${k + 1} · ${patterns[r.pattern].label}</div>`).join("") || '<div class="muted">No regions. The whole wall uses the base pattern.</div>'}
    <button id="addRegion"${dis}>+ Add region</button>
    <button id="paint" class="${ui.painting && !ui.erase ? "on" : ""}"${dis}>Paint</button>
    <button id="erase" class="${ui.painting && ui.erase ? "on" : ""}"${dis}>Erase</button>
    <label>Brush size <input type="range" id="brush" min="1" max="40" step="1" value="${ui.brush}"><span class="v">${ui.brush}</span></label>
    <label>Show paint surface <input type="checkbox" id="showSurface"${ui.showSurface ? " checked" : ""}></label>

    <h2>Preview</h2>
    <label>Color by <select id="previewMode">${(Object.keys(PREVIEW_LABELS) as PreviewMode[]).map((m) => opt(m, PREVIEW_LABELS[m], m === ui.preview)).join("")}</select></label>
    <label>Layer from <input type="range" id="layerMin" min="0" max="1" step="0.001" value="${ui.layerMin}"></label>
    <label>Layer to <input type="range" id="layerMax" min="0" max="1" step="0.001" value="${ui.layerMax}"></label>`;
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
    <button id="export" class="primary">Export G-code</button>
    <button id="saveProject">Save project</button><button id="openProject">Open…</button>
    <input type="file" id="projectFile" accept=".nexspiro,application/json" hidden>`;
  bindPanel();
}

function renderPlateBar() {
  let bar = document.getElementById("plates");
  if (!bar) { bar = document.createElement("div"); bar.id = "plates"; view.append(bar); }
  bar.innerHTML = views.map((v, i) => {
    const st = v.status === "done" ? (v.result!.issues.some((x) => x.level === "error") ? "⚠" : "✓") : v.status === "slicing" ? "…" : v.status === "error" ? "✕" : "";
    return `<div class="plate${i === ui.active ? " on" : ""}" data-plate="${i}">
      <span>${esc(v.plate.name)} ${st}</span>
      <button data-lock="${i}" title="Lock plate">${v.plate.locked ? "🔒" : "🔓"}</button>
      <button data-dup="${i}" title="Duplicate (Ctrl+D)">⧉</button>
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
  const v = views[ui.active]; if (!v) return;
  const r = v.result, M = machine();
  let s = `${v.plate.name} · ${v.status}${v.status === "error" ? ": " + v.error : ""} · ${stats.fps.toFixed(0)} fps\n`;
  if (r) {
    s += `${formatDuration(r.stats.timeS)} · ${r.stats.grams.toFixed(1)} g · ${(r.stats.filamentMm / 1000).toFixed(2)} m · ${r.stats.layers} layers · cost ${r.stats.cost.toFixed(2)}\n`;
    s += `${r.mp.count.toLocaleString()} moves (${r.mp.decimated.toLocaleString()} decimated) · sliced in ${r.ms.toFixed(0)} ms\n`;
    if (ui.preview !== "feature") { const [lo, hi, unit] = legendRange(r.mp, ui.preview); s += `${PREVIEW_LABELS[ui.preview]}: <span style="color:hsl(240,85%,60%)">${lo.toFixed(1)}</span> → <span style="color:hsl(0,85%,60%)">${hi.toFixed(1)}</span> ${unit}\n`; }
    if (r.zClipped) s += `<span class="warn">Z wobble capped at ±${M.zWobbleMax} mm on ${r.zClipped.toLocaleString()} points</span>\n`;
    if (r.mp.inclinationViolations) s += `<span class="warn">${r.mp.inclinationViolations.toLocaleString()} segments exceed max inclination ${proc().nonLinear.maxInclination}°</span>\n`;
    for (const i of r.issues) s += `<span class="${i.level === "error" ? "err" : "warn"}">${esc(i.message)}</span>\n`;
  }
  statsEl.innerHTML = s;
}
function renderAll() { renderPanel(); renderPlateBar(); renderStatus(); }

function bindPanel() {
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T | null;
  panel.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.onclick = () => { ui.tab = b.dataset.tab as typeof ui.tab; renderPanel(); });
  const v = views[ui.active], p = v.plate;
  const changed = () => { renderStatus(); sliceActiveSoon(); };

  if (ui.tab === "prepare") {
    $<HTMLSelectElement>("primitive")!.onchange = (e) => { p.primitive = (e.target as HTMLSelectElement).value as PrimitiveName; buildSurface(v); focusActive(); changed(); };
    for (const k of ["scaleXY", "scaleZ", "rotation"] as const) $(k)!.onchange = (e) => {
      const n = Number((e.target as HTMLInputElement).value); p.transform[k] = k === "rotation" ? n : Math.max(0.1, n / 100); buildSurface(v); changed();
    };
    $<HTMLSelectElement>("target")!.onchange = (e) => { ui.target = Number((e.target as HTMLSelectElement).value); renderPanel(); };
    $<HTMLSelectElement>("pattern")!.onchange = (e) => {
      const name = (e.target as HTMLSelectElement).value, defs = { ...patterns[name].defaults };
      if (ui.target < 0) p.base = { pattern: name, params: defs }; else { p.mask.regions[ui.target].pattern = name; p.regionParams[ui.target] = defs; }
      renderPanel(); changed();
    };
    panel.querySelectorAll<HTMLInputElement>("input[data-param]").forEach((inp) => inp.oninput = () => {
      (ui.target < 0 ? p.base.params : p.regionParams[ui.target])[inp.dataset.param as keyof PatternParams] = Number(inp.value);
      (inp.nextElementSibling as HTMLElement).textContent = inp.value; changed();
    });
    $("addRegion")!.onclick = () => { const k = addRegion(p.mask, "sine"); p.regionParams[k] = { ...patterns.sine.defaults }; ui.target = k; ui.painting = true; ui.erase = false; renderPanel(); };
    $("paint")!.onclick = () => { ui.painting = !(ui.painting && !ui.erase); ui.erase = false; renderPanel(); };
    $("erase")!.onclick = () => { ui.painting = !(ui.painting && ui.erase); ui.erase = true; renderPanel(); };
    $("brush")!.oninput = (e) => { const el = e.target as HTMLInputElement; ui.brush = Number(el.value); (el.nextElementSibling as HTMLElement).textContent = el.value; };
    $("showSurface")!.onchange = (e) => { ui.showSurface = (e.target as HTMLInputElement).checked; updateSurfaceVisibility(); };
    $<HTMLSelectElement>("previewMode")!.onchange = (e) => { ui.preview = (e.target as HTMLSelectElement).value as PreviewMode; views.forEach(redrawPaths); renderStatus(); };
    $("layerMin")!.oninput = (e) => { ui.layerMin = Math.min(Number((e.target as HTMLInputElement).value), ui.layerMax); views.forEach(applyLayerRange); };
    $("layerMax")!.oninput = (e) => { ui.layerMax = Math.max(Number((e.target as HTMLInputElement).value), ui.layerMin); views.forEach(applyLayerRange); };
  } else {
    const kind = ui.tab;
    $<HTMLSelectElement>("presetSel")!.onchange = (e) => { ui.selected[kind] = (e.target as HTMLSelectElement).value; delete ui.edited[kind]; onPresetsChanged(); };
    panel.querySelectorAll<HTMLInputElement>("[data-path]").forEach((el) => el.onchange = () => {
      const edited = structuredClone(presetValues(kind)) as unknown as Record<string, unknown>;
      const path = el.dataset.path!;
      const val = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value)
        : el.dataset.array ? el.value.split(",").map(Number) : el.value;
      setPath(edited, path, val);
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
    const rev = $("presetRevert"); if (rev) rev.onclick = () => { delete ui.edited[kind]; onPresetsChanged(); };
    const del = $("presetDelete"); if (del) del.onclick = () => {
      const cur = registry.get(ui.selected[kind])!; registry.remove(cur.id); ui.selected[kind] = cur.inherits ?? registry.list(kind)[0].id;
      delete ui.edited[kind]; persistUserPresets(); onPresetsChanged();
    };
  }
  $("slicePlate")!.onclick = () => slice(views[ui.active]);
  $("sliceAll")!.onclick = sliceAll;
  $("export")!.onclick = () => exportGcode();
  $("saveProject")!.onclick = saveProject;
  $("openProject")!.onclick = () => $("projectFile")!.click();
  $("projectFile")!.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) loadProject(f); };
}
function onPresetsChanged() { layoutPlates(); focusActive(); renderAll(); sliceActiveSoon(); }

// ======================= loop =======================
function resize() { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(view);
let frames = 0, last = performance.now();
renderer.setAnimationLoop(() => {
  controls.update();
  for (const v of views) if (v.lod && v.line) {
    const far = camera.position.distanceTo(v.group.position) > 450; v.lod.visible = far; v.line.visible = !far;
  }
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - last > 1000) { stats.fps = (frames * 1000) / (now - last); frames = 0; last = now; renderStatus(); }
});

addPlate(newPlate("Plate 1"));
resize();
