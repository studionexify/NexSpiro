import { Viewport, type ColorMode } from "./scene.ts";
import { h, numInput, select, download } from "./dom.ts";
import { openMotionexEditor } from "./motionexEditor.ts";
import { MACHINES, FILAMENTS, PROCESSES, type PrintProfiles } from "../core/profiles.ts";
import { makeObject, type PrimitiveKind, type SceneObject } from "../core/primitives.ts";
import { PluginHost } from "../core/plugins.ts";
import { runPipeline, type PipelineResult } from "../core/pipeline.ts";
import { createMotionex, defaultApplication } from "../plugins/motionex/index.ts";
import type { MotionApplication, TargetType } from "../plugins/motionex/model.ts";

const storage = (() => { try { const s = window.localStorage; s.getItem("x"); return s; } catch { return null; } })();

const state = {
  tab: "prepare" as "prepare" | "preview" | "device",
  machine: MACHINES[0], filament: FILAMENTS[0], process: PROCESSES[0],
  objects: [] as SceneObject[],
  selected: null as string | null,
  result: null as PipelineResult | null,
  stale: true,
  color: "feature" as ColorMode,
  maxLayer: Infinity,
};
const profiles = (): PrintProfiles => ({ machine: state.machine, filament: state.filament, process: state.process });

const host = new PluginHost();
const mx = createMotionex(storage);
host.register(mx.plugin);

const $ = (id: string) => document.getElementById(id)!;
let view: Viewport;
try { view = new Viewport($("view")); } catch (err) {
  $("view").append(h("div.nogl", null, h("strong", null, "3D view could not start"), h("div", null, "Your browser blocked 3D graphics (WebGL). Try Chrome, Edge or Safari, or turn on hardware acceleration in your browser settings.")));
  throw err;
}
view.onPick = (id) => { state.selected = id; renderLeft(); syncScene(); };

// Starter scene: a 20 mm cube and a vase, with a sine brush on the outer wall.
const centre = () => [state.machine.bed.x / 2, state.machine.bed.y / 2] as const;
{
  const [cx, cy] = centre();
  state.objects.push(makeObject("cube", cx - 45, cy), makeObject("vase", cx + 25, cy));
  state.selected = state.objects[1].id;
  mx.state.applications.push(defaultApplication("preset-sine"));
}

function invalidate(): void { state.stale = true; state.result = null; if (state.tab === "preview") setTab("prepare"); renderStats(); ($("exportBtn") as HTMLButtonElement).disabled = true; }

function syncScene(): void {
  view.setObjects(state.objects, state.selected);
  view.setToolpaths(state.tab === "preview" && state.result ? state.result.layers : null, state.color, state.maxLayer);
}

