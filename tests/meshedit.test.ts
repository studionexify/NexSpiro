import { describe, expect, it } from 'vitest';
import { openEdgeCount, weld, type IndexedMesh } from '../src/engine/mesh';
import { buildTopology, edgeChain, featureEdges, paintBoundaryEdges, EDGE_SHARP } from '../src/engine/topology';
import { bevelEdges, hasPolygonFaces, remapTriArray, smoothMesh, subdivide, type EdgePair } from '../src/engine/meshedit';
import { parseOBJPolys } from '../src/io/obj';
import { primitive } from '../src/state/ops';

const volume = (m: IndexedMesh) => {
  const v = m.vertices, ix = m.indices;
  let s = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    s += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return s / 6;
};
/** Every directed edge appears once and has its reverse once: closed and consistently oriented. */
const oriented = (m: IndexedMesh) => {
  const d = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const key = `${m.indices[t + k]}_${m.indices[t + ((k + 1) % 3)]}`;
    d.set(key, (d.get(key) ?? 0) + 1);
  }
  for (const [key, c] of d) { const [a, b] = key.split('_'); if (c !== 1 || d.get(`${b}_${a}`) !== 1) return false; }
  return true;
};
const sharpPairs = (m: IndexedMesh, filter?: (a: number[], b: number[]) => boolean): EdgePair[] => {
  const t = buildTopology(m);
  const out: EdgePair[] = [];
  for (let e = 0; e < t.edgeCount; e++) {
    if (t.kind[e] !== EDGE_SHARP) continue;
    const a = t.edgeV[e * 2], b = t.edgeV[e * 2 + 1];
    const p = [m.vertices[a * 3], m.vertices[a * 3 + 1], m.vertices[a * 3 + 2]], q = [m.vertices[b * 3], m.vertices[b * 3 + 1], m.vertices[b * 3 + 2]];
    if (!filter || filter(p, q)) out.push([a, b]);
  }
  return out;
};
const cube = () => primitive('box', 20);

describe('topology', () => {
  it('finds the 12 crease edges of a cube and no open edges', () => {
    const m = cube();
    const t = buildTopology(m);
    expect(featureEdges(t)).toHaveLength(12);
    expect(Array.from(t.kind).filter((k) => k === EDGE_SHARP)).toHaveLength(12);
    expect(Array.from(t.convex).filter((c) => c === 1)).toHaveLength(12);
  });
  it('reports the outline between painted colours', () => {
    const m = cube();
    const paint = new Uint8Array(m.indices.length / 3);
    paint[0] = 1; paint[1] = 1; // one face (two triangles)
    const edges = paintBoundaryEdges(buildTopology(m), paint);
    expect(edges).toHaveLength(4);
  });
  it('chains a cube rim edge into its straight run', () => {
    const m = cube();
    const t = buildTopology(m);
    const sharp = new Set(featureEdges(t));
    // a cube edge has no tessellation segments, so its chain is just itself
    expect(edgeChain(m, t, [...sharp][0], (e) => sharp.has(e))).toHaveLength(1);
    // a cylinder rim is one closed chain
    const c = primitive('cylinder', 20);
    const ct = buildTopology(c);
    const cs = new Set(featureEdges(ct));
    const rim = edgeChain(c, ct, [...cs][0], (e) => cs.has(e), 40);
    expect(rim.length).toBeGreaterThanOrEqual(48);
  });
});

