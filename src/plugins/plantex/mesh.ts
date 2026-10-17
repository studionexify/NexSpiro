// Mesh builder. The body is a grid over (angle, meridian row): a pole at the floor centre, floor rings,
// then wall rows up to the rim. Walled bodies get a matching inner grid offset by the wall thickness,
// and a closed strip wherever a cell is removed (cut-through textures, drain holes) or at the rim, so the
// result is always a closed, consistently wound shell. Vase mode builds one closed solid instead.
import type { IndexedMesh } from '../../engine/mesh';
import type { PlantexSpec } from './model';
import { bodyFn } from './shape';
import { textureField, type Mask } from './textures';

const TAU = Math.PI * 2;

export interface BuildResult { mesh: IndexedMesh; warnings: string[]; triangles: number }

interface ShellOptions {
  N: number;
  height: number;
  /** Base radius at angle a, height z (no texture). */
  radius(a: number, z: number): number;
  /** Signed displacement along the surface normal at angle fraction u, height z. */
  disp?(u: number, z: number): number;
  /** Max wall row step (mm). */
  step: number;
  solid: boolean;
  wall: number;
  floor: number;
  /** Cell removed (walled only): wall cells get (u, z), floor cells get the cell centre (x, y). */
  cutWall?(u: number, z: number): boolean;
  cutFloor?(x: number, y: number): boolean;
  /** Raise the inner floor at (angle, ρ 0..1) by this many mm (saucer ribs). */
  floorBump?(a: number, rho: number): number;
}

