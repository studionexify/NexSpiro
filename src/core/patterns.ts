// Toolpath modulation patterns. Each returns radial offset (mm), Z offset (mm) and extrusion multiplier
// at angle theta (rad) on fractional layer index `layer`.
export type PatternParams = {
  amplitude: number;      // radial wave amplitude, mm
  wavesPerRev: number;    // wave count around one revolution
  phasePerLayer: number;  // phase shift per layer, degrees (180 = stacked loops, small = diagonal rope)
  zAmplitude: number;     // in-layer Z oscillation (non-planar), mm
  extrusionPulse: number; // extra extrusion at wave peaks, fraction (0.3 = +30%)
};
export type Sample = { dr: number; dz: number; e: number };
export type PatternFn = (theta: number, layer: number, p: PatternParams) => Sample;

const rad = (deg: number) => (deg * Math.PI) / 180;
const tri = (x: number) => (2 / Math.PI) * Math.asin(Math.sin(x)); // triangle wave in [-1,1]

export const patterns: Record<string, { label: string; defaults: PatternParams; fn: PatternFn }> = {
  none: {
    label: "Plain wall",
    defaults: { amplitude: 0, wavesPerRev: 0, phasePerLayer: 0, zAmplitude: 0, extrusionPulse: 0 },
    fn: () => ({ dr: 0, dz: 0, e: 1 }),
  },
  sine: {
    label: "Sine wave",
    defaults: { amplitude: 1.2, wavesPerRev: 60, phasePerLayer: 0, zAmplitude: 0, extrusionPulse: 0 },
    fn: (th, l, p) => ({ dr: p.amplitude * Math.sin(p.wavesPerRev * th + l * rad(p.phasePerLayer)), dz: 0, e: 1 }),
  },
  knit: {
    // Alternating-phase loops + Z bob + extrusion pulse at peaks → drooping stitch beads.
    label: "Knit / stitch",
    defaults: { amplitude: 1.0, wavesPerRev: 90, phasePerLayer: 180, zAmplitude: 0.35, extrusionPulse: 0.35 },
    fn: (th, l, p) => {
      const s = Math.sin(p.wavesPerRev * th + l * rad(p.phasePerLayer));
      return { dr: p.amplitude * s, dz: p.zAmplitude * Math.abs(s), e: 1 + p.extrusionPulse * Math.max(0, s) };
    },
  },
  rope: {
    label: "Rope / diagonal twist",
    defaults: { amplitude: 0.9, wavesPerRev: 70, phasePerLayer: 12, zAmplitude: 0.15, extrusionPulse: 0.2 },
    fn: (th, l, p) => {
      const s = Math.sin(p.wavesPerRev * th + l * rad(p.phasePerLayer));
      return { dr: p.amplitude * s, dz: p.zAmplitude * s, e: 1 + p.extrusionPulse * Math.max(0, s) };
    },
  },
  perforated: {
    // Amplitude > bead width with 180° alternation: layers touch only at nodes → diamond holes.
    label: "Perforated mesh",
    defaults: { amplitude: 1.6, wavesPerRev: 48, phasePerLayer: 180, zAmplitude: 0, extrusionPulse: 0 },
    fn: (th, l, p) => ({ dr: p.amplitude * tri(p.wavesPerRev * th + l * rad(p.phasePerLayer)), dz: 0, e: 1 }),
  },
  ribbed: {
    label: "Ribbed / fluted",
    defaults: { amplitude: 2.5, wavesPerRev: 24, phasePerLayer: 0, zAmplitude: 0, extrusionPulse: 0 },
    fn: (th, l, p) => ({ dr: p.amplitude * Math.abs(Math.sin((p.wavesPerRev / 2) * th + l * rad(p.phasePerLayer))), dz: 0, e: 1 }),
  },
};
export type PatternName = keyof typeof patterns;
