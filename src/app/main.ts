import { Viewport, type ColorMode } from "./scene.ts";
import { h, numInput, select, download } from "./dom.ts";
import { openMotionexEditor } from "./motionexEditor.ts";
import { MACHINES, FILAMENTS, PROCESSES, type PrintProfiles } from "../core/profiles.ts";
import { makeObject, type PrimitiveKind, type SceneObject } from "../core/primitives.ts";
import { PluginHost } from "../core/plugins.ts";
import { runPipeline, runBaseline, type PipelineResult } from "../core/pipeline.ts";
import { regionFromDef, type RegionDef } from "../core/regions.ts";
import type { CollisionMode, HeadVolume, ToolheadProfile } from "../core/toolhead.ts";
import { createMotionex, defaultApplication } from "../plugins/motionex/index.ts";
import type { MotionApplication, TargetType } from "../plugins/motionex/model.ts";
import type { ViewMode } from "./scene.ts";

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
  regions: [] as RegionDef[],
  viewMode: "3d" as ViewMode,
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
  if (state.viewMode !== "3d") view.setView(state.viewMode);
}

// ───────────── left: profiles, objects, transform ─────────────
// Panel redraws are queued: a redraw removes the focused number box, which fires blur/change,
// which would otherwise start a second redraw in the middle of the first.
const pending = new Set<() => void>();
function later(fn: () => void): () => void {
  return () => { if (pending.size === 0) queueMicrotask(() => { const fns = [...pending]; pending.clear(); fns.forEach((f) => f()); }); pending.add(fn); };
}
const renderLeft = later(drawLeft);
const renderRight = later(drawRight);

