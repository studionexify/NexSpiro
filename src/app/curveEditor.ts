// Graph editor for one Motionex curve: x = position in the period (0–1), y = value.
// Drag points and bezier handles, double-click to add, Delete/Backspace to remove the selected point.
import { evalCurve, clamp } from "../plugins/motionex/curve.ts";
import { pt, type Curve } from "../plugins/motionex/model.ts";

export interface CurveEditorOpts { min: number; max: number; disabled: boolean; onChange: () => void; onSelect: (i: number | null) => void }

type Grab = { kind: "point" | "in" | "out"; i: number } | null;

export class CurveEditor {
  canvas: HTMLCanvasElement;
  selected: number | null = null;
  private grab: Grab = null;
  private pad = { l: 40, r: 14, t: 14, b: 24 };

  constructor(public curve: Curve, private o: CurveEditorOpts) {
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    this.canvas.style.height = "260px";
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", () => { this.grab = null; });
    this.canvas.addEventListener("dblclick", (e) => this.add(e));
    this.canvas.addEventListener("keydown", (e) => { if ((e.key === "Delete" || e.key === "Backspace") && this.selected !== null) { this.removeSelected(); e.preventDefault(); } });
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  private get w() { return this.canvas.clientWidth; }
  private get hgt() { return this.canvas.clientHeight; }
  private X = (t: number) => this.pad.l + t * (this.w - this.pad.l - this.pad.r);
  private Y = (v: number) => this.pad.t + (1 - (v - this.o.min) / (this.o.max - this.o.min)) * (this.hgt - this.pad.t - this.pad.b);
  private T = (x: number) => (x - this.pad.l) / (this.w - this.pad.l - this.pad.r);
  private V = (y: number) => this.o.min + (1 - (y - this.pad.t) / (this.hgt - this.pad.t - this.pad.b)) * (this.o.max - this.o.min);

  private local(e: MouseEvent) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  private hit(x: number, y: number): Grab {
    const P = this.curve.points;
    if (this.curve.interpolation === "bezier" && this.selected !== null) {
      const p = P[this.selected];
      for (const kind of ["in", "out"] as const) {
        const hnd = kind === "in" ? p.in_handle : p.out_handle;
        if (Math.hypot(this.X(p.t + hnd[0]) - x, this.Y(p.v + hnd[1]) - y) < 8) return { kind, i: this.selected };
      }
    }
    for (let i = 0; i < P.length; i++) if (Math.hypot(this.X(P[i].t) - x, this.Y(P[i].v) - y) < 9) return { kind: "point", i };
    return null;
  }

  private down(e: PointerEvent): void {
    if (this.o.disabled) return;
    const { x, y } = this.local(e);
    this.grab = this.hit(x, y);
    if (this.grab?.kind === "point") this.select(this.grab.i);
    else if (!this.grab) this.select(null);
    this.canvas.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent): void {
    const { x, y } = this.local(e);
    this.canvas.style.cursor = this.o.disabled ? "not-allowed" : this.hit(x, y) ? "grab" : "crosshair";
    if (!this.grab) return;
    const P = this.curve.points, i = this.grab.i, p = P[i];
    const t = clamp(this.T(x), 0, 1), v = clamp(this.V(y), this.o.min, this.o.max);
    if (this.grab.kind === "point") {
      const lo = i === 0 ? 0 : P[i - 1].t + 0.001, hi = i === P.length - 1 ? 1 : P[i + 1].t - 0.001;
      if (i !== 0 && i !== P.length - 1) p.t = round(clamp(t, lo, hi));
      p.v = round(v);
    } else {
      const dt = round(t - p.t), dv = round(v - p.v);
      if (this.grab.kind === "in") p.in_handle = [Math.min(0, dt), dv]; else p.out_handle = [Math.max(0, dt), dv];
    }
    this.draw(); this.o.onChange();
  }

  private add(e: MouseEvent): void {
    if (this.o.disabled) return;
    const { x } = this.local(e);
    const t = round(clamp(this.T(x), 0, 1));
    const v = round(evalCurve(this.curve, t));
    const P = this.curve.points;
    const i = P.findIndex((p) => p.t > t);
    const at = i < 0 ? P.length : i;
    P.splice(at, 0, pt(t, v, [-0.05, 0], [0.05, 0]));
    this.select(at); this.draw(); this.o.onChange();
  }

  removeSelected(): void {
    if (this.selected === null || this.curve.points.length <= 1) return;
    this.curve.points.splice(this.selected, 1);
    this.select(null); this.draw(); this.o.onChange();
  }

  select(i: number | null): void { this.selected = i; this.o.onSelect(i); this.draw(); }

  draw(): void {
    const c = this.canvas, dpr = devicePixelRatio || 1;
    c.width = this.w * dpr; c.height = this.hgt * dpr;
    const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.hgt);
    g.font = "11px Inter, system-ui, sans-serif"; g.fillStyle = "#8a93a0"; g.strokeStyle = "#e6e9ee"; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const v = this.o.min + ((this.o.max - this.o.min) * k) / 4, y = this.Y(v);
      g.beginPath(); g.moveTo(this.pad.l, y); g.lineTo(this.w - this.pad.r, y); g.stroke();
      g.fillText(fmt(v), 4, y + 4);
    }
    for (let k = 0; k <= 4; k++) {
      const x = this.X(k / 4);
      g.beginPath(); g.moveTo(x, this.pad.t); g.lineTo(x, this.hgt - this.pad.b); g.stroke();
      g.fillText(`${k * 25}%`, x - 10, this.hgt - 7);
    }
    g.strokeStyle = this.o.disabled ? "#c5cad2" : "#7c3aed"; g.lineWidth = 2; g.beginPath();
    const N = 300;
    for (let k = 0; k <= N; k++) { const t = k / N, x = this.X(t), y = this.Y(evalCurve(this.curve, t)); k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    const P = this.curve.points;
    if (this.curve.interpolation === "bezier" && this.selected !== null && !this.o.disabled) {
      const p = P[this.selected];
      g.strokeStyle = "#94a3b8"; g.fillStyle = "#fff"; g.lineWidth = 1;
      for (const hnd of [p.in_handle, p.out_handle]) {
        const hx = this.X(p.t + hnd[0]), hy = this.Y(p.v + hnd[1]);
        g.beginPath(); g.moveTo(this.X(p.t), this.Y(p.v)); g.lineTo(hx, hy); g.stroke();
        g.beginPath(); g.arc(hx, hy, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
    P.forEach((p, i) => {
      g.beginPath(); g.arc(this.X(p.t), this.Y(p.v), i === this.selected ? 6.5 : 5, 0, Math.PI * 2);
      g.fillStyle = this.o.disabled ? "#c5cad2" : i === this.selected ? "#7c3aed" : "#fff"; g.fill();
      g.strokeStyle = this.o.disabled ? "#c5cad2" : "#7c3aed"; g.lineWidth = 2; g.stroke();
    });
    if (this.o.disabled) { g.fillStyle = "#6b7380"; g.font = "600 12px Inter, system-ui"; g.fillText("Z motion unlocks with toolhead collision checks (phase 6)", this.pad.l + 10, this.pad.t + 18); }
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000 || 0;
const fmt = (v: number) => (Math.abs(v) < 1e-9 ? "0" : v.toFixed(2).replace(/\.?0+$/, ""));
