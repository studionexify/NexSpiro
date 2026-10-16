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
  | 'prime_tower'
  | 'travel'
  | 'wave_overhang';

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
  wave_overhang: 'Wave overhang',
  prime_tower: 'Prime tower',
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

export type PartType = 'negative' | 'modifier' | 'support_enforcer' | 'support_blocker';

export interface PartInput {
  type: PartType;
  /** World-space, indexed. */
  vertices: Float32Array;
  indices: Uint32Array;
  /** Modifier overrides (only MODIFIER_KEYS are honoured). */
  overrides?: Record<string, number | boolean | string>;
}

/** Per-triangle paint layers. support/seam: 0 none, 1 enforce, 2 block. color: 0 = object filament, n = slot n-1. */
export interface MeshPaint { support?: Uint8Array; seam?: Uint8Array; color?: Uint8Array; motion?: Uint8Array }

export interface MeshInput {
  id: string;
  name: string;
  /** World-space vertex positions (already transformed), indexed. */
  vertices: Float32Array;
  indices: Uint32Array;
  /** 0-based filament slot for this object (default 0). */
  filament?: number;
  /** Per-object setting overrides (only OBJECT_KEYS are honoured). */
  overrides?: Record<string, number | boolean | string>;
  parts?: PartInput[];
  paint?: MeshPaint;
  /** Variable layer height profile: successive layer heights from the bed. */
  layerHeights?: number[];
  /** Named sets of picked triangles (used by plugins such as Motionex). */
  faceSets?: FaceSet[];
}

export interface FaceSet { id: string; name: string; tris: Uint32Array }

/** Filament slot settings used during emission. */
export interface FilamentSlot {
  name: string;
  type: string;
  color: string;
  diameter: number;
  density: number;
  cost: number;
  nozzleTemp: number;
  nozzleTempInitial: number;
  flowRatio: number;
  maxVolumetricSpeed: number;
  pressureAdvance?: number;
}

/** Actions inserted at a layer height (from the preview slider). */
export interface LayerAction {
  z: number; type: 'pause' | 'color' | 'custom' | 'config'; filament?: number; gcode?: string;
  /** 'config': a numeric setting changed from this layer on (e.g. nozzle temperature, retraction, speed). */
  key?: string; value?: number;
}

export interface SliceOptions {
  filaments?: FilamentSlot[];
  /** Flush volume (mm³) for each [from][to] filament pair; overrides flush_volume. */
  flushMatrix?: number[][];
  layerActions?: LayerAction[];
  /** Config for each enabled plugin, keyed by plugin id (plain data). */
  plugins?: Record<string, unknown>;
}

export interface SliceStats {
  timeSeconds: number;
  filamentMm: number;
  filamentGrams: number;
  filamentCost: number;
  layerCount: number;
  toolChanges: number;
  perFilament: { grams: number; mm: number; cost: number }[];
  towerGrams: number;
  byFeature: Partial<Record<FeatureType, { time: number; filamentMm: number }>>;
}

export interface SliceOutput {
  gcode: string;
  moves: Float32Array; // packed moves, see packMoves()
  moveFeatures: Uint8Array;
  layers: LayerResult[];
  stats: SliceStats;
  warnings: string[];
  /** What each plugin reported (e.g. Motionex print check). */
  pluginReports?: Record<string, unknown>;
}

export const FEATURE_ORDER: FeatureType[] = [
  'outer_wall', 'inner_wall', 'overhang_wall', 'sparse_infill', 'internal_solid_infill',
  'top_surface', 'bottom_surface', 'bridge', 'ironing', 'skirt', 'brim', 'support',
  'support_interface', 'travel', 'prime_tower', 'wave_overhang',
];