describe('chamfer and fillet', () => {
  it('chamfers one cube edge and stays closed and outward', () => {
    const m = cube();
    const v0 = volume(m);
    const r = bevelEdges(m, [sharpPairs(m)[0]], 2)!;
    expect(r.applied).toBe(1);
    expect(openEdgeCount(r.mesh)).toBe(0);
    expect(oriented(r.mesh)).toBe(true);
    // a chamfer of 2 along a 20 mm edge removes a 2x2/2 prism
    expect(v0 - volume(r.mesh)).toBeCloseTo(0.5 * 2 * 2 * 20, 3);
  });
  it('chamfers all 12 cube edges (three-way corners)', () => {
    const m = cube();
    const r = bevelEdges(m, sharpPairs(m), 2)!;
    expect(r.applied).toBe(12);
    expect(openEdgeCount(r.mesh)).toBe(0);
    expect(oriented(r.mesh)).toBe(true);
    const v = volume(r.mesh);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(volume(m));
    expect(r.triSource.length).toBe(r.mesh.indices.length / 3);
  });
  it('fillets all cube edges into a rounded body and removes less than the chamfer', () => {
    const m = cube();
    const ch = bevelEdges(m, sharpPairs(m), 3, 1)!;
    const fi = bevelEdges(m, sharpPairs(m), 3, 6)!;
    expect(openEdgeCount(fi.mesh)).toBe(0);
    expect(oriented(fi.mesh)).toBe(true);
    expect(fi.mesh.indices.length).toBeGreaterThan(ch.mesh.indices.length);
    expect(volume(fi.mesh)).toBeGreaterThan(volume(ch.mesh));
    expect(volume(fi.mesh)).toBeLessThan(volume(m));
  });
  it('fillets a polyline of two cube edges (two bevels meeting at a vertex)', () => {
    const m = cube();
    // the two top edges sharing the corner at max x, max y, max z
    const pairs = sharpPairs(m, (p, q) => p[2] === 10 && q[2] === 10 && (p[0] === 10 || q[0] === 10) && (p[1] === 10 || q[1] === 10) && !(p[0] === 10 && p[1] === 10 && q[0] === 10 && q[1] === 10));
    const r = bevelEdges(m, pairs, 2, 4)!;
    expect(r.applied).toBe(pairs.length);
    expect(openEdgeCount(r.mesh)).toBe(0);
    expect(oriented(r.mesh)).toBe(true);
  });
  it('fillets the rim of a cylinder', () => {
    const m = primitive('cylinder', 20);
    const t = buildTopology(m);
    const rim: EdgePair[] = featureEdges(t).filter((e) => m.vertices[t.edgeV[e * 2] * 3 + 2] > 0).map((e) => [t.edgeV[e * 2], t.edgeV[e * 2 + 1]]);
    const r = bevelEdges(m, rim, 1.5, 4)!;
    expect(openEdgeCount(r.mesh)).toBe(0);
    expect(oriented(r.mesh)).toBe(true);
    expect(volume(r.mesh)).toBeLessThan(volume(m));
  });
  it('limits the size to fit and ignores open borders', () => {
    const m = cube();
    const r = bevelEdges(m, [sharpPairs(m)[0]], 500)!;
    expect(r.size).toBeLessThan(500);
    expect(oriented(r.mesh)).toBe(true);
    expect(bevelEdges(m, [[0, 999999]], 1)).toBeNull();
  });
  it('carries paint to new triangles', () => {
    const m = cube();
    const paint = new Uint8Array(m.indices.length / 3).fill(2);
    const r = bevelEdges(m, sharpPairs(m), 2)!;
    const p2 = remapTriArray(paint, r.triSource)!;
    expect(p2.length).toBe(r.mesh.indices.length / 3);
    expect(Array.from(p2).every((x) => x === 2)).toBe(true);
  });
});

