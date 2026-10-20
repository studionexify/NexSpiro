// User-level actions shared by menus, toolbar and keyboard shortcuts.
import { weld } from '../engine/mesh';
import { loadModelFile } from '../io/load';
import { openModelFiles, saveFile } from '../platform';
import { printerById } from '../profiles/printers';
import { arrange, autoOrient, centreOnBed } from './ops';
import { sliceNow } from './slicing';
import { emptyProject, newId, useStore, type SceneObject } from './store';
import { centreMesh } from '../io/load';

export async function importBuffers(files: { name: string; data: ArrayBuffer }[]) {
  const s = useStore.getState();
  const added: SceneObject[] = [];
  for (const f of files) {
    try {
      if (/\.3mf$/i.test(f.name)) {
        const { isProject, loadProject } = await import('./project');
        if (await isProject(f.data)) {
          if (s.objects.length && !confirm(`Open project ${f.name}? The current plate will be replaced.`)) continue;
          await loadProject(f.data);
          useStore.getState().set({ toast: { kind: 'info', text: `Opened project ${f.name}` } });
          return;
        }
      }
      const models = /\.(step|stp|iges|igs|brep)$/i.test(f.name) ? await (await import('../io/cad')).loadCadFile(f.name, f.data) : await loadModelFile(f.name, f.data);
      for (const m of models) {
        let o: SceneObject = { id: newId(), name: m.name, mesh: m.mesh, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], openEdges: m.openEdges };
        o = centreOnBed(o, s.printerId);
        added.push(o);
        if (m.openEdges) s.set({ toast: { kind: 'warn', text: `${m.name}: mesh has ${m.openEdges} open edges and may not slice cleanly.` } });
      }
    } catch (e: any) {
      s.set({ toast: { kind: 'error', text: e?.message ?? `Could not open ${f.name}` } });
    }
  }
  if (!added.length) return;
  s.addObjects(added);
  if (useStore.getState().objects.length > 1) arrange();
  s.set({ workspace: 'prepare' });
}

export async function importDialog() {
  const files = await openModelFiles();
  if (files.length) await importBuffers(files);
}

export function newProject() {
  const s = useStore.getState();
  if (s.objects.length && !confirm('Start a new project? Unsaved changes on the plate will be lost.')) return;
  s.set({ objects: [], selected: [], selectedPart: null, undoStack: [], redoStack: [], workspace: 'prepare', project: emptyProject(), plates: [{ id: 'plate1', name: 'Plate 1', layerActions: [] }], activePlate: 0, slice: { status: 'idle', stage: '', progress: 0, result: null, error: null, dirty: true, plate: 0 } });
}

/** Slice the active plate; the Preview tab opens at once so the progress window is visible there. */
export async function sliceAndPreview() {
  const st = useStore.getState();
  if (st.slice.status === 'slicing') { st.set({ workspace: 'preview' }); return; }
  st.set({ workspace: 'preview' });
  const out = await sliceNow();
  const after = useStore.getState();
  // cancelled, failed or nothing to slice: back to Prepare (a replaced slice is still running, so stay)
  if (!out && after.slice.status !== 'slicing' && after.workspace === 'preview') after.set({ workspace: 'prepare' });
}

export async function exportGcode() {
  const s = useStore.getState();
  let r = s.slice.result;
  if (!r || s.slice.dirty) r = await sliceNow();
  if (!r) return;
  const mx = r.pluginReports?.motionex as { check?: { blocking?: boolean; collisionCount?: number } } | undefined;
  if (mx?.check?.blocking) {
    s.set({ toast: { kind: 'error', text: `Motionex: the print head would hit the print in ${mx.check.collisionCount} spots. Export is stopped — see the Motionex panel.` } });
    return;
  }
  const base = (s.objects[0]?.name ?? 'plate').replace(/[^\w.-]+/g, '_');
  const p = printerById(s.printerId);
  const saved = await saveFile(`${base}_${p.model.replace(/\s+/g, '')}.gcode`, r.gcode, 'gcode');
  if (saved) s.set({ toast: { kind: 'info', text: `G-code exported: ${saved}` } });
}

// ----- built-in sample models (procedural, no assets needed)
function boxSoup(sx: number, sy: number, sz: number, x0 = 0, y0 = 0, z0 = 0): number[] {
  const x1 = x0 + sx, y1 = y0 + sy, z1 = z0 + sz;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.flatMap((t) => t.flatMap((i) => v[i]));
}
function tubeSoup(rOut: number, rIn: number, h: number, seg = 96): number[] {
  const out: number[] = [];
  const P = (r: number, a: number, z: number) => [r * Math.cos(a), r * Math.sin(a), z];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const o0b = P(rOut, a0, 0), o1b = P(rOut, a1, 0), o0t = P(rOut, a0, h), o1t = P(rOut, a1, h);
    out.push(...o0b, ...o1b, ...o1t, ...o0b, ...o1t, ...o0t);
    if (rIn > 0) {
      const i0b = P(rIn, a0, 0), i1b = P(rIn, a1, 0), i0t = P(rIn, a0, h), i1t = P(rIn, a1, h);
      out.push(...i0b, ...i1t, ...i1b, ...i0b, ...i0t, ...i1t);
      out.push(...o0t, ...o1t, ...i1t, ...o0t, ...i1t, ...i0t);
      out.push(...o0b, ...i1b, ...o1b, ...o0b, ...i0b, ...i1b);
    } else {
      out.push(0, 0, h, ...o0t, ...o1t, 0, 0, 0, ...o1b, ...o0b);
    }
  }
  return out;
}

export const SAMPLES: { id: string; name: string; description: string; make: () => number[] }[] = [
  { id: 'cube', name: 'Calibration cube', description: '20 mm cube for dimensional checks.', make: () => boxSoup(20, 20, 20) },
  { id: 'vase', name: 'Cylinder vase', description: 'Ø60 × 90 mm — try Spiral vase mode.', make: () => tubeSoup(30, 0, 90) },
  { id: 'ring', name: 'Ring', description: 'Ø40 tube, tests holes and seams.', make: () => tubeSoup(20, 14, 12) },
  { id: 'tee', name: 'Overhang test', description: 'T-shape that needs support or bridging.', make: () => [...boxSoup(10, 10, 15, -5, -5, 0), ...boxSoup(50, 10, 4, -25, -5, 15)] },
];

export function addSample(id: string) {
  const sm = SAMPLES.find((x) => x.id === id)!;
  const mesh = weld(new Float32Array(sm.make()));
  centreMesh(mesh);
  const s = useStore.getState();
  const o = centreOnBed({ id: newId(), name: sm.name, mesh, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], openEdges: 0 }, s.printerId);
  s.addObjects([o]);
  if (useStore.getState().objects.length > 1) arrange();
  s.set({ workspace: 'prepare' });
}

export { arrange, autoOrient };
