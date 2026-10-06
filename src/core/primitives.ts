// Parametric single-wall shapes. A profile gives the wall's cross-section at height fraction t ∈ [0,1]:
//   - bodies of revolution: radius(t) only
//   - prisms / lobed / twisted shapes: an explicit closed contour(t) (x,y pairs, CCW or CW) in addition to radius(t) (= max extent)
export type Profile = {
  name: string; height: number;
  radius: (t: number) => number;
  contour?: (t: number) => Float64Array;
  rows?: number; // display tessellation hint for contours that vary with height (default 2 = straight prism)
};

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const MIN_R = 0.4; // keeps apex shapes (sphere, cone…) printable instead of collapsing to a point

// ---- contour helpers (all closed loops, x,y interleaved) ----
const regular = (n: number, r: number, rot = 0): number[] => {
  const p: number[] = [];
  for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU; p.push(r * Math.cos(a), r * Math.sin(a)); }
  return p;
};
const rotated = (loop: number[], a: number): number[] => {
  const c = Math.cos(a), s = Math.sin(a), out: number[] = [];
  for (let i = 0; i < loop.length; i += 2) out.push(loop[i] * c - loop[i + 1] * s, loop[i] * s + loop[i + 1] * c);
  return out;
};
/** Round the corners of a polygon: each vertex is replaced by a quadratic curve cut `radius` mm into its edges. */
export function roundCorners(poly: number[], radius: number, seg = 6): number[] {
  if (radius <= 1e-6) return poly;
  const n = poly.length / 2, out: number[] = [];
  for (let i = 0; i < n; i++) {
    const V = [poly[i * 2], poly[i * 2 + 1]], P = [poly[((i + n - 1) % n) * 2], poly[((i + n - 1) % n) * 2 + 1]], N = [poly[((i + 1) % n) * 2], poly[((i + 1) % n) * 2 + 1]];
    const lp = Math.hypot(P[0] - V[0], P[1] - V[1]), ln = Math.hypot(N[0] - V[0], N[1] - V[1]);
    const d = Math.min(radius, lp / 2 - 1e-6, ln / 2 - 1e-6);
    if (d <= 0) { out.push(V[0], V[1]); continue; }
    const A = [V[0] + ((P[0] - V[0]) / lp) * d, V[1] + ((P[1] - V[1]) / lp) * d], B = [V[0] + ((N[0] - V[0]) / ln) * d, V[1] + ((N[1] - V[1]) / ln) * d];
    for (let s = 0; s <= seg; s++) {
      const u = s / seg, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
      out.push(a * A[0] + b * V[0] + c * B[0], a * A[1] + b * V[1] + c * B[1]);
    }
  }
  return out;
}
const rect = (w: number, d: number): number[] => [-w / 2, -d / 2, w / 2, -d / 2, w / 2, d / 2, -w / 2, d / 2];
const ellipse = (a: number, b: number, n = 96): number[] => { const p: number[] = []; for (let i = 0; i < n; i++) { const t = (i / n) * TAU; p.push(a * Math.cos(t), b * Math.sin(t)); } return p; };
const star = (n: number, ro: number, ri: number): number[] => { const p: number[] = []; for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * TAU - Math.PI / 2, r = i % 2 ? ri : ro; p.push(r * Math.cos(a), r * Math.sin(a)); } return p; };
const lobed = (n: number, r: number, depth: number, m = 160): number[] => { const p: number[] = []; for (let i = 0; i < m; i++) { const t = (i / m) * TAU, rr = r * (1 + depth * Math.cos(n * t)); p.push(rr * Math.cos(t), rr * Math.sin(t)); } return p; };
const heart = (s: number, m = 120): number[] => {
  const p: number[] = [];
  for (let i = 0; i < m; i++) { const t = (i / m) * TAU; p.push((s * 16 * Math.sin(t) ** 3) / 17, (s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) - s * 2) / 17); }
  return p;
};
const cross = (arm: number, w: number): number[] => { const a = arm / 2, b = w / 2; return [-b, -a, b, -a, b, -b, a, -b, a, b, b, b, b, a, -b, a, -b, b, -a, b, -a, -b, -b, -b]; };
const gear = (teeth: number, ro: number, depth: number): number[] => {
  const p: number[] = [], ri = ro - depth;
  for (let i = 0; i < teeth; i++) for (const [f, r] of [[0, ri], [0.25, ri], [0.32, ro], [0.68, ro], [0.75, ri]] as const) {
    const a = ((i + f) / teeth) * TAU; p.push(r * Math.cos(a), r * Math.sin(a));
  }
  return p;
};
const maxExtent = (l: number[]) => { let m = 0; for (let i = 0; i < l.length; i += 2) m = Math.max(m, Math.hypot(l[i], l[i + 1])); return m; };

