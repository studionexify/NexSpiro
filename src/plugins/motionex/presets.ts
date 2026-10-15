import { flatCurve, pt, type Curve, type CurveKey, type MotionBrush } from "./model.ts";

/** Periodic curve as cubic Hermite → bezier through n samples of f (derivative df), exact to ~0.1% for n=8. */
function periodic(f: (t: number) => number, df: (t: number) => number, n = 8): Curve {
  const dt = 1 / n, h = dt / 3;
  const points = Array.from({ length: n + 1 }, (_, i) => {
    const t = i * dt, d = df(t) * h;
    return pt(t, round6(f(t)), i === 0 ? [0, 0] : [-h, round6(-d)], i === n ? [0, 0] : [h, round6(d)]);
  });
  return { interpolation: "bezier", points };
}
const round6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0; // no -0, so JSON round-trips exactly
const TAU = 2 * Math.PI;
const SINE = periodic((t) => Math.sin(TAU * t), (t) => TAU * Math.cos(TAU * t));
const COS = periodic((t) => Math.cos(TAU * t), (t) => -TAU * Math.sin(TAU * t));
const lin = (pts: [number, number][]): Curve => ({ interpolation: "linear", points: pts.map(([t, v]) => pt(t, v)) });
const step = (pts: [number, number][]): Curve => ({ interpolation: "step", points: pts.map(([t, v]) => pt(t, v)) });

function brush(id: string, name: string, over: Partial<Record<CurveKey, Curve>>, extra: Partial<MotionBrush> = {}): MotionBrush {
  return {
    id, name, version: 1, amplitude: 0.6, period_mm: 4, phase_deg: 0, repeat_mode: "tile",
    curves: {
      lateral_offset: flatCurve(0), along_offset: flatCurve(0), z_offset: flatCurve(0),
      extrusion_mult: flatCurve(1), speed_mult: flatCurve(1), ...over,
    },
    events: [], noise: null, limits: { min_flow_mult: 0.5, max_flow_mult: 1.6 }, tags: ["preset"], ...extra,
  };
}

/** Built-in library (spec §3.1). Presets are read-only; editing one saves a copy. */
export const PRESETS: MotionBrush[] = [
  brush("preset-sine", "Sine wave", { lateral_offset: SINE }),
  brush("preset-zigzag", "Zigzag", { lateral_offset: lin([[0, 0], [0.25, 1], [0.75, -1], [1, 0]]) }),
  brush("preset-square", "Square wave", { lateral_offset: step([[0, 1], [0.5, -1], [1, -1]]) }, { amplitude: 0.4, period_mm: 6 }),
  brush("preset-sawtooth", "Sawtooth", { lateral_offset: lin([[0, -1], [1, 1]]) }, { period_mm: 5 }),
  // Coil: lateral sine + along-path cosine traces a circle-ish trochoid; along amplitude < period/2π keeps it forward-moving.
  brush("preset-coil", "Spiral / coil", { lateral_offset: SINE, along_offset: COS }, { amplitude: 0.5, period_mm: 3.5 }),
  // Loop/curl: along offset large enough that the nozzle runs backwards briefly, drawing loops.
  brush("preset-loop", "Loop / curl", { lateral_offset: SINE, along_offset: COS, speed_mult: lin([[0, 0.7], [1, 0.7]]) },
    { amplitude: 1.2, period_mm: 4, limits: { min_flow_mult: 0.5, max_flow_mult: 1.4 } }),
  brush("preset-noise", "Noise (fuzzy)", {}, { amplitude: 0.35, period_mm: 1.5, noise: { enabled: true, type: "value", seed: 1337, scale: 1, octaves: 3, persistence: 0.5 } }),
];

export function presetById(id: string): MotionBrush | undefined { return PRESETS.find((b) => b.id === id); }
