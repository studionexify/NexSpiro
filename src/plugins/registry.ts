// UI side of the plugin system: which plugins exist, which are installed, and what each one
// sends to the slicing worker. A plugin adds a tab to the right dock only while installed.
import type { ComponentType } from 'react';
import type { FaceSet } from '../engine/types';
import { useStore } from '../state/store';
import { motionexConfig, MotionexPanel } from './motionex/ui/MotionexPanel';

export interface UiPlugin {
  id: string;
  name: string;
  description: string;
  /** One or two letters for the dock tab. */
  badge: string;
  Panel: ComponentType;
  /** Plain-data config for the slicer, or undefined when the plugin has nothing to do. */
  sliceConfig(): unknown;
}

export const PLUGINS: UiPlugin[] = [
  {
    id: 'motionex', name: 'Motionex', badge: 'M',
    description: 'Waves, loops, dots and textures on the walls of your print.',
    Panel: MotionexPanel,
    sliceConfig: () => motionexConfig(useStore.getState().printerId),
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