/** Constant or twisting prism from a fixed outline. `twist` is the total rotation (deg) from bottom to top, `taper` the top/bottom scale. */
function prism(name: string, height: number, outline: number[], twist = 0, taper = 1): Profile {
  const R = maxExtent(outline), tw = (twist * Math.PI) / 180;
  const shape = (t: number) => {
    const s = lerp(1, taper, t), l = tw ? rotated(outline, tw * t) : outline;
    return Float64Array.from(l, (v) => v * s);
  };
  return { name, height, radius: (t) => R * lerp(1, taper, t), contour: shape, rows: twist ? 72 : 2 };
}
const revolve = (name: string, height: number, f: (t: number) => number): Profile => ({ name, height, radius: (t) => Math.max(MIN_R, f(Math.min(1, Math.max(0, t)))) });

// ---- catalogue ----
export type ParamDef = { key: string; label: string; min: number; max: number; step: number; def: number; unit?: string };
export type PrimitiveGroup = "Basic" | "Prisms & polygons" | "Rounded & organic" | "Revolved vessels" | "Decorative";
export type PrimitiveDef = { label: string; group: PrimitiveGroup; params: ParamDef[]; build: (p: Record<string, number>) => Profile };
const P = (key: string, label: string, def: number, min: number, max: number, step = 1, unit = "mm"): ParamDef => ({ key, label, def, min, max, step, unit });
const H = (def: number) => P("h", "Height", def, 5, 250);
const R = (def: number, key = "r", label = "Radius") => P(key, label, def, 3, 125);

