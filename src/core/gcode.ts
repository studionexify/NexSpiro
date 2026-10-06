import type { Toolpath } from "./path.ts";

export type Flavor = "marlin" | "klipper" | "bambu";
export type GcodeSettings = { flavor: Flavor; nozzleTemp: number; bedTemp: number; speed: number /*mm/s*/; fan: number /*0-1*/ };

const f = (v: number, d = 3) => v.toFixed(d).replace(/\.?0+$/, "");

function header(s: GcodeSettings): string[] {
  const h = [`; NexSpiro generated G-code (${s.flavor})`];
  if (s.flavor === "klipper") h.push(`PRINT_START EXTRUDER=${s.nozzleTemp} BED=${s.bedTemp}`);
  else if (s.flavor === "bambu") h.push(`M140 S${s.bedTemp}`, `M104 S${s.nozzleTemp}`, "G28", `M190 S${s.bedTemp}`, `M109 S${s.nozzleTemp}`);
  else h.push(`M140 S${s.bedTemp}`, `M104 S${s.nozzleTemp}`, "G28", `M190 S${s.bedTemp}`, `M109 S${s.nozzleTemp}`);
  h.push("G90", "M83", "G92 E0", `M106 S${Math.round(s.fan * 255)}`);
  return h;
}
function footer(s: GcodeSettings): string[] {
  if (s.flavor === "klipper") return ["PRINT_END"];
  return ["M107", "G91", "G1 Z10 F600", "G90", "M104 S0", "M140 S0", "M84"];
}

/** Relative extrusion (M83) output. */
export function toGcode(tp: Toolpath, s: GcodeSettings): string {
  const out = header(s);
  const { xyz, e } = tp;
  out.push(`G0 X${f(xyz[0])} Y${f(xyz[1])} Z${f(xyz[2])} F6000`);
  out.push(`G1 F${Math.round(s.speed * 60)}`);
  for (let i = 1; i < tp.count; i++) {
    out.push(`G1 X${f(xyz[i * 3])} Y${f(xyz[i * 3 + 1])} Z${f(xyz[i * 3 + 2])} E${f(e[i] - e[i - 1], 5)}`);
  }
  return [...out, ...footer(s), ""].join("\n");
}