// ───────────── left: profiles, objects, transform ─────────────
function renderLeft(): void {
  const sel = state.objects.find((o) => o.id === state.selected) ?? null;
  const row = (label: string, el: HTMLElement) => h("div.row", null, h("label", null, label), el);
  const change = (fn: () => void) => () => { fn(); invalidate(); renderLeft(); syncScene(); };
  $("left").replaceChildren(...[
    h("div.card", null, h("h3", null, "Printer & material"),
      row("Printer", select(state.machine.id, MACHINES.map((m) => [m.id, m.name]), (v) => {
        const prev = state.machine; state.machine = MACHINES.find((m) => m.id === v)!;
        for (const o of state.objects) { o.x += (state.machine.bed.x - prev.bed.x) / 2; o.y += (state.machine.bed.y - prev.bed.y) / 2; }
        view.setMachine(state.machine); invalidate(); renderLeft(); renderRight(); syncScene();
      })),
      row("Filament", select(state.filament.id, FILAMENTS.map((f) => [f.id, f.name]), (v) => { state.filament = FILAMENTS.find((f) => f.id === v)!; invalidate(); renderRight(); })),
      row("Print settings", select(state.process.id, PROCESSES.map((p) => [p.id, p.name]), (v) => { state.process = PROCESSES.find((p) => p.id === v)!; invalidate(); renderRight(); })),
      h("div.muted", null, `Build area ${state.machine.bed.x} × ${state.machine.bed.y} × ${state.machine.bed.z} mm · ${state.machine.nozzle} mm nozzle`),
    ),
    h("div.card", null, h("h3", null, "Objects", select<PrimitiveKind | "">("", [["", "+ Add shape"], ["cube", "Cube"], ["cylinder", "Cylinder"], ["vase", "Vase"]], (k) => {
      if (!k) return; const [cx, cy] = centre(); const o = makeObject(k, cx, cy); state.objects.push(o); state.selected = o.id; invalidate(); renderLeft(); syncScene();
    }, { style: "width:auto;font-size:12px;padding:2px 6px" })),
      state.objects.length ? h("div.list", null, ...state.objects.map((o) => h("div.item" + (o.id === state.selected ? ".sel" : ""), { onclick: () => { state.selected = o.id; renderLeft(); syncScene(); } },
        h("span.dot", { style: `background:${o.id === state.selected ? "#35c497" : "#c3c9d1"}` }), h("span.name", null, o.name), h("span.muted", null, `${o.size.z} mm`),
        h("button.ghost.sm", { title: `Delete ${o.name}`, onclick: (e: Event) => { e.stopPropagation(); state.objects = state.objects.filter((q) => q !== o); if (state.selected === o.id) state.selected = null; invalidate(); renderLeft(); syncScene(); } }, "✕"))))
        : h("div.muted", null, "Plate is empty. Add a shape to start."),
    ),
    sel ? h("div.card", null, h("h3", null, `Object · ${sel.name}`),
      row("X (mm)", numInput(sel.x, (v) => change(() => { sel.x = v; })())),
      row("Y (mm)", numInput(sel.y, (v) => change(() => { sel.y = v; })())),
      row("Turn (°)", numInput(sel.rotation, (v) => change(() => { sel.rotation = v; })())),
      row("Width (mm)", numInput(sel.size.x, (v) => change(() => { sel.size.x = Math.max(1, v); })())),
      row("Depth (mm)", numInput(sel.size.y, (v) => change(() => { sel.size.y = Math.max(1, v); })())),
      row("Height (mm)", numInput(sel.size.z, (v) => change(() => { sel.size.z = Math.min(state.machine.bed.z, Math.max(1, v)); })())),
      plateCheck(sel),
    ) : null,
  ].filter(Boolean) as HTMLElement[]);
}

function plateCheck(o: SceneObject): HTMLElement | null {
  const r = Math.hypot(o.size.x, o.size.y) / 2, m = state.machine;
  const out = o.x - r < 0 || o.y - r < 0 || o.x + r > m.bed.x || o.y + r > m.bed.y;
  return out ? h("div.warn", null, "⚠ Object may extend past the bed edge.") : null;
}

// ───────────── right: process + plugins ─────────────
function renderRight(): void {
  const p = state.process;
  $("right").replaceChildren(
    h("div.card", null, h("h3", null, "Print settings"),
      ...([["Layer height", p.layerHeight, "mm"], ["Line thickness", p.lineWidth, "mm"], ["Walls", p.walls, ""], ["Wall speed", p.wallSpeed, "mm/s"]] as [string, number, string][])
        .map(([l, v, u]) => h("div.row", null, h("span.muted", null, l), h("span", null, `${v} ${u}`)))),
    motionexCard(),
    h("div.card", null, h("h3", null, "Plugins"), h("div.list", null, ...host.list().map((pl) => h("div.item", null, h("span.name", null, pl.name), h("span.tag", null, `v${pl.version}`), h("span.tag", null, "On"))))),
  );
}