export const primitiveDefs = {
  // Basic
  cube: { label: "Cube", group: "Basic", params: [P("s", "Size", 50, 5, 200), P("r", "Corner radius", 0, 0, 40)],
    build: (p) => prism("cube", p.s, roundCorners(rect(p.s, p.s), p.r)) },
  box: { label: "Box / rounded rectangle", group: "Basic", params: [P("w", "Width", 70, 5, 220), P("d", "Depth", 45, 5, 220), H(50), P("r", "Corner radius", 6, 0, 40)],
    build: (p) => prism("box", p.h, roundCorners(rect(p.w, p.d), p.r)) },
  cylinder: { label: "Cylinder", group: "Basic", params: [H(50), R(30)], build: (p) => ({ name: "cylinder", height: p.h, radius: () => p.r }) },
  sphere: { label: "Sphere", group: "Basic", params: [R(40)], build: (p) => revolve("sphere", 2 * p.r, (t) => p.r * Math.sin(Math.PI * t)) },
  hemisphere: { label: "Hemisphere / dome", group: "Basic", params: [R(50)], build: (p) => revolve("hemisphere", p.r, (t) => p.r * Math.cos((Math.PI / 2) * t)) },
  cone: { label: "Cone", group: "Basic", params: [H(70), R(35)], build: (p) => revolve("cone", p.h, (t) => p.r * (1 - t)) },
  frustum: { label: "Truncated cone", group: "Basic", params: [H(60), P("rb", "Bottom radius", 40, 3, 125), P("rt", "Top radius", 20, 1, 125)], build: (p) => revolve("frustum", p.h, (t) => lerp(p.rb, p.rt, t)) },
  capsule: { label: "Capsule / pill", group: "Basic", params: [R(25), P("l", "Straight length", 40, 0, 200)],
    build: (p) => { const H2 = 2 * p.r + p.l; return revolve("capsule", H2, (t) => { const z = t * H2; return z < p.r ? Math.sqrt(Math.max(0, p.r * p.r - (p.r - z) ** 2)) : z > p.r + p.l ? Math.sqrt(Math.max(0, p.r * p.r - (z - p.r - p.l) ** 2)) : p.r; }); } },
  ellipsoid: { label: "Ellipsoid", group: "Basic", params: [P("a", "Width radius", 50, 5, 125), P("b", "Depth radius", 30, 5, 125), P("c", "Height radius", 40, 5, 125)],
    build: (p) => { const base = (t: number) => Math.sin(Math.PI * t); const out = prism("ellipsoid", 2 * p.c, ellipse(p.a, p.b)); out.rows = 64; out.radius = (t) => Math.max(MIN_R, Math.max(p.a, p.b) * base(t)); out.contour = (t) => { const s = Math.max(0.01, base(t)); return Float64Array.from(ellipse(p.a * s, p.b * s)); }; return out; } },
  disc: { label: "Disc / coaster", group: "Basic", params: [R(50), P("h", "Height", 8, 2, 60)], build: (p) => ({ name: "disc", height: p.h, radius: () => p.r }) },
  // Prisms & polygons
  triangle: { label: "Triangular prism", group: "Prisms & polygons", params: [H(60), R(35, "r", "Circumradius"), P("c", "Corner rounding", 4, 0, 30)], build: (p) => prism("triangle", p.h, roundCorners(regular(3, p.r, Math.PI / 2), p.c)) },
  pentagon: { label: "Pentagonal prism", group: "Prisms & polygons", params: [H(60), R(35, "r", "Circumradius"), P("c", "Corner rounding", 0, 0, 30)], build: (p) => prism("pentagon", p.h, roundCorners(regular(5, p.r, Math.PI / 2), p.c)) },
  hexprism: { label: "Hexagonal prism", group: "Prisms & polygons", params: [H(60), R(35, "r", "Circumradius"), P("c", "Corner rounding", 0, 0, 30)], build: (p) => prism("hexprism", p.h, roundCorners(regular(6, p.r), p.c)) },
  octagon: { label: "Octagonal prism", group: "Prisms & polygons", params: [H(60), R(35, "r", "Circumradius"), P("c", "Corner rounding", 0, 0, 30)], build: (p) => prism("octagon", p.h, roundCorners(regular(8, p.r, Math.PI / 8), p.c)) },
  polygon: { label: "N-gon prism", group: "Prisms & polygons", params: [P("n", "Sides", 7, 3, 24, 1, ""), H(60), R(35, "r", "Circumradius"), P("c", "Corner rounding", 0, 0, 30)], build: (p) => prism("polygon", p.h, roundCorners(regular(Math.round(p.n), p.r), p.c)) },
  starprism: { label: "Star prism", group: "Prisms & polygons", params: [P("n", "Points", 5, 3, 16, 1, ""), H(60), R(40, "ro", "Outer radius"), P("ri", "Inner radius", 18, 3, 120), P("c", "Tip rounding", 1.5, 0, 12)], build: (p) => prism("starprism", p.h, roundCorners(star(Math.round(p.n), p.ro, Math.min(p.ri, p.ro - 1)), p.c, 4)) },
  crossprism: { label: "Cross / plus", group: "Prisms & polygons", params: [H(60), P("arm", "Arm length", 70, 20, 220), P("w", "Arm width", 24, 6, 100), P("c", "Corner rounding", 2, 0, 10)], build: (p) => prism("crossprism", p.h, roundCorners(cross(p.arm, Math.min(p.w, p.arm - 2)), p.c, 4)) },
  gear: { label: "Gear / cog", group: "Prisms & polygons", params: [P("n", "Teeth", 14, 6, 40, 1, ""), H(40), R(40, "r", "Outer radius"), P("d", "Tooth depth", 5, 1, 20)], build: (p) => prism("gear", p.h, gear(Math.round(p.n), p.r, Math.min(p.d, p.r - 2))) },
  // Rounded & organic
  oval: { label: "Oval / elliptic cylinder", group: "Rounded & organic", params: [H(60), P("a", "Width radius", 45, 5, 125), P("b", "Depth radius", 28, 5, 125)], build: (p) => prism("oval", p.h, ellipse(p.a, p.b)) },
  heartprism: { label: "Heart", group: "Rounded & organic", params: [H(50), P("s", "Size", 40, 10, 120)], build: (p) => prism("heartprism", p.h, heart(p.s)) },
  lobed: { label: "Flower / lobed", group: "Rounded & organic", params: [P("n", "Lobes", 6, 2, 16, 1, ""), H(60), R(35), P("d", "Lobe depth", 0.18, 0.02, 0.45, 0.01, "")], build: (p) => prism("lobed", p.h, lobed(Math.round(p.n), p.r, p.d)) },
  twisted: { label: "Twisted prism", group: "Rounded & organic", params: [P("n", "Sides", 4, 3, 12, 1, ""), H(90), R(32, "r", "Circumradius"), P("tw", "Twist", 120, -360, 360, 5, "°"), P("tp", "Top scale", 1, 0.3, 1.6, 0.05, "×")], build: (p) => prism("twisted", p.h, regular(Math.round(p.n), p.r, Math.PI / 4), p.tw, p.tp) },
  egg: { label: "Egg", group: "Rounded & organic", params: [P("h", "Height", 80, 20, 240), R(32)], build: (p) => revolve("egg", p.h, (t) => p.r * Math.sin(Math.PI * Math.pow(t, 0.8)) * lerp(1, 0.78, t)) },
  teardrop: { label: "Teardrop", group: "Rounded & organic", params: [P("h", "Height", 100, 30, 240), R(32)], build: (p) => revolve("teardrop", p.h, (t) => p.r * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 1.2) * (1 - 0.6 * t)) },
  bullet: { label: "Bullet / ogive", group: "Rounded & organic", params: [P("h", "Height", 90, 20, 240), R(30)], build: (p) => revolve("bullet", p.h, (t) => (t < 0.55 ? p.r : p.r * Math.cos(((t - 0.55) / 0.45) * (Math.PI / 2)) ** 0.8)) },
  // Revolved vessels
  vase: { label: "Vase", group: "Revolved vessels", params: [P("h", "Height", 120, 20, 250), P("rb", "Base radius", 35, 5, 125), P("rbelly", "Belly radius", 50, 5, 125), P("rn", "Neck radius", 25, 3, 125)], build: (p) => revolve("vase", p.h, (t) => p.rb + (p.rbelly - p.rb) * Math.sin(Math.PI * t) + (p.rn - p.rb) * t) },
  bowl: { label: "Bowl", group: "Revolved vessels", params: [P("h", "Height", 60, 10, 200), P("rb", "Base radius", 40, 5, 125), P("rr", "Rim radius", 100, 10, 125)], build: (p) => revolve("bowl", p.h, (t) => p.rb + (p.rr - p.rb) * Math.sqrt(t)) },
  shade: { label: "Pendant shade", group: "Revolved vessels", params: [P("h", "Height", 140, 20, 250), P("rt", "Top radius", 18, 3, 125), P("rbot", "Bottom radius", 60, 5, 125)], build: (p) => revolve("shade", p.h, (t) => p.rt + (p.rbot - p.rt) * Math.pow(Math.cos((t * Math.PI) / 2), 1.6)) },
  cup: { label: "Cup / tumbler", group: "Revolved vessels", params: [P("h", "Height", 90, 20, 250), P("rb", "Base radius", 28, 5, 125), P("rt", "Rim radius", 38, 5, 125)], build: (p) => revolve("cup", p.h, (t) => lerp(p.rb, p.rt, t) * (t < 0.06 ? 0.85 + 2.5 * t : 1)) },
  goblet: { label: "Goblet", group: "Revolved vessels", params: [P("h", "Height", 150, 40, 250), P("rc", "Cup radius", 38, 8, 125), P("rs", "Stem radius", 6, 3, 40), P("rf", "Foot radius", 34, 8, 125)],
    build: (p) => revolve("goblet", p.h, (t) => (t < 0.12 ? lerp(p.rf, p.rs, t / 0.12) : t < 0.45 ? p.rs : lerp(p.rs, p.rc, Math.sin(((t - 0.45) / 0.55) * (Math.PI / 2))) * (t > 0.92 ? 1 - (t - 0.92) * 0.8 : 1))) },
  bottle: { label: "Bottle", group: "Revolved vessels", params: [P("h", "Height", 180, 40, 250), R(32, "r", "Body radius"), P("rn", "Neck radius", 11, 4, 60)], build: (p) => revolve("bottle", p.h, (t) => (t < 0.6 ? p.r : t < 0.78 ? lerp(p.r, p.rn, Math.sin(((t - 0.6) / 0.18) * (Math.PI / 2))) : p.rn)) },
  hourglass: { label: "Hourglass", group: "Revolved vessels", params: [P("h", "Height", 110, 30, 250), R(38, "r", "End radius"), P("rw", "Waist radius", 10, 3, 60)], build: (p) => revolve("hourglass", p.h, (t) => lerp(p.rw, p.r, (2 * t - 1) ** 2)) },
  urn: { label: "Urn / amphora", group: "Revolved vessels", params: [P("h", "Height", 130, 30, 250), R(42, "r", "Belly radius"), P("rn", "Neck radius", 16, 4, 80)], build: (p) => revolve("urn", p.h, (t) => lerp(p.rn, p.r, Math.sin(Math.PI * Math.min(1, t * 1.1)) ** 0.7) * (t < 0.08 ? 0.6 + 5 * t : 1) * (t > 0.9 ? 1 + (t - 0.9) * 2 : 1)) },
  bell: { label: "Bell", group: "Revolved vessels", params: [P("h", "Height", 100, 30, 250), R(50, "r", "Mouth radius")], build: (p) => revolve("bell", p.h, (t) => p.r * (0.25 + 0.75 * Math.pow(1 - t, 0.55)) * (t < 0.1 ? 1.1 - t : 1) ) },
  pot: { label: "Flared planter", group: "Revolved vessels", params: [P("h", "Height", 80, 20, 250), P("rb", "Base radius", 30, 5, 125), P("rt", "Rim radius", 48, 5, 125)], build: (p) => revolve("pot", p.h, (t) => lerp(p.rb, p.rt, t * t * 0.4 + t * 0.6)) },
  // Decorative
  onion: { label: "Onion dome", group: "Decorative", params: [P("h", "Height", 110, 30, 250), R(40, "r", "Belly radius")], build: (p) => revolve("onion", p.h, (t) => p.r * (t < 0.55 ? Math.sin(Math.PI * (t / 0.55) * 0.5 + 0.12) : Math.max(0.03, Math.cos(((t - 0.55) / 0.45) * (Math.PI / 2)) ** 1.4))) },
  top: { label: "Spinning top / diamond", group: "Decorative", params: [P("h", "Height", 90, 20, 250), R(40, "r", "Equator radius"), P("e", "Equator height", 0.6, 0.15, 0.85, 0.01, "")], build: (p) => revolve("top", p.h, (t) => (t < p.e ? p.r * (t / p.e) : p.r * (1 - t) / (1 - p.e))) },
  lantern: { label: "Barrel / lantern", group: "Decorative", params: [P("h", "Height", 100, 20, 250), R(35, "r", "Belly radius"), P("rn", "End radius", 24, 5, 125)], build: (p) => revolve("lantern", p.h, (t) => lerp(p.rn, p.r, Math.sin(Math.PI * t))) },
  cooling: { label: "Cooling tower", group: "Decorative", params: [P("h", "Height", 110, 30, 250), P("rb", "Base radius", 50, 10, 125), P("rw", "Waist radius", 30, 5, 125)], build: (p) => revolve("cooling", p.h, (t) => lerp(p.rb, p.rw, Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.9) * (1 + 0.12 * t * t)) },
  ripple: { label: "Ripple vase", group: "Decorative", params: [P("h", "Height", 120, 30, 250), R(34, "r", "Mean radius"), P("a", "Ripple depth", 7, 0, 20), P("n", "Ripples", 4, 1, 12, 1, "")], build: (p) => revolve("ripple", p.h, (t) => p.r + p.a * Math.sin(p.n * TAU * t) * Math.sin(Math.PI * t) ** 0.5) },
} satisfies Record<string, PrimitiveDef>;
export type PrimitiveName = keyof typeof primitiveDefs;
export const PRIMITIVE_GROUPS: PrimitiveGroup[] = ["Basic", "Prisms & polygons", "Rounded & organic", "Revolved vessels", "Decorative"];
export const primitiveDefaults = (name: PrimitiveName): Record<string, number> => Object.fromEntries((primitiveDefs[name] as PrimitiveDef).params.map((p) => [p.key, p.def]));
/** Build a primitive from its (partial) parameter set; unknown/missing keys fall back to the defaults and values are clamped to range. */
export function buildPrimitive(name: PrimitiveName, params: Record<string, number> = {}): Profile {
  const def = primitiveDefs[name] as PrimitiveDef, p: Record<string, number> = {};
  for (const d of def.params) { const v = Number(params[d.key]); p[d.key] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : d.def; }
  return def.build(p);
}

// Legacy positional factories (kept for the engine tests and callers that pass a Profile directly).
export const primitives = {
  vase: (height = 120, rBase = 35, rBelly = 50, rNeck = 25): Profile => primitiveDefs.vase.build({ h: height, rb: rBase, rbelly: rBelly, rn: rNeck }),
  bowl: (height = 60, rBase = 40, rRim = 100): Profile => primitiveDefs.bowl.build({ h: height, rb: rBase, rr: rRim }),
  shade: (height = 140, rTop = 18, rBottom = 60): Profile => primitiveDefs.shade.build({ h: height, rt: rTop, rbot: rBottom }),
  cylinder: (height = 50, r = 30): Profile => primitiveDefs.cylinder.build({ h: height, r }),
};
