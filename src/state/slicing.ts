// Bridges the store and the slicer worker.
import { transformVertices } from '../engine/mesh';
import type { MeshInput, SliceOutput } from '../engine/types';
import { resolveConfig } from '../profiles/resolve';
import { objectMatrix, useStore } from './store';

let worker: Worker | null = null;
let seq = 0;

export function currentConfig() {
  const s = useStore.getState();
  return resolveConfig({ printerId: s.printerId, plate: s.plate, filamentId: s.filamentId, presetId: s.presetId, overrides: s.overrides, machineOverrides: s.machineOverrides });
}

export function sliceNow(): Promise<SliceOutput | null> {
  const s = useStore.getState();
  if (!s.objects.length) {
    s.set({ toast: { kind: 'warn', text: 'Add a model to the plate first.' } });
    return Promise.resolve(null);
  }
  worker?.terminate();
  worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const meshes: MeshInput[] = s.objects.map((o) => ({
    id: o.id, name: o.name, vertices: transformVertices(o.mesh.vertices, objectMatrix(o).elements), indices: o.mesh.indices,
  }));
  s.set({ slice: { ...s.slice, status: 'slicing', stage: 'Preparing', progress: 0, error: null } });
  return new Promise((resolve) => {
    worker!.onmessage = (ev) => {
      const m = ev.data;
      if (m.id !== id) return;
      const st = useStore.getState();
      if (m.type === 'progress') st.set({ slice: { ...st.slice, stage: m.stage, progress: m.pct } });
      else if (m.type === 'done') {
        const out = m.out as SliceOutput;
        st.set({
          slice: { status: 'done', stage: 'Done', progress: 1, result: out, error: null, dirty: false },
          layerRange: [0, out.layers.length - 1], moveCursor: -1,
          toast: out.warnings.length ? { kind: 'warn', text: out.warnings.join(' ') } : null,
        });
        resolve(out);
      } else {
        st.set({ slice: { ...st.slice, status: 'error', error: m.message }, toast: { kind: 'error', text: `Slicing failed: ${m.message}` } });
        resolve(null);
      }
    };
    worker!.postMessage({ id, meshes, cfg: currentConfig() }, meshes.map((m) => m.vertices.buffer));
  });
}
