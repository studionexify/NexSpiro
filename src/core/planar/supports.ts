// Support area generation for the planar slicer (Bambu/Orca-like): overhang detection, normal (column) support, tree support,
// roof/floor interfaces and raft footprints. Pure geometry: it outputs ExPoly sets per layer, the planner turns them into toolpaths.
//
// Conventions / decisions (see also the notes next to each step):
//  * Threshold angle is measured FROM VERTICAL: a layer may overhang the layer below by tan(angle)*layerHeight before it needs support.
//    support_threshold_angle = 0 means "auto" and uses 30 degrees. The angle is clamped to [1, 89].
//  * Layer i of `outlines` spans z in [layerZ[i]-layerHeights[i], layerZ[i]]. A support layer j sits under an overhang layer k when the
//    top of j is at least support_top_z_distance below the bottom of k; a support layer sits at least support_bottom_z_distance above
//    the top of any model layer below it (those layers are left empty, the support rests "through" the gap).
//  * Layer 0 uses support_object_first_layer_gap as the XY gap instead of support_object_xy_distance.
import type { ExPoly, SupportLayer, SupportResult } from "./types.ts";
import type { SettingMap } from "../settings.ts";
import * as G from "./supports-geom.ts";
import type { Paths } from "./supports-geom.ts";

export type SupportInput = {
  layerZ: number[]; layerHeights: number[]; outlines: ExPoly[][]; settings: SettingMap; nozzle: number; lineWidth: number;
  enforcers?: ExPoly[][]; blockers?: ExPoly[][];
};

const num = (s: SettingMap, k: string, d: number): number => {
  const v = s[k]; if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return d;
};
const bool = (s: SettingMap, k: string, d: boolean): boolean => { const v = s[k]; if (typeof v === "boolean") return v; if (typeof v === "string") return v === "true" || v === "1"; if (typeof v === "number") return v !== 0; return d; };
const str = (s: SettingMap, k: string, d: string): string => { const v = s[k]; return typeof v === "string" ? v : d; };

export function generateSupports(input: SupportInput): SupportResult {
  const warnings: string[] = [];
  const n = Array.isArray(input?.outlines) ? input.outlines.length : 0;
  try {
    return run(input, warnings);
  } catch (e) {
    warnings.push("Support generation failed: " + (e instanceof Error ? e.message : String(e)));
    return { layers: Array.from({ length: n }, () => ({ base: [], topInterface: [], bottomInterface: [] })), raftLayers: [], warnings };
  }
}

