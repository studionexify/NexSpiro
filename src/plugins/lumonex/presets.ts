// Lumonex presets: the 72 designs of the Lumonex 2026 catalogue (rebuilt parametrically from their
// family, silhouette, pattern and materials), studio forms in the style of popular printed lamps
// (twisted vase shades, fin stacks, ribbons, minis) and starters for every lamp type.
import type { MaterialKind } from './catalog';
import { defaultJoint } from './joinery';
import { defaultDesign, section, type LampDesign, type LampKind } from './model';
import { defaultShape, pattern, SILHOUETTES, type PatternLayer, type ShapeSpec } from './shape';

export type Family = 'Fluted columns' | 'Pleats & cones' | 'Glow orbs' | 'Mushrooms & blooms' | 'Stacks & accordions' | 'Lattice & pattern' | 'Pendants';

interface Catalogue { code: string; name: string; family: Family; type: 'Table' | 'Pendant'; shade: [MaterialKind, string]; base?: [MaterialKind, string]; heights: [number, number, number, number] }

const M = (m: string): MaterialKind => (m === 'PETG' ? 'PETG Translucent' : m === 'Matte' ? 'PLA Matte' : m === 'Plus' ? 'PLA+' : m === 'Stone' ? 'PLA Stone' : m === 'Wood' ? 'PLA Wood' : 'PLA Silk');
const c = (code: string, name: string, family: Family, type: 'Table' | 'Pendant', sm: string, sc: string, bm: string | null, bc: string | null, h: [number, number, number, number]): Catalogue =>
  ({ code, name, family, type, shade: [M(sm), sc], base: bm ? [M(bm), bc!] : undefined, heights: h });

const FC: Family = 'Fluted columns', PC: Family = 'Pleats & cones', GO: Family = 'Glow orbs', MB: Family = 'Mushrooms & blooms', SA: Family = 'Stacks & accordions', LP: Family = 'Lattice & pattern', PD: Family = 'Pendants';
const T = 'Table' as const, P = 'Pendant' as const;
const H = (m: number): [number, number, number, number] => [Math.round(m * 0.75), m, Math.round(m * 1.25), Math.round(m * 1.5)];

