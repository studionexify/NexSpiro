// Surface edit actions on scene objects: chamfer / fillet of picked edges, smooth subdivision, smoothing.
// Each is one undo step. Per-triangle paint is carried across the edit.
import { openEdgeCount } from '../engine/mesh';
import { bevelEdges, remapTriArray, smoothMesh, subdivide, type EditResult, type EdgePair, type SmoothOptions, type SubdivOptions } from '../engine/meshedit';
import { buildTopology, edgeChain, EDGE_SHARP } from '../engine/topology';
import { dropToBed, useStore, worldBounds, type ObjectPaint, type SceneObject } from './store';

function remapPaint(p: ObjectPaint | undefined, src: Uint32Array): ObjectPaint | undefined {
  if (!p) return p;
  const out: ObjectPaint = {};
  for (const k of ['support', 'seam', 'color', 'motion', 'adv'] as const) if (p[k]) out[k] = remapTriArray(p[k], src);
  return out;
}

/** Swap an object's mesh for an edit result, keeping paint and keeping the object on the bed if it was on it. */
function commit(id: string, r: EditResult, label: string) {
  const s = useStore.getState();
  const before = s.objects.find((o) => o.id === id);
  if (!before) return;
  const grounded = Math.abs(worldBounds(before).min[2]) < 1e-3;
  s.updateObjects((o): SceneObject => {
    const next: SceneObject = { ...o, mesh: r.mesh, openEdges: openEdgeCount(r.mesh), paint: remapPaint(o.paint, r.triSource) };
    return grounded ? dropToBed(next) : next;
  }, [id]);
  s.set({ edgeSel: null, toast: { kind: 'info', text: label } });
}

export function selectedEdgeObject(): SceneObject | undefined {
  const s = useStore.getState();
  return s.edgeSel ? s.objects.find((o) => o.id === s.edgeSel!.objectId) : undefined;
}

/** All crease edges of an object, as the current edge selection. */
export function selectCreaseEdges(objectId: string) {
  const s = useStore.getState();
  const o = s.objects.find((x) => x.id === objectId);
  if (!o) return;
  const t = buildTopology(o.mesh, s.edgeAngle);
  const edges: EdgePair[] = [];
  for (let e = 0; e < t.edgeCount; e++) if (t.kind[e] === EDGE_SHARP) edges.push([t.edgeV[e * 2], t.edgeV[e * 2 + 1]]);
  s.set({ edgeSel: edges.length ? { objectId, edges } : null });
}

/** Chamfer (segments = 1) or fillet (segments > 1) the picked edges. Returns a message when nothing could be done. */
export function bevelSelectedEdges(size: number, segments: number): string | null {
  const s = useStore.getState();
  const sel = s.edgeSel;
  const o = sel && s.objects.find((x) => x.id === sel.objectId);
  if (!sel || !o) return 'Pick some edges first.';
  const r = bevelEdges(o.mesh, sel.edges, size, segments);
  if (!r) return 'These edges cannot be bevelled (open or non-manifold edges, or size too small).';
  const what = segments > 1 ? 'Filleted' : 'Chamfered';
  const clamp = r.size < size - 1e-6 ? ` (size reduced to ${r.size.toFixed(2)} mm to fit the surrounding faces)` : '';
  const skip = r.skipped ? `, ${r.skipped} skipped` : '';
  commit(o.id, r, `${what} ${r.applied} edge${r.applied === 1 ? '' : 's'}${skip}${clamp}.`);
  return null;
}

export function subdivideObject(id: string, opts: SubdivOptions): void {
  const o = useStore.getState().objects.find((x) => x.id === id);
  if (!o) return;
  const r = subdivide(o.mesh, opts);
  commit(id, r, `Smoothed body: ${(r.mesh.indices.length / 3).toLocaleString()} triangles.`);
}

export function smoothObject(id: string, opts: SmoothOptions): void {
  const o = useStore.getState().objects.find((x) => x.id === id);
  if (!o) return;
  commit(id, smoothMesh(o.mesh, opts), 'Surface smoothed.');
}

// ------------------------------------------------------------------ edge picking

/** The edge of triangle `tri` nearest to the local-space point `p`, as a topology edge id. */
export function nearestEdge(o: SceneObject, tri: number, p: [number, number, number], angle: number): number {
  const t = buildTopology(o.mesh, angle);
  const v = o.mesh.vertices;
  let best = -1, bestD = Infinity;
  for (let k = 0; k < 3; k++) {
    const e = t.triEdges[tri * 3 + k];
    const a = t.edgeV[e * 2] * 3, b = t.edgeV[e * 2 + 1] * 3;
    const ex = v[b] - v[a], ey = v[b + 1] - v[a + 1], ez = v[b + 2] - v[a + 2];
    const l2 = ex * ex + ey * ey + ez * ez || 1;
    const u = Math.max(0, Math.min(1, ((p[0] - v[a]) * ex + (p[1] - v[a + 1]) * ey + (p[2] - v[a + 2]) * ez) / l2));
    const d = Math.hypot(p[0] - (v[a] + ex * u), p[1] - (v[a + 1] + ey * u), p[2] - (v[a + 2] + ez * u));
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

/** The run of edges a click on edge `e` selects: its crease chain, or just itself when it is not a crease (or `single`). */
export function edgeRun(o: SceneObject, e: number, angle: number, single = false): EdgePair[] {
  const t = buildTopology(o.mesh, angle);
  const ids = single || t.kind[e] !== EDGE_SHARP ? [e] : edgeChain(o.mesh, t, e, (x) => t.kind[x] === EDGE_SHARP);
  return ids.map((x) => [t.edgeV[x * 2], t.edgeV[x * 2 + 1]] as EdgePair);
}

/** Edge tool click: replace the selection with the run under the cursor, or with `add` toggle it in or out. */
export function pickEdge(objectId: string, tri: number, p: [number, number, number], opts: { add?: boolean; single?: boolean } = {}) {
  const s = useStore.getState();
  const o = s.objects.find((x) => x.id === objectId);
  if (!o) return;
  const run = edgeRun(o, nearestEdge(o, tri, p, s.edgeAngle), s.edgeAngle, opts.single);
  const key = (e: EdgePair) => (e[0] < e[1] ? `${e[0]}_${e[1]}` : `${e[1]}_${e[0]}`);
  const cur = s.edgeSel && s.edgeSel.objectId === objectId ? s.edgeSel.edges : [];
  if (!opts.add) { s.set({ edgeSel: { objectId, edges: run } }); return; }
  const have = new Set(cur.map(key));
  const allIn = run.every((e) => have.has(key(e)));
  const drop = new Set(run.map(key));
  const edges = allIn ? cur.filter((e) => !drop.has(key(e))) : [...cur, ...run.filter((e) => !have.has(key(e)))];
  s.set({ edgeSel: edges.length ? { objectId, edges } : null });
}