function normalAt(o: ShellOptions, a: number, z: number): [number, number, number] {
  const e = 1e-3, r = o.radius(a, z);
  const ra = (o.radius(a + e, z) - o.radius(a - e, z)) / (2 * e);
  const rz = (o.radius(a, Math.min(o.height, z + e)) - o.radius(a, Math.max(0, z - e))) / ((Math.min(o.height, z + e) - Math.max(0, z - e)) || e);
  const c = Math.cos(a), s = Math.sin(a);
  // dP/da × dP/dz
  const ta = [ra * c - r * s, ra * s + r * c, 0], tz = [rz * c, rz * s, 1];
  const n: [number, number, number] = [ta[1] * tz[2] - ta[2] * tz[1], ta[2] * tz[0] - ta[0] * tz[2], ta[0] * tz[1] - ta[1] * tz[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

export function buildShell(o: ShellOptions): IndexedMesh {
  const N = o.N, H = o.height;
  const nz = Math.max(2, Math.ceil(H / o.step));
  let rMax0 = 0;
  for (let i = 0; i < N; i++) rMax0 = Math.max(rMax0, o.radius((i * TAU) / N, 0));
  const F = Math.max(4, Math.min(80, Math.ceil(rMax0 / 1.2)));
  const verts: number[] = [];
  const add = (x: number, y: number, z: number) => { verts.push(x, y, z); return verts.length / 3 - 1; };

  // outer rows: pole, floor rings 1..F-1, wall rows 0..nz, (solid) cap rings F-1..1, top pole
  type Row = { start: number; pole: boolean; kind: 'floor' | 'wall' | 'cap'; z: number; rho: number };
  const outer: Row[] = [];
  const ring = (kind: Row['kind'], z: number, rho: number, pt: (i: number) => [number, number, number]) => {
    const start = verts.length / 3;
    for (let i = 0; i < N; i++) { const p = pt(i); add(p[0], p[1], p[2]); }
    return { start, pole: false, kind, z, rho };
  };
  const ang = (i: number) => (i * TAU) / N;
  const wallPt = (i: number, z: number, inset: number, d: (u: number, z: number) => number): [number, number, number] => {
    const a = ang(i), r = o.radius(a, z), n = normalAt(o, a, z);
    const k = d(i / N, z) - inset;
    return [r * Math.cos(a) + n[0] * k, r * Math.sin(a) + n[1] * k, Math.max(0, Math.min(H, z + n[2] * k))];
  };
  const disp = o.disp ?? (() => 0);
  const none = () => 0;

  outer.push({ start: add(0, 0, 0), pole: true, kind: 'floor', z: 0, rho: 0 });
  for (let k = 1; k < F; k++) outer.push(ring('floor', 0, k / F, (i) => { const a = ang(i), r = o.radius(a, 0) * (k / F); return [r * Math.cos(a), r * Math.sin(a), 0]; }));
  const wallRow0 = outer.length;
  const wallXY: [number, number, number][][] = [];
  for (let j = 0; j <= nz; j++) {
    const z = (H * j) / nz;
    const pts = Array.from({ length: N }, (_, i) => wallPt(i, z, 0, disp));
    if (j === 0) for (const p of pts) p[2] = 0;
    if (j === nz) for (const p of pts) p[2] = H;
    wallXY.push(pts);
    outer.push(ring('wall', z, 1, (i) => pts[i]));
  }
  if (o.solid) {
    const top = wallXY[nz];
    for (let k = F - 1; k >= 1; k--) outer.push(ring('cap', H, k / F, (i) => [top[i][0] * (k / F), top[i][1] * (k / F), H]));
    outer.push({ start: add(0, 0, H), pole: true, kind: 'cap', z: H, rho: 0 });
  }

  const inner: Row[] = [];
  if (!o.solid) {
    const fl = Math.min(o.floor, H - 1);
    const zi = (z: number) => fl + (z * (H - fl)) / H;
    const iw: [number, number, number][][] = [];
    for (let j = 0; j <= nz; j++) {
      const z = zi((H * j) / nz);
      const pts = Array.from({ length: N }, (_, i) => wallPt(i, z, o.wall, none));
      for (const p of pts) p[2] = j === 0 ? fl : j === nz ? H : Math.max(fl, p[2]);
      iw.push(pts);
    }
    const bump = o.floorBump ?? (() => 0);
    inner.push({ start: add(0, 0, fl + bump(0, 0)), pole: true, kind: 'floor', z: fl, rho: 0 });
    for (let k = 1; k < F; k++) inner.push(ring('floor', fl, k / F, (i) => [iw[0][i][0] * (k / F), iw[0][i][1] * (k / F), fl + bump(ang(i), k / F)]));
    for (let j = 0; j <= nz; j++) inner.push(ring('wall', iw[j][0][2], 1, (i) => iw[j][i]));
  }

  const vid = (rows: Row[], r: number, i: number) => (rows[r].pole ? rows[r].start : rows[r].start + (((i % N) + N) % N));
  const R = outer.length;
  const cells = R - 1;
  const alive = new Uint8Array(cells * N).fill(1);
  if (!o.solid && (o.cutWall || o.cutFloor)) {
    for (let j = 0; j < cells; j++) for (let i = 0; i < N; i++) {
      const r0 = outer[j], r1 = outer[j + 1];
      if (r0.kind === 'wall' && r1.kind === 'wall') {
        if (o.cutWall?.((i + 0.5) / N, (r0.z + r1.z) / 2)) alive[j * N + i] = 0;
      } else if (o.cutFloor && j + 1 <= wallRow0) {
        const p = [vid(outer, j, i), vid(outer, j, i + 1), vid(outer, j + 1, i), vid(outer, j + 1, i + 1)];
        const x = p.reduce((s, v) => s + verts[v * 3], 0) / 4, y = p.reduce((s, v) => s + verts[v * 3 + 1], 0) / 4;
        if (o.cutFloor(x, y)) alive[j * N + i] = 0;
      }
    }
  }

  // two cells meeting only at a corner would pinch the shell there (non-manifold): fill one of the gaps
  for (let changed = true; changed;) {
    changed = false;
    for (let j = 0; j + 1 < cells; j++) for (let i = 0; i < N; i++) {
      const i1 = (i + 1) % N;
      const p = alive[j * N + i], q = alive[j * N + i1], r = alive[(j + 1) * N + i], s = alive[(j + 1) * N + i1];
      if (p === s && q === r && p !== q) { if (p) alive[j * N + i1] = 1; else alive[j * N + i] = 1; changed = true; }
    }
  }

  const idx: number[] = [];
  const tri = (a: number, b: number, c: number) => { if (a !== b && b !== c && a !== c) idx.push(a, b, c); };
  const isAlive = (j: number, i: number) => j >= 0 && j < cells && alive[j * N + (((i % N) + N) % N)] === 1;
  for (let j = 0; j < cells; j++) for (let i = 0; i < N; i++) {
    if (!alive[j * N + i]) continue;
    const a = vid(outer, j, i), b = vid(outer, j, i + 1), c = vid(outer, j + 1, i), d = vid(outer, j + 1, i + 1);
    tri(a, b, c); tri(b, d, c);
    if (o.solid) continue;
    const a2 = vid(inner, j, i), b2 = vid(inner, j, i + 1), c2 = vid(inner, j + 1, i), d2 = vid(inner, j + 1, i + 1);
    tri(a2, c2, b2); tri(b2, c2, d2);
    // boundary strips: outer loop a→b→d→c; for an open edge X→Y join to the inner copy
    const edges: [number, number, number, number, boolean][] = [
      [a, b, a2, b2, j > 0 && !isAlive(j - 1, i)],
      [b, d, b2, d2, !isAlive(j, i + 1)],
      [d, c, d2, c2, j + 1 >= cells || !isAlive(j + 1, i)],
      [c, a, c2, a2, !isAlive(j, i - 1)],
    ];
    for (const [X, Y, X2, Y2, open] of edges) {
      if (!open || X === Y) continue;
      tri(Y, X, X2); tri(Y, X2, Y2);
    }
  }
  return { vertices: Float32Array.from(verts), indices: Uint32Array.from(idx) };
}

/** Planter / vase body for a spec. `masks` resolves linked Patternex artwork. */
export function buildBody(spec: PlantexSpec, masks: (key: string) => Mask | undefined = () => undefined, draft = false): BuildResult {
  const warnings: string[] = [];
  const body = bodyFn(spec);
  const H = body.height;
  let rRef = 0;
  for (let k = 0; k <= 8; k++) rRef += body.radius(0, (H * k) / 8) / 9;
  const tex = textureField(spec, rRef, masks);
  const solid = spec.vaseMode;
  if (solid && spec.textures.some((t) => t.enabled && t.mode === 'cut')) warnings.push('Vase mode prints one closed wall: cut-through layers are debossed instead.');
  if (solid && spec.drain.enabled) warnings.push('Vase mode has a solid bottom: drain holes are left out.');
  const wall = Math.max(0.8, spec.wall);
  if (!solid && tex.maxDeboss > wall - 0.6) warnings.push(`Deboss depth ${tex.maxDeboss.toFixed(1)} mm leaves less than 0.6 mm of a ${wall} mm wall.`);
  const N = Math.max(24, Math.round((draft ? Math.min(spec.around, 160) : spec.around) / 4) * 4);
  const step = draft ? Math.max(spec.step, 1.5) : Math.max(0.2, spec.step);
  const fl = Math.max(0.8, spec.floor);
  const zLo = fl + spec.solidBase, zHi = H - spec.solidRim;
  const d = spec.drain;
  const r0 = body.radius(0, 0) - wall;
  const holes: [number, number, number][] = [];
  if (!solid && d.enabled) {
    if (d.center > 0) holes.push([0, 0, d.center / 2]);
    for (let k = 0; k < d.count; k++) {
      const a = (k * TAU) / d.count;
      holes.push([Math.cos(a) * r0 * d.ring, Math.sin(a) * r0 * d.ring, d.diameter / 2]);
    }
  }
  const mesh = buildShell({
    N, height: H, step, solid, wall, floor: fl,
    radius: body.radius,
    disp: tex.disp,
    cutWall: tex.hasCut ? (u, z) => z > zLo && z < zHi && tex.cut(u, z) : undefined,
    cutFloor: holes.length ? (x, y) => holes.some(([hx, hy, r]) => (x - hx) ** 2 + (y - hy) ** 2 < r * r) : undefined,
  });
  return { mesh, warnings, triangles: mesh.indices.length / 3 };
}

/** Saucer matching the base outline of the body. */
export function buildSaucer(spec: PlantexSpec, draft = false): BuildResult {
  const body = bodyFn(spec);
  const s = spec.saucer;
  let emb = 0;
  for (const t of spec.textures) if (t.enabled && t.mode === 'emboss' && t.z0 <= 0.05) emb = Math.max(emb, t.depth);
  const h = Math.max(s.floor + 2, s.height);
  const N = Math.max(24, Math.round((draft ? Math.min(spec.around, 160) : Math.min(spec.around, 240)) / 4) * 4);
  const ribs = Math.max(0, Math.round(s.ribs));
  const ribH = 1.6;
  const mesh = buildShell({
    N, height: h, step: draft ? 2 : 0.8, solid: false, wall: s.wall, floor: s.floor,
    radius: (a, z) => body.radius(a, 0) + emb + s.gap + s.wall + s.flare * (z / h),
    floorBump: ribs ? (a, rho) => (rho > 0.25 && rho < 0.9 && Math.abs(((a * ribs) / TAU) % 1 - 0.5) > 0.42 ? ribH : 0) : undefined,
  });
  return { mesh, warnings: [], triangles: mesh.indices.length / 3 };
}
