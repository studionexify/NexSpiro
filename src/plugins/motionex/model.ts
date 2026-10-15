// Motionex data model (spec §5). Field names follow the spec so brush JSON is portable.

export type Interpolation = "bezier" | "linear" | "step";

/** Handles are offsets [dt, dv] relative to their point. */
export interface CurvePoint { t: number; v: number; in_handle: [number, number]; out_handle: [number, number] }
export interface Curve { points: CurvePoint[]; interpolation: Interpolation }

export type RepeatMode = "tile" | "once" | "stretch";
export type CurveKey = "lateral_offset" | "along_offset" | "z_offset" | "extrusion_mult" | "speed_mult";

export interface MotionEvent {
  at: { mode: "percent" | "mm"; value: number };
  type: "dwell" | "flow_change" | "retract";
  params: Record<string, number>;
  once?: boolean;
}

export interface NoiseSettings { enabled: boolean; type: "value"; seed: number; scale: number; octaves: number; persistence: number }

export interface MotionBrush {
  id: string;
  name: string;
  version: number;
  /** Peak lateral offset in mm for a curve value of 1. */
  amplitude: number;
  period_mm: number;
  /** Phase in degrees (0–360) of the period. */
  phase_deg: number;
  repeat_mode: RepeatMode;
  curves: Record<CurveKey, Curve>;
  /** Phase 5. Stored and round-tripped, not yet executed. */
  events: MotionEvent[];
  noise: NoiseSettings | null;
  limits: { min_flow_mult: number; max_flow_mult: number };
  tags?: string[];
  /** Library group shown in the picker, e.g. "Waves". */
  category?: string;
  /** One plain-language line shown under the name. */
  description?: string;
}

export type TargetType = "model" | "feature" | "height_range" | "patternex_region";

export interface MotionApplication {
  brush_id: string;
  target: { type: TargetType; ref?: string };
  mask: { z_start: number; z_end: number; fade_in_mm: number; fade_out_mm: number };
  order: number;
  blend: "add" | "override";
  enabled: boolean;
}

export const CURVE_KEYS: CurveKey[] = ["lateral_offset", "along_offset", "z_offset", "extrusion_mult", "speed_mult"];

export const CURVE_INFO: Record<CurveKey, { label: string; unit: string; neutral: number; min: number; max: number; enabled: boolean }> = {
  lateral_offset: { label: "Side to side", unit: "in and out from the wall", neutral: 0, min: -1, max: 1, enabled: true },
  along_offset: { label: "Forward and back", unit: "ahead of or behind the nozzle", neutral: 0, min: -1, max: 1, enabled: true },
  z_offset: { label: "Up and down", unit: "coming soon", neutral: 0, min: -1, max: 1, enabled: false },
  extrusion_mult: { label: "Plastic amount", unit: "1 = normal", neutral: 1, min: 0, max: 3, enabled: true },
  speed_mult: { label: "Speed", unit: "1 = normal", neutral: 1, min: 0.1, max: 2, enabled: true },
};

export function flatCurve(v: number): Curve {
  return { interpolation: "linear", points: [pt(0, v), pt(1, v)] };
}

export function pt(t: number, v: number, inH: [number, number] = [0, 0], outH: [number, number] = [0, 0]): CurvePoint {
  return { t, v, in_handle: inH, out_handle: outH };
}
