// Walls straight from the 3D model, for the Select window's live preview: each layer's cross-section of the
// meshes, offset inwards into the outer wall and the inner walls, with the current layer height, first layer
// height, wall count and line widths. No infill, no top or bottom skins: those come with the real slice.
// The result has the slice's own shape (SliceOutput), so the window shows, picks and drafts motions on it as on
// a real slice, and a change of layer height or wall count shows in a moment.
import { offset, SCALE } from '../../../engine/clipper';
import type { Paths } from '../../../engine/types';
import { sliceMesh } from '../../../engine/slice';
import { FEATURE_ORDER, type FeatureType, type MeshInput, type SliceOutput } from '../../../engine/types';
import type { Config } from '../../../profiles/settings';

const num = (cfg: Config, k: string, d: number) => { const v = parseFloat(String(cfg[k] ?? '')); return Number.isFinite(v) && v > 0 ? v : d; };

export interface ModelWallSettings { layerH: number; firstH: number; walls: number; outerW: number; innerW: number }

export function wallSettings(cfg: Config): ModelWallSettings {
  const lw = num(cfg, 'line_width', 0.42);
  return {
    layerH: num(cfg, 'layer_height', 0.2), firstH: num(cfg, 'initial_layer_print_height', num(cfg, 'layer_height', 0.2)),
    walls: Math.max(1, Math.round(num(cfg, 'wall_loops', 2))), outerW: num(cfg, 'outer_wall_line_width', lw), innerW: num(cfg, 'inner_wall_line_width', lw),
  };
}

export function wallsFromModel(meshes: MeshInput[], s: ModelWallSettings, maxLayers = 4000): SliceOutput | null {
  let top = 0;
  for (const m of meshes) for (let k = 2; k < m.vertices.length; k += 3) top = Math.max(top, m.vertices[k]);
  if (top <= 0) return null;
  const tops: number[] = [];
  for (let z = s.firstH; z <= top + 1e-6 && tops.length < maxLayers; z += s.layerH) tops.push(+z.toFixed(5));
  const planes = tops.map((z, i) => z - (i ? s.layerH : s.firstH) / 2);
  const sections = meshes.map((m) => sliceMesh(m, planes));
  const moves: number[] = [], feats: number[] = [];
  const OUT = FEATURE_ORDER.indexOf('outer_wall'), IN = FEATURE_ORDER.indexOf('inner_wall'), TR = FEATURE_ORDER.indexOf('travel' as FeatureType);
  const push = (x: number, y: number, z: number, w: number, h: number, f: number) => { moves.push(x, y, z, w, h, 40, 0, 0); feats.push(f); };
  push(0, 0, 0, 0, 0, TR);
  const layers: SliceOutput['layers'] = [];
  tops.forEach((z, li) => {
    const h = li ? s.layerH : s.firstH, start = feats.length;
    for (const sec of sections) {
      const sl = sec[li];
      if (!sl?.length) continue;
      for (let k = 0; k < s.walls; k++) {
        const w = k ? s.innerW : s.outerW;
        const d = k ? s.outerW + (k - 0.5) * s.innerW : s.outerW / 2;
        const loops: Paths = offset(sl, -d);
        for (const loop of loops) {
          if (loop.length < 3) continue;
          push(loop[0].X / SCALE, loop[0].Y / SCALE, z, 0, h, TR);
          for (let j = 1; j <= loop.length; j++) { const q = loop[j % loop.length]; push(q.X / SCALE, q.Y / SCALE, z, w, h, k ? IN : OUT); }
        }
      }
    }
    layers.push({ index: li, z, height: h, moveStart: start, moveEnd: feats.length, time: 0 });
  });
  return { moves: new Float32Array(moves), moveFeatures: new Uint8Array(feats), layers, stats: { timeSeconds: 0, toolChanges: 0, towerGrams: 0, flushGrams: 0 } } as unknown as SliceOutput;
}
