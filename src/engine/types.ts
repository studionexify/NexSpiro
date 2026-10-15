// Core engine types. All engine geometry is in millimetres unless noted.

/** Clipper integer point (scaled by SCALE). */
export interface IntPoint { X: number; Y: number }
export type Path = IntPoint[];
export type Paths = Path[];

/** A polygon with holes; contour is CCW, holes CW (Clipper convention). */
export interface ExPolygon { contour: Path; holes: Paths }

export type FeatureType =
  | 'outer_wall'
  | 'inner_wall'
  | 'overhang_wall'
  | 'sparse_infill'
  | 'internal_solid_infill'
  | 'top_surface'
  | 'bottom_surface'
  | 'bridge'
  | 'ironing'
  | 'skirt'
  | 'brim'
  | 'support'
  | 'support_interface'
  | 'travel';

export const FEATURE_LABELS: Record<FeatureType, string> = {
  outer_wall: 'Outer wall',
  inner_wall: 'Inner wall',
  overhang_wall: 'Overhang wall',
  sparse_infill: 'Sparse infill',
  internal_solid_infill: 'Internal solid infill',
  top_surface: 'Top surface',
  bottom_surface: 'Bottom surface',
  bridge: 'Bridge',
  ironing: 'Ironing',
  skirt: 'Skirt',
  brim: 'Brim',
  support: 'Support',
  support_interface: 'Support interface',
  travel: 'Travel',
};

/** Polyline in mm, either closed loop or open path. */
export interface Polyline2 { pts: number[]; closed: boolean } // flat [x0,y0,x1,y1,...]

/** One extrusion path, before emission. */
export interface ExtrusionPath {
  feature: FeatureType;
  pts: number[]; // flat xy in mm
  closed: boolean;
  width: number; // mm
  flow?: number; // multiplier
}

/** A single emitted move — the unit of the preview & time estimate. */
export interface Move {
  x: number; y: number; z: number; // end position
  e: number; // extruded filament length for this move (mm, relative)
  f: number; // feedrate mm/s
  feature: FeatureType;
  width: number;
  height: number;
  t: number; // estimated duration (s)
}

export interface LayerResult {
  index: number;
  z: number; // top of layer
  height: number;
  moveStart: number; // index into moves array
  moveEnd: number; // exclusive
  time: number;
}

export interface MeshInput {
  id: string;
  name: string;
  /** World-space vertex positions (already transformed), indexed. */
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface SliceStats {
  timeSeconds: number;
  filamentMm: number;
  filamentGrams: number;
  filamentCost: number;
  layerCount: number;
  byFeature: Partial<Record<FeatureType, { time: number; filamentMm: number }>>;
}

export interface SliceOutput {
  gcode: string;
  moves: Float32Array; // packed moves, see packMoves()
  moveFeatures: Uint8Array;
  layers: LayerResult[];
  stats: SliceStats;
  warnings: string[];
}

export const FEATURE_ORDER: FeatureType[] = [
  'outer_wall', 'inner_wall', 'overhang_wall', 'sparse_infill', 'internal_solid_infill',
  'top_surface', 'bottom_surface', 'bridge', 'ironing', 'skirt', 'brim', 'support',
  'support_interface', 'travel',
];