export const CATALOGUE: Catalogue[] = [
  c('LX-01', 'Pagoda', PC, T, 'Matte', 'Beige', 'Matte', 'Beige', H(240)),
  c('LX-02', 'Colonna', FC, T, 'Plus', 'Terracotta Orange', 'Plus', 'Terracotta Orange', [180, 240, 300, 360]),
  c('LX-03', 'Totem Trio', SA, T, 'PETG', 'Orange', 'Wood', 'Natural', H(260)),
  c('LX-04', 'Doric', FC, T, 'Matte', 'Navy Blue', 'Matte', 'Navy Blue', [165, 220, 275, 330]),
  c('LX-05', 'Lantern Cube', SA, T, 'PETG', 'Yellow', 'Matte', 'Beige', H(220)),
  c('LX-06', 'Bulb Verde', GO, T, 'PETG', 'Green', 'Stone', 'White', H(230)),
  c('LX-07', 'Flare', FC, T, 'Plus', 'Outrageous Orange', 'Plus', 'Apricot', [190, 250, 310, 375]),
  c('LX-08', 'Lumen', GO, T, 'PETG', 'Arctic', 'Matte', 'Black', H(230)),
  c('LX-09', 'Totem Mist', SA, T, 'PETG', 'Arctic', 'Matte', 'Moon Gray', H(260)),
  c('LX-10', 'Gear', PD, P, 'Plus', 'Outrageous Orange', null, null, H(220)),
  c('LX-11', 'Cog', FC, T, 'Plus', 'Terracotta Orange', 'Plus', 'Terracotta Orange', [220, 295, 370, 440]),
  c('LX-12', 'Vortex Azure', GO, T, 'PETG', 'Ice Blue', 'Stone', 'White', H(240)),
  c('LX-13', 'Luna', PD, P, 'Matte', 'White', null, null, [205, 275, 345, 410]),
  c('LX-14', 'Halo Silver', PC, T, 'Silk', 'Silk Silver', 'Matte', 'White', H(240)),
  c('LX-15', 'Vortex Ember', GO, T, 'PETG', 'Orange', 'Matte', 'Black', H(240)),
  c('LX-16', 'Bloom Blue', PC, T, 'Matte', 'Ice Blue', 'Matte', 'Navy Blue', H(240)),
  c('LX-17', 'Origa', PD, P, 'Plus', 'Terracotta Orange', null, null, [160, 210, 260, 315]),
  c('LX-18', 'Kirie Amber', PC, T, 'PETG', 'Orange', 'Matte', 'Beige', H(240)),
  c('LX-19', 'Plissé Rosa', PC, T, 'Matte', 'Sakura Pink', 'Matte', 'Sakura Pink', H(240)),
  c('LX-20', 'Ribb Aqua', GO, T, 'PETG', 'Ice Blue', 'Matte', 'Black', H(230)),
  c('LX-21', 'Flute Sand', FC, T, 'Matte', 'Skin', 'Wood', 'Natural', [270, 360, 450, 540]),
  c('LX-22', 'Moss', MB, T, 'Plus', 'Army Green', 'Plus', 'Army Green', [195, 260, 325, 390]),
  c('LX-23', 'Rhombo', LP, T, 'PETG', 'Arctic', 'Stone', 'White', [235, 315, 395, 470]),
  c('LX-24', 'Prism Azure', PC, T, 'PETG', 'Blue', 'Matte', 'Moon Gray', H(240)),
  c('LX-25', 'Origa Table', PC, T, 'Plus', 'Terracotta Orange', 'Plus', 'Terracotta Orange', H(240)),
  c('LX-26', 'Bell Noir', PC, T, 'Silk', 'Silk Antique Gold', 'Matte', 'Black', H(240)),
  c('LX-27', 'Lilac Column', FC, T, 'Matte', 'Lilac Purple', 'Matte', 'Lilac Purple', H(240)),
  c('LX-28', 'Spool', FC, T, 'Plus', 'Rust Copper', 'Plus', 'Rust Copper', H(240)),
  c('LX-29', 'Crown Silver', FC, T, 'PETG', 'Arctic', 'Silk', 'Silk Silver', H(240)),
  c('LX-30', 'Corolla', FC, T, 'PETG', 'Yellow', 'PETG', 'Yellow', H(240)),
  c('LX-31', 'Colonna Pendant', PD, P, 'Plus', 'Teal Blue', null, null, H(240)),
  c('LX-32', 'Fungi Sage', MB, T, 'Matte', 'Mint Green', 'Matte', 'Mint Green', [185, 245, 305, 370]),
  c('LX-33', 'Dome Sol', PD, P, 'Matte', 'Sunshine Yellow', null, null, H(200)),
  c('LX-34', 'Cobalt Tube', FC, T, 'PETG', 'Blue', 'Matte', 'Moon Gray', H(240)),
  c('LX-35', 'Obsidian', FC, T, 'Matte', 'Black', 'Silk', 'Silk Antique Gold', H(240)),
  c('LX-36', 'Corona', PD, P, 'Matte', 'Ruby Red', null, null, H(220)),
  c('LX-37', 'Morel', MB, T, 'PETG', 'Orange', 'Matte', 'Beige', [200, 270, 340, 405]),
  c('LX-38', 'Fungi Terra', MB, T, 'Plus', 'Terracotta Orange', 'Plus', 'Terracotta Orange', [170, 230, 290, 345]),
  c('LX-39', 'Kirie Mist', PC, T, 'PETG', 'Arctic', 'Matte', 'Moon Gray', H(240)),
  c('LX-40', 'Parasol', PC, T, 'Matte', 'Beige', 'Wood', 'Natural', H(240)),
  c('LX-41', 'Coral Orb', GO, T, 'PETG', 'Red', 'Stone', 'White', H(230)),
  c('LX-42', 'Ice Orb', GO, T, 'PETG', 'Ice Blue', 'Stone', 'White', H(230)),
  c('LX-43', 'Facet', PC, T, 'Silk', 'Silk Silver', 'PETG', 'Orange', H(240)),
  c('LX-44', 'Chalice', FC, T, 'Matte', 'Navy Blue', 'Matte', 'Navy Blue', H(240)),
  c('LX-45', 'Luna Terra', PD, P, 'Plus', 'Terracotta Orange', null, null, [185, 245, 305, 370]),
  c('LX-46', 'Cobalt Orb', GO, T, 'PETG', 'Blue', 'Matte', 'Moon Gray', H(230)),
  c('LX-47', 'Hourglass', FC, T, 'Wood', 'Natural', 'Wood', 'Natural', H(240)),
  c('LX-48', 'Accordion', SA, T, 'PETG', 'Green', 'Matte', 'Moon Gray', H(240)),
  c('LX-49', 'Accordion Amber', SA, T, 'PETG', 'Yellow', 'Matte', 'Beige', H(240)),
  c('LX-50', 'Strata', PD, P, 'Plus', 'Teal Blue', null, null, H(220)),
  c('LX-51', 'Ripple Coral', GO, T, 'PETG', 'Red', 'Matte', 'Black', H(230)),
  c('LX-52', 'Cascade', SA, T, 'Plus', 'Rust Copper', 'Plus', 'Rust Copper', H(240)),
  c('LX-53', 'Gourd Silver', MB, T, 'Silk', 'Silk Silver', 'Plus', 'Outrageous Orange', [180, 240, 300, 360]),
  c('LX-54', 'Bloom Azure', GO, T, 'PETG', 'Blue', 'Matte', 'Moon Gray', H(230)),
  c('LX-55', 'Rhombo Amber', LP, T, 'PETG', 'Orange', 'Plus', 'Terracotta Orange', [165, 220, 275, 330]),
  c('LX-56', 'Lattice', LP, T, 'PETG', 'Arctic', 'Stone', 'White', [180, 240, 300, 360]),
  c('LX-57', 'Strata Cube', SA, T, 'PETG', 'Orange', 'Matte', 'White', H(220)),
  c('LX-58', 'Chevron', PD, P, 'Matte', 'Beige', null, null, [200, 270, 340, 405]),
  c('LX-59', 'Saucer', PC, T, 'PETG', 'Orange', 'Matte', 'White', H(220)),
  c('LX-60', 'Plisse', PD, P, 'Plus', 'Teal Blue', null, null, H(220)),
  c('LX-61', 'Helix Lime', GO, T, 'PETG', 'Green', 'Matte', 'Black', H(230)),
  c('LX-62', 'Quill Noir', SA, T, 'Matte', 'Black', 'Matte', 'Black', H(240)),
  c('LX-63', 'Helix Amber', GO, T, 'PETG', 'Orange', 'Matte', 'Black', H(230)),
  c('LX-64', 'Bell', PD, P, 'Plus', 'Apricot', null, null, H(220)),
  c('LX-65', 'Morel Mint', MB, T, 'Matte', 'Mint Green', 'Matte', 'Mint Green', [220, 295, 370, 440]),
  c('LX-66', 'Kite', PC, T, 'Matte', 'Ruby Red', 'Matte', 'White', H(240)),
  c('LX-67', 'Facet Noir', PD, P, 'Matte', 'Black', null, null, H(220)),
  c('LX-68', 'Frost Tube', LP, T, 'PETG', 'Arctic', 'Matte', 'White', [165, 220, 275, 330]),
  c('LX-69', 'Scala', PD, P, 'Plus', 'Terracotta Orange', null, null, [245, 325, 405, 480]),
  c('LX-70', 'Amphora', LP, T, 'PETG', 'Yellow', 'Wood', 'Natural', [170, 230, 290, 345]),
  c('LX-71', 'Dome Lime', PD, P, 'Plus', 'Grass Green', null, null, H(200)),
  c('LX-72', 'Spira', PD, P, 'Wood', 'Natural', null, null, [165, 220, 275, 330]),
];

