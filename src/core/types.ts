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
}

export interface Toolpath {
  feature: Feature;
  closed: boolean;
  points: ToolpathPoint[];
  /** Plugin id that last modified this path, for preview colouring. */
  modifiedBy?: string;
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
}
