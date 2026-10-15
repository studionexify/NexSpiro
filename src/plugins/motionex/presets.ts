// Built-in pattern library. Every pattern is a shape function over one repeat (u = 0..1),
// turned into editable curves, then offered in several sizes.
import { flatCurve, pt, type Curve, type CurveKey, type MotionBrush, type NoiseSettings } from "./model.ts";

type Fn = (u: number) => number;
const TAU = 2 * Math.PI;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0; // no -0, so JSON round-trips exactly
const frac = (u: number) => ((u % 1) + 1) % 1;

/** Smooth curve: cubic Hermite through n samples, handles from a numeric slope (wraps for repeating shapes). */
function smooth(f: Fn, n = 16): Curve {
  const dt = 1 / n, h = dt / 3, e = 1e-4;
  const slope = (u: number) => (f(frac(u + e)) - f(frac(u - e))) / (2 * e);
  return {
    interpolation: "bezier",
    points: Array.from({ length: n + 1 }, (_, i) => {
      // Cap handle height so near-vertical shapes (slope → ∞) cannot overshoot their own range.
      const u = i * dt, d = Math.max(-0.5, Math.min(0.5, slope(u === 1 ? 0 : u) * h));
      return pt(u, r6(f(u === 1 ? 0 : u)), i === 0 ? [0, 0] : [-h, r6(-d)], i === n ? [0, 0] : [h, r6(d)]);
    }),
  };
}

/** Sharp-cornered curve: straight lines through n samples (n is a multiple of 8 so corners at ⅛ steps land exactly). */
function sharp(f: Fn, n = 48): Curve {
  return { interpolation: "linear", points: Array.from({ length: n + 1 }, (_, i) => pt(r6(i / n), r6(f(i === n ? 1 : i / n)))) };
}

function jumps(steps: [number, number][]): Curve {
  return { interpolation: "step", points: [...steps.map(([u, v]) => pt(u, v)), pt(1, steps[steps.length - 1][1])] };
}

// ───────── shape functions (−1..1 unless noted) ─────────
const sine: Fn = (u) => Math.sin(TAU * u);
const cosine: Fn = (u) => Math.cos(TAU * u);
const tri: Fn = (u) => (u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4);
const saw: Fn = (u) => 2 * u - 1;
const bump: Fn = (u) => 2 * Math.abs(Math.sin(Math.PI * u)) - 1;
const scallop: Fn = (u) => 2 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)) - 1;
const gauss = (w: number): Fn => (u) => 2 * Math.exp(-(((u - 0.5) / w) ** 2)) - 1;
const softSquare = (k: number): Fn => (u) => Math.tanh(k * Math.sin(TAU * u)) / Math.tanh(k);
const trapezoid: Fn = (u) => Math.max(-1, Math.min(1, 3 * tri(u)));
const spikes: Fn = (u) => { const d = Math.abs(u - 0.5); return d < 0.12 ? 1 - (2 * d) / 0.12 : -1; };
const stairs = (n: number): Fn => (u) => { const s = Math.floor(tri(u) * n + n) / n - 1; return Math.max(-1, Math.min(1, s * (n / (n - 0.5)))); };
const heartbeat: Fn = (u) => (u < 0.35 ? 0 : u < 0.4 ? -0.4 * ((u - 0.35) / 0.05) : u < 0.45 ? -0.4 + 1.4 * ((u - 0.4) / 0.05) : u < 0.5 ? 1 - 2 * ((u - 0.45) / 0.05) : u < 0.55 ? -1 + ((u - 0.5) / 0.05) : 0);
const sharkFin: Fn = (u) => 2 * (1 - Math.exp(-4 * u)) / (1 - Math.exp(-4)) - 1;
const norm = (f: Fn): Fn => { let m = 0; for (let i = 0; i <= 400; i++) m = Math.max(m, Math.abs(f(i / 400))); return (u) => f(u) / (m || 1); };
const sum = (...fs: [number, Fn][]): Fn => norm((u) => fs.reduce((a, [k, f]) => a + k * f(u), 0));
const harm = (k: number, ph = 0): Fn => (u) => Math.sin(TAU * k * u + ph);

