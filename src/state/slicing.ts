// Bridges the store and the slicer worker.
import * as THREE from 'three';
import { transformVertices } from '../engine/mesh';
import type { MeshInput, SliceOutput } from '../engine/types';
import { filamentSlots, resolveConfig, slotOverrides } from '../profiles/resolve';
import { effectiveFlush } from '../profiles/flush';
import { faceSetsOf, pluginConfigs } from '../plugins/registry';
import { objectMatrix, objectPlate, partWorldMatrix, plateOrigin, useStore, type SceneObject } from './store';
import { advancedSliceConfig } from './advanced';
import { startWorker, workerFailure } from '../workers';

let worker: Worker | null = null;
let seq = 0;
let pending: ((r: SliceOutput | null) => void) | null = null;

/** Settings for slicing a plate: the global ones with the plate's own bed type and spiral vase on top. */
export function currentConfig(plateIndex = useStore.getState().activePlate) {
  const s = useStore.getState();
  const pl = s.plates[plateIndex];
  const overrides = pl?.spiralVase === undefined ? s.overrides : { ...s.overrides, spiral_mode: pl.spiralVase };
  const plateOv = { ...(pl?.printSequence ? { print_sequence: pl.printSequence } : {}) };
  return resolveConfig({ printerId: s.printerId, plate: pl?.bedType ?? s.plate, filamentId: s.filaments[0].presetId, presetId: s.presetId, overrides: { ...overrides, ...plateOv }, machineOverrides: s.machineOverrides, filamentOverrides: slotOverrides(s.filaments[0]) });
}

export const plateObjects = (plate = useStore.getState().activePlate) => {
  const s = useStore.getState();
  return s.objects.filter((o) => objectPlate(o, s.printerId, s.plates.length) === plate);
};

/** Stops the running slice: the worker is terminated, the waiting caller gets null and nothing is reported as an error. */
export function cancelSlice() {
  const was = useStore.getState().slice.status === 'slicing';
  worker?.terminate();
  worker = null;
  const p = pending;
  pending = null;
  p?.(null);
  if (!was && !p) return;
  const st = useStore.getState();
  st.set({ slice: { ...st.slice, status: 'idle', stage: '', progress: 0, error: null, dirty: true }, toast: { kind: 'info', text: 'Slicing cancelled' } });
}

/** The slicer's input for objects of a plate: world meshes moved into the plate's own coordinates, with parts and paint. */
export function plateMeshes(objs: SceneObject[], plate = useStore.getState().activePlate): MeshInput[] {
  const s = useStore.getState();
  const [ox, oy] = plateOrigin(plate, s.printerId);
  const toPlate = new THREE.Matrix4().makeTranslation(-ox, -oy, 0);
  return objs.map((o) => ({
    id: o.id, name: o.name,
    vertices: transformVertices(o.mesh.vertices, toPlate.clone().multiply(objectMatrix(o)).elements),
    indices: o.mesh.indices,
    filament: o.filament ?? 0,
    overrides: o.overrides,
    paint: o.paint,
    faceSets: faceSetsOf(o.paint?.motion),
    layerHeights: o.layerHeights,
    heightRanges: o.heightRanges,
    brimEars: o.brimEars?.map(([x, y, z]) => {
      const p = new THREE.Vector3(x, y, z ?? 0).applyMatrix4(toPlate.clone().multiply(objectMatrix(o)));
      return [p.x, p.y] as [number, number];
    }),
    parts: (o.parts ?? []).map((p) => ({
      type: p.type, overrides: p.overrides, indices: p.mesh.indices,
      innerFrom: p.prim?.wall && p.mesh.indices.length / 3 === p.prim.tris ? p.prim.innerFrom : undefined,
      vertices: transformVertices(p.mesh.vertices, toPlate.clone().multiply(partWorldMatrix(o, p)).elements),
    })),
  }));
}

export function sliceNow(): Promise<SliceOutput | null> {
  const s = useStore.getState();
  const plate = s.activePlate;
  const program = s.plates[plate]?.program;
  const objs = program ? [] : plateObjects(plate).filter((o) => o.printable !== false);
  if (!objs.length && !program) {
    s.set({ toast: { kind: 'warn', text: `${s.plates[plate].name} is empty — add a model first.` } });
    return Promise.resolve(null);
  }
  let meshes: MeshInput[];
  try { meshes = plateMeshes(objs, plate); }
  catch (e: any) {
    s.set({ slice: { ...s.slice, status: 'error', error: e?.message ?? String(e), dirty: true }, toast: { kind: 'error', text: `Slicing failed: the plate could not be prepared (${e?.message ?? e})` } });
    return Promise.resolve(null);
  }
  worker?.terminate();
  pending?.(null); // a slice that is replaced never finishes
  const mine = startWorker('slicer');
  worker = mine;
  const id = ++seq;
  s.set({ slice: { ...s.slice, status: 'slicing', stage: 'Preparing', progress: 0, error: null, plate, dirty: false } }); // edits during the slice mark it dirty again
  return new Promise((done) => {
    const resolve = (r: SliceOutput | null) => { if (pending === resolve) pending = null; if (worker === mine) { mine.terminate(); worker = null; } done(r); };
    pending = resolve;
    // a worker that dies (out of memory, script error) is reported once, unless this slice was replaced or cancelled
    const fail = (message: string) => {
      if (worker !== mine) return;
      const st = useStore.getState();
      st.set({ slice: { ...st.slice, status: 'error', error: message, dirty: true }, toast: { kind: 'error', text: `Slicing failed: ${message}` } });
      resolve(null);
    };
    // a script error carries a message; a script that could not be loaded (or a crash) does not
    mine.onerror = (e) => { e.preventDefault?.(); if (e.message) fail(e.message); else void workerFailure('slicer', 'slicer').then(fail); };
    mine.onmessageerror = () => fail('the slicer sent back data that could not be read');
    mine.onmessage = (ev) => {
      const m = ev.data;
      if (m.id !== id || worker !== mine) return;
      const st = useStore.getState();
      if (m.type === 'progress') st.set({ slice: { ...st.slice, stage: m.stage, progress: m.pct } });
      else if (m.type === 'done') {
        const out = m.out as SliceOutput;
        st.set({
          slice: { status: 'done', stage: 'Done', progress: 1, result: out, error: null, dirty: st.slice.dirty, plate },
          layerRange: [0, out.layers.length - 1], moveCursor: -1,
          toast: out.warnings.length ? { kind: 'warn', text: out.warnings.join(' ') } : null,
        });
        resolve(out);
      } else fail(m.message);
    };
    try {
      mine.postMessage({
        id, meshes, cfg: currentConfig(plate),
        opts: { program, filaments: filamentSlots(s.filaments), layerActions: s.plates[plate].layerActions, plugins: pluginConfigs(), advanced: advancedSliceConfig(), flushMatrix: s.filaments.length > 1 ? effectiveFlush(s.filaments.map((f) => f.color), s.flushMatrix, s.flushMultiplier) : undefined },
      }, meshes.map((m) => m.vertices.buffer));
    } catch (e: any) {
      // settings or plugin data that cannot be sent to the worker: report it instead of staying at "Preparing"
      fail(`the plate could not be sent to the slicer (${e?.message ?? e})`);
    }
  });
}
