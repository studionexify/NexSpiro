import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  patterns, primitives, printers, printerById, createMask, addRegion, stamp, toGcode,
  type PatternParams, type PrimitiveName, type Toolpath,
} from "../core/index.ts";
import type { BuildRequest } from "./worker.ts";

// ---------- state ----------
const REGION_COLORS = [0x4c8dff, 0xff6b5b, 0x3ccf91, 0xffb454, 0xc77dff, 0x2fd3e0, 0xf7768e];
const BASE_COLOR = new THREE.Color(0xd8dce4);
const state = {
  printer: printers[0].id,
  primitive: "bowl" as PrimitiveName,
  layerHeight: 0.4, lineWidth: 0.8, segmentsPerRev: 720, fadeHeight: 2,
  base: { pattern: "knit", params: { ...patterns.knit.defaults } as PatternParams },
  target: -1, // -1 = base wall, else paint region index
  painting: false, erase: false, brush: 8, showSurface: true,
  layerMin: 0, layerMax: 1,
};
const mask = createMask(256, 256);
const regionParams: PatternParams[] = [];

// ---------- three.js scene ----------
const view = document.getElementById("view")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16181d);
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
camera.up.set(0, 0, 1);
camera.position.set(220, -220, 160);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 40);
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(200, -150, 300); scene.add(sun);
const grid = new THREE.GridHelper(256, 16, 0x333a46, 0x262b34); grid.rotation.x = Math.PI / 2; scene.add(grid);

const pathMat = new THREE.LineBasicMaterial({ vertexColors: true });
let pathFull: THREE.Line | null = null, pathLod: THREE.Line | null = null;
let current: (Toolpath & { height: number }) | null = null;

