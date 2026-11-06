// Mixed filaments (colour mixing by layer alternation), as in Snapmaker Orca's Color Mixing.
// A mixed filament is a virtual filament: on each layer it prints with one of the physical filaments, so the
// stacked thin layers read as a blend from a normal viewing distance. Virtual filaments are numbered after the
// physical ones: with 4 physical filaments the first mix is filament 5.
//   ratio  two filaments, A:B layers (2:1 → A A B A A B …, spread as evenly as possible)
//   cycle  a custom sequence of filaments repeated layer by layer (1,2,2,3 …)

export type MixedFilament =
  | { id: string; name?: string; kind: 'ratio'; a: number; b: number; ra: number; rb: number }
  | { id: string; name?: string; kind: 'cycle'; seq: number[] };

export const MAX_CYCLE = 24;
export const MAX_RATIO = 9;

/** Layer-by-layer sequence of physical slots (0-based) the mix repeats. */
export function mixSequence(m: MixedFilament): number[] {
  if (m.kind === 'cycle') return m.seq.length ? m.seq.slice(0, MAX_CYCLE) : [0];
  const ra = Math.max(0, Math.min(MAX_RATIO, Math.round(m.ra)));
  const rb = Math.max(0, Math.min(MAX_RATIO, Math.round(m.rb)));
  if (!ra && !rb) return [m.a];
  if (!rb) return [m.a];
  if (!ra) return [m.b];
  // even spread: put B on the layers where the running share of B crosses an integer
  const n = ra + rb;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.floor(((i + 1) * rb) / n) > Math.floor((i * rb) / n) ? m.b : m.a);
  return out;
}

/** Physical slot used by a mix on layer `layer`. */
export const mixSlotAt = (m: MixedFilament, layer: number) => { const s = mixSequence(m); return s[((layer % s.length) + s.length) % s.length]; };

const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c: number) => Math.round(255 * Math.max(0, Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)));
const rgbOf = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0x808080;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** Expected look of the mix: layer shares averaged in linear light (how thin stacked layers blend to the eye). */
export function mixColor(m: MixedFilament, colors: string[]): string {
  const seq = mixSequence(m);
  const acc = [0, 0, 0];
  for (const k of seq) { const c = rgbOf(colors[k] ?? '#808080'); for (let j = 0; j < 3; j++) acc[j] += lin(c[j]); }
  return `#${acc.map((v) => gam(v / seq.length).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Share of each physical slot in the mix, e.g. {0: 0.67, 1: 0.33}. */
export function mixShares(m: MixedFilament): Map<number, number> {
  const seq = mixSequence(m);
  const out = new Map<number, number>();
  for (const k of seq) out.set(k, (out.get(k) ?? 0) + 1 / seq.length);
  return out;
}

/** Short description: "F1 2 : 1 F2" or "1 → 2 → 2 → 3". */
export function mixLabel(m: MixedFilament): string {
  if (m.kind === 'ratio') return `F${m.a + 1} ${m.ra} : ${m.rb} F${m.b + 1}`;
  return m.seq.map((k) => k + 1).join(' → ');
}

/** Problems with a mix for `physical` filament slots (empty when it can be printed). */
export function mixProblems(m: MixedFilament, physical: number): string[] {
  const seq = mixSequence(m);
  const out: string[] = [];
  if (seq.some((k) => k < 0 || k >= physical)) out.push('Uses a filament slot that no longer exists.');
  if (new Set(seq).size < 2) out.push('Needs at least two different filaments.');
  return out;
}

/** Filament index (physical or virtual) → physical slot on a layer. Unknown virtual indices fall back to slot 0. */
export function resolveFilament(fil: number, layer: number, physical: number, mixes: MixedFilament[] | undefined): number {
  if (fil < physical) return Math.max(0, fil);
  const m = mixes?.[fil - physical];
  if (!m) return Math.max(0, physical - 1);
  const k = mixSlotAt(m, layer);
  return k >= 0 && k < physical ? k : 0;
}

/** Colours of every choosable filament: the physical ones, then each mix's blended colour. */
export const allFilamentColors = (colors: string[], mixes: MixedFilament[] | undefined) => [...colors, ...(mixes ?? []).map((m) => mixColor(m, colors))];

/** Mixes after physical slot `k` is removed: references to it go to slot 1, later slots move down by one. */
export function mixesAfterSlotRemoved(mixes: MixedFilament[], k: number): MixedFilament[] {
  const f = (x: number) => (x === k ? 0 : x > k ? x - 1 : x);
  return mixes.map((m) => (m.kind === 'ratio' ? { ...m, a: f(m.a), b: f(m.b) } : { ...m, seq: m.seq.map(f) }));
}

/** Remaps a filament index (0-based) when the filament list changes shape: `from` is the first index affected,
 *  `delta` +1 (inserted before it) or -1 (removed at from - 1… handled by the caller), `gone` the removed index. */
export function shiftIndex(f: number | undefined, gone: number | null, from: number, delta: number): number | undefined {
  if (f === undefined) return f;
  if (gone !== null && f === gone) return 0;
  return f >= from ? f + delta : f;
}