function drawLeft(): void {
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
    regionsCard(),
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

// ───────────── regions (shared with Patternex) ─────────────
let regionCounter = 0;
function regionsCard(): HTMLElement {
  const [cx, cy] = centre();
  const add = (kind: "band" | "box") => {
    regionCounter++;
    const name = kind === "band" ? `Band ${regionCounter}` : `Box ${regionCounter}`;
    state.regions.push(kind === "band" ? { id: `region-${regionCounter}`, name, kind, z_from: 10, z_to: 20 } : { id: `region-${regionCounter}`, name, kind, x: cx, y: cy, w: 30, d: 30, z_from: 5, z_to: 40 });
    invalidate(); renderLeft(); renderRight();
  };
  const field = (label: string, v: number, set: (v: number) => void) => h("label.muted", null, label, numInput(v, (x) => { set(x); invalidate(); renderRight(); }));
  return h("div.card", null,
    h("h3", null, "Regions", h("span", null, h("button.sm", { onclick: () => add("band"), title: "A height band all the way round" }, "+ Band"), " ", h("button.sm", { onclick: () => add("box"), title: "A box-shaped area" }, "+ Box"))),
    state.regions.length ? h("div", null, ...state.regions.map((r, i) => h("div.app", null,
      h("div.app-top", null, h<"input">("input", { value: r.name, "aria-label": "Region name", oninput: (e: Event) => { r.name = (e.target as HTMLInputElement).value; renderRight(); } }),
        h("button.ghost.sm", { title: "Delete region", onclick: () => { state.regions.splice(i, 1); invalidate(); renderLeft(); renderRight(); } }, "✕")),
      r.kind === "box" ? h("div.row.three", null, field("Centre X", r.x, (v) => { r.x = v; }), field("Centre Y", r.y, (v) => { r.y = v; }), field("Width", r.w, (v) => { r.w = Math.max(1, v); })) : null,
      h("div.row.three", null, r.kind === "box" ? field("Depth", r.d, (v) => { r.d = Math.max(1, v); }) : h("span"), field("From height", r.z_from, (v) => { r.z_from = v; }), field("To height", r.z_to, (v) => { r.z_to = v; })),
    ))) : h("div.muted", null, "Mark part of the print so a pattern only goes there. Pick the region in a pattern's \"Apply to\"."),
  );
}

function syncRegions(): void {
  host.regions.clear();
  for (const d of state.regions) host.regions.set(regionFromDef(d, state.process.layerHeight, state.process.firstLayerHeight, state.machine.bed));
}

function plateCheck(o: SceneObject): HTMLElement | null {
  const r = Math.hypot(o.size.x, o.size.y) / 2, m = state.machine;
  const out = o.x - r < 0 || o.y - r < 0 || o.x + r > m.bed.x || o.y + r > m.bed.y;
  return out ? h("div.warn", null, "⚠ Object may extend past the bed edge.") : null;
}

// ───────────── right: process + plugins ─────────────
function drawRight(): void {
  const p = state.process;
  $("right").replaceChildren(
    h("div.card", null, h("h3", null, "Print settings"),
      ...([["Layer height", p.layerHeight, "mm"], ["Line thickness", p.lineWidth, "mm"], ["Walls", p.walls, ""], ["Wall speed", p.wallSpeed, "mm/s"]] as [string, number, string][])
        .map(([l, v, u]) => h("div.row", null, h("span.muted", null, l), h("span", null, `${v} ${u}`)))),
    motionexCard(),
    h("div.card", null, h("h3", null, "Plugins"), h("div.list", null, ...host.list().map((pl) => h("div.item", null, h("span.name", null, pl.name), h("span.tag", null, `v${pl.version}`), h("span.tag", null, "On"))))),
  );
}

const openMore = new WeakSet<MotionApplication>();

function motionexCard(): HTMLElement {
  const app = (a: MotionApplication, i: number) => {
    const upd = (fn: () => void) => { fn(); invalidate(); renderRight(); };
    const targetVal = a.target.type === "feature" || a.target.type === "patternex_region" ? `${a.target.type}:${a.target.ref}` : a.target.type;
    const targets: [string, string][] = [["feature:outer_wall", "Outer wall"], ["feature:inner_wall", "Inner walls"], ["model", "All walls"], ...state.regions.map((r) => [`patternex_region:${r.id}`, `Region: ${r.name}`] as [string, string])];
    if (a.target.type === "patternex_region" && !state.regions.some((r) => r.id === a.target.ref)) targets.push([targetVal, "Region (deleted)"]);
    const more = h<"details">("details", { open: openMore.has(a) || undefined, ontoggle: (e: Event) => { if ((e.target as HTMLDetailsElement).open) openMore.add(a); else openMore.delete(a); } },
      h("summary.muted", { style: "cursor:pointer;margin-top:6px" }, "More options"),
      h("div.row", null, h("span.muted", { title: "Add on top of patterns above, or replace them" }, "Mix"), select(a.blend, [["add", "Add on top"], ["override", "Replace patterns above"]], (v) => upd(() => { a.blend = v; }))),
      h("div.row.three", null,
        h("label.muted", null, "Blend out", numInput(a.mask.fade_out_mm, (v) => upd(() => { a.mask.fade_out_mm = Math.max(0, v); }))),
        h("label.muted", { title: "0° is a straight wall; positive leans out" }, "Wall slope from °", numInput(a.mask.angle_min ?? -90, (v) => upd(() => { a.mask.angle_min = v <= -90 ? undefined : v; }))),
        h("label.muted", null, "to °", numInput(a.mask.angle_max ?? 90, (v) => upd(() => { a.mask.angle_max = v >= 90 ? undefined : v; })))),
      a.target.type === "patternex_region" ? h("div.row", null, h("span.muted", null, "Soft edge (mm)"), numInput(a.mask.blend_mm ?? 0, (v) => upd(() => { a.mask.blend_mm = Math.max(0, v); }))) : null,
    );
    return h("div.app" + (a.enabled ? "" : ".off"), null,
      h("div.app-top", null,
        h<"input">("input", { type: "checkbox", checked: a.enabled, title: "Enabled", onchange: (e: Event) => upd(() => { a.enabled = (e.target as HTMLInputElement).checked; }) }),
        patternSelect(a.brush_id, (v) => upd(() => { a.brush_id = v; })),
        h("button.sm", { title: "Edit brush", onclick: () => edit(a.brush_id) }, "Edit"),
        h("button.ghost.sm", { title: "Remove", onclick: () => upd(() => { mx.state.applications.splice(i, 1); }) }, "✕")),
      sizeRow(a, () => invalidate()),
      h("div.row", null, h("span.muted", null, "Apply to"), select(targetVal, targets,
        (v) => upd(() => { const [t, ref] = v.split(":"); a.target = { type: t as TargetType, ref }; }))),
      h("div.row.three", null,
        h("label.muted", null, "From height", numInput(a.mask.z_start, (v) => upd(() => { a.mask.z_start = v; }))),
        h("label.muted", null, "To height", numInput(a.mask.z_end >= 1e4 ? state.machine.bed.z : a.mask.z_end, (v) => upd(() => { a.mask.z_end = v; }))),
        h("label.muted", null, "Blend in", numInput(a.mask.fade_in_mm, (v) => upd(() => { a.mask.fade_in_mm = Math.max(0, v); })))),
      more,
    );
  };
  return h("div.card", null,
    h("div.plugin-head", null, h("span.plugin-badge", null, "M"), h("div", { style: "flex:1" }, h("div", { style: "font-weight:700" }, "Motionex"), h("div.muted", null, "Waves, loops and textures for your walls")),
      h("button.sm", { onclick: () => edit(mx.state.applications[0]?.brush_id ?? null) }, "Pattern library")),
    ...mx.state.applications.map(app),
    h("button.sm", { onclick: () => { mx.state.applications.push({ ...defaultApplication("preset-zigzag"), order: mx.state.applications.length }); invalidate(); renderRight(); } }, "+ Add pattern"),
    h("div.row", null, h("span.muted", { title: "Smaller numbers follow the pattern more closely but make bigger files" }, "Detail (mm)"), numInput(mx.state.options.resampleStep, (v) => { mx.state.options.resampleStep = Math.min(2, Math.max(0.05, v)); invalidate(); })),
    h("div.row", null, h("span.muted", { title: "Loops lay plastic over itself, so they print slower" }, "Loop speed"), select(String(mx.state.options.loopSpeedShare), [["0.35", "Slow (35%)"], ["0.5", "Medium (50%)"], ["0.75", "Gentle (75%)"]], (v) => { mx.state.options.loopSpeedShare = +v; invalidate(); })),
  );
}

function sizeRow(a: MotionApplication, onChange: () => void): HTMLElement {
  const label = h("span", { style: "min-width:44px;text-align:right" }, `×${(a.scale ?? 1).toFixed(2)}`);
  const slider = h<"input">("input", { type: "range", min: "0.25", max: "3", step: "0.05", value: String(a.scale ?? 1), "aria-label": "Pattern size",
    oninput: (e: Event) => { a.scale = +(e.target as HTMLInputElement).value; label.textContent = `×${a.scale.toFixed(2)}`; },
    onchange: onChange });
  return h("div.row", { style: "grid-template-columns:auto 1fr auto" }, h("span.muted", { title: "Makes the whole pattern bigger or smaller" }, "Size"), slider, label);
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
    syncRegions();
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
    ...(r.check.blocking ? ["⛔ Export is stopped: press Export to see where the print head would hit"] : []),
  ];
  $("stats").textContent = lines.join("\n");
}