const sil = (id: string) => (SILHOUETTES.find((s) => s.id === id) ?? SILHOUETTES[0]).handles.slice();
const has = (n: string, ...k: string[]) => k.some((x) => n.toLowerCase().includes(x));

/** Shade and base shapes for a catalogue design at total height h. */
function formsFor(e: Catalogue, h: number): { shade: ShapeSpec; base?: ShapeSpec; gallery: number } {
  const n = e.name;
  const fl = (count: number, depth: number, sharp = 1.5): PatternLayer => pattern('flutes', { count, depth, sharpness: sharp });
  const pl = (count: number, depth: number): PatternLayer => pattern('pleats', { count, depth });
  const translucent = e.shade[0] === 'PETG Translucent';
  const wall = translucent ? 1.2 : 1.6;
  switch (e.family) {
    case 'Fluted columns': {
      const shadeH = h * 0.45, baseH = h * 0.62;
      let base = defaultShape({ silhouette: 'cylinder', handles: sil('cylinder'), height: baseH, diameter: h * 0.42, wall: 2.4, innerFollows: false, patterns: [fl(32, 2)] });
      let shade = defaultShape({ silhouette: 'drum', handles: sil('drum'), height: shadeH, diameter: h * 0.8, wall, patterns: [fl(56, 2.6)] });
      if (has(n, 'flare', 'cog', 'flute sand')) base = defaultShape({ silhouette: 'cone', handles: sil('cone'), height: baseH, diameter: h * 0.46, wall: 2.4, innerFollows: false });
      if (has(n, 'cog')) shade = defaultShape({ ...shade, patterns: [pattern('cog', { count: 22, depth: 9, sharpness: 1.4 })] });
      if (has(n, 'flare')) shade = defaultShape({ ...shade, patterns: [pattern('flutes', { count: 30, depth: 5, sharpness: 2.5 })] });
      if (has(n, 'flute sand', 'cobalt')) shade = defaultShape({ ...shade, silhouette: 'cylinder', handles: sil('cylinder'), height: h * 0.55, diameter: h * 0.42, patterns: [fl(64, 1.6, 2)] });
      if (has(n, 'spool')) base = defaultShape({ ...base, silhouette: 'spool', handles: sil('spool') });
      if (has(n, 'chalice')) base = defaultShape({ ...base, silhouette: 'chalice', handles: sil('chalice') });
      if (has(n, 'hourglass')) base = defaultShape({ ...base, silhouette: 'hourglass', handles: sil('hourglass') });
      if (has(n, 'crown')) shade = defaultShape({ ...shade, section: 'star', sides: 24, sectionDepth: 0.06 });
      if (has(n, 'corolla')) shade = defaultShape({ ...shade, silhouette: 'tulip', handles: sil('tulip') });
      return { shade, base, gallery: 0.12 };
    }
    case 'Pleats & cones': {
      let shade = defaultShape({ silhouette: 'empire', handles: sil('empire'), height: h * 0.5, diameter: h * 0.85, wall, patterns: [pl(28, 5)] });
      const base = defaultShape({ silhouette: 'cylinder', handles: sil('cylinder'), height: h * 0.55, diameter: h * 0.3, wall: 2.4, innerFollows: false, patterns: [fl(20, 1.2)] });
      if (has(n, 'pagoda')) shade = defaultShape({ ...shade, silhouette: 'pagoda', handles: sil('pagoda'), height: h * 0.62 });
      if (has(n, 'kirie', 'origa')) shade = defaultShape({ ...shade, patterns: [pattern('origami', { count: 18, rows: 3, depth: 7 })] });
      if (has(n, 'plissé', 'halo', 'bloom')) shade = defaultShape({ ...shade, patterns: [pl(48, 3.2)] });
      if (has(n, 'prism', 'facet')) shade = defaultShape({ ...shade, section: 'polygon', sides: has(n, 'facet') ? 6 : 8, rounding: 0, patterns: [] });
      if (has(n, 'bell')) shade = defaultShape({ ...shade, silhouette: 'bell', handles: sil('bell') });
      if (has(n, 'parasol', 'saucer')) shade = defaultShape({ ...shade, silhouette: 'saucer', handles: sil('saucer'), height: h * 0.3, diameter: h * 0.95 });
      if (has(n, 'kite')) shade = defaultShape({ ...shade, section: 'star', sides: 8, sectionDepth: 0.25, patterns: [] });
      return { shade, base, gallery: 0.06 };
    }
    case 'Glow orbs': {
      let shade = defaultShape({ silhouette: 'orb', handles: sil('orb'), height: h * 0.72, diameter: h * 0.72, wall: 1.2, patterns: [fl(24, 2.5, 1.2)] });
      const base = defaultShape({ silhouette: 'cylinder', handles: sil('cylinder'), height: h * 0.18, diameter: h * 0.4, wall: 3, innerFollows: false, floor: 0 });
      if (has(n, 'vortex', 'helix')) shade = defaultShape({ ...shade, patterns: [pattern('helix', { count: 18, rows: 1, depth: 3, twist: 0.5, sharpness: 1.6 })] });
      if (has(n, 'ripple')) shade = defaultShape({ ...shade, patterns: [pattern('ripple', { count: 12, rows: 9, depth: 2 })] });
      if (has(n, 'bloom')) shade = defaultShape({ ...shade, section: 'petal', sides: 8, sectionDepth: 0.12 });
      if (has(n, 'lumen', 'bulb')) shade = defaultShape({ ...shade, patterns: [pattern('stack', { rows: 6, depth: 3 })] });
      return { shade, base, gallery: 0.03 };
    }
    case 'Mushrooms & blooms': {
      let shade = defaultShape({ silhouette: 'dome', handles: sil('dome'), height: h * 0.4, diameter: h * 0.95, wall, patterns: [fl(72, 1.8, 2)] });
      let base = defaultShape({ silhouette: 'flare', handles: [1, 0.86, 0.76, 0.7, 0.66, 0.64, 0.62], height: h * 0.66, diameter: h * 0.34, wall: 2.4, innerFollows: false, patterns: [fl(40, 1.4, 2)] });
      if (has(n, 'sage', 'gourd')) { shade = defaultShape({ ...shade, silhouette: 'onion', handles: sil('onion'), height: h * 0.55, diameter: h * 0.6 }); base = defaultShape({ ...base, silhouette: 'orb', handles: sil('orb'), height: h * 0.42, diameter: h * 0.5 }); }
      if (has(n, 'moss')) { shade = defaultShape({ ...shade, silhouette: 'cylinder', handles: sil('cylinder'), height: h * 0.3, diameter: h * 0.6, patterns: [pattern('noise', { count: 24, rows: 6, depth: 0.6 })] }); base = defaultShape({ ...base, silhouette: 'vase', handles: [0.5, 0.5, 0.9, 1, 1, 0.8, 0.6], patterns: [] }); }
      return { shade, base, gallery: 0.1 };
    }
    case 'Stacks & accordions': {
      let shade = defaultShape({ silhouette: 'cylinder', handles: sil('cylinder'), height: h * 0.8, diameter: h * 0.55, wall: 1.2, patterns: [pattern('stack', { rows: 4, depth: 10, count: 1 }), fl(24, 1.2)] });
      const base = defaultShape({ silhouette: 'cylinder', handles: sil('cylinder'), height: h * 0.12, diameter: h * 0.4, wall: 3, innerFollows: false });
      if (has(n, 'accordion')) shade = defaultShape({ ...shade, patterns: [pattern('accordion', { rows: 9, depth: 8 })] });
      if (has(n, 'cube')) shade = defaultShape({ ...shade, section: 'polygon', sides: 4, rounding: 0.25 });
      if (has(n, 'cascade', 'quill')) shade = defaultShape({ ...shade, silhouette: 'taper', handles: sil('taper'), patterns: [pattern('fins', { rows: 14, depth: 5 })] });
      return { shade, base, gallery: 0.03 };
    }
    case 'Lattice & pattern': {
      let shade = defaultShape({ silhouette: 'capsule', handles: sil('capsule'), height: h * 0.55, diameter: h * 0.5, wall: 1.2, patterns: [pattern('rhombo', { count: 12, rows: 5, depth: 2.4 })] });
      let base = defaultShape({ silhouette: 'cylinder', handles: sil('cylinder'), height: h * 0.45, diameter: h * 0.4, wall: 3, innerFollows: false });
      if (has(n, 'lattice')) shade = defaultShape({ ...shade, patterns: [pattern('lattice', { count: 10, rows: 5, depth: 1.8 })] });
      if (has(n, 'rhombo') && !has(n, 'amber')) shade = defaultShape({ ...shade, silhouette: 'cylinder', handles: sil('drum'), height: h * 0.35, diameter: h * 0.75 });
      if (has(n, 'frost')) { shade = defaultShape({ ...shade, silhouette: 'drum', handles: sil('drum'), patterns: [] }); base = defaultShape({ ...base, patterns: [pattern('scales', { count: 18, rows: 9, depth: 1.6 })] }); }
      if (has(n, 'amphora')) { shade = defaultShape({ ...shade, patterns: [] }); base = defaultShape({ ...base, height: h * 0.32, diameter: h * 0.5, patterns: [pattern('knurl', { count: 40, rows: 12, depth: 1 })] }); }
      return { shade, base, gallery: 0.04 };
    }
    default: {
      let shade = defaultShape({ silhouette: 'orb', handles: [0.62, 0.86, 0.98, 1, 0.94, 0.72, 0.3], height: h * 0.8, diameter: h, wall, patterns: [fl(20, 4, 2)] });
      if (has(n, 'gear')) shade = defaultShape({ ...shade, silhouette: 'drum', handles: sil('drum'), patterns: [pattern('cog', { count: 20, depth: 8 })] });
      if (has(n, 'origa')) shade = defaultShape({ ...shade, silhouette: 'bell', handles: sil('bell'), patterns: [pattern('origami', { count: 20, rows: 2, depth: 9 })] });
      if (has(n, 'colonna')) shade = defaultShape({ ...shade, silhouette: 'cylinder', handles: sil('cylinder'), diameter: h * 0.65, patterns: [fl(48, 2.4)] });
      if (has(n, 'dome')) shade = defaultShape({ ...shade, silhouette: 'dome', handles: sil('dome'), height: h * 0.55, patterns: [] });
      if (has(n, 'corona')) shade = defaultShape({ ...shade, silhouette: 'drum', handles: sil('drum'), section: 'star', sides: 16, sectionDepth: 0.12, patterns: [] });
      if (has(n, 'strata')) shade = defaultShape({ ...shade, silhouette: 'cone', handles: sil('cone'), patterns: [pattern('fins', { rows: 12, depth: 6 })] });
      if (has(n, 'chevron')) shade = defaultShape({ ...shade, silhouette: 'cylinder', handles: sil('cylinder'), section: 'polygon', sides: 4, rounding: 0, diameter: h * 0.75, patterns: [pattern('chevron', { count: 6, rows: 9, depth: 5 })] });
      if (has(n, 'plisse')) shade = defaultShape({ ...shade, silhouette: 'empire', handles: sil('empire'), patterns: [pl(40, 3.5)] });
      if (has(n, 'bell')) shade = defaultShape({ ...shade, silhouette: 'bell', handles: sil('bell'), patterns: [] });
      if (has(n, 'facet')) shade = defaultShape({ ...shade, section: 'polygon', sides: 7, rounding: 0, patterns: [] });
      if (has(n, 'scala')) shade = defaultShape({ ...shade, silhouette: 'cylinder', handles: sil('cylinder'), diameter: h * 0.6, patterns: [pattern('scales', { count: 14, rows: 12, depth: 2.4 })] });
      if (has(n, 'spira')) shade = defaultShape({ ...shade, silhouette: 'bell', handles: [1, 0.96, 0.8, 0.5, 0.36, 0.3, 0.26], patterns: [pattern('helix', { count: 60, rows: 1, depth: 1.6, twist: 0.25 })] });
      // pendants hang from the top: handles run bottom (rim) → top (cord)
      return { shade, gallery: 1 };
    }
  }
}

