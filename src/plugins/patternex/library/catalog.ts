// The pattern library: families × presets × seeds × palettes, generated on demand.
// Entries are cheap descriptors; geometry is built only when a thumbnail or preview needs it.
import { boundsOf, type Pattern, type PatternShape, type Ring } from '../model';
import { hashStr } from '../svg';
import { CATEGORIES, defaults, FAMILIES, familyById, type Category, type Family } from './families';
import { rng, SHAPE_NAMES } from './geom';

export interface Palette { id: string; name: string; colors: string[] }
/** Colour 0 is the base material (background); the others become region groups. */
export const PALETTES: Palette[] = [
  { id: 'ink', name: 'Ink', colors: ['#f4f1ea', '#1b1b1f', '#8c8c94'] },
  { id: 'ember', name: 'Ember', colors: ['#f6ead7', '#d1495b', '#edae49'] },
  { id: 'ocean', name: 'Ocean', colors: ['#e8f1f2', '#00798c', '#003d5b'] },
  { id: 'forest', name: 'Forest', colors: ['#f1ede0', '#2e7d32', '#a1c181'] },
  { id: 'candy', name: 'Candy', colors: ['#fff4f8', '#ff5c8d', '#7b5cff'] },
  { id: 'sunset', name: 'Sunset', colors: ['#fff1e0', '#ff7a45', '#7a1f5c'] },
  { id: 'mono', name: 'Mono', colors: ['#ffffff', '#000000', '#7f7f7f'] },
  { id: 'gold', name: 'Gold', colors: ['#141414', '#d4af37', '#7a6a3a'] },
];

export interface LibraryEntry {
  key: string;
  family: string;
  preset: string;
  seed: number;
  palette: string;
  /** Value of the family's variant parameter, when it has one. */
  variant?: number;
  name: string;
  category: Category;
  tags: string[];
}

const SEEDS_PER_PRESET = 6;

let cache: LibraryEntry[] | null = null;
/** All library entries (thousands), in a stable order. */
export function libraryEntries(): LibraryEntry[] {
  if (cache) return cache;
  const out: LibraryEntry[] = [];
  for (const f of FAMILIES) for (const preset of Object.keys(f.presets)) {
    const seeds = f.seeded ? SEEDS_PER_PRESET : 1;
    const vars: (number | undefined)[] = f.variants ? f.variants.values : [undefined];
    const vlabel = (v: number | undefined) => (v === undefined ? '' : ` ${f.variants!.key === 'shape' ? SHAPE_NAMES[v] : `${v} ${f.params.find((d) => d.key === f.variants!.key)?.label.toLowerCase().split(' ')[0]}`}`);
    for (const variant of vars) for (let seed = 1; seed <= seeds; seed++) for (const pal of PALETTES) {
      out.push({
        key: `${f.id}/${preset}/${variant ?? '-'}/${seed}/${pal.id}`, family: f.id, preset, seed, palette: pal.id, variant,
        name: `${f.name} · ${preset}${vlabel(variant)}${f.seeded ? ` #${seed}` : ''}`, category: f.category, tags: [...f.tags, preset, pal.name.toLowerCase()],
      });
    }
  }
  return (cache = out);
}

export function libraryCounts(): Record<Category | 'All', number> {
  const all = libraryEntries();
  const c = Object.fromEntries(CATEGORIES.map((k) => [k, 0])) as Record<Category | 'All', number>;
  for (const e of all) c[e.category]++;
  c.All = all.length;
  return c;
}

export function searchLibrary(q: string, category: Category | 'All'): LibraryEntry[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return libraryEntries().filter((e) => (category === 'All' || e.category === category)
    && words.every((w) => e.name.toLowerCase().includes(w) || e.tags.some((t) => t.includes(w)) || e.category.toLowerCase().includes(w)));
}

/** Everything that defines a generated pattern; editable in the library window. */
export interface GenSpec { family: string; params: Record<string, number>; seed: number; palette: string; width: number; height: number }

export function specOf(e: LibraryEntry, width = 40, height = 40): GenSpec {
  const f = familyById(e.family)!;
  return { family: e.family, params: { ...defaults(f), ...f.presets[e.preset], ...(e.variant !== undefined && f.variants ? { [f.variants.key]: e.variant } : {}) }, seed: e.seed, palette: e.palette, width, height };
}

/** Build the pattern for a spec. Deterministic: same spec → same geometry and id. */
export function buildPattern(spec: GenSpec, name?: string): Pattern {
  const f: Family = familyById(spec.family)!;
  const pal = PALETTES.find((p) => p.id === spec.palette) ?? PALETTES[0];
  const params = { ...defaults(f), ...spec.params };
  const raw = f.gen(params, spec.width, spec.height, rng(spec.seed * 7919 + 17));
  const byColor = new Map<string, PatternShape[]>();
  for (const s of raw) {
    if (!s.rings.length) continue;
    const color = pal.colors[Math.min(pal.colors.length - 1, Math.max(0, s.c))];
    const shape: PatternShape = { polygon_rings: s.rings.map(clean).filter((r) => r.length >= 3), fill_color: color, fill_rule: s.evenodd ? 'evenodd' : 'nonzero' };
    if (!shape.polygon_rings.length) continue;
    const l = byColor.get(color); if (l) l.push(shape); else byColor.set(color, [shape]);
  }
  // colour 0 is the background: drawn shapes in it are kept (they print in the base material)
  const shapes = [...byColor.values()].flat();
  const id = `gen:${spec.family}:${hashStr(JSON.stringify(spec))}`;
  return { id, name: name ?? `${f.name}`, source: 'builtin', shapes, tolerance_mm: 0.05, bounds: shapes.length ? boundsOf(shapes) : [0, 0, spec.width, spec.height] };
}

const clean = (r: Ring): Ring => {
  const out: Ring = [];
  for (const p of r) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) out.push([+p[0].toFixed(4), +p[1].toFixed(4)]); }
  return out;
};

/** SVG markup for previews. Background = palette colour 0, viewBox = the pattern area. */
export function patternSvg(pat: Pattern, w: number, h: number, bg: string, maxPoints = 60_000): string {
  const total = pat.shapes.reduce((n, s) => n + s.polygon_rings.reduce((a, r) => a + r.length, 0), 0);
  const step = Math.max(1, Math.ceil(total / maxPoints));
  const paths = pat.shapes.map((s) => {
    const d = s.polygon_rings.map((r) => {
      let out = '';
      for (let k = 0; k < r.length; k += step) out += `${k ? 'L' : 'M'}${r[k][0].toFixed(2)} ${(h - r[k][1]).toFixed(2)}`;
      return out + 'Z';
    }).join('');
    return `<path fill="${s.fill_color}" fill-rule="${s.fill_rule}" d="${d}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><rect width="${w}" height="${h}" fill="${bg}"/>${paths}</svg>`;
}

export const paletteOf = (id: string) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];
