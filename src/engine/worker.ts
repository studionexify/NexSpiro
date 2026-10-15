// Web Worker entry: runs the slicer off the UI thread.
import { slice } from './slicer';
import type { MeshInput } from './types';
import type { Config } from '../profiles/settings';

self.onmessage = (ev: MessageEvent<{ id: number; meshes: MeshInput[]; cfg: Config }>) => {
  const { id, meshes, cfg } = ev.data;
  try {
    const out = slice(meshes, cfg, (stage, pct) => (self as any).postMessage({ id, type: 'progress', stage, pct }));
    (self as any).postMessage({ id, type: 'done', out }, [out.moves.buffer, out.moveFeatures.buffer]);
  } catch (e: any) {
    (self as any).postMessage({ id, type: 'error', message: e?.message ?? String(e) });
  }
};