export type Size = 'S' | 'M' | 'L' | 'XL';

export function catalogueDesign(e: Catalogue, size: Size = 'M'): LampDesign {
  const h = e.heights[['S', 'M', 'L', 'XL'].indexOf(size)];
  const f = formsFor(e, h);
  const kind: LampKind = e.type === 'Pendant' ? 'pendant' : 'table';
  const d = defaultDesign(kind);
  d.name = `${e.name} (${size})`;
  d.code = e.code;
  const shade = section({ role: 'shade', name: 'Shade', shape: f.shade, material: e.shade[0], color: e.shade[1], gallery: f.gallery });
  if (kind === 'pendant') {
    d.sections = [shade];
    d.bulb = f.shade.diameter > 150 ? 'g95' : 'g45';
  } else {
    const base = section({ role: 'base', name: 'Base', shape: f.base!, material: e.base![0], color: e.base![1] });
    d.sections = [base, shade];
    d.bulb = minBulb(f.shade);
  }
  return d;
}

const minBulb = (s: ShapeSpec) => (s.diameter < 120 ? 'g45' : s.diameter < 170 ? 'p45-e27' : 'a60');

// ---------------------------------------------------------------- studio & starters
export interface Preset { id: string; group: string; name: string; make: () => LampDesign }

const studio = (id: string, name: string, f: (d: LampDesign) => void, kind: LampKind = 'pendant'): Preset =>
  ({ id, group: 'Studio forms', name, make: () => { const d = defaultDesign(kind); d.name = name; f(d); return d; } });