describe('subdivision and smoothing', () => {
  const quadCube = () => {
    // 6 quads, 8 vertices
    const obj = ['v -1 -1 -1', 'v 1 -1 -1', 'v 1 1 -1', 'v -1 1 -1', 'v -1 -1 1', 'v 1 -1 1', 'v 1 1 1', 'v -1 1 1',
      'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8'].join('\n');
    const { soup, groups } = parseOBJPolys(obj);
    return weld(soup, 1e-5, groups);
  };
  it('keeps quad groups through weld', () => {
    const m = quadCube();
    expect(m.indices.length / 3).toBe(12);
    expect(new Set(m.faceGroups).size).toBe(6);
    expect(hasPolygonFaces(m)).toBe(true);
    expect(hasPolygonFaces(cube())).toBe(false);
  });
  it('Catmull-Clark rounds a quad cube into a closed body', () => {
    const m = quadCube();
    const r = subdivide(m, { levels: 2, creaseDeg: 120 });
    expect(openEdgeCount(r.mesh)).toBe(0);
    expect(oriented(r.mesh)).toBe(true);
    expect(volume(r.mesh)).toBeLessThan(volume(m));
    expect(volume(r.mesh)).toBeGreaterThan(volume(m) * 0.25);
    // a ball-like body: corners pulled in
    let maxR = 0;
    for (let i = 0; i < r.mesh.vertices.length; i += 3) maxR = Math.max(maxR, Math.hypot(r.mesh.vertices[i], r.mesh.vertices[i + 1], r.mesh.vertices[i + 2]));
    expect(maxR).toBeLessThan(Math.sqrt(3) - 0.2);
    expect(r.mesh.faceGroups).toBeTruthy();
  });
  it('keeps hard edges when the crease angle is low', () => {
    const m = quadCube();
    const r = subdivide(m, { levels: 1, creaseDeg: 30 });
    let maxR = 0;
    for (let i = 0; i < r.mesh.vertices.length; i += 3) maxR = Math.max(maxR, Math.hypot(r.mesh.vertices[i], r.mesh.vertices[i + 1], r.mesh.vertices[i + 2]));
    expect(maxR).toBeCloseTo(Math.sqrt(3), 5); // corners fixed
  });
  it('Loop subdivides a triangle mesh', () => {
    const m = primitive('sphere', 20);
    const r = subdivide(m, { levels: 1, creaseDeg: 100 });
    expect(r.mesh.indices.length).toBe(m.indices.length * 4);
    expect(openEdgeCount(r.mesh)).toBe(0);
    expect(oriented(r.mesh)).toBe(true);
  });
  it('smooths without opening the mesh and keeps creases', () => {
    const m = primitive('sphere', 20);
    const r = smoothMesh(m, { iterations: 5, strength: 0.5, creaseDeg: 90 });
    expect(openEdgeCount(r.mesh)).toBe(0);
    expect(Math.abs(volume(r.mesh) - volume(m)) / volume(m)).toBeLessThan(0.05);
    const c = cube();
    const rc = smoothMesh(c, { iterations: 10 });
    expect(Array.from(rc.mesh.vertices)).toEqual(Array.from(c.vertices)); // every vertex is on a crease
  });
});

describe('edge tool actions', () => {
  it('picks a crease run, fillets it and keeps paint and the bed contact', async () => {
    const { useStore } = await import('../src/state/store');
    const { bevelSelectedEdges, pickEdge, selectCreaseEdges } = await import('../src/state/meshTools');
    const mesh = cube();
    for (let i = 2; i < mesh.vertices.length; i += 3) mesh.vertices[i] += 10; // sits on z = 0
    const paint = new Uint8Array(mesh.indices.length / 3).fill(1);
    useStore.setState({
      objects: [{ id: 'o1', name: 'cube', mesh, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], openEdges: 0, paint: { color: paint } }],
      selected: ['o1'], edgeSel: null, undoStack: [], redoStack: [],
    });
    selectCreaseEdges('o1');
    expect(useStore.getState().edgeSel!.edges).toHaveLength(12);
    pickEdge('o1', 0, [mesh.vertices[0], mesh.vertices[1], mesh.vertices[2]]);
    expect(useStore.getState().edgeSel!.edges.length).toBeGreaterThanOrEqual(1);
    selectCreaseEdges('o1');
    expect(bevelSelectedEdges(2, 5)).toBeNull();
    const o = useStore.getState().objects[0];
    expect(openEdgeCount(o.mesh)).toBe(0);
    expect(o.paint!.color!.length).toBe(o.mesh.indices.length / 3);
    expect(useStore.getState().edgeSel).toBeNull();
    expect(useStore.getState().undoStack.length).toBe(1);
  });
});