interface Shape {
  key: string; name: string; desc: string; cat: string;
  lat?: Curve; along?: Curve; flow?: Curve; speed?: Curve;
  amp?: number; period?: number; noise?: Partial<NoiseSettings>;
  /** Sizes to offer; loops keep their proportions when scaled. */
  sizes?: (keyof typeof SIZES)[];
  limits?: [number, number];
}

const SIZES = {
  fine: { label: "fine", amp: 0.5, per: 0.5 },
  medium: { label: "", amp: 1, per: 1 },
  bold: { label: "bold", amp: 1.6, per: 1.6 },
  wide: { label: "stretched", amp: 1, per: 2.2 },
} as const;

const W = "Waves", T = "Teeth & steps", B = "Bumps & dents", P = "Pulses & beats", L = "Loops & coils", K = "Knits, braids & ropes", F = "Plastic flow patterns", R = "Rough & natural", M = "Mixed";

const SHAPES: Shape[] = [
  // Waves
  { key: "sine", name: "Wave", desc: "Smooth, even wave in and out of the wall", cat: W, lat: smooth(sine) },
  { key: "double-wave", name: "Double wave", desc: "A big wave with a smaller ripple riding on it", cat: W, lat: smooth(sum([1, sine], [0.5, harm(2)])) },
  { key: "triple-ripple", name: "Triple ripple", desc: "Three ripples stacked on one wave", cat: W, lat: smooth(sum([1, sine], [0.35, harm(3)])) },
  { key: "wobble", name: "Wobble", desc: "Wave with a fast shiver on top", cat: W, lat: smooth(sum([1, sine], [0.25, harm(5)]), 32) },
  { key: "ocean", name: "Ocean wave", desc: "Sharp crests, wide rounded troughs", cat: W, lat: smooth(norm((u) => 1 - 2 * Math.abs(Math.cos(Math.PI * u)) ** 0.6), 24) },
  { key: "swell", name: "Swell", desc: "Wave that grows and shrinks", cat: W, lat: smooth(norm((u) => Math.sin(TAU * 3 * u) * Math.sin(Math.PI * u)), 32) },
  { key: "pinch", name: "Pinched wave", desc: "Wave squeezed thin near the wall", cat: W, lat: smooth((u) => Math.sin(TAU * u) ** 3) },
  { key: "plump", name: "Plump wave", desc: "Wave with fat, rounded peaks", cat: W, lat: smooth(norm((u) => Math.sign(Math.sin(TAU * u)) * Math.abs(Math.sin(TAU * u)) ** 0.4), 24) },
  { key: "speedup", name: "Quickening wave", desc: "Waves that get closer together", cat: W, lat: smooth((u) => Math.sin(TAU * (u + 1.5 * u * u)), 48) },
  { key: "echo", name: "Echo", desc: "A strong wave fading into smaller ones", cat: W, lat: smooth(norm((u) => Math.exp(-4 * u) * Math.sin(TAU * 4 * u)), 48) },
  { key: "lean-wave", name: "Leaning wave", desc: "Wave that rises slowly and drops fast", cat: W, lat: smooth(sum([1, sine], [-0.4, harm(2, Math.PI / 2)]), 24) },
  { key: "soft-square", name: "Soft square", desc: "Square-ish wave with rounded corners", cat: W, lat: smooth(softSquare(3), 32) },
  { key: "flat-top", name: "Flat-top wave", desc: "Wave that holds at the top and bottom", cat: W, lat: smooth(softSquare(1.6), 24) },
  // Teeth & steps
  { key: "zigzag", name: "Zigzag", desc: "Straight lines that switch direction", cat: T, lat: sharp(tri) },
  { key: "square", name: "Square teeth", desc: "Blocky in-and-out steps", cat: T, lat: jumps([[0, 1], [0.5, -1]]), amp: 0.4, period: 6 },
  { key: "castle", name: "Castle wall", desc: "Square teeth with sloped sides", cat: T, lat: sharp(trapezoid) },
  { key: "sawtooth", name: "Saw teeth", desc: "Slow ramp out, sudden drop back", cat: T, lat: sharp(saw) },
  { key: "reverse-saw", name: "Reverse saw", desc: "Sudden jump out, slow ramp back", cat: T, lat: sharp((u) => 1 - 2 * u) },
  { key: "shark-fin", name: "Shark fins", desc: "Curved fins that drop off sharply", cat: T, lat: sharp(sharkFin) },
  { key: "stairs", name: "Staircase", desc: "Steps up, steps down", cat: T, lat: sharp(stairs(3)) },
  { key: "small-stairs", name: "Small steps", desc: "Many little steps up and down", cat: T, lat: sharp(stairs(5), 96) },
  { key: "spikes", name: "Spikes", desc: "Thin points sticking out", cat: T, lat: sharp(spikes) },
  { key: "cog", name: "Gear teeth", desc: "Like the edge of a gear", cat: T, lat: sharp(norm((u) => Math.max(-0.7, Math.min(0.7, 2 * tri(u)))), 48) },
  { key: "narrow-pulse", name: "Thin ridges", desc: "Narrow ridges with long flat gaps", cat: T, lat: jumps([[0, -1], [0.75, 1]]), amp: 0.4, period: 6 },
  { key: "wide-pulse", name: "Wide ridges", desc: "Wide ridges with narrow grooves", cat: T, lat: jumps([[0, 1], [0.75, -1]]), amp: 0.4, period: 6 },
  { key: "double-step", name: "Double step", desc: "Two heights of blocks taking turns", cat: T, lat: jumps([[0, 1], [0.25, 0], [0.5, -1], [0.75, 0]]), amp: 0.5, period: 6 },
  { key: "arrow", name: "Arrowheads", desc: "Pointy zigzag with uneven sides", cat: T, lat: sharp((u) => (u < 0.7 ? -1 + (2 * u) / 0.7 : 1 - (2 * (u - 0.7)) / 0.3)) },
  // Bumps & dents
  { key: "bumps", name: "Bumps", desc: "Rounded bumps pushing out", cat: B, lat: smooth(bump, 24) },
  { key: "dents", name: "Dents", desc: "Rounded dents pressing in", cat: B, lat: smooth((u) => -bump(u), 24) },
  { key: "scallops", name: "Scallops", desc: "Half circles side by side", cat: B, lat: sharp(scallop, 64) },
  { key: "fish-scales", name: "Fish scales", desc: "Half circles facing in", cat: B, lat: sharp((u) => -scallop(u), 64) },
  { key: "hills", name: "Rolling hills", desc: "Soft hills with flat valleys", cat: B, lat: smooth((u) => 2 * Math.max(0, Math.sin(TAU * u)) ** 2 - 1, 32) },
  { key: "single-bump", name: "Round beads", desc: "One round bead per repeat", cat: B, lat: smooth(gauss(0.15), 24) },
  { key: "tiny-beads", name: "Tiny beads", desc: "Small, sharp beads with gaps", cat: B, lat: smooth(gauss(0.07), 32) },
  { key: "twin-bumps", name: "Twin bumps", desc: "Two bumps, then a gap", cat: B, lat: smooth(norm((u) => Math.exp(-(((u - 0.35) / 0.08) ** 2)) + Math.exp(-(((u - 0.65) / 0.08) ** 2)) - 0.5), 32) },
  { key: "bump-dent", name: "Bump and dent", desc: "A bump out followed by a dent in", cat: B, lat: smooth(norm((u) => Math.exp(-(((u - 0.3) / 0.1) ** 2)) - Math.exp(-(((u - 0.7) / 0.1) ** 2))), 32) },
  { key: "blisters", name: "Blisters", desc: "Flat wall with sudden round blisters", cat: B, lat: sharp((u) => (Math.abs(u - 0.5) < 0.2 ? 2 * Math.sqrt(1 - ((u - 0.5) / 0.2) ** 2) - 1 : -1), 80) },
  { key: "dimples", name: "Dimples", desc: "Flat wall with small round dips", cat: B, lat: sharp((u) => (Math.abs(u - 0.5) < 0.2 ? 1 - 2 * Math.sqrt(1 - ((u - 0.5) / 0.2) ** 2) : 1), 80) },
  // Pulses & beats
  { key: "heartbeat", name: "Heartbeat", desc: "Flat line with a heartbeat blip", cat: P, lat: sharp(heartbeat, 80), period: 8 },
  { key: "double-beat", name: "Double heartbeat", desc: "Two quick blips, then quiet", cat: P, lat: sharp((u) => heartbeat(frac(u * 2)), 160), period: 10 },
  { key: "ping", name: "Ping", desc: "A single sharp spike, then calm", cat: P, lat: sharp((u) => (Math.abs(u - 0.5) < 0.05 ? 1 - Math.abs(u - 0.5) / 0.05 : 0), 80), period: 8 },
  { key: "ring", name: "Ringing", desc: "A kick that fades out like a bell", cat: P, lat: smooth(norm((u) => Math.exp(-6 * u) * Math.sin(TAU * 6 * u)), 64), period: 8 },
  { key: "morse", name: "Morse code", desc: "Short and long ridges", cat: P, lat: jumps([[0, 1], [0.1, -1], [0.2, 1], [0.5, -1], [0.6, 1], [0.7, -1]]), amp: 0.4, period: 10 },
  { key: "barcode", name: "Barcode", desc: "Ridges of different widths", cat: P, lat: jumps([[0, 1], [0.05, -1], [0.15, 1], [0.3, -1], [0.35, 1], [0.4, -1], [0.55, 1], [0.6, -1], [0.75, 1], [0.85, -1]]), amp: 0.35, period: 12 },
  // Loops & coils (side-to-side + forward-and-back)
  { key: "coil", name: "Coil", desc: "Tight spring-like curls", cat: L, lat: smooth(sine), along: smooth(cosine), amp: 0.5, period: 3.5 },
  { key: "loop", name: "Loops", desc: "Nozzle draws little loops as it goes", cat: L, lat: smooth(sine), along: smooth(cosine), amp: 1.2, period: 4, speed: flatCurve(0.7), limits: [0.5, 1.4] },
  { key: "big-loops", name: "Big loops", desc: "Large overlapping loops", cat: L, lat: smooth(sine), along: smooth(cosine), amp: 1.8, period: 4, speed: flatCurve(0.6), limits: [0.5, 1.4] },
  { key: "flat-loops", name: "Flat loops", desc: "Loops squashed against the wall", cat: L, lat: smooth((u) => 0.5 * sine(u)), along: smooth(cosine), amp: 1.4, period: 4, speed: flatCurve(0.7) },
  { key: "tall-loops", name: "Tall loops", desc: "Loops stretched out from the wall", cat: L, lat: smooth(sine), along: smooth((u) => 0.6 * cosine(u)), amp: 1.6, period: 4, speed: flatCurve(0.7) },
  { key: "teardrops", name: "Teardrops", desc: "Loops with a pointed tail", cat: L, lat: smooth(bump, 24), along: smooth(cosine), amp: 1.2, period: 4, speed: flatCurve(0.7) },
  { key: "figure-eight", name: "Figure eights", desc: "Eights drawn along the wall", cat: L, lat: smooth(harm(2), 24), along: smooth(sine), amp: 1.2, period: 5, speed: flatCurve(0.6) },
  { key: "curl-back", name: "Back curls", desc: "Loops that curl the other way", cat: L, lat: smooth((u) => -sine(u)), along: smooth(cosine), amp: 1.2, period: 4, speed: flatCurve(0.7) },
  { key: "spring", name: "Stretched spring", desc: "Coil pulled long", cat: L, lat: smooth(sine), along: smooth((u) => 0.5 * cosine(u)), amp: 0.8, period: 6 },
  { key: "petals", name: "Petals", desc: "Flower-petal loops", cat: L, lat: smooth(norm((u) => Math.abs(Math.sin(TAU * u)) * 1.0), 24), along: smooth(harm(1, Math.PI / 2)), amp: 1.4, period: 5, speed: flatCurve(0.6) },
  { key: "clover", name: "Clover", desc: "Three small loops per repeat", cat: L, lat: smooth(harm(3), 48), along: smooth((u) => Math.cos(TAU * 3 * u)), amp: 0.7, period: 7, speed: flatCurve(0.6) },
  // Knits, braids & ropes
  { key: "knit", name: "Knit stitch", desc: "Looks like knitted wool", cat: K, lat: smooth(bump, 24), along: smooth((u) => 0.35 * Math.sin(TAU * 2 * u)), amp: 0.8, period: 3 },
  { key: "braid", name: "Braid", desc: "Over-and-under plait look", cat: K, lat: smooth(sine), along: smooth(harm(2), 24), amp: 0.9, period: 5 },
  { key: "rope", name: "Rope", desc: "Twisted rope strands", cat: K, lat: smooth(sum([1, sine], [0.3, harm(2)])), along: smooth((u) => 0.6 * cosine(u)), amp: 0.8, period: 3 },
  { key: "chain", name: "Chain links", desc: "Linked oval loops", cat: K, lat: smooth(sine), along: smooth((u) => 1.0 * cosine(u)), amp: 1.0, period: 5, speed: flatCurve(0.6) },
  { key: "weave", name: "Basket weave", desc: "Blocks that look woven", cat: K, lat: smooth(softSquare(4), 32), along: smooth((u) => 0.3 * Math.sin(TAU * 2 * u)), amp: 0.5, period: 6 },
  { key: "cable", name: "Cable knit", desc: "Chunky twisted cable", cat: K, lat: smooth(norm((u) => Math.sin(TAU * u) + 0.6 * Math.sin(TAU * 2 * u + 1)), 24), along: smooth((u) => 0.5 * Math.cos(TAU * u)), amp: 1.1, period: 5 },
  { key: "stitch", name: "Running stitch", desc: "Dashed stitch line", cat: K, lat: smooth(gauss(0.2), 24), flow: jumps([[0, 1.3], [0.6, 0.7]]), amp: 0.4, period: 4 },
  // Plastic flow patterns
  { key: "beads", name: "Pearl beads", desc: "Thicker blobs along a straight wall", cat: F, flow: smooth((u) => 1 + 0.45 * Math.cos(TAU * u)), period: 3 },
  { key: "dashes", name: "Dashes", desc: "Alternating thick and thin sections", cat: F, flow: jumps([[0, 1.4], [0.5, 0.6]]), period: 4 },
  { key: "thick-thin", name: "Thick and thin", desc: "Line slowly swells and slims", cat: F, flow: smooth((u) => 1 + 0.35 * Math.sin(TAU * u)), period: 10 },
  { key: "swelling-wave", name: "Swelling wave", desc: "Wave that gets thicker at the peaks", cat: F, lat: smooth(sine), flow: smooth((u) => 1 + 0.3 * Math.abs(Math.sin(TAU * u)) * 2 - 0.3), period: 4 },
  { key: "pearl-string", name: "Pearl string", desc: "Round bumps that are also thicker", cat: F, lat: smooth(bump, 24), flow: smooth((u) => 1 + 0.4 * Math.sin(Math.PI * u) ** 2 - 0.1), period: 3 },
  { key: "speed-ripple", name: "Speed ripple", desc: "Slows and speeds up for a shimmer", cat: F, speed: smooth((u) => 1 + 0.4 * Math.sin(TAU * u)), period: 6 },
  { key: "dotted", name: "Dotted line", desc: "Almost-dots with thin links", cat: F, flow: smooth((u) => 0.75 + 0.6 * Math.exp(-(((u - 0.5) / 0.15) ** 2))), period: 2.5, limits: [0.5, 1.4] },
  // Rough & natural (seeded randomness)
  { key: "noise", name: "Fuzzy skin", desc: "Random rough texture", cat: R, amp: 0.35, period: 1.5, noise: { seed: 1337, scale: 1, octaves: 3, persistence: 0.5 } },
  { key: "sand", name: "Sand", desc: "Very fine grainy texture", cat: R, amp: 0.2, period: 0.6, noise: { seed: 7, scale: 1, octaves: 2, persistence: 0.5 } },
  { key: "bark", name: "Tree bark", desc: "Coarse, uneven ridges", cat: R, amp: 0.6, period: 4, noise: { seed: 42, scale: 1, octaves: 4, persistence: 0.65 } },
  { key: "stone", name: "Stone", desc: "Lumpy rock-like surface", cat: R, amp: 0.5, period: 6, noise: { seed: 99, scale: 1, octaves: 5, persistence: 0.55 } },
  { key: "static", name: "Static", desc: "Sharp, jittery roughness", cat: R, amp: 0.3, period: 0.8, noise: { seed: 2024, scale: 0.5, octaves: 1, persistence: 0.5 } },
  { key: "clay", name: "Hand-made clay", desc: "Soft, uneven, hand-pressed look", cat: R, amp: 0.45, period: 10, noise: { seed: 5, scale: 1, octaves: 3, persistence: 0.4 } },
  { key: "coral", name: "Coral", desc: "Bumpy natural growth look", cat: R, amp: 0.55, period: 2.5, noise: { seed: 314, scale: 1, octaves: 4, persistence: 0.7 } },
  { key: "leather", name: "Leather", desc: "Fine, soft grain", cat: R, amp: 0.15, period: 1.2, noise: { seed: 808, scale: 1, octaves: 3, persistence: 0.6 } },
  // Mixed
  { key: "wavy-fuzz", name: "Wavy fuzz", desc: "Smooth wave with rough skin", cat: M, lat: smooth((u) => 0.75 * sine(u)), amp: 0.7, period: 5, noise: { seed: 11, scale: 0.12, octaves: 2, persistence: 0.5 } },
  { key: "zig-loops", name: "Zigzag loops", desc: "Zigzag with a loop at each turn", cat: M, lat: sharp(tri), along: smooth((u) => 0.8 * cosine(u)), amp: 1.0, period: 4, speed: flatCurve(0.7) },
  { key: "wave-beads", name: "Wave with beads", desc: "Wave with thicker spots at the turns", cat: M, lat: smooth(sine), flow: smooth((u) => 1 + 0.35 * Math.cos(TAU * 2 * u)), period: 5 },
  { key: "rough-teeth", name: "Rough teeth", desc: "Saw teeth with a grainy finish", cat: M, lat: sharp((u) => 0.8 * saw(u)), amp: 0.6, period: 5, noise: { seed: 21, scale: 0.15, octaves: 2, persistence: 0.5 } },
  { key: "bubbles", name: "Bubbles", desc: "Bumps of random size", cat: M, lat: smooth(bump, 24), amp: 0.6, period: 3, noise: { seed: 63, scale: 1.5, octaves: 1, persistence: 0.5 } },
];