function renderViewTools(): void {
  const tools = $("viewTools");
  if (state.tab !== "preview" || !state.result) { tools.replaceChildren(); return; }
  const n = state.result.layers.length;
  const seg = h("div.seg", null, ...(["feature", "speed", "flow", "updown", "problems"] as ColorMode[]).map((m) => h("button.sm" + (m === state.color ? ".on" : ""), { onclick: () => { state.color = m; renderViewTools(); syncScene(); } }, { feature: "Parts", speed: "Speed", flow: "Plastic", updown: "Up/down", problems: "Problems" }[m])));
  const dot = (c: string, t: string) => [h("span.dot", { style: `background:${c}` }), t];
  const legend = state.color === "feature"
    ? h("div.seg", null, h("span.legend", { style: "padding:2px 8px" }, ...dot("#8b5cf6", "Patterned wall"), ...dot("#f97316", "Outer wall"), ...dot("#facc15", "Inner wall")))
    : state.color === "problems"
      ? h("div.seg", null, h("span.legend", { style: "padding:2px 8px" }, ...dot("#e5484d", `Print head hits (${state.result.check.collisionCount})`), ...dot("#f59e0b", `Slowed loops (${state.result.check.loopSlowed})`), ...dot("#9aa3ae", "OK")))
      : state.color === "updown"
        ? h("div.seg", null, h("span.legend", { style: "padding:2px 8px" }, "lower", h("span.ramp"), "higher"))
        : h("div.seg", null, h("span.legend", { style: "padding:2px 8px" }, "less", h("span.ramp"), "more"));
  const views = h("div.seg", null, ...([["3d", "3D"], ["front", "Front"], ["side", "Side"]] as [ViewMode, string][]).map(([v, l]) =>
    h("button.sm" + (v === state.viewMode ? ".on" : ""), { title: v === "3d" ? "Turn the view freely" : `Flat ${l.toLowerCase()} view of the wall profile`, onclick: () => { state.viewMode = v; view.setView(v); renderViewTools(); } }, l)));
  const slider = h<"input">("input", { type: "range", min: "0", max: String(n - 1), value: String(Math.min(n - 1, state.maxLayer)), style: "width:180px",
    oninput: (e: Event) => { state.maxLayer = +(e.target as HTMLInputElement).value; syncScene(); } });
  tools.replaceChildren(views, seg, legend, h("div.seg", null, h("span.muted", { style: "padding:2px 6px" }, "Layers"), slider));
}