// Surface mesh in (u,t) space: used for painting and showing the mask.
const maskTex = new THREE.DataTexture(new Uint8Array(mask.cols * mask.rows * 4), mask.cols, mask.rows);
maskTex.wrapS = THREE.RepeatWrapping; maskTex.magFilter = THREE.LinearFilter; maskTex.needsUpdate = true;
const surfMat = new THREE.MeshBasicMaterial({ map: maskTex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
let surface: THREE.Mesh | null = null;

function buildSurface() {
  const prof = primitives[state.primitive]();
  const C = 128, R = 64, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= R; j++) for (let i = 0; i <= C; i++) {
    const u = i / C, t = j / R, r = prof.radius(t), a = u * Math.PI * 2;
    pos.push(r * Math.cos(a), r * Math.sin(a), t * prof.height); uv.push(u, t);
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
    const a = j * (C + 1) + i, b = a + 1, c = a + C + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (surface) { scene.remove(surface); surface.geometry.dispose(); }
  surface = new THREE.Mesh(g, surfMat);
  surface.visible = state.showSurface;
  scene.add(surface);
  controls.target.set(0, 0, prof.height / 2);
}

function refreshMaskTexture() {
  const d = maskTex.image.data as Uint8Array;
  d.fill(0);
  const c = new THREE.Color();
  mask.regions.forEach((reg, k) => {
    c.set(REGION_COLORS[k % REGION_COLORS.length]);
    for (let i = 0; i < reg.weight.length; i++) {
      const w = reg.weight[i];
      if (w <= 0) continue;
      const o = i * 4;
      d[o] = Math.max(d[o], c.r * 255 * w); d[o + 1] = Math.max(d[o + 1], c.g * 255 * w);
      d[o + 2] = Math.max(d[o + 2], c.b * 255 * w); d[o + 3] = Math.max(d[o + 3], 220 * w);
    }
  });
  maskTex.needsUpdate = true;
}

// ---------- toolpath → GPU ----------
function makeLine(tp: Toolpath, height: number, stride: number): THREE.Line {
  const n = Math.floor((tp.count - 1) / stride) + 1;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const c = new THREE.Color(), tint = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const i = k * stride;
    pos[k * 3] = tp.xyz[i * 3]; pos[k * 3 + 1] = tp.xyz[i * 3 + 1]; pos[k * 3 + 2] = tp.xyz[i * 3 + 2];
    const tag = tp.tag[i];
    if (tag === 0) c.copy(BASE_COLOR); else c.set(REGION_COLORS[(tag - 1) % REGION_COLORS.length]);
    // subtle height shading so layers read in depth
    const shade = 0.65 + 0.35 * (tp.xyz[i * 3 + 2] / height);
    tint.copy(c).multiplyScalar(shade);
    col[k * 3] = tint.r; col[k * 3 + 1] = tint.g; col[k * 3 + 2] = tint.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const line = new THREE.Line(g, pathMat);
  line.userData.stride = stride;
  line.frustumCulled = false;
  return line;
}
function disposeLine(l: THREE.Line | null) { if (l) { scene.remove(l); l.geometry.dispose(); } }

function applyLayerRange() {
  if (!current) return;
  const spr = state.segmentsPerRev, layers = (current.count - 1) / spr;
  const a = Math.floor(state.layerMin * layers) * spr, b = Math.ceil(state.layerMax * layers) * spr + 1;
  for (const l of [pathFull, pathLod]) {
    if (!l) continue;
    const s = l.userData.stride as number;
    l.geometry.setDrawRange(Math.floor(a / s), Math.max(0, Math.ceil((b - a) / s)));
  }
}

// ---------- worker ----------
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let reqId = 0, pending = false, queued = false;
function rebuild() {
  if (pending) { queued = true; return; }
  pending = true;
  const printer = printerById(state.printer);
  const req: BuildRequest = {
    id: ++reqId, primitive: state.primitive,
    settings: {
      layerHeight: state.layerHeight, lineWidth: state.lineWidth, filamentDiameter: 1.75,
      segmentsPerRev: state.segmentsPerRev, pattern: state.base.pattern, params: state.base.params,
      fadeHeight: state.fadeHeight, center: [0, 0], zCap: printer.zWobbleMax,
    },
    paint: {
      cols: mask.cols, rows: mask.rows,
      regions: mask.regions.map((r, k) => ({ pattern: r.pattern, params: regionParams[k], weight: r.weight.slice() })),
    },
  };
  stats.building = true; renderStats();
  worker.postMessage(req);
}
worker.onmessage = (ev) => {
  pending = false;
  const d = ev.data;
  current = { xyz: d.xyz, e: d.e, tag: d.tag, count: d.count, zClipped: d.zClipped, height: d.height };
  disposeLine(pathFull); disposeLine(pathLod);
  pathFull = makeLine(current, d.height, 1);
  pathLod = current.count > 400_000 ? makeLine(current, d.height, 4) : null;
  scene.add(pathFull); if (pathLod) scene.add(pathLod);
  applyLayerRange();
  Object.assign(stats, { building: false, points: d.count, ms: d.ms, filament: d.e[d.count - 1] / 1000, zClipped: d.zClipped });
  renderStats();
  if (queued) { queued = false; rebuild(); }
};
let rebuildTimer = 0;
const rebuildSoon = (ms = 150) => { clearTimeout(rebuildTimer); rebuildTimer = window.setTimeout(rebuild, ms); };

// ---------- painting ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let stroking = false;
function paintAt(ev: PointerEvent) {
  if (!surface || state.target < 0) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(surface)[0];
  if (!hit?.uv) return;
  stamp(mask, state.target, hit.uv.x, hit.uv.y, state.brush, state.erase);
  refreshMaskTexture();
}
renderer.domElement.addEventListener("pointerdown", (ev) => {
  if (!state.painting || ev.button !== 0) return;
  if (state.target < 0) { alert("Select or add a paint region first."); return; }
  stroking = true; controls.enabled = false; paintAt(ev);
});
renderer.domElement.addEventListener("pointermove", (ev) => { if (stroking) paintAt(ev); });
window.addEventListener("pointerup", () => {
  if (!stroking) return;
  stroking = false; controls.enabled = true; rebuildSoon(0);
});

// ---------- UI ----------
const panel = document.getElementById("panel")!;
const stats = { building: false, points: 0, ms: 0, filament: 0, zClipped: 0, fps: 0 };
const statsEl = document.getElementById("stats")!;
function renderStats() {
  const p = printerById(state.printer);
  statsEl.innerHTML =
    `${stats.building ? "building…\n" : ""}points ${stats.points.toLocaleString()}  ·  build ${stats.ms.toFixed(0)} ms  ·  ${stats.fps.toFixed(0)} fps\n` +
    `filament ${stats.filament.toFixed(2)} m` +
    (stats.zClipped ? `\n<span class="warn">Z wobble capped at ±${p.zWobbleMax} mm on ${stats.zClipped.toLocaleString()} points (${p.name})</span>` : "");
}

const opt = (v: string, label: string, sel: boolean) => `<option value="${v}"${sel ? " selected" : ""}>${label}</option>`;
const PARAM_UI: [keyof PatternParams, string, number, number, number][] = [
  ["amplitude", "Amplitude mm", 0, 4, 0.05],
  ["wavesPerRev", "Waves / rev", 0, 200, 1],
  ["phasePerLayer", "Phase / layer °", 0, 360, 1],
  ["zAmplitude", "Z wobble mm", 0, 1.5, 0.01],
  ["extrusionPulse", "Extrusion pulse", 0, 1, 0.01],
];
function targetPattern() { return state.target < 0 ? state.base.pattern : mask.regions[state.target].pattern; }
function targetParams() { return state.target < 0 ? state.base.params : regionParams[state.target]; }

function renderPanel() {
  const P = targetParams();
  panel.innerHTML = `
    <h2>Printer</h2>
    <label>Profile <select id="printer">${printers.map((p) => opt(p.id, p.name, p.id === state.printer)).join("")}</select></label>
    <label>Model <select id="primitive">${Object.keys(primitives).map((k) => opt(k, k, k === state.primitive)).join("")}</select></label>
    <label>Layer height <input type="number" id="layerHeight" step="0.05" min="0.1" max="1" value="${state.layerHeight}"></label>
    <label>Line width <input type="number" id="lineWidth" step="0.05" min="0.3" max="2" value="${state.lineWidth}"></label>
    <label>Segments / rev <input type="number" id="segmentsPerRev" step="60" min="60" max="3600" value="${state.segmentsPerRev}"></label>

    <h2>Edit wall</h2>
    <label>Target <select id="target">${opt("-1", "Base wall", state.target < 0)}${mask.regions
      .map((_, k) => opt(String(k), `Region ${k + 1}`, k === state.target)).join("")}</select></label>
    <label>Pattern <select id="pattern">${Object.entries(patterns).map(([k, p]) => opt(k, p.label, k === targetPattern())).join("")}</select></label>
    ${PARAM_UI.map(([k, l, mn, mx, st]) =>
      `<label>${l} <input type="range" data-param="${k}" min="${mn}" max="${mx}" step="${st}" value="${P[k]}"><span class="v">${P[k]}</span></label>`).join("")}

    <h2>Paint regions</h2>
    <div>${mask.regions.map((r, k) => `<div><span class="swatch" style="background:#${REGION_COLORS[k % REGION_COLORS.length].toString(16).padStart(6, "0")}"></span>Region ${k + 1} · ${patterns[r.pattern].label}</div>`).join("") || '<div style="color:var(--muted)">No regions. The whole wall uses the base pattern.</div>'}</div>
    <button id="addRegion">+ Add region</button>
    <button id="paint" class="${state.painting && !state.erase ? "on" : ""}">Paint</button>
    <button id="erase" class="${state.painting && state.erase ? "on" : ""}">Erase</button>
    <label>Brush size <input type="range" id="brush" min="1" max="40" step="1" value="${state.brush}"><span class="v">${state.brush}</span></label>
    <label>Show surface <input type="checkbox" id="showSurface"${state.showSurface ? " checked" : ""}></label>

    <h2>Preview</h2>
    <label>Layer from <input type="range" id="layerMin" min="0" max="1" step="0.001" value="${state.layerMin}"></label>
    <label>Layer to <input type="range" id="layerMax" min="0" max="1" step="0.001" value="${state.layerMax}"></label>

    <h2>Export</h2>
    <button id="export" class="primary">Download G-code</button>`;
  bind();
}

function bind() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  $<HTMLSelectElement>("printer").onchange = (e) => { state.printer = (e.target as HTMLSelectElement).value; rebuildSoon(); };
  $<HTMLSelectElement>("primitive").onchange = (e) => {
    state.primitive = (e.target as HTMLSelectElement).value as PrimitiveName; buildSurface(); rebuildSoon();
  };
  for (const k of ["layerHeight", "lineWidth", "segmentsPerRev"] as const)
    $<HTMLInputElement>(k).onchange = (e) => { state[k] = Number((e.target as HTMLInputElement).value); rebuildSoon(); };
  $<HTMLSelectElement>("target").onchange = (e) => { state.target = Number((e.target as HTMLSelectElement).value); renderPanel(); };
  $<HTMLSelectElement>("pattern").onchange = (e) => {
    const name = (e.target as HTMLSelectElement).value, defs = { ...patterns[name].defaults };
    if (state.target < 0) state.base = { pattern: name, params: defs };
    else { mask.regions[state.target].pattern = name; regionParams[state.target] = defs; }
    renderPanel(); rebuildSoon();
  };
  panel.querySelectorAll<HTMLInputElement>("input[data-param]").forEach((inp) => {
    inp.oninput = () => {
      targetParams()[inp.dataset.param as keyof PatternParams] = Number(inp.value);
      (inp.nextElementSibling as HTMLElement).textContent = inp.value;
      rebuildSoon();
    };
  });
  $("addRegion").onclick = () => {
    const k = addRegion(mask, "sine"); regionParams[k] = { ...patterns.sine.defaults };
    state.target = k; state.painting = true; state.erase = false; renderPanel();
  };
  $("paint").onclick = () => { state.painting = !(state.painting && !state.erase); state.erase = false; renderPanel(); };
  $("erase").onclick = () => { state.painting = !(state.painting && state.erase); state.erase = true; renderPanel(); };
  $<HTMLInputElement>("brush").oninput = (e) => {
    const el = e.target as HTMLInputElement; state.brush = Number(el.value); (el.nextElementSibling as HTMLElement).textContent = el.value;
  };
  $<HTMLInputElement>("showSurface").onchange = (e) => { state.showSurface = (e.target as HTMLInputElement).checked; if (surface) surface.visible = state.showSurface; };
  $<HTMLInputElement>("layerMin").oninput = (e) => { state.layerMin = Math.min(Number((e.target as HTMLInputElement).value), state.layerMax); applyLayerRange(); };
  $<HTMLInputElement>("layerMax").oninput = (e) => { state.layerMax = Math.max(Number((e.target as HTMLInputElement).value), state.layerMin); applyLayerRange(); };
  $("export").onclick = exportGcode;
}

function exportGcode() {
  if (!current) return;
  const p = printerById(state.printer);
  // Recenter from viewer origin to bed center.
  const xyz = current.xyz.slice();
  for (let i = 0; i < current.count; i++) { xyz[i * 3] += p.bed[0] / 2; xyz[i * 3 + 1] += p.bed[1] / 2; }
  const g = toGcode({ ...current, xyz }, { flavor: p.flavor, nozzleTemp: 220, bedTemp: 60, speed: 25, fan: 1 });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([g], { type: "text/plain" }));
  a.download = `nexspiro-${state.primitive}-${state.base.pattern}-${p.id}.gcode`;
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------- loop ----------
function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
let frames = 0, last = performance.now();
renderer.setAnimationLoop(() => {
  controls.update();
  // LOD: decimated path when far away, full detail up close.
  if (pathLod && pathFull) {
    const far = camera.position.distanceTo(controls.target) > 260;
    pathLod.visible = far; pathFull.visible = !far;
  }
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - last > 1000) { stats.fps = (frames * 1000) / (now - last); frames = 0; last = now; renderStats(); }
});

buildSurface();
renderPanel();
resize();
rebuild();
