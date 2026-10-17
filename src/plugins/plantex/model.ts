// Plantex data model: a vase or planter is a profile (radius by height) swept around a cross-section,
// twisted, then shaped by texture layers (emboss / deboss / cut through). Plain data only, so designs
// save to the project file and to the user's design library as JSON.

export type PlantexKind = 'planter' | 'vase';
export type SectionKind = 'circle' | 'polygon' | 'star' | 'petal' | 'gear' | 'superellipse' | 'wave';
export type TwistEase = 'linear' | 'ease' | 'wave';
export type TextureMode = 'emboss' | 'deboss' | 'cut';
export type TextureKind =
  | 'ribs' | 'flutes' | 'fins' | 'pleats' | 'lattice' | 'diamonds' | 'pyramids' | 'knurl' | 'hex' | 'voronoi'
  | 'bubbles' | 'craters' | 'waves' | 'rings' | 'steps' | 'bricks' | 'weave' | 'scales' | 'zigzag' | 'ribbons'
  | 'facets' | 'dots' | 'noise' | 'helix' | 'petals' | 'pattern';

/** A profile control point: z as a fraction of the height (0 = base, 1 = rim), r = radius in mm. */
export interface ProfilePoint { z: number; r: number }

/**
 * A reference plane at a height (fraction of the texture band). Between planes the values are blended,
 * so alternating shifts give zig-zags (linear blend) or waves (smooth blend).
 */
export interface RefPlane { z: number; shift: number; scale: number; depth: number }

export interface TextureLayer {
  id: string;
  name: string;
  enabled: boolean;
  kind: TextureKind;
  /** Patternex library entry key when kind = 'pattern' (linked, not copied). */
  patternKey?: string;
  mode: TextureMode;
  /** mm of relief (emboss / deboss). */
  depth: number;
  /** Repeats around the body. */
  countU: number;
  /** Repeats up the texture band. */
  countV: number;
  /** Shear of the pattern (°): 0 = upright, ± = spiralling. */
  rotate: number;
  /** Turn the pattern around the body (°). */
  offsetU: number;
  /** Move the pattern up (fraction of one repeat). */
  offsetV: number;
  /** Texture band, fractions of the height. */
  z0: number;
  z1: number;
  /** Soft fade at the band edges (mm). */
  fade: number;
  /** Kind-specific shape value 0..1 (line width, cell gap, bump size…). */
  shape: number;
  /** Edge sharpness 0 (soft) .. 1 (hard). */
  sharp: number;
  invert: boolean;
  seed: number;
  /** Sine wave on the pattern around the body: amplitude (°) and period (mm). */
  waveAmp: number;
  wavePeriod: number;
  /** Reference planes; empty = no modulation. */
  planes: RefPlane[];
  /** Blend between planes: linear (zig-zag) or smooth (wave). */
  planeBlend: 'linear' | 'smooth';
  /** Cut-through threshold 0..1 (higher = smaller holes). */
  cutLevel: number;
}

export interface SectionSpec {
  kind: SectionKind;
  /** Corners / lobes / teeth. */
  n: number;
  /** Lobe or tooth depth as a fraction of the radius. */
  depth: number;
  /** 0 = sharp, 1 = round (polygon corners, gear teeth). */
  round: number;
  /** Superellipse exponent. */
  exponent: number;
  /** Width / depth ratio (oval bodies). */
  aspect: number;
  /** Section at the rim (blended up the height); omitted = same as the base. */
  morphTo?: Omit<SectionSpec, 'morphTo'>;
}

export interface DrainSpec {
  enabled: boolean;
  /** Centre hole diameter (mm), 0 = none. */
  center: number;
  /** Ring of holes. */
  count: number;
  diameter: number;
  /** Ring radius as a fraction of the floor radius. */
  ring: number;
}

export interface SaucerSpec {
  enabled: boolean;
  gap: number;
  wall: number;
  floor: number;
  height: number;
  /** Outward flare of the rim (mm). */
  flare: number;
  /** Raised ribs on the saucer floor that lift the pot so water can drain (0 = none). */
  ribs: number;
}

export interface PlantexSpec {
  name: string;
  kind: PlantexKind;
  /** Single closed body for spiral vase mode (outer wall only; no holes possible). */
  vaseMode: boolean;
  height: number;
  profile: ProfilePoint[];
  /** Spline through the points (else straight segments). */
  smooth: boolean;
  section: SectionSpec;
  /** Total twist base → rim (°). */
  twist: number;
  twistEase: TwistEase;
  wall: number;
  floor: number;
  /** Band under the rim kept free of cut-throughs (mm). */
  solidRim: number;
  /** Band above the floor kept free of cut-throughs (mm). */
  solidBase: number;
  drain: DrainSpec;
  saucer: SaucerSpec;
  textures: TextureLayer[];
  /** Mesh resolution: segments around, max row step (mm). */
  around: number;
  step: number;
}

let seq = 0;
export const uid = (p = 't') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function textureLayer(patch: Partial<TextureLayer> = {}): TextureLayer {
  return {
    id: uid(), name: 'Texture', enabled: true, kind: 'ribs', mode: 'emboss', depth: 1.6, countU: 48, countV: 1,
    rotate: 0, offsetU: 0, offsetV: 0, z0: 0, z1: 1, fade: 0, shape: 0.5, sharp: 0.5, invert: false, seed: 1,
    waveAmp: 0, wavePeriod: 40, planes: [], planeBlend: 'smooth', cutLevel: 0.5, ...patch,
  };
}

export const DEFAULT_SECTION: SectionSpec = { kind: 'circle', n: 6, depth: 0.15, round: 0.3, exponent: 4, aspect: 1 };

export function defaultSpec(): PlantexSpec {
  return {
    name: 'New planter', kind: 'planter', vaseMode: false, height: 110,
    profile: [{ z: 0, r: 45 }, { z: 0.45, r: 62 }, { z: 1, r: 55 }], smooth: true,
    section: { ...DEFAULT_SECTION }, twist: 0, twistEase: 'linear',
    wall: 2.4, floor: 2.4, solidRim: 3, solidBase: 4,
    drain: { enabled: true, center: 10, count: 0, diameter: 6, ring: 0.55 },
    saucer: { enabled: false, gap: 2, wall: 2, floor: 2, height: 14, flare: 4, ribs: 6 },
    textures: [], around: 360, step: 0.6,
  };
}

/** Fill gaps in stored / preset data with defaults (older saves, partial presets). */
export function normalizeSpec(s: Partial<PlantexSpec>): PlantexSpec {
  const d = defaultSpec();
  return {
    ...d, ...s,
    section: { ...d.section, ...s.section },
    drain: { ...d.drain, ...s.drain }, saucer: { ...d.saucer, ...s.saucer },
    profile: (s.profile ?? d.profile).map((p) => ({ ...p })),
    textures: (s.textures ?? []).map((t) => textureLayer({ ...t, id: t.id ?? uid() })),
  };
}