function setTab(tab: typeof state.tab): void {
  if (tab === "preview" && !state.result) tab = "prepare";
  if (tab !== "preview" && state.viewMode !== "3d") { state.viewMode = "3d"; view.setView("3d"); }
  state.tab = tab;
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (tab === "device") showDevice();
  renderViewTools(); renderStats(); syncScene();
}

function showDevice(): void {
  const m = state.machine;
  let head: ToolheadProfile = mx.state.toolheads.get(m.id);
  const close = () => { $("modal").hidden = true; setTab("prepare"); };
  const render = () => {
    const num = (v: number, set: (x: number) => void, attrs = {}) => numInput(v, (x) => { set(x); }, { step: 0.5, ...attrs });
    const vol = (v: HeadVolume, i: number) => h("div.app", null,
      h("div.app-top", null, h<"input">("input", { value: v.name, "aria-label": "Part name", oninput: (e: Event) => { v.name = (e.target as HTMLInputElement).value; } }),
        select(v.shape, [["box", "Box"], ["cylinder", "Round"]], (x) => { v.shape = x; render(); }, { style: "width:auto" }),
        h("button.ghost.sm", { title: "Remove part", onclick: () => { head.volumes.splice(i, 1); render(); } }, "✕")),
      h("div.row.three", null,
        h("label.muted", null, v.shape === "box" ? "Width" : "Radius", num(v.dims[0], (x) => { v.dims[0] = Math.max(0, x); })),
        v.shape === "box" ? h("label.muted", null, "Depth", num(v.dims[1], (x) => { v.dims[1] = Math.max(0, x); })) : h("span"),
        h("label.muted", { title: "How far above the nozzle tip this part starts" }, "Starts above tip", num(v.offset[2], (x) => { v.offset[2] = Math.max(0, x); }))),
      h("div.row.three", null,
        h("label.muted", { title: "Left/right of the nozzle" }, "Shift X", num(v.offset[0], (x) => { v.offset[0] = x; })),
        h("label.muted", { title: "Front/back of the nozzle" }, "Shift Y", num(v.offset[1], (x) => { v.offset[1] = x; })),
        h("span")));
    const win = h("div.window", { style: "grid-template:52px 1fr / 1fr;grid-template-areas:'wh' 'main';width:min(620px,calc(100vw - 16px));height:min(820px,calc(100vh - 16px))" },
      h("div.whead", null, h("span.title", null, `Printer · ${m.name}`), h("div.spacer"),
        h("button.primary", { onclick: () => { mx.state.toolheads.save(head); invalidate(); close(); } }, "Save"),
        h("button.ghost", { onclick: close, "aria-label": "Close" }, "✕")),
      h("div.wmain", null,
        h("div.section", { style: "margin-top:0" }, "Printer limits"),
        ...([["Printer type", { klipper: "Klipper", marlin: "Marlin", bambu: "Bambu Lab" }[m.firmware]], ["Build area", `${m.bed.x} × ${m.bed.y} × ${m.bed.z} mm`], ["Top speed", `${m.maxSpeed.x} mm/s`],
          ["Top up/down speed", `${m.maxSpeed.z} mm/s`], ["Pauses, blobs, lift-offs", "Supported"], ["Up-and-down patterns", m.firmware === "klipper" ? "Supported" : `Supported, slower (up/down ${m.maxSpeed.z} mm/s)`]] as [string, string][])
          .map(([k, v]) => h("div.row", null, h("span.muted", null, k), h("span", null, v))),
        h("div.section", null, "Print head shape"),
        h("div.muted", null, "Used to stop up-and-down patterns from knocking the print. Measure from the nozzle tip. Defaults are a safe guess for this printer."),
        h("div.row", null, h("span.muted", null, "Nozzle tip length (mm)"), num(head.nozzle.tip_len, (x) => { head.nozzle.tip_len = Math.max(0.5, x); })),
        h("div.row", null, h("span.muted", null, "Nozzle cone angle (°)"), num(head.nozzle.cone_angle_deg, (x) => { head.nozzle.cone_angle_deg = Math.min(80, Math.max(10, x)); }, { step: 5 })),
        h("div.row", null, h("span.muted", null, "Nozzle tip width (mm)"), num(head.nozzle.tip_diameter, (x) => { head.nozzle.tip_diameter = Math.max(0.2, x); }, { step: 0.1 })),
        h("div.row", null, h("span.muted", null, "Safety gap (mm)"), num(head.margin, (x) => { head.margin = Math.max(0, x); }, { step: 0.1 })),
        ...head.volumes.map(vol),
        h("div", null, h("button.sm", { onclick: () => { head.volumes.push({ name: "New part", shape: "box", dims: [20, 20, 10], offset: [0, 0, 5] }); render(); } }, "+ Add part"), " ",
          h("button.sm", { onclick: () => { mx.state.toolheads.reset(m.id); head = mx.state.toolheads.get(m.id); render(); } }, "Reset to default")),
        h("div.section", null, "When the print head would hit the print"),
        select<CollisionMode>(mx.state.collisionMode, [["clamp", "Lower the pattern there automatically"], ["skip", "Leave the pattern out there"], ["fail", "Stop and show me"]], (v) => { mx.state.collisionMode = v; invalidate(); }),
      ));
    $("modal").replaceChildren(win); $("modal").hidden = false;
  };
  render();
}

