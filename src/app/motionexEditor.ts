// Motionex brush editor window: library, curve editor, live 2D preview, parameters.
import { h, numInput, select, download, pickFile } from "./dom.ts";
import { CurveEditor } from "./curveEditor.ts";
import { CURVE_INFO, CURVE_KEYS, type CurveKey, type MotionBrush, type Interpolation, type RepeatMode } from "../plugins/motionex/model.ts";
import { applyBrushToPath } from "../plugins/motionex/modifier.ts";
import { parseBrush, serializeBrush } from "../plugins/motionex/library.ts";
import type { MotionexState } from "../plugins/motionex/index.ts";
import type { PrintProfiles } from "../core/profiles.ts";
import type { Toolpath } from "../core/types.ts";

export function openMotionexEditor(root: HTMLElement, mx: MotionexState, profiles: () => PrintProfiles, startId: string | null, onClose: (changed: boolean) => void): void {
  let brush: MotionBrush = structuredClone(mx.library.get(startId ?? "") ?? mx.library.all()[0]);
  let curveKey: CurveKey = "lateral_offset";
  let dirty = false, changed = false;
  let editor: CurveEditor;
  let query = "";
  const openGroups = new Set<string>([brushGroup(brush)]);

  const win = h("div.window", { role: "dialog", "aria-label": "Motionex pattern library" });
  const lib = h("div.wlib"), main = h("div.wmain"), side = h("div.wside");
  const previewCanvas = h<"canvas">("canvas", { style: "height:190px" });
  const previewCap = h("div.cap");
  const pointBox = h("div");
  const saveBtn = h<"button">("button.primary", { onclick: save }, "Save pattern");
  const title = h("span.title");
  const desc = h("div.wdesc");

  win.append(
    h("div.whead", null, h("span.plugin-badge", null, "M"), h("div", null, title, desc), h("div.spacer"),
      h("button", { onclick: async () => { try { const b = parseBrush(await pickFile(".json,application/json")); brush = mx.library.save(b); changed = true; dirty = false; renderAll(); } catch (e) { alert(`That file could not be opened: ${(e as Error).message}`); } } }, "Open file…"),
      h("button", { onclick: () => download(`${brush.name.replace(/\W+/g, "-").toLowerCase()}.motionex.json`, serializeBrush(brush), "application/json") }, "Save to file"),
      saveBtn, h("button.ghost", { onclick: close, "aria-label": "Close" }, "✕")),
    lib, main, side);
  root.replaceChildren(win); root.hidden = false;
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  function close(): void {
    if (dirty && !confirm("You have unsaved changes to this pattern. Close anyway?")) return;
    document.removeEventListener("keydown", onKey);
    root.hidden = true; root.replaceChildren(); onClose(changed);
  }

  function save(): void {
    brush = mx.library.save(brush); dirty = false; changed = true; renderAll();
  }

  function touch(): void { dirty = true; title.textContent = `${brush.name} •`; drawPreview(); }

  function renderLib(): void {
    const q = query.trim().toLowerCase();
    const match = (b: MotionBrush) => !q || `${b.name} ${b.category ?? ""} ${b.description ?? ""}`.toLowerCase().includes(q);
    const groups = new Map<string, MotionBrush[]>();
    for (const b of mx.library.all()) if (match(b)) { const g = brushGroup(b); groups.set(g, [...(groups.get(g) ?? []), b]); }
    const total = [...groups.values()].reduce((n, bs) => n + bs.length, 0);
    const search = h<"input">("input.lib-search", { type: "search", placeholder: `Search ${mx.library.all().length} patterns…`, value: query,
      oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; renderLib(); const s = lib.querySelector<HTMLInputElement>("input"); s?.focus(); s?.setSelectionRange(query.length, query.length); } });
    lib.replaceChildren(search, ...(total ? [] : [h("div.muted", null, "No patterns match.")]),
      ...[...groups].map(([g, bs]) => {
        const d = h<"details">("details.lib-group", { open: q !== "" || openGroups.has(g) }, h("summary", null, h("span", null, `${g} (${bs.length})`)), h("div.list"));
        d.addEventListener("toggle", () => { if (d.open) fillGroup(d, bs); if (!q) { if (d.open) openGroups.add(g); else openGroups.delete(g); } });
        if (d.open) fillGroup(d, bs);
        return d;
      }),
      h("div.muted", { style: "margin-top:10px" }, "Change any pattern and press Save to keep your own version under My patterns."));
  }

  function fillGroup(d: HTMLDetailsElement, bs: MotionBrush[]): void {
    const list = d.querySelector(".list")!;
    if (list.childElementCount) return;
    list.append(...bs.map((b) => {
      const el = h("div.item" + (b.id === brush.id ? ".sel" : ""), { title: b.description ?? "",
        onclick: () => { if (dirty && !confirm("You have unsaved changes. Switch pattern anyway?")) return; brush = structuredClone(b); dirty = false; renderAll(); } },
        h("canvas", { width: 44, height: 18, style: "width:44px;height:18px" }), h("span.name", null, b.name),
        !mx.library.isPreset(b.id) ? h("button.ghost.sm", { title: "Delete", onclick: (e: Event) => { e.stopPropagation(); if (confirm(`Delete ${b.name}?`)) { mx.library.remove(b.id); changed = true; renderLib(); } } }, "✕") : null);
      thumb(el.querySelector("canvas")!, b);
      return el;
    }));
  }

  function renderMain(): void {
    const info = CURVE_INFO[curveKey];
    editor = new CurveEditor(brush.curves[curveKey], { min: info.min, max: info.max, disabled: !info.enabled, onChange: () => { renderPoint(); touch(); }, onSelect: () => renderPoint() });
    const tabs = h("div.ctabs", null, ...CURVE_KEYS.map((k) => h("button.sm" + (k === curveKey ? ".on" : ""), { onclick: () => { curveKey = k; renderMain(); } }, CURVE_INFO[k].label)));
    const interp = select<Interpolation>(brush.curves[curveKey].interpolation, [["bezier", "Smooth curves"], ["linear", "Straight lines"], ["step", "Sudden jumps"]], (v) => { brush.curves[curveKey].interpolation = v; editor.draw(); touch(); }, { style: "width:auto", disabled: !info.enabled });
    main.replaceChildren(
      h("div", { style: "display:flex;gap:8px;align-items:center;justify-content:space-between" }, tabs, interp),
      h("div.canvas-box", null, editor.canvas, h("div.cap", null, `${info.label} · ${info.unit} · double-click to add a dot`)),
      pointBox,
      h("div.section", null, "Preview: a 40 mm piece of wall, seen from above"),
      h("div.canvas-box", null, previewCanvas, previewCap),
    );
    requestAnimationFrame(() => { editor.draw(); drawPreview(); });
    renderPoint();
  }

  function renderPoint(): void {
    const i = editor.selected;
    if (i === null) { pointBox.replaceChildren(h("div.muted", null, "Drag the dots to reshape the pattern. Click a dot to type exact numbers or drag its handles. Press Delete to remove a dot.")); return; }
    const p = brush.curves[curveKey].points[i];
    const set = (fn: () => void) => () => { fn(); editor.draw(); touch(); };
    const last = brush.curves[curveKey].points.length - 1;
    pointBox.replaceChildren(h("div.row.three", { style: "grid-template-columns:repeat(6,1fr)" },
      h("label", null, "Position % ", numInput(Math.round(p.t * 1000) / 10, (v) => set(() => { if (i > 0 && i < last) p.t = Math.min(1, Math.max(0, v / 100)); })())),
      h("label", null, "Amount ", numInput(p.v, (v) => set(() => { p.v = v; })())),
      h("label", null, "Left handle ↔ ", numInput(p.in_handle[0], (v) => set(() => { p.in_handle[0] = Math.min(0, v); })())),
      h("label", null, "Left handle ↕ ", numInput(p.in_handle[1], (v) => set(() => { p.in_handle[1] = v; })())),
      h("label", null, "Right handle ↔ ", numInput(p.out_handle[0], (v) => set(() => { p.out_handle[0] = Math.max(0, v); })())),
      h("label", null, "Right handle ↕ ", numInput(p.out_handle[1], (v) => set(() => { p.out_handle[1] = v; })())),
    ));
  }

  function renderSide(): void {
    const row = (label: string, input: HTMLElement) => h("div.row", null, h("label", null, label), input);
    const n = brush.noise;
    side.replaceChildren(h("div", null,
      h("div.section", { style: "margin-top:0" }, "Pattern"),
      row("Name", h<"input">("input", { value: brush.name, "aria-label": "Pattern name", oninput: (e: Event) => { brush.name = (e.target as HTMLInputElement).value; touch(); } })),
      row("Wave height (mm)", numInput(brush.amplitude, (v) => { brush.amplitude = Math.max(0, v); touch(); }, { min: 0, step: 0.05 })),
      row("Wave length (mm)", numInput(brush.period_mm, (v) => { brush.period_mm = Math.max(0.2, v); touch(); }, { min: 0.2, step: 0.1 })),
      row("Start shift (°)", numInput(brush.phase_deg, (v) => { brush.phase_deg = ((v % 360) + 360) % 360; touch(); }, { step: 15 })),
      row("Repeat", select<RepeatMode>(brush.repeat_mode, [["tile", "All the way round"], ["once", "Only once"], ["stretch", "Fit evenly (no seam)"]], (v) => { brush.repeat_mode = v; touch(); })),
      h("div.section", null, "Plastic limits"),
      row("Least plastic", numInput(brush.limits.min_flow_mult, (v) => { brush.limits.min_flow_mult = v; touch(); }, { step: 0.05 })),
      row("Most plastic", numInput(brush.limits.max_flow_mult, (v) => { brush.limits.max_flow_mult = v; touch(); }, { step: 0.05 })),
      h("div.muted", null, "1 is the normal amount. Nexspiro also slows down automatically if your printer can't melt plastic fast enough."),
      h("div.section", null, "Roughness"),
      h("label.inline", null, h<"input">("input", { type: "checkbox", checked: !!n?.enabled, onchange: (e: Event) => {
        const on = (e.target as HTMLInputElement).checked;
        brush.noise = on ? (n ?? { enabled: true, type: "value", seed: 1337, scale: 1, octaves: 3, persistence: 0.5 }) : n ? { ...n, enabled: false } : null;
        if (brush.noise) brush.noise.enabled = on; renderSide(); touch();
      } }), "Add random roughness"),
      n?.enabled ? h("div", null,
        row("Pattern number", numInput(n.seed, (v) => { n.seed = Math.round(v); touch(); }, { step: 1 })),
        row("Size", numInput(n.scale, (v) => { n.scale = Math.max(0.05, v); touch(); }, { step: 0.1 })),
        row("Detail", numInput(n.octaves, (v) => { n.octaves = Math.min(6, Math.max(1, Math.round(v))); touch(); }, { step: 1 })),
        row("Bumpiness", numInput(n.persistence, (v) => { n.persistence = v; touch(); }, { step: 0.05 })),
      ) : null,
      h("div.section", null, "Pauses and blobs"),
      h("div.muted", null, "Coming soon: pause the nozzle, add a blob, or lift off at chosen spots."),
      h("div.section", null, "About"),
      h("div.muted", null, `${brush.category ?? "My patterns"} · version ${brush.version}${mx.library.isPreset(brush.id) ? " · built-in (saving keeps your own copy)" : ""}`),
    ));
  }

  function drawPreview(): void {
    const t0 = performance.now();
    const p = profiles();
    const L = 40;
    const base: Toolpath = { feature: "outer_wall", closed: false, points: [
      { x: 0, y: 0, z: 1, f: p.process.wallSpeed, flow: 1, e: 0 }, { x: L, y: 0, z: 1, f: p.process.wallSpeed, flow: 1, e: 0 }] };
    const out = applyBrushToPath(base, brush, p, mx.options, () => 1, () => {});
    const cv = previewCanvas, dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const span = Math.max(2, brush.amplitude * 2.6);
    const sx = (W - 40) / L, sy = Math.min(sx, (H - 30) / (span * 2));
    const X = (x: number) => 20 + x * sx, Y = (y: number) => H / 2 - y * sy;
    g.strokeStyle = "#cfd5dd"; g.setLineDash([4, 4]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(L), Y(0)); g.stroke(); g.setLineDash([]);
    const bead = p.process.lineWidth * sy;
    for (let i = 1; i < out.points.length; i++) {
      const a = out.points[i - 1], b = out.points[i];
      g.strokeStyle = `hsl(${(1 - Math.min(1, Math.max(0, (b.flow - 0.5) / 1.1))) * 240},75%,52%)`;
      g.lineWidth = Math.max(1.5, Math.min(14, bead * b.flow)); g.lineCap = "round";
      g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(b.x), Y(b.y)); g.stroke();
    }
    g.fillStyle = "#8a93a0"; g.font = "11px Inter, system-ui";
    g.fillText("plain wall", X(0), Y(0) - 6 - brush.amplitude * sy);
    g.fillText("10 mm", X(L - 10), H - 8); g.strokeStyle = "#8a93a0"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(L - 10), H - 18); g.lineTo(X(L), H - 18); g.stroke();
    previewCap.textContent = `colour and thickness show the amount of plastic · ${(performance.now() - t0).toFixed(0)} ms`;
  }

  function thumb(cv: HTMLCanvasElement, b: MotionBrush): void {
    const g = cv.getContext("2d")!; g.clearRect(0, 0, 44, 18);
    const p = profiles();
    const out = applyBrushToPath({ feature: "outer_wall", closed: false, points: [{ x: 0, y: 0, z: 0, f: 30, flow: 1, e: 0 }, { x: b.period_mm * 2.5, y: 0, z: 0, f: 30, flow: 1, e: 0 }] }, b, p, { resampleStep: b.period_mm / 24 }, () => 1, () => {});
    const L = b.period_mm * 2.5, A = Math.max(0.01, b.amplitude * 1.3);
    g.strokeStyle = "#7c3aed"; g.lineWidth = 1.5; g.beginPath();
    out.points.forEach((q, i) => { const x = 2 + (q.x / L) * 40, y = 9 - (q.y / A) * 7; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }

  function renderAll(): void { title.textContent = brush.name + (dirty ? " •" : ""); desc.textContent = brush.description ?? ""; openGroups.add(brushGroup(brush)); renderLib(); renderMain(); renderSide(); }

  function brushGroup(b: MotionBrush): string { return mx.library.isPreset(b.id) ? b.category ?? "Other" : "My patterns"; }
  renderAll();
}
