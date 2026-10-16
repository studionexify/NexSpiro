// Bridges the store and the slicer worker.
import * as THREE from 'three';
import { transformVertices } from '../engine/mesh';
import type { MeshInput, SliceOutput } from '../engine/types';
import { filamentSlots, resolveConfig, tuningConfig } from '../profiles/resolve';
import { effectiveFlush } from '../profiles/flush';
import { faceSetsOf, pluginConfigs } from '../plugins/registry';
import { objectMatrix, objectPlate, partWorldMatrix, plateOrigin, useStore } from './store';

let worker: Worker | null = null;
let seq = 0;

export function currentConfig() {
  const s = useStore.getState();
  return { ...resolveConfig({ printerId: s.printerId, plate: s.plate, filamentId: s.filaments[0].presetId, presetId: s.presetId, overrides: s.overrides, machineOverrides: s.machineOverrides }), ...tuningConfig(s.filaments[0].tuning) };
}

export const plateObjects = (plate = useStore.getState().activePlate) => {
  const s = useStore.getState();
  return s.objects.filter((o) => objectPlate(o, s.printerId, s.plates.length) === plate);
};

export function sliceNow(): Promise<SliceOutput | null> {
  const s = useStore.getState();
  const plate = s.activePlate;
  const objs = plateObjects(plate);
  if (!objs.length) {
    s.set({ toast: { kind: 'warn', text: `${s.plates[plate].name} is empty — add a model first.` } });
    return Promise.resolve(null);
  }
  worker?.terminate();
  worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const [ox, oy] = plateOrigin(plate, s.printerId);
  const toPlate = new THREE.Matrix4().makeTranslation(-ox, -oy, 0);
  const meshes: MeshInput[] = objs.map((o) => ({
    id: o.id, name: o.name,
    vertices: transformVertices(o.mesh.vertices, toPlate.clone().multiply(objectMatrix(o)).elements),
    indices: o.mesh.indices,
    filament: o.filament ?? 0,
    overrides: o.overrides,
    paint: o.paint,
    faceSets: faceSetsOf(o.paint?.motion),
    layerHeights: o.layerHeights,
    parts: (o.parts ?? []).map((p) => ({
      type: p.type, overrides: p.overrides, indices: p.mesh.indices,
      vertices: transformVertices(p.mesh.vertices, toPlate.clone().multiply(partWorldMatrix(o, p)).elements),
    })),
  }));
  s.set({ slice: { ...s.slice, status: 'slicing', stage: 'Preparing', progress: 0, error: null, plate } });
  return new Promise((resolve) => {
    worker!.onmessage = (ev) => {
      const m = ev.data;
      if (m.id !== id) return;
      const st = useStore.getState();
      if (m.type === 'progress') st.set({ slice: { ...st.slice, stage: m.stage, progress: m.pct } });
      else if (m.type === 'done') {
        const out = m.out as SliceOutput;
        st.set({
          slice: { status: 'done', stage: 'Done', progress: 1, result: out, error: null, dirty: false, plate },
          layerRange: [0, out.layers.length - 1], moveCursor: -1,
          toast: out.warnings.length ? { kind: 'warn', text: out.warnings.join(' ') } : null,
        });
        resolve(out);
      } else {
        st.set({ slice: { ...st.slice, status: 'error', error: m.message }, toast: { kind: 'error', text: `Slicing failed: ${m.message}` } });
        resolve(null);
      }
    };
    worker!.postMessage({
      id, meshes, cfg: currentConfig(),
      opts: { filaments: filamentSlots(s.filaments), layerActions: s.plates[plate].layerActions, plugins: pluginConfigs(), flushMatrix: s.filaments.length > 1 ? effectiveFlush(s.filaments.map((f) => f.color), s.flushMatrix, s.flushMultiplier) : undefined },
    }, meshes.map((m) => m.vertices.buffer));
  });
}