// ───────────── pre-export check ─────────────
function showCheck(): void {
  const r = state.result; if (!r) return;
  const c = r.check, base = runBaseline(state.objects, profiles());
  const dt = r.stats.seconds - base.seconds, dg = r.stats.grams - base.grams;
  const fmtT = (s: number) => { const a = Math.abs(s); return `${s < 0 ? "−" : "+"}${a >= 3600 ? `${Math.floor(a / 3600)}h ` : ""}${Math.floor((a % 3600) / 60)}m ${Math.round(a % 60)}s`; };
  const row = (ok: boolean, title: string, detail: string) => h("div.check", null, h("span", { class: ok ? "ok" : "bad", "aria-hidden": "true" }, ok ? "✓" : "!"), h("div", null, h("strong", null, title), h("div.muted", null, detail)));
  const close = () => { $("modal").hidden = true; };
  const win = h("div.window", { style: "grid-template:52px 1fr / 1fr;grid-template-areas:'wh' 'main';width:min(600px,calc(100vw - 16px));height:auto;max-height:calc(100vh - 16px)" },
    h("div.whead", null, h("span.title", null, "Check before export"), h("div.spacer"), h("button.ghost", { onclick: close, "aria-label": "Close" }, "✕")),
    h("div.wmain", null,
      row(c.collisionCount === 0, c.collisionCount ? `Print head hits the print in ${c.collisionCount} spots` : "Print head stays clear",
        c.collisionCount ? `${{ clamp: "Lowered automatically", skip: "Pattern left out there", fail: "Export stopped" }[mx.state.collisionMode]}. First spots: ${c.collisions.slice(0, 5).map((p) => `layer ${p.layer} at ${p.x.toFixed(0)}, ${p.y.toFixed(0)}`).join(" · ")}. Shown red under Preview → Problems.` : "Checked against the print head shape for this printer."),
      row(c.flowCapHits === 0, c.flowCapHits ? `Slowed ${c.flowCapHits} spots so the nozzle can melt enough plastic` : "Plastic flow within limits", "The nozzle can only melt plastic so fast; Nexspiro slows down to match."),
      row(c.speedHits + c.zSpeedHits + c.accelHits === 0, "Printer speed limits",
        `${c.speedHits} spots at top speed · ${c.zSpeedHits} up/down moves slowed · ${c.accelHits} turns sharper than the printer can take at full speed`),
      row(c.loopSlowed === 0, c.loopSlowed ? `Loops slowed in ${c.loopSlowed} spots` : "No overlapping loops", "Loops lay plastic over itself, so they print slower."),
      row(true, "Pauses, blobs and lift-offs", `${c.events.dwell} pauses · ${c.events.retract} lift-offs · ${c.events.flow} plastic changes. All supported on ${state.machine.name}.`),
      row(true, "What the patterns add", `Print time ${fmtT(dt)} (walls ${Math.round(r.stats.seconds / 60)} min) · filament ${dg >= 0 ? "+" : "−"}${Math.abs(dg).toFixed(1)} g (${r.stats.grams.toFixed(1)} g total)`),
      h("div", { style: "display:flex;gap:8px;justify-content:flex-end;margin-top:8px" },
        h("button", { onclick: () => { close(); state.color = "problems"; setTab("preview"); } }, "Show problems"),
        h<"button">("button.primary", { disabled: c.blocking || undefined, title: c.blocking ? "Fix the print head hits first, or pick another option under Printer" : "", onclick: () => { download(`nexspiro-${state.machine.id}.gcode`, r.gcode); close(); } }, c.blocking ? "Export blocked" : "Export G-code")),
    ));
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
$("exportBtn").addEventListener("click", showCheck);

view.setMachine(state.machine);
renderLeft(); renderRight(); setTab("prepare");
