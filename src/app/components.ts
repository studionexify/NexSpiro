// Pure HTML builders and small helpers for the clay UI (no module-level DOM access, so they can be unit-tested in Node).
import { icon } from "./icons.ts";

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const opt = (v: string, label: string, sel: boolean) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(label)}</option>`;

/** Percent position of `v` inside [min, max], used for the filled part of a slider track. */
export const pct = (v: number, min: number, max: number) => (max > min ? Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) : 0);

/** Slider row: label + live value on top, track below. `attrs` carries the data-* hooks the delegated handlers read. */
export function rangeRow(label: string, attrs: string, value: number, min: number, max: number, step: number, o: { unit?: string; cls?: string; disabled?: boolean; digits?: number } = {}) {
  const shown = o.digits !== undefined ? value.toFixed(o.digits) : String(value);
  return `<div class="row range"><span class="lbl">${label}</span><output class="v">${shown}${o.unit ? `<span class="unit">${o.unit}</span>` : ""}</output>
    <input type="range" class="${o.cls ?? ""}" ${attrs} min="${min}" max="${max}" step="${step}" value="${value}" style="--p:${pct(value, min, max).toFixed(1)}%"${o.disabled ? " disabled" : ""} aria-label="${esc(label)}"></div>`;
}
export const numRow = (label: string, attrs: string, value: number | string, o: { unit?: string; step?: number | string; min?: number; max?: number; disabled?: boolean } = {}) =>
  `<label class="row"><span class="lbl">${label}</span><span class="numwrap"><input type="number" ${attrs} step="${o.step ?? "any"}"${o.min !== undefined ? ` min="${o.min}"` : ""}${o.max !== undefined ? ` max="${o.max}"` : ""} value="${value}"${o.disabled ? " disabled" : ""}>${o.unit ? `<span class="unit">${o.unit}</span>` : ""}</span></label>`;
export const switchRow = (label: string, attrs: string, on: boolean, o: { disabled?: boolean } = {}) =>
  `<label class="row"><span class="lbl">${label}</span><input type="checkbox" ${attrs}${on ? " checked" : ""}${o.disabled ? " disabled" : ""}></label>`;
export const selectRow = (label: string, attrs: string, options: string) =>
  `<label class="row"><span class="lbl">${label}</span><select ${attrs}>${options}</select></label>`;

export type SegItem = { value: string; label: string; icon?: string; disabled?: boolean; title?: string };
export const seg = (act: string, items: SegItem[], current: string, o: { cls?: string; hideLabels?: boolean } = {}) =>
  `<div class="seg ${o.cls ?? ""}" role="tablist">${items.map((i) =>
    `<button type="button" role="tab" aria-selected="${i.value === current}" class="${i.value === current ? "on" : ""}" data-act="${act}" data-arg="${i.value}"${i.disabled ? " disabled" : ""}${i.title ? ` title="${esc(i.title)}"` : ""}>${i.icon ? icon(i.icon) : ""}<span class="tx">${i.label}</span></button>`).join("")}</div>`;

/** Material family guessed from a filament preset name (PLA/PETG/TPU…); "Custom" when unknown. */
export function materialOf(name: string): string {
  const m = /\b(PETG|PLA|TPU|ABS|ASA|PA12|PA6|PA|PC|PVA|HIPS|PP)\b/i.exec(name);
  return m ? m[1].toUpperCase() : "Custom";
}
/** Lifecycle shown in the top capsule. */
export type PlateState = "idle" | "slicing" | "done" | "error";
export function statusBadge(state: PlateState, fresh: boolean, issues: readonly { level: string }[]): { text: string; tone: "plain" | "amber" | "sage" | "coral" } {
  if (state === "slicing") return { text: "Slicing…", tone: "amber" };
  if (state === "error") return { text: "Error", tone: "coral" };
  if (state !== "done" || !fresh) return { text: "Draft", tone: "plain" };
  return issues.length ? { text: "Sliced", tone: issues.some((i) => i.level === "error") ? "coral" : "amber" } : { text: "Ready", tone: "sage" };
}
/** Planar vs. non-linear label for a sliced plate (nonLinearMm = path length carrying in-layer Z motion). */
export function slicingKind(nonLinearMm: number | undefined): "nonlinear" | "planar" | "none" {
  return nonLinearMm === undefined ? "none" : nonLinearMm > 0 ? "nonlinear" : "planar";
}
/** CSS gradient string for the preview legend: blue (low) → red (high), matching the toolpath ramp. */
export function rampGradient(sat = 70, light = 50, stops = 8): string {
  const s = Array.from({ length: stops + 1 }, (_, i) => `hsl(${Math.round((1 - i / stops) * 240)} ${sat}% ${light}%)`);
  return `linear-gradient(90deg, ${s.join(", ")})`;
}
export const slug = (s: string) => s.trim().replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "project";

/** Two-thumb slider (layer range). Horizontal or vertical (low at the bottom). Values are 0..1. */
export class DualSlider {
  lo = 0; hi = 1;
  private readonly el: HTMLElement; private readonly vertical: boolean;
  private readonly thumbs: HTMLButtonElement[];
  private readonly onChange: (lo: number, hi: number) => void;
  constructor(el: HTMLElement, vertical: boolean, onChange: (lo: number, hi: number) => void, labels: [string, string]) {
    this.el = el; this.vertical = vertical; this.onChange = onChange;
    el.classList.add("dual", vertical ? "v" : "h");
    el.innerHTML = `<div class="track"><div class="fill"></div></div>
      <button type="button" class="thumb" role="slider" aria-label="${labels[0]}" aria-valuemin="0" aria-valuemax="100"></button>
      <button type="button" class="thumb" role="slider" aria-label="${labels[1]}" aria-valuemin="0" aria-valuemax="100"></button>`;
    this.thumbs = [...el.querySelectorAll<HTMLButtonElement>(".thumb")];
    this.thumbs.forEach((t, k) => {
      t.addEventListener("pointerdown", (e) => { e.preventDefault(); t.setPointerCapture(e.pointerId); });
      t.addEventListener("pointermove", (e) => { if (t.hasPointerCapture(e.pointerId)) this.drag(k, e); });
      t.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.01 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.01 : 0;
        if (!d) return; e.preventDefault(); this.move(k, (k ? this.hi : this.lo) + d);
      });
    });
    this.render();
  }
  private frac(e: PointerEvent) {
    const r = this.el.getBoundingClientRect(), pad = 11;
    return this.vertical ? 1 - (e.clientY - r.top - pad) / Math.max(1, r.height - 2 * pad) : (e.clientX - r.left - pad) / Math.max(1, r.width - 2 * pad);
  }
  private drag(k: number, e: PointerEvent) { this.move(k, this.frac(e)); }
  private move(k: number, f: number) {
    f = Math.min(1, Math.max(0, f));
    if (k === 0) this.lo = Math.min(f, this.hi); else this.hi = Math.max(f, this.lo);
    this.render(); this.onChange(this.lo, this.hi);
  }
  set(lo: number, hi: number) { this.lo = lo; this.hi = hi; this.render(); }
  private render() {
    this.el.style.setProperty("--lo", String(this.lo)); this.el.style.setProperty("--hi", String(this.hi));
    this.thumbs[0].style.setProperty("--t", String(this.lo)); this.thumbs[1].style.setProperty("--t", String(this.hi));
    this.thumbs[0].setAttribute("aria-valuenow", String(Math.round(this.lo * 100))); this.thumbs[1].setAttribute("aria-valuenow", String(Math.round(this.hi * 100)));
  }
}
