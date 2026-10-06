// Turns SupportResult areas (and raft layers) into extrusion paths.
import { Feature, type ExPoly, type Path, type SupportLayer } from "./types.ts";
import { diffPolys, offsetPolys } from "./geom.ts";
import { fillPolys, orderLines, type FillLine } from "./infill.ts";
import type { Cfg } from "./slicecfg.ts";

export function linesToPaths(lines: FillLine[], z: number, base: Omit<Path, "xyz" | "closed">): Path[] {
  const out: Path[] = [];
  for (const l of lines) {
    const n = l.pts.length >> 1; if (n < 2) continue;
    const xyz = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { xyz[3 * i] = l.pts[2 * i]; xyz[3 * i + 1] = l.pts[2 * i + 1]; xyz[3 * i + 2] = z; }
    out.push({ ...base, xyz, closed: l.closed });
  }
  return out;
}

export function supportLayerPaths(sl: SupportLayer, layer: number, z: number, h: number, obj: number, cfg: Cfg, pos: { x: number; y: number }, first: boolean): Path[] {
  const w = cfg.n("support_line_width") || 0.42, out: Path[] = [];
  const angle = cfg.n("support_angle");
  const sp = cfg.n("support_base_pattern_spacing"), isp = cfg.n("support_interface_spacing");
  const spd = first ? Math.min(cfg.n("support_speed"), cfg.n("initial_layer_infill_speed")) : cfg.n("support_speed");
  const ispd = first ? Math.min(cfg.n("support_interface_speed"), cfg.n("initial_layer_infill_speed")) : cfg.n("support_interface_speed");
  const emit = (polys: ExPoly[], feature: number, speed: number, o: Parameters<typeof fillPolys>[1]) => {
    for (const p of polys) {
      const o2 = orderLines(fillPolys([p], o), pos.x, pos.y); pos.x = o2.x; pos.y = o2.y;
      out.push(...linesToPaths(o2.lines, z, { feature: feature as Path["feature"], obj, width: w, height: h, flow: 1, speed }));
    }
  };
  const ifaces = [...sl.topInterface, ...sl.bottomInterface];
  const base = ifaces.length ? diffPolys(sl.base, ifaces) : sl.base;
  const bp = cfg.s("support_base_pattern");
  if (base.length) {
    const pitch = sp > 0 ? sp + w : w;
    // outline loop
    const loops = offsetPolys(base, -w / 2);
    for (const p of loops) {
      const rings = [p.outer, ...p.holes];
      for (const r of rings) if (r.length >= 6) out.push(...linesToPaths([{ pts: r, closed: true }], z, { feature: Feature.Support, obj, width: w, height: h, flow: 1, speed: spd }));
    }
    if (bp !== "hollow") {
      const inner = offsetPolys(base, -w * 1.0);
      const pat = bp === "rectilinear-grid" ? "grid" : bp === "honeycomb" ? "honeycomb" : "line";
      const o = { pattern: pat, width: w, density: Math.min(1, w / pitch), angle, layer, z, pitch: pat === "grid" ? pitch / 2 : pat === "line" ? pitch : undefined } as Parameters<typeof fillPolys>[1];
      emit(inner, Feature.Support, spd, sp > 0 ? o : { ...o, pattern: "zig-zag", density: 1, pitch: w });
    }
  }
  const ip = cfg.s("support_interface_pattern");
  const iPat = ip === "concentric" ? "concentric" : ip === "grid" ? "grid" : "line";
  const ipitch = isp > 0 ? isp + w : w;
  for (const area of [sl.topInterface, sl.bottomInterface]) {
    if (!area.length) continue;
    const o = { pattern: isp > 0 ? iPat : ip === "concentric" ? "concentric" : "zig-zag", width: w, density: Math.min(1, w / ipitch), angle: angle + 90, layer, z, pitch: iPat === "grid" ? ipitch / 2 : ipitch } as Parameters<typeof fillPolys>[1];
    emit(area, Feature.SupportInterface, ispd, o);
  }
  return out;
}

export function raftLayerPaths(area: ExPoly[], idx: number, z: number, h: number, obj: number, cfg: Cfg, pos: { x: number; y: number }): Path[] {
  const w = idx === 0 ? cfg.n("initial_layer_line_width") : cfg.n("support_line_width") || 0.42;
  const dens = idx === 0 ? Math.max(0.1, cfg.n("raft_first_layer_density") / 100) : 1;
  const speed = idx === 0 ? cfg.n("initial_layer_infill_speed") : cfg.n("support_interface_speed");
  const out: Path[] = [];
  for (const p of offsetPolys(area, -w / 2)) for (const r of [p.outer, ...p.holes]) if (r.length >= 6) out.push(...linesToPaths([{ pts: r, closed: true }], z, { feature: Feature.Raft, obj, width: w, height: h, flow: 1, speed }));
  const inner = offsetPolys(area, -w);
  for (const p of inner) {
    const o = orderLines(fillPolys([p], { pattern: "zig-zag", width: w, density: dens, angle: cfg.n("support_angle") + 90 * (idx & 1), layer: 0, z }), pos.x, pos.y);
    pos.x = o.x; pos.y = o.y;
    out.push(...linesToPaths(o.lines, z, { feature: Feature.Raft, obj, width: w, height: h, flow: 1, speed }));
  }
  return out;
}