const mini = (id: string, name: string, f: (d: LampDesign) => void): Preset =>
  ({ id, group: 'Mini lamps', name, make: () => { const d = defaultDesign('table'); d.name = name; d.fitting.holder = 'e14'; d.bulb = 'p45'; d.watts = 4; f(d); return d; } });

export const PRESETS: Preset[] = [
  ...(['table', 'wall', 'pendant', 'floor', 'ceiling', 'lantern', 'mount'] as LampKind[]).map((k) => ({ id: `start-${k}`, group: 'Starters', name: defaultDesign(k).name, make: () => defaultDesign(k) })),
  { id: 'start-tripod', group: 'Starters', name: 'Tripod table lamp', make: () => { const d = defaultDesign('table'); d.name = 'Tripod table lamp'; d.base.legs = 3; d.sections[0].shape = defaultShape({ height: 60, diameter: 60, wall: 3, innerFollows: false }); d.sections[1].shape = defaultShape({ silhouette: 'stack', handles: sil('cylinder'), height: 200, diameter: 180, patterns: [pattern('stack', { rows: 4, depth: 14 })] }); d.sections[1].material = 'PETG Translucent'; d.sections[1].color = 'Orange'; d.sections[1].gallery = 0.02; return d; } },
  { id: 'start-half-sconce', group: 'Starters', name: 'Half-round wall sconce', make: () => { const d = defaultDesign('wall'); d.name = 'Half-round wall sconce'; Object.assign(d.sections[0].shape, { section: 'half', sectionDepth: 0.55 }); d.wall.armLength = 40; return d; } },
  { id: 'start-bike', group: 'Starters', name: 'Bicycle light (31.8 bar)', make: () => { const d = defaultDesign('mount'); d.name = 'Bicycle light'; d.mount.pipe = 31.8; return d; } },
  { id: 'start-rack', group: 'Starters', name: 'Roof-rack camp light (42.4 strap)', make: () => { const d = defaultDesign('mount'); d.name = 'Roof-rack camp light'; d.mount.pipe = 42.4; d.mount.style = 'strap'; d.sections[0].shape.diameter = 70; d.bulb = 'puck60'; return d; } },
  { id: 'start-hex-lantern', group: 'Starters', name: 'Hexagonal lantern', make: () => { const d = defaultDesign('lantern'); d.name = 'Hexagonal lantern'; for (const s of d.sections) Object.assign(s.shape, { section: 'polygon', sides: 6, rounding: 0.1 }); return d; } },
  { id: 'start-totem-floor', group: 'Starters', name: 'Stacked totem floor lamp (5 tiers)', make: () => {
    const d = defaultDesign('floor'); d.name = 'Stacked totem floor lamp'; d.bulb = 'strip'; d.fitting.holder = 'strip';
    const tiers = ['orb', 'barrel', 'onion', 'lantern', 'capsule'];
    d.sections = [d.sections[0], ...tiers.map((t, i) => section({ role: 'body', name: `Tier ${i + 1}`, material: 'PETG Translucent', color: ['Orange', 'Yellow', 'Pink', 'Ice Blue', 'Arctic'][i], attach: 'stack', joint: defaultJoint({ kind: 'bayonet', length: 10 }), shape: defaultShape({ silhouette: t, handles: sil(t).map((v) => Math.max(0.55, v)), height: 220, diameter: 200, patterns: [pattern(['flutes', 'stack', 'helix', 'rhombo', 'fins'][i] as PatternLayer['type'], { count: 24, rows: 4, depth: 3 })] }) }))];
    return d;
  } },
  studio('mm-twist', 'Twisted vase pendant', (d) => { d.sections[0].shape = defaultShape({ silhouette: 'onion', handles: [0.5, 0.88, 1, 0.94, 0.7, 0.44, 0.22], height: 220, diameter: 230, section: 'polygon', sides: 9, rounding: 0.15, twist: 120, vase: true, wall: 0.8 }); d.sections[0].gallery = 1; }),
  studio('mm-fins', 'Fin stack pendant', (d) => { d.sections[0].shape = defaultShape({ silhouette: 'orb', handles: sil('orb'), height: 220, diameter: 240, patterns: [pattern('fins', { rows: 18, depth: 14, sharpness: 2 })], innerFollows: false }); }),
  studio('mm-wavefins', 'Wavy fin pendant', (d) => { d.sections[0].shape = defaultShape({ silhouette: 'drum', handles: sil('drum'), height: 180, diameter: 220, patterns: [pattern('wave-fins', { count: 16, rows: 14, depth: 10 })], innerFollows: false }); }),
  studio('mm-ribbon', 'Ribbon table lamp', (d) => { d.sections[1].shape = defaultShape({ silhouette: 'tulip', handles: sil('tulip'), height: 200, diameter: 190, patterns: [pattern('ribbon', { count: 8, rows: 1.5, depth: 7 })] }); d.sections[1].material = 'PETG Translucent'; d.sections[1].color = 'Ice Blue'; }, 'table'),
  studio('mm-voronoi', 'Voronoi globe pendant', (d) => { d.sections[0].shape = defaultShape({ silhouette: 'orb', handles: sil('orb'), height: 220, diameter: 230, patterns: [pattern('voronoi', { count: 12, rows: 7, depth: 3, seed: 7 })] }); }),
  studio('mm-facet', 'Low-poly faceted pendant', (d) => { d.sections[0].shape = defaultShape({ silhouette: 'onion', handles: sil('onion'), height: 200, diameter: 220, section: 'polygon', sides: 7, rounding: 0, twist: 51 }); }),
  studio('mm-honey', 'Honeycomb drum', (d) => { d.sections[1].shape = defaultShape({ silhouette: 'drum', handles: sil('drum'), height: 150, diameter: 210, patterns: [pattern('honeycomb', { count: 16, rows: 6, depth: 2.4 })] }); }, 'table'),
  mini('mini-mushroom', 'Mini mushroom', (d) => { d.sections[0].shape = defaultShape({ silhouette: 'flare', handles: sil('flare'), height: 70, diameter: 60, wall: 2.4, innerFollows: false, patterns: [pattern('flutes', { count: 24, depth: 1 })] }); d.sections[1].shape = defaultShape({ silhouette: 'dome', handles: sil('dome'), height: 55, diameter: 130, patterns: [pattern('flutes', { count: 48, depth: 1.4 })] }); d.sections[1].gallery = 0.08; }),
  mini('mini-stack', 'Mini bubble stack', (d) => { d.sections[0].shape = defaultShape({ height: 30, diameter: 70, wall: 3, innerFollows: false }); d.sections[1].shape = defaultShape({ height: 120, diameter: 90, patterns: [pattern('stack', { rows: 4, depth: 7 })] }); d.sections[1].material = 'PETG Translucent'; d.sections[1].color = 'Pink'; d.sections[1].gallery = 0.03; }),
  mini('mini-candle', 'Mini candle cone', (d) => { d.fitting.holder = 'e12'; d.bulb = 'c35-e12'; d.sections[0].shape = defaultShape({ silhouette: 'cone', handles: sil('cone'), height: 80, diameter: 70, wall: 2.4, innerFollows: false }); d.sections[1].shape = defaultShape({ silhouette: 'empire', handles: sil('empire'), height: 90, diameter: 130, patterns: [pattern('pleats', { count: 24, depth: 3 })] }); d.sections[1].gallery = 0.05; }),
  mini('mini-battery', 'Mini battery orb', (d) => { Object.assign(d, defaultDesign('lantern'), { name: 'Mini battery orb' }); d.sections[1].shape = defaultShape({ silhouette: 'orb', handles: sil('orb').map((v) => Math.max(0.7, v)), height: 90, diameter: 100, patterns: [pattern('ripple', { count: 8, rows: 6, depth: 1.6 })] }); d.sections.splice(2, 1); }),
  ...CATALOGUE.map((e) => ({ id: e.code, group: `Catalogue · ${e.family}`, name: `${e.code} ${e.name}`, make: () => catalogueDesign(e) })),
];