function motionexCard(): HTMLElement {
  const brushes = mx.state.library.all();
  const app = (a: MotionApplication, i: number) => {
    const upd = (fn: () => void) => { fn(); invalidate(); renderRight(); };
    const targetVal = a.target.type === "feature" ? `feature:${a.target.ref}` : a.target.type;
    return h("div.app" + (a.enabled ? "" : ".off"), null,
      h("div.app-top", null,
        h<"input">("input", { type: "checkbox", checked: a.enabled, title: "Enabled", onchange: (e: Event) => upd(() => { a.enabled = (e.target as HTMLInputElement).checked; }) }),
        patternSelect(a.brush_id, (v) => upd(() => { a.brush_id = v; })),
        h("button.sm", { title: "Edit brush", onclick: () => edit(a.brush_id) }, "Edit"),
        h("button.ghost.sm", { title: "Remove", onclick: () => upd(() => { mx.state.applications.splice(i, 1); }) }, "✕")),
      h("div.row", null, h("span.muted", null, "Apply to"), select(targetVal, [["feature:outer_wall", "Outer wall"], ["feature:inner_wall", "Inner walls"], ["model", "All walls"]],
        (v) => upd(() => { const [t, ref] = v.split(":"); a.target = { type: t as TargetType, ref }; }))),
      h("div.row.three", null,
        h("label.muted", null, "From height", numInput(a.mask.z_start, (v) => upd(() => { a.mask.z_start = v; }))),
        h("label.muted", null, "To height", numInput(a.mask.z_end >= 1e4 ? state.machine.bed.z : a.mask.z_end, (v) => upd(() => { a.mask.z_end = v; }))),
        h("label.muted", null, "Blend in", numInput(a.mask.fade_in_mm, (v) => upd(() => { a.mask.fade_in_mm = Math.max(0, v); })))),
    );
  };
  return h("div.card", null,
    h("div.plugin-head", null, h("span.plugin-badge", null, "M"), h("div", { style: "flex:1" }, h("div", { style: "font-weight:700" }, "Motionex"), h("div.muted", null, "Waves, loops and textures for your walls")),
      h("button.sm", { onclick: () => edit(mx.state.applications[0]?.brush_id ?? null) }, "Pattern library")),
    ...mx.state.applications.map(app),
    h("button.sm", { onclick: () => { mx.state.applications.push({ ...defaultApplication("preset-zigzag"), order: mx.state.applications.length }); invalidate(); renderRight(); } }, "+ Add pattern"),
    h("div.row", null, h("span.muted", { title: "Smaller numbers follow the pattern more closely but make bigger files" }, "Detail (mm)"), numInput(mx.state.options.resampleStep, (v) => { mx.state.options.resampleStep = Math.min(2, Math.max(0.05, v)); invalidate(); })),
  );
}

function patternSelect(value: string, onChange: (v: string) => void): HTMLSelectElement {
  const all = mx.state.library.all(), groups = new Map<string, typeof all>();
  for (const b of all) { const g = mx.state.library.isPreset(b.id) ? b.category ?? "Other" : "My patterns"; groups.set(g, [...(groups.get(g) ?? []), b]); }
  const s = h<"select">("select", { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
    ...[...groups].map(([g, bs]) => h<"optgroup">("optgroup", { label: g }, ...bs.map((b) => h<"option">("option", { value: b.id }, b.name)))));
  s.value = value;
  return s;
}

function edit(id: string | null): void {
  openMotionexEditor($("modal"), mx.state, profiles, id, (changed) => { if (changed) { invalidate(); renderRight(); } });
}

// ───────────── slice / preview / export ─────────────
function slice(): void {
  if (!state.objects.length) return;
  const btn = $("sliceBtn") as HTMLButtonElement;
  btn.disabled = true; btn.textContent = "Slicing…";
  setTimeout(() => {
    const t0 = performance.now();
    state.result = runPipeline(state.objects, profiles(), host);
    (state.result as PipelineResult & { ms?: number }).ms = performance.now() - t0;
    state.stale = false; state.maxLayer = Infinity;
    btn.disabled = false; btn.textContent = "Slice";
    ($("exportBtn") as HTMLButtonElement).disabled = false;
    setTab("preview");
  }, 20);
}

function renderStats(): void {
  const r = state.result as (PipelineResult & { ms?: number }) | null;
  if (!r) { $("stats").textContent = state.objects.length ? `${state.objects.length} object${state.objects.length === 1 ? "" : "s"} on the plate · press Slice to see the print` : ""; return; }
  const t = r.stats.seconds, hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60);
  const lines = [
    `${r.layers.length} layers · sliced in ${((r.ms ?? 0) / 1000).toFixed(1)} s`,
    `Walls print in about ${hh}h ${mm}m · ${(r.stats.filamentMm / 1000).toFixed(2)} m of filament · ${r.stats.grams.toFixed(1)} g`,
    ...r.warnings.map((w) => `⚠ ${w.message}`),
  ];
  $("stats").textContent = lines.join("\n");
}

