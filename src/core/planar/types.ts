// Shared contracts of the planar (layer-by-layer) slicer. Units: mm, degrees, seconds. Bed-centre XY, Z up from the plate.
import type { MachinePreset, FilamentPreset, ProcessPreset } from "../presets.ts";
import type { SettingMap } from "../settings.ts";

/** A flat ring: x,y,x,y… Outer rings are counter-clockwise, holes clockwise. Not repeated: last point != first. */
export type Ring = Float64Array;
/** One island: an outer ring plus its holes. */
export type ExPoly = { outer: Ring; holes: Ring[] };

/** Toolpath roles. 0 is travel (never extrudes). Numbers are stable: they are stored in typed arrays and drive preview colours. */
export const Feature = {
  Travel: 0, OuterWall: 1, InnerWall: 2, OverhangWall: 3, SparseInfill: 4, InternalSolid: 5, TopSurface: 6, BottomSurface: 7,
  Bridge: 8, GapFill: 9, Skirt: 10, Brim: 11, Support: 12, SupportInterface: 13, Ironing: 14, Raft: 15, PrimeTower: 16, Custom: 17,
} as const;
export type FeatureId = (typeof Feature)[keyof typeof Feature];
export const FEATURE_LABEL: Record<number, string> = {
  0: "Travel", 1: "Outer wall", 2: "Inner wall", 3: "Overhang wall", 4: "Sparse infill", 5: "Internal solid infill", 6: "Top surface", 7: "Bottom surface",
  8: "Bridge", 9: "Gap infill", 10: "Skirt", 11: "Brim", 12: "Support", 13: "Support interface", 14: "Ironing", 15: "Raft", 16: "Prime tower", 17: "Custom",
};
/** Bambu Studio's `;TYPE:` comment for each feature. */
export const FEATURE_GCODE_TYPE: Record<number, string> = {
  0: "Travel", 1: "Outer wall", 2: "Inner wall", 3: "Overhang wall", 4: "Sparse infill", 5: "Internal solid infill", 6: "Top surface", 7: "Bottom surface",
  8: "Bridge", 9: "Gap infill", 10: "Skirt", 11: "Brim", 12: "Support", 13: "Support interface", 14: "Ironing", 15: "Support", 16: "Prime tower", 17: "Custom",
};

/** One polyline the toolhead follows while extruding (or an explicit non-extruding wipe/travel when feature = Travel). */
export type Path = {
  feature: FeatureId;
  obj: number;                 // index into PlanarJob.objects, -1 for plate-level paths (skirt, prime tower)
  xyz: Float32Array;           // 3 floats per point; z is the nozzle height (usually the layer top, varies for non-planar walls)
  closed: boolean;             // loop whose last point returns to the first (the writer closes it; xyz does not repeat the start)
  width: number;               // extrusion width, mm
  height: number;              // extruded layer thickness at this path, mm (bridges use ≈ nozzle diameter)
  flow: number;                // extra multiplier on top of width×height (bridge flow, ironing 0.1…)
  speed: number;               // target mm/s before acceleration / cooling limits (already feature + overhang specific)
  accel?: number;              // mm/s² override, 0/undefined = process default
  zone?: Uint8Array;           // optional per-point wall-texture zone (0 base, i+1 painted region i) for preview colouring
  fan?: number;                // optional fan override 0..100 (bridges / overhangs)
  /** Per-point speed multipliers (length = point count, last for closed loops = first) used for overhang slowdown. */
  speedScale?: Float32Array;
  /** Per-point extrusion multipliers (length = point count): a segment extrudes by the mean of its end points. Used by wall textures (extrusion pulse). */
  flowScale?: Float32Array;
};
/** All paths of one layer, in print order. The G-code writer inserts travel, retraction, z-hop and wipes between them. */
export type Layer = {
  index: number;               // 0-based global print layer (object-sequential prints restart per object but keep unique `print` order)
  obj: number;                 // owning object for by-object printing, -1 = layer shared by all objects
  z: number;                   // top of the layer, mm
  height: number;              // thickness, mm
  paths: Path[];
  /** Combined layers (infill every N): number of thin layers this sparse infill spans; informational. */
  isRaft?: boolean;
};
export type PlanarObject = {
  id: string; name: string;
  tris: Float32Array;          // triangles (9 floats each) already in bed-centre space, min Z at 0 (raft/support offsets applied by the slicer)
  settings: SettingMap;        // fully resolved settings for this object (global + per-object overrides)
  texture?: TextureHook;       // optional NexSpiro wall texture / non-linear hook, applied to the outer wall only
  /** Enforcer/blocker volumes for supports, optional triangle soups in bed space. */
  supportEnforcers?: Float32Array; supportBlockers?: Float32Array;
};
/** Hook the planner calls for each outer-wall ring so NexSpiro textures can displace it. Returns the new points (xyz triplets) — may add points. */
export type TextureHook = (ring: Float64Array, z: number, layerIndex: number, layerHeight: number, closed: boolean) => { xyz: Float32Array; zone?: Uint8Array; flow?: Float32Array } | null;

export type PlanarJob = {
  objects: PlanarObject[];
  machine: MachinePreset; filament: FilamentPreset; process: ProcessPreset;
  settings: SettingMap;        // global resolved settings (plate level: skirt, brim, print_sequence, support global flags…)
  onProgress?: (fraction: number, stage: string) => void;
};
export type PlanarPlan = {
  layers: Layer[];             // in print order
  sequence: "layer" | "object";
  warnings: string[];
  objectNames: string[];
  /** Per-object extents after slicing, for the UI and EXCLUDE_OBJECT definitions: [minX,minY,maxX,maxY]. */
  bounds: [number, number, number, number][];
};

/** Support geometry per layer, produced by supports.ts and turned into paths by the planner (infill patterns live there). */
export type SupportLayer = {
  base: ExPoly[];              // normal support body
  topInterface: ExPoly[];      // dense roof under overhangs
  bottomInterface: ExPoly[];   // dense floor above model surfaces
};
export type SupportResult = { layers: SupportLayer[]; raftLayers: ExPoly[][]; warnings: string[] };

/** Final G-code writer output. */
export type GcodeResult = {
  text: string;
  timeS: number;
  filamentMm: number; filamentCm3: number; grams: number; cost: number;
  layers: number;
  /** Time (s) and filament (mm) per feature, for the preview legend. */
  byFeature: Record<number, { timeS: number; filamentMm: number }>;
};
/** Per-move preview data derived from the plan: flat typed arrays, one entry per segment. */
export type PreviewSegments = {
  count: number;
  a: Float32Array;             // 3 floats: start xyz
  b: Float32Array;             // 3 floats: end xyz
  feature: Uint8Array;
  layer: Uint32Array;
  obj: Int16Array;
  speed: Float32Array;         // effective mm/s after planning
  width: Float32Array;
  zone: Uint8Array;
  order: Float32Array;         // cumulative print time at the segment end, s (for the scrub/animation)
};
