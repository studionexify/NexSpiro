import type { MotionPath } from "../../core/motion.ts";

export const TRAJECTORY_COLUMNS = ["object", "i", "x", "y", "z", "e", "f", "nx", "ny", "nz", "curvature", "layer", "tag", "z_offset"] as const;

/** Raw toolpath dump for external verification. e = cumulative filament (mm), f = mm/s, curvature = 1/mm. */
export function trajectoryCSV(mps: MotionPath[], offset: [number, number] = [0, 0]): string {
  const rows: string[] = [TRAJECTORY_COLUMNS.join(",")];
  mps.forEach((mp, o) => {
    for (let i = 0; i < mp.count; i++) rows.push([
      o, i, (mp.xyz[i * 3] + offset[0]).toFixed(4), (mp.xyz[i * 3 + 1] + offset[1]).toFixed(4), mp.xyz[i * 3 + 2].toFixed(4),
      mp.e[i].toFixed(5), mp.feed[i].toFixed(3), mp.normal[i * 3].toFixed(5), mp.normal[i * 3 + 1].toFixed(5), mp.normal[i * 3 + 2].toFixed(5),
      mp.curvature[i].toExponential(4), mp.layer[i], mp.tag[i], mp.zOff[i].toFixed(4),
    ].join(","));
  });
  return rows.join("\n") + "\n";
}

export function trajectoryJSON(mps: MotionPath[], offset: [number, number] = [0, 0]): string {
  return JSON.stringify({
    format: "nexspiro-trajectory", version: 1, units: { length: "mm", feed: "mm/s", curvature: "1/mm" },
    objects: mps.map((mp) => ({
      count: mp.count,
      x: Array.from(mp.xyz.filter((_, i) => i % 3 === 0), (v) => v + offset[0]),
      y: Array.from(mp.xyz.filter((_, i) => i % 3 === 1), (v) => v + offset[1]),
      z: Array.from(mp.xyz.filter((_, i) => i % 3 === 2)),
      e: Array.from(mp.e), f: Array.from(mp.feed), normal: Array.from(mp.normal), curvature: Array.from(mp.curvature),
      layer: Array.from(mp.layer), tag: Array.from(mp.tag), zOffset: Array.from(mp.zOff),
    })),
  });
}