function renderViewTools(): void {
  const tools = $("viewTools");
  if (state.tab !== "preview" || !state.result) { tools.replaceChildren(); return; }
  const n = state.result.layers.length;
  const seg = h("div.seg", null, ...(["feature", "speed", "flow"] as ColorMode[]).map((m) => h("button.sm" + (m === state.color ? ".on" : ""), { onclick: () => { state.color = m; renderViewTools(); syncScene(); } }, { feature: "Parts", speed: "Speed", flow: "Plastic" }[m])));
  const legend = state.color === "feature"
    ? h("div.seg", null, h("span.legend", { style: "padding:2px 8px" }, h("span.dot", { style: "background:#8b5cf6" }), "Patterned wall", h("span.dot", { style: "background:#f97316" }), "Outer wall", h("span.dot", { style: "background:#facc15" }), "Inner wall"))
    : h("div.seg", null, h("span.legend", { style: "padding:2px 8px" }, "less", h("span.ramp"), "more"));
  const slider = h<"input">("input", { type: "range", min: "0", max: String(n - 1), value: String(Math.min(n - 1, state.maxLayer)), style: "width:180px",
    oninput: (e: Event) => { state.maxLayer = +(e.target as HTMLInputElement).value; syncScene(); } });
  tools.replaceChildren(seg, legend, h("div.seg", null, h("span.muted", { style: "padding:2px 6px" }, "Layers"), slider));
}

function setTab(tab: typeof state.tab): void {
  if (tab === "preview" && !state.result) tab = "prepare";
  state.tab = tab;
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (tab === "device") showDevice();
  renderViewTools(); renderStats(); syncScene();
}

function showDevice(): void {
  const m = state.machine;
  const win = h("div.window", { style: "grid-template:52px 1fr / 1fr;grid-template-areas:'wh' 'main';width:min(560px,calc(100vw - 32px));height:auto" },
    h("div.whead", null, h("span.title", null, `Device · ${m.name}`), h("div.spacer"), h("button.ghost", { onclick: () => { $("modal").hidden = true; setTab("prepare"); } }, "✕")),
    h("div.wmain", null,
      h("div.muted", null, "These are the limits Nexspiro keeps to for this printer. Editing them and setting up your print head shape are coming soon."),
      ...([["Printer type", { klipper: "Klipper", marlin: "Marlin", bambu: "Bambu Lab" }[m.firmware]], ["Build area", `${m.bed.x} × ${m.bed.y} × ${m.bed.z} mm`], ["Top speed", `${m.maxSpeed.x} mm/s`],
        ["Top up/down speed", `${m.maxSpeed.z} mm/s`], ["Up-and-down patterns", "Coming soon"]] as [string, string][])
        .map(([k, v]) => h("div.row", null, h("span.muted", null, k), h("span", null, v)))));
  $("modal").replaceChildren(win); $("modal").hidden = false;
}

// Narrow screens: side panels slide over the 3D view instead of squeezing it.
for (const side of ["left", "right"] as const) {
  $(`${side}Toggle`).addEventListener("click", () => {
    const other = side === "left" ? "right" : "left";
    document.body.classList.remove(`show-${other}`);
    document.body.classList.toggle(`show-${side}`);
  });
}
$("view").addEventListener("pointerdown", () => document.body.classList.remove("show-left", "show-right"));

$("tabs").addEventListener("click", (e) => { const t = (e.target as HTMLElement).dataset.tab; if (t) setTab(t as typeof state.tab); });
$("sliceBtn").addEventListener("click", slice);
$("exportBtn").addEventListener("click", () => { if (state.result) download(`nexspiro-${state.machine.id}.gcode`, state.result.gcode); });

view.setMachine(state.machine);
renderLeft(); renderRight(); setTab("prepare");
