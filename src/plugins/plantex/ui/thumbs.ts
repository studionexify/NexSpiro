// Small previews: a design's silhouette (with its texture shading) and a texture swatch, as data URLs.
import { normalizeSpec, type PlantexSpec, type TextureLayer } from '../model';
import { bodyFn } from '../shape';
import { KINDS, layerValue } from '../textures';
import { patternMask } from '../patternLink';

const cache = new Map<string, string>();

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

/** Shaded front view of a design (silhouette from the profile, texture as light and shade). */
export function designThumb(spec: Partial<PlantexSpec>, key = JSON.stringify(spec), size = 84): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const s = normalizeSpec(spec);
  const b = bodyFn(s);
  const H = s.height;
  let rMax = 1;
  for (let k = 0; k <= 40; k++) rMax = Math.max(rMax, b.radius(0, (H * k) / 40), b.radius(Math.PI / 2, (H * k) / 40));
  const span = Math.max(H, rMax * 2.1);
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const layers = s.textures.filter((t) => t.enabled);
  for (let py = 0; py < size; py++) {
    const z = ((size - 1 - py) / size) * span - (span - H) / 2;
    if (z < 0 || z > H) continue;
    for (let px = 0; px < size; px++) {
      const x = ((px - size / 2) / size) * span;
      // view from the front: angle where the body's radius covers x
      const r = b.radius(Math.PI / 2, z);
      if (Math.abs(x) > r) continue;
      const a = Math.asin(Math.max(-1, Math.min(1, x / r)));
      const u = (((Math.PI / 2 - a) / (2 * Math.PI)) % 1 + 1) % 1;
      let d = 0;
      for (const L of layers) d += (L.mode === 'emboss' ? 1 : -0.7) * layerValue(L, u, z, H, rMax, L.kind === 'pattern' && L.patternKey ? patternMask(L.patternKey) : undefined);
      const lit = 0.55 + 0.35 * Math.cos(a) + 0.18 * Math.max(-1, Math.min(1, d));
      const i = (py * size + px) * 4;
      img.data[i] = 70 + 110 * lit; img.data[i + 1] = 120 + 100 * lit; img.data[i + 2] = 90 + 70 * lit; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

/** 3 × 3 repeats of a texture layer's height field. */
export function textureThumb(L: Partial<TextureLayer>, size = 56): string {
  const key = `tex:${JSON.stringify(L)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const k = KINDS[L.kind ?? 'ribs'];
  const mask = L.kind === 'pattern' && L.patternKey ? patternMask(L.patternKey) : undefined;
  const cu = 3;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let h = k.fn((px / size) * 3, ((size - py) / size) * 3, { cu, shape: L.shape ?? 0.5, sharp: L.sharp ?? 0.5, seed: L.seed ?? 1, mask });
    if (L.invert) h = 1 - h;
    const v = 40 + 200 * h;
    const i = (py * size + px) * 4;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
