// Core data structures shared by the slicer, plugins and G-code emitter.

export type Feature = "outer_wall" | "inner_wall" | "top_surface" | "bottom_surface" | "infill" | "skirt";

export interface ToolpathPoint {
  x: number; y: number; z: number;
  /** Feedrate in mm/s for the move that ends at this point. */
  f: number;
  /** Flow multiplier applied to the move that ends at this point (1 = nominal). */
  flow: number;
  /** Extrusion in mm of filament for the move ending here; filled in by computeExtrusion(). */
  e: number;
  /** The move ending here is a non-printing travel (after a retract). */
  travel?: boolean;
  /** Actions run after arriving at this point. */
  post?: PointAction;
  /** Height above/below the layer's flat height, for preview colouring. */
  zOff?: number;
  /** Wall slope at this point in degrees: 0 = straight up, + = leaning out (overhang), − = leaning in. */
  slope?: number;
  /** Problem marker for the preview and report. */
  flag?: "collision" | "loop";
}

export interface PointAction {
  retract_mm?: number;
  unretract_mm?: number;
  dwell_ms?: number;
  /** Extra filament (mm) pushed out during the dwell to make a blob. */
  blob_mm?: number;
}

/** What the pre-export check found. Filled by the core and by plugins. */
export interface PrintCheck {
  collisions: { x: number; y: number; z: number; layer: number }[];
  collisionCount: number;
  /** True when a collision must stop export (user picked "stop and show me"). */
  blocking: boolean;
  flowCapHits: number;
  speedHits: number;
  zSpeedHits: number;
  accelHits: number;
  loopSlowed: number;
  events: { dwell: number; retract: number; flow: number };
  notes: string[];
}

export function emptyCheck(): PrintCheck {
  return { collisions: [], collisionCount: 0, blocking: false, flowCapHits: 0, speedHits: 0, zSpeedHits: 0, accelHits: 0, loopSlowed: 0, events: { dwell: 0, retract: 0, flow: 0 }, notes: [] };
}

export interface Toolpath {
  feature: Feature;
  closed: boolean;
  points: ToolpathPoint[];
  /** Plugin id that last modified this path, for preview colouring. */
  modifiedBy?: string;
  /** The path as the slicer made it, kept so a "replace" pattern can start over from it. */
  base?: ToolpathPoint[];
}

export interface Layer {
  index: number;
  /** Nominal layer top Z in mm. */
  z: number;
  /** Layer height in mm (cross-section height of the bead). */
  height: number;
  paths: Toolpath[];
}

export interface SliceWarning { code: string; message: string; layer?: number }

export interface SlicedPlate {
  layers: Layer[];
  warnings: SliceWarning[];
  check: PrintCheck;
}