function build(s: Shape, sizeKey: keyof typeof SIZES): MotionBrush {
  const z = SIZES[sizeKey];
  const curves: Record<CurveKey, Curve> = {
    lateral_offset: s.lat ?? flatCurve(0), along_offset: s.along ?? flatCurve(0), z_offset: flatCurve(0),
    extrusion_mult: s.flow ?? flatCurve(1), speed_mult: s.speed ?? flatCurve(1),
  };
  const noise = s.noise ? { enabled: true, type: "value" as const, seed: 1, scale: 1, octaves: 3, persistence: 0.5, ...s.noise } : null;
  return {
    id: sizeKey === "medium" ? `preset-${s.key}` : `preset-${s.key}-${sizeKey}`,
    name: z.label ? `${s.name} · ${z.label}` : s.name,
    version: 1,
    amplitude: r6((s.amp ?? 0.6) * z.amp), period_mm: r6((s.period ?? 4) * z.per), phase_deg: 0, repeat_mode: "tile",
    curves, events: [], noise,
    limits: { min_flow_mult: s.limits?.[0] ?? 0.5, max_flow_mult: s.limits?.[1] ?? 1.6 },
    tags: ["preset"], category: s.cat, description: s.desc,
  };
}

/** Every built-in pattern, each in up to four sizes. Presets are read-only; editing one saves a copy. */
export const PRESETS: MotionBrush[] = SHAPES.flatMap((s) => (s.sizes ?? (Object.keys(SIZES) as (keyof typeof SIZES)[])).map((k) => build(s, k)));

export const PRESET_CATEGORIES: string[] = [...new Set(SHAPES.map((s) => s.cat))];

export function presetById(id: string): MotionBrush | undefined { return PRESETS.find((b) => b.id === id); }
