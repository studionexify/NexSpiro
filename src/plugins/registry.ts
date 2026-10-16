// UI side of the plugin system: which plugins exist, which are installed, and what each one
// sends to the slicing worker. A plugin adds a tab to the right dock only while installed.
import type { ComponentType } from 'react';
import type { FaceSet } from '../engine/types';
import { useStore } from '../state/store';
import { motionexConfig, MotionexPanel, motionexPreview, mx } from './motionex/ui/MotionexPanel';
import { PatternStudio } from './motionex/ui/PatternStudio';
import { toConfig } from './motionex';
import { patternexConfig, patternexMotionApps, PatternexPanel, px } from './patternex/ui/PatternexPanel';
import { patternexPreview } from './patternex/ui/preview';

export interface UiPlugin {
  id: string;
  name: string;
  description: string;
  /** One or two letters for the dock tab. */
  badge: string;
  Panel: ComponentType;
  /** Plain-data config for the slicer, or undefined when the plugin has nothing to do. */
  sliceConfig(): unknown;
  /** Quick preview lines drawn on the model in Prepare (no slicing), or null for none. */
  preview?(): { positions: Float32Array; colors: Float32Array } | null;
  /** Full-height editor shown beside the 3D view in the Pattern tab. */
  Studio?: ComponentType;
}

export const PLUGINS: UiPlugin[] = [
  {
    id: 'motionex', name: 'Motionex', badge: 'M',
    description: 'Waves, loops, dots and textures on the walls of your print.',
    Panel: MotionexPanel,
    sliceConfig: () => {
      const printerId = useStore.getState().printerId;
      // Patternex regions that carry a motion become Motionex applications targeting that region
      const extra = useStore.getState().plugins.includes('patternex') ? patternexMotionApps() : [];
      const base = motionexConfig(printerId);
      if (!extra.length) return base;
      const c = base ?? { ...toConfig(mx, printerId), applications: [] };
      const have = new Set(c.brushes.map((b) => b.id));
      const brushes = [...c.brushes, ...extra.map((a) => a.brush_id).filter((id, i, l) => !have.has(id) && l.indexOf(id) === i).map((id) => mx.library.get(id)).filter((b): b is NonNullable<typeof b> => !!b).map((b) => structuredClone(b))];
      return { ...c, applications: [...c.applications, ...extra], brushes };
    },
    preview: motionexPreview,
    Studio: PatternStudio,
  },
  {
    id: 'patternex', name: 'Patternex', badge: 'P',
    description: 'SVG and pattern artwork on the surface, with a filament change (AMS) or a manual swap inside each region.',
    Panel: PatternexPanel,
    sliceConfig: () => patternexConfig(),
    preview: () => patternexPreview(px),
  },
];

export const installedPlugins = () => {
  const ids = useStore.getState().plugins;
  return PLUGINS.filter((p) => ids.includes(p.id));
};

export function pluginConfigs(): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const p of installedPlugins()) {
    const c = p.sliceConfig();
    if (c !== undefined) out[p.id] = c;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Surface sets painted or picked on an object (paint.motion values 1..n). */
export function faceSetsOf(motion: Uint8Array | undefined): FaceSet[] | undefined {
  if (!motion) return undefined;
  const by = new Map<number, number[]>();
  motion.forEach((v, t) => { if (v) { const l = by.get(v); if (l) l.push(t); else by.set(v, [t]); } });
  if (!by.size) return undefined;
  return [...by].map(([v, tris]) => ({ id: String(v), name: surfaceName(v), tris: Uint32Array.from(tris) }));
}

export const surfaceName = (n: number) => `Surface ${n}`;
export { SURFACE_COLORS } from '../state/motionPaint';