function run(input: SupportInput, warnings: string[]): SupportResult {
  const s = input.settings || {};
  const n = input.outlines.length;
  const lw = input.lineWidth > 0 ? input.lineWidth : input.nozzle > 0 ? input.nozzle : 0.42;
  const nozzle = input.nozzle > 0 ? input.nozzle : lw;
  const layersOut: SupportLayer[] = Array.from({ length: n }, () => ({ base: [], topInterface: [], bottomInterface: [] }));
  if (n === 0) return { layers: layersOut, raftLayers: [], warnings };

  const Z = new Array<number>(n), H = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const z = input.layerZ[i];
    const hh = input.layerHeights[i] ?? (i > 0 ? input.layerZ[i] - input.layerZ[i - 1] : z);
    H[i] = hh > 1e-6 && Number.isFinite(hh) ? hh : 0.2;
    Z[i] = Number.isFinite(z) ? z : (i > 0 ? Z[i - 1] : 0) + H[i];
  }
  const O: Paths[] = input.outlines.map((o) => G.unionAll([G.toPaths(o || [])]));
  const E: Paths[] = O.map((_, i) => (input.enforcers?.[i]?.length ? G.unionAll([G.toPaths(input.enforcers[i])]) : []));
  const B: Paths[] = O.map((_, i) => (input.blockers?.[i]?.length ? G.unionAll([G.toPaths(input.blockers[i])]) : []));

  const enable = bool(s, "enable_support", false);
  const type = str(s, "support_type", "normal(auto)");
  const isTree = type.startsWith("tree");
  const manual = type.includes("manual");
  const style = str(s, "support_style", "default");
  const onlyPlate = bool(s, "support_on_build_plate_only", false);
  const removeSmall = bool(s, "support_remove_small_overhang", true);
  let thrDeg = num(s, "support_threshold_angle", 30); if (!(thrDeg > 0)) thrDeg = 30; thrDeg = Math.min(89, Math.max(1, thrDeg));
  const thrTan = Math.tan((thrDeg * Math.PI) / 180);
  const topGap = Math.max(0, num(s, "support_top_z_distance", 0.2));
  const botGap = Math.max(0, num(s, "support_bottom_z_distance", 0.2));
  const xy = Math.max(0, num(s, "support_object_xy_distance", 0.35));
  const firstGap = Math.max(0, num(s, "support_object_first_layer_gap", 0.2));
  const expansion = num(s, "support_expansion", 0);
  const roofLayers = Math.max(0, Math.floor(num(s, "support_interface_top_layers", 2)));
  const floorLayers = Math.max(0, Math.floor(num(s, "support_interface_bottom_layers", 0)));
  const xyAt = (i: number) => (i === 0 ? firstGap : xy);

  // Number of layers directly below layer i that lie within the bottom gap of support layer i.
  const bg = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const bottom = Z[i] - H[i]; let c = 0;
    for (let j = i - 1; j >= 0 && bottom - Z[j] < botGap - 1e-6; j--) c++;
    bg[i] = c;
  }
  // Highest support layer allowed under an overhang in layer k (-1 = none).
  const topLayerFor = (k: number): number => {
    const target = Z[k] - H[k] - topGap + 1e-6; let j = k - 1;
    while (j >= 0 && Z[j] > target) j--;
    return j;
  };

  let footprintExtra: Paths = []; // support footprint on layer 0, for the raft
  if (enable && n > 1) {
    // ---- overhang detection -------------------------------------------------------------------------------------------------
    const minArea = 4 * lw * lw;
    const contact: Paths[] = new Array(n).fill(null).map(() => []);
    let anyContact = false;
    for (let k = 1; k < n; k++) {
      if (!O[k].length) continue;
      let auto: Paths = [];
      if (!manual || E[k].length) {
        const off = G.offset(O[k - 1], thrTan * H[k]);
        auto = G.opening(G.diff(O[k], off), 0.02);
        if (removeSmall) auto = G.filterSmall(auto, minArea);
      }
      let c: Paths = auto;
      if (E[k].length) { // enforcers: any model area not directly above the layer below (zero threshold) inside the enforcer volume
        const zero = G.opening(G.inter(G.diff(O[k], O[k - 1]), E[k]), 0.02);
        c = G.union(c, G.filterSmall(zero, 0.05));
      }
      if (manual) c = G.inter(c, E[k]);
      if (B[k].length) c = G.diff(c, B[k]);
      if (c.length) { contact[k] = c; anyContact = true; }
    }
    if (anyContact) {
      if (isTree) footprintExtra = treeSupport();
      else footprintExtra = normalSupport();
    }

    function offsFor(): Paths[] { return O.map((p, j) => (p.length ? G.offset(p, xyAt(j)) : [])); }

    // ---- normal support -----------------------------------------------------------------------------------------------------
    function normalSupport(): Paths {
      const offs = offsFor();
      // Contact footprints at the highest allowed support layer.
      const contacts: Paths[] = new Array(n).fill(null).map(() => []);
      for (let k = 1; k < n; k++) {
        if (!contact[k].length) continue;
        const m = topLayerFor(k); if (m < 0) continue;
        let c = contact[k];
        if (style === "snug") c = G.offset(c, expansion);
        else c = G.closing(G.offset(c, expansion + 2 * lw), 3); // grid / default: blocky, merges neighbouring islands
        if (!c.length) continue;
        contacts[m] = G.union(contacts[m], c);
      }
      // Top-down projection.
      const S: Paths[] = new Array(n).fill(null).map(() => []);
      const L: Paths[] = new Array(n).fill(null).map(() => []);
      let carry: Paths = [];
      for (let i = n - 1; i >= 0; i--) {
        const raw = G.union(carry, contacts[i]);
        if (!raw.length) { carry = []; continue; }
        const lo = Math.max(0, i - bg[i]);
        let cut: Paths = offs[i];
        for (let j = lo; j < i; j++) cut = G.union(cut, offs[j]);
        let cur = G.diff(raw, cut);
        if (B[i].length) cur = G.diff(cur, B[i]);
        if (onlyPlate) {
          let mdl: Paths = O[i]; for (let j = lo; j < i; j++) mdl = G.union(mdl, O[j]);
          L[i] = G.inter(raw, mdl);
        }
        S[i] = cur; carry = cur;
      }
      // Bottom-up: discard columns landing on the model (plate only), prune unsupported fragments, drop slivers.
      const tol = Math.max(xy, firstGap, lw * 0.5);
      let acc: Paths = [], prev: Paths = [];
      for (let i = 0; i < n; i++) {
        if (onlyPlate && L[i].length) acc = G.union(acc, L[i]);
        let cur = S[i];
        if (cur.length && onlyPlate && acc.length) cur = G.diff(cur, acc);
        if (cur.length && i > 0) {
          const rest = i - 1 - bg[i] >= 0 ? O[i - 1 - bg[i]] : [];
          cur = G.inter(cur, G.offset(G.union(prev, rest), tol));
        }
        if (cur.length) cur = G.filterSmall(G.opening(cur, 0.25 * lw * 0.5), lw * lw);
        S[i] = cur; prev = cur;
      }
      // Interfaces.
      const T = roofLayers, F = floorLayers;
      const floorSrc: Paths[] = new Array(n).fill(null).map(() => []);
      if (F > 0) for (let i = 1; i < n; i++) { const j = i - 1 - bg[i]; if (S[i].length && j >= 0 && O[j].length) floorSrc[i] = G.inter(S[i], O[j]); }
      for (let i = 0; i < n; i++) {
        if (!S[i].length) continue;
        let roof: Paths = [];
        if (T > 0) {
          const parts: Paths[] = []; for (let t = 0; t < T && i + t < n; t++) if (contacts[i + t].length) parts.push(contacts[i + t]);
          if (parts.length) roof = G.inter(S[i], G.unionAll(parts));
        }
        let floor: Paths = [];
        if (F > 0) {
          const parts: Paths[] = []; for (let b = 0; b < F && i - b >= 0; b++) if (floorSrc[i - b].length) parts.push(floorSrc[i - b]);
          if (parts.length) floor = G.inter(S[i], G.unionAll(parts));
        }
        if (roof.length) floor = G.diff(floor, roof);
        let base = S[i]; if (roof.length) base = G.diff(base, roof); if (floor.length) base = G.diff(base, floor);
        const L0 = layersOut[i];
        L0.base = G.fromPaths(base); L0.topInterface = G.fromPaths(roof); L0.bottomInterface = G.fromPaths(floor);
      }
      return S[0];
    }

    // ---- tree support -------------------------------------------------------------------------------------------------------
    // Contact points are sampled on the overhang (grid of tree_support_branch_distance + boundary), each grows a circle that widens
    // from the tip diameter downwards, steers around the model (silhouette of everything below when plate-only; sideways dodging
    // otherwise, resting on the model if it cannot), converges with neighbours at tree_support_branch_angle and merges when they overlap.
    function treeSupport(): Paths {
      type Br = { start: number; xs: number[]; ys: number[]; rs: number[]; r: number; cap: number; alive: boolean; dead: boolean; kids: number[]; nx: number; ny: number };
      const spacing = Math.max(1, num(s, "tree_support_branch_distance", 5));
      const mult = style === "tree_slim" ? 0.8 : style === "tree_strong" ? 1.25 : 1;
      const branchR = Math.max(0.3, (num(s, "tree_support_branch_diameter", 5) * mult) / 2);
      const tipR = Math.max(0.15, Math.min(branchR, num(s, "tree_support_tip_diameter", 0.8) / 2));
      const angTan = Math.tan((Math.min(85, Math.max(1, num(s, "tree_support_branch_angle", 40))) * Math.PI) / 180);
      const growth = Math.tan((5 * Math.PI) / 180);
      const capMerged = branchR * 1.5;
      const reach = spacing * 1.5;
      const roofR = Math.max(tipR, Math.min(spacing * 0.45, 2.5));
      const offsCache = new Map<number, Paths>();
      const offAt = (j: number) => { let v = offsCache.get(j); if (!v) { v = O[j].length ? G.offset(O[j], xyAt(j)) : []; offsCache.set(j, v); } return v; };

      // contacts
      type Ct = { x: number; y: number; m: number };
      const cts: Ct[] = []; const cs = spacing * 0.6; const hash = new Map<string, number[]>();
      const MAXC = 2500; let capped = false;
      for (let k = 1; k < n && !capped; k++) {
        if (!contact[k].length) continue;
        const m = topLayerFor(k); if (m < 0) continue;
        for (const isl of G.islands(contact[k])) {
          const pts: [number, number][] = [];
          const bb = G.bounds(isl); if (!bb) continue;
          for (let x = Math.ceil(bb[0] / spacing) * spacing; x <= bb[2]; x += spacing) for (let y = Math.ceil(bb[1] / spacing) * spacing; y <= bb[3]; y += spacing) if (G.contains(isl, x, y)) pts.push([x, y]);
          for (const p of G.walkRings(isl, spacing)) pts.push(p);
          const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2; if (G.contains(isl, cx, cy)) pts.push([cx, cy]);
          for (const [x, y] of pts) {
            const z = Z[m]; const ix = Math.floor(x / cs), iy = Math.floor(y / cs), iz = Math.floor(z / cs); let dup = false;
            for (let a = -1; a <= 1 && !dup; a++) for (let b = -1; b <= 1 && !dup; b++) for (let c = -1; c <= 1 && !dup; c++) {
              const l = hash.get(`${ix + a},${iy + b},${iz + c}`); if (!l) continue;
              for (const id of l) { const o = cts[id]; if (Math.hypot(o.x - x, o.y - y, Z[o.m] - z) < cs) { dup = true; break; } }
            }
            if (dup) continue;
            if (cts.length >= MAXC) { capped = true; break; }
            const key = `${ix},${iy},${iz}`; let l = hash.get(key); if (!l) { l = []; hash.set(key, l); } l.push(cts.length);
            cts.push({ x, y, m });
          }
          if (capped) break;
        }
      }
      if (capped) warnings.push(`Tree support: contact point limit (${MAXC}) reached; increase tree_support_branch_distance.`);
      if (!cts.length) return [];
      const byLayer = new Map<number, Ct[]>(); let maxM = 0;
      for (const c of cts) { let l = byLayer.get(c.m); if (!l) { l = []; byLayer.set(c.m, l); } l.push(c); if (c.m > maxM) maxM = c.m; }

      // obstacle grids (lazy)
      const hardGrids = new Map<number, G.EdgeGrid>();
      const hard = (i: number): G.EdgeGrid => {
        let g = hardGrids.get(i);
        if (!g) { let u: Paths = O[i]; for (let j = Math.max(0, i - bg[i]); j < i; j++) u = G.union(u, O[j]); g = new G.EdgeGrid(u); hardGrids.set(i, g); }
        return g;
      };
      const stride = Math.max(1, Math.ceil(n / 40));
      const silGrids: G.EdgeGrid[] = []; let silCum: Paths = [];
      const sil = (i: number): G.EdgeGrid => {
        const idx = Math.floor(i / stride);
        while (silGrids.length <= idx) {
          const upto = silGrids.length * stride;
          const parts: Paths[] = [silCum]; for (let j = Math.max(0, upto - stride + 1); j <= upto && j < n; j++) parts.push(O[j]);
          silCum = G.unionAll(parts); silGrids.push(new G.EdgeGrid(silCum, 3));
        }
        return silGrids[idx];
      };
      const free = (i: number, x: number, y: number, need: number): boolean => { const g = hard(i); return g.empty || g.clearance(x, y, need + 0.5) >= need; };

      const brs: Br[] = []; let active: number[] = []; let killed = 0; let skipped = 0;
      const kill = (id: number) => { const st = [id]; while (st.length) { const b = brs[st.pop() as number]; if (b.dead) continue; b.dead = true; b.alive = false; killed++; for (const k of b.kids) st.push(k); } };

      for (let i = maxM; i >= 0; i--) {
        // advance existing branches from layer i+1 to layer i
        const hh = H[Math.min(n - 1, i + 1)]; const maxStep = angTan * hh; const xyi = xyAt(i);
        const adv: number[] = [];
        for (const id of active) {
          const b = brs[id]; if (!b.alive) continue;
          const px = b.xs[b.xs.length - 1], py = b.ys[b.ys.length - 1];
          const rNew = Math.min(b.cap, b.r + growth * hh); const need = rNew + xyi + 0.02;
          let nx = px, ny = py;
          if (onlyPlate) {
            const g = sil(i);
            if (!g.empty) {
              const R = need + maxStep * 2 + 0.5; const ins = g.inside(px, py);
              let q = g.nearest(px, py, R); if (q.d === Infinity && ins) q = g.nearestAll(px, py);
              if (q.d !== Infinity && (ins ? -q.d : q.d) < need + 0.1) {
                const dx = ins ? q.qx - px : px - q.qx, dy = ins ? q.qy - py : py - q.qy; const L = Math.hypot(dx, dy);
                if (L > 1e-9) { const want = ins ? q.d + need + 0.1 : need + 0.1 - q.d; const st = Math.min(maxStep, want); nx = px + (dx / L) * st; ny = py + (dy / L) * st; }
              }
            }
          }
          if (!free(i, nx, ny, need)) {
            let best = -Infinity, bx = px, by = py, ok = false; const g = hard(i);
            for (const f of [0, 0.5, 1]) for (let a = 0; a < 12; a++) {
              if (f === 0 && a > 0) break;
              const cx = px + Math.cos((a / 12) * Math.PI * 2) * maxStep * f, cy = py + Math.sin((a / 12) * Math.PI * 2) * maxStep * f;
              const c = g.empty ? 1e9 : g.clearance(cx, cy, need + 0.5);
              if (c >= need && c > best) { best = c; bx = cx; by = cy; ok = true; }
            }
            if (!ok) { if (onlyPlate) kill(id); else b.alive = false; continue; }
            nx = bx; ny = by;
          }
          b.r = rNew; b.nx = nx; b.ny = ny; adv.push(id);
        }
        // converge with the nearest neighbour (within the slope budget), then record and merge
        if (adv.length > 1) {
          const grid = new Map<string, number[]>();
          for (const id of adv) { const b = brs[id]; const key = `${Math.floor(b.nx / reach)},${Math.floor(b.ny / reach)}`; let l = grid.get(key); if (!l) { l = []; grid.set(key, l); } l.push(id); }
          const moved = new Map<number, [number, number]>();
          for (const id of adv) {
            const b = brs[id]; const cx = Math.floor(b.nx / reach), cy = Math.floor(b.ny / reach);
            let bd = reach, tx = 0, ty = 0, found = false;
            for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const o of grid.get(`${cx + a},${cy + c}`) || []) {
              if (o === id) continue; const ob = brs[o]; const d = Math.hypot(ob.nx - b.nx, ob.ny - b.ny);
              if (d < bd) { bd = d; tx = ob.nx; ty = ob.ny; found = true; }
            }
            if (!found || bd < 1e-6) continue;
            const used = Math.hypot(b.nx - b.xs[b.xs.length - 1], b.ny - b.ys[b.ys.length - 1]);
            const st = Math.min(maxStep - used, bd / 2); if (st <= 1e-6) continue;
            const mx = b.nx + ((tx - b.nx) / bd) * st, my = b.ny + ((ty - b.ny) / bd) * st;
            if (free(i, mx, my, b.r + xyi + 0.02)) moved.set(id, [mx, my]);
          }
          for (const [id, p] of moved) { brs[id].nx = p[0]; brs[id].ny = p[1]; }
        }
        for (const id of adv) { const b = brs[id]; b.xs.push(b.nx); b.ys.push(b.ny); b.rs.push(b.r); }
        // absorb overlapping branches (smaller into larger)
        if (adv.length > 1) {
          const sorted = adv.slice().sort((a, b) => brs[b].r - brs[a].r);
          for (let ai = 0; ai < sorted.length; ai++) {
            const a = brs[sorted[ai]]; if (!a.alive) continue;
            for (let bi = ai + 1; bi < sorted.length; bi++) {
              const b = brs[sorted[bi]]; if (!b.alive) continue;
              if (Math.hypot(a.nx - b.nx, a.ny - b.ny) < a.r * 0.8) {
                b.alive = false; a.kids.push(sorted[bi]); a.cap = capMerged; a.r = Math.min(capMerged, Math.sqrt(a.r * a.r + b.r * b.r));
                a.rs[a.rs.length - 1] = a.r;
              }
            }
          }
        }
        active = adv.filter((id) => brs[id].alive);
        // spawn new contacts whose top layer is i
        for (const c of byLayer.get(i) || []) {
          const need = tipR + xyi + 0.02; let px = c.x, py = c.y, ok = free(i, px, py, need);
          for (let rad = 0.4; !ok && rad <= 3.01; rad += 0.4) for (let a = 0; a < 12 && !ok; a++) {
            const x = c.x + Math.cos((a / 12) * Math.PI * 2) * rad, y = c.y + Math.sin((a / 12) * Math.PI * 2) * rad;
            if (free(i, x, y, need)) { px = x; py = y; ok = true; }
          }
          if (!ok) { skipped++; continue; }
          brs.push({ start: i, xs: [px], ys: [py], rs: [tipR], r: tipR, cap: branchR, alive: i > 0, dead: false, kids: [], nx: px, ny: py });
          if (i > 0) active.push(brs.length - 1);
        }
      }
      if (killed) warnings.push(`Tree support: ${killed} branch(es) could not reach the build plate and were removed (support on build plate only).`);
      if (skipped) warnings.push(`Tree support: ${skipped} contact point(s) had no free space and were skipped.`);

      // assemble per-layer geometry
      const circ: Paths[] = new Array(n).fill(null).map(() => []);
      const roofC: Paths[] = new Array(n).fill(null).map(() => []);
      for (const b of brs) {
        if (b.dead) continue;
        for (let t = 0; t < b.xs.length; t++) {
          const layer = b.start - t; if (layer < 0) break;
          circ[layer].push(G.circle(b.xs[t], b.ys[t], b.rs[t]));
          if (t < roofLayers) roofC[layer].push(G.circle(b.xs[t], b.ys[t], Math.max(b.rs[t], roofR)));
        }
      }
      let layer0: Paths = [];
      for (let i = 0; i < n; i++) {
        if (!circ[i].length) continue;
        let base = G.unionAll([circ[i]]); let roof: Paths = [];
        if (roofC[i].length) {
          let cut: Paths = offAt(i); for (let j = Math.max(0, i - bg[i]); j < i; j++) cut = G.union(cut, offAt(j));
          roof = G.diff(G.unionAll([roofC[i]]), cut);
          if (B[i].length) roof = G.diff(roof, B[i]);
          base = G.diff(base, roof);
        }
        if (B[i].length) base = G.diff(base, B[i]);
        layersOut[i].base = G.fromPaths(base); layersOut[i].topInterface = G.fromPaths(roof);
        if (i === 0) layer0 = G.union(base, roof);
      }
      return layer0;
    }
  }

  // ---- raft -----------------------------------------------------------------------------------------------------------------
  // The raft footprint is layer 0 of the model plus the support that lands on the plate, grown by raft_expansion. Every raft layer
  // uses the same region (raftLayers[0] is the first layer). raft_layers is honoured even when enable_support is off.
  const raftN = Math.max(0, Math.min(50, Math.floor(num(s, "raft_layers", 0))));
  const raftLayers: ExPoly[][] = [];
  if (raftN > 0) {
    const fp = G.offset(G.union(O[0], footprintExtra), Math.max(0, num(s, "raft_expansion", 1.5)));
    const poly = G.fromPaths(fp);
    if (!poly.length) warnings.push("Raft requested but the first layer is empty.");
    for (let i = 0; i < raftN; i++) raftLayers.push(poly);
  }
  void nozzle;
  return { layers: layersOut, raftLayers, warnings };
}
