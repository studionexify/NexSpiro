import type { Toolpath } from "./path.ts";
import type { MachinePreset, FilamentPreset, ProcessPreset } from "./presets.ts";

// Motion planning for the non-linear spiral: point decimation, curvature, feedrate limits
// (volumetric, cornering, Z-axis speed), acceleration smoothing, per-layer cooling slowdown & fan.
export type MotionPath = {
  count: number;
  xyz: Float32Array;     // kept points
  e: Float64Array;       // cumulative E (mm filament, before flow ratio)
  tag: Uint8Array;       // paint region tag
  layer: Uint32Array;    // layer index per point
  feed: Float32Array;    // mm/s for the move ending at point i (feed[0] unused)
  curvature: Float32Array; // 1/mm at point i
  layerTime: Float32Array; // s per layer after slowdown
  layerFan: Uint8Array;    // 0..100 % per layer
  time: number;            // s, extrusion moves only
  inclinationViolations: number;
  decimated: number;       // points removed by deviation tolerance
};

export type MotionInput = { machine: MachinePreset; filament: FilamentPreset; process: ProcessPreset };

function pointLineDist(xyz: Float32Array, a: number, b: number, p: number): number {
  const ax = xyz[a * 3], ay = xyz[a * 3 + 1], az = xyz[a * 3 + 2];
  const dx = xyz[b * 3] - ax, dy = xyz[b * 3 + 1] - ay, dz = xyz[b * 3 + 2] - az;
  const px = xyz[p * 3] - ax, py = xyz[p * 3 + 1] - ay, pz = xyz[p * 3 + 2] - az;
  const L2 = dx * dx + dy * dy + dz * dz;
  if (L2 === 0) return Math.hypot(px, py, pz);
  const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / L2));
  return Math.hypot(px - t * dx, py - t * dy, pz - t * dz);
}

export function planMotion(tp: Toolpath, segmentsPerRev: number, { machine, filament, process }: MotionInput): MotionPath {
  const nl = process.nonLinear;
  // 1. Decimate within deviation tolerance (never across paint-region or layer boundaries).
  const keep: number[] = [0];
  const tol = Math.max(0, nl.deviationTol);
  for (let i = 1; i < tp.count - 1; i++) {
    const a = keep[keep.length - 1];
    let ok = tol > 0 && tp.tag[i] === tp.tag[a] && Math.floor(i / segmentsPerRev) === Math.floor(a / segmentsPerRev) && i - a < 64;
    for (let j = a + 1; ok && j <= i; j++) ok = pointLineDist(tp.xyz, a, i + 1, j) <= tol;
    if (!ok) keep.push(i);
  }
  keep.push(tp.count - 1);
  const n = keep.length;
  const xyz = new Float32Array(n * 3), e = new Float64Array(n), tag = new Uint8Array(n), layer = new Uint32Array(n);
  keep.forEach((src, k) => {
    xyz[k * 3] = tp.xyz[src * 3]; xyz[k * 3 + 1] = tp.xyz[src * 3 + 1]; xyz[k * 3 + 2] = tp.xyz[src * 3 + 2];
    e[k] = tp.e[src]; tag[k] = tp.tag[src]; layer[k] = Math.floor(src / segmentsPerRev);
  });

  // 2. Segment geometry, curvature, raw feed limits.
  const len = new Float32Array(n), curvature = new Float32Array(n), feed = new Float32Array(n);
  const filArea = Math.PI * (filament.diameter / 2) ** 2;
  const maxSlope = Math.tan((nl.maxInclination * Math.PI) / 180);
  let inclinationViolations = 0;
  for (let i = 1; i < n; i++) {
    const dx = xyz[i * 3] - xyz[i * 3 - 3], dy = xyz[i * 3 + 1] - xyz[i * 3 - 2], dz = xyz[i * 3 + 2] - xyz[i * 3 - 1];
    const L = Math.hypot(dx, dy, dz), xy = Math.hypot(dx, dy);
    len[i] = L;
    if (xy > 0 && Math.abs(dz) / xy > maxSlope) inclinationViolations++;
    let v = layer[i] === 0 ? process.firstLayerSpeed : process.wallSpeed;
    const volPerMm = L > 0 ? ((e[i] - e[i - 1]) * filArea * filament.flowRatio) / L : 0; // mm³ per mm of travel
    if (volPerMm > 0) v = Math.min(v, filament.maxVolumetric / volPerMm);
    if (Math.abs(dz) > 1e-6 && L > 0) v = Math.min(v, (machine.maxZSpeed * L) / Math.abs(dz));
    feed[i] = v;
  }
  for (let i = 1; i < n - 1; i++) {
    const ax = xyz[i * 3] - xyz[i * 3 - 3], ay = xyz[i * 3 + 1] - xyz[i * 3 - 2], az = xyz[i * 3 + 2] - xyz[i * 3 - 1];
    const bx = xyz[i * 3 + 3] - xyz[i * 3], by = xyz[i * 3 + 4] - xyz[i * 3 + 1], bz = xyz[i * 3 + 5] - xyz[i * 3 + 2];
    const la = len[i], lb = len[i + 1];
    if (la === 0 || lb === 0) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)));
    const k = Math.acos(cos) / ((la + lb) / 2);
    curvature[i] = k;
    if (k > 0) feed[i + 1] = Math.min(feed[i + 1], Math.sqrt(machine.maxAccel / k)); // centripetal a = v²κ
  }

  // 3. Acceleration-limited smoothing (forward + backward pass). zSmoothing lowers effective accel.
  const a = machine.maxAccel * (1 - 0.9 * Math.min(1, Math.max(0, nl.zSmoothing)));
  feed[0] = feed[1] || process.firstLayerSpeed;
  for (let i = 1; i < n; i++) feed[i] = Math.min(feed[i], Math.sqrt(feed[i - 1] ** 2 + 2 * a * len[i]));
  for (let i = n - 2; i >= 1; i--) feed[i] = Math.min(feed[i], Math.sqrt(feed[i + 1] ** 2 + 2 * a * len[i + 1]));

  // 4. Per-layer cooling: slow layers that print faster than slowdownLayerTime; fan by layer time.
  const layers = layer[n - 1] + 1;
  const layerTime = new Float32Array(layers), layerFan = new Uint8Array(layers);
  const start = new Uint32Array(layers + 1).fill(n); // layer index is monotonic → contiguous ranges
  for (let i = n - 1; i >= 1; i--) start[layer[i]] = i;
  for (let L = layers - 1; L >= 0; L--) start[L] = Math.min(start[L], start[L + 1]);
  for (let i = 1; i < n; i++) layerTime[layer[i]] += len[i] / feed[i];
  for (let L = 0; L < layers; L++) {
    const t = layerTime[L];
    if (t > 0 && t < filament.slowdownLayerTime) {
      const f = t / filament.slowdownLayerTime;
      layerTime[L] = 0;
      for (let i = start[L]; i < start[L + 1]; i++) {
        feed[i] = Math.max(Math.min(feed[i], filament.minSpeed), feed[i] * f);
        layerTime[L] += len[i] / feed[i];
      }
    }
    layerFan[L] = L < filament.fanOffFirstLayers ? 0
      : layerTime[L] < filament.fanMaxBelowLayerTime ? filament.fanMax : filament.fanMin;
  }
  const time = layerTime.reduce((s, t) => s + t, 0);
  return { count: n, xyz, e, tag, layer, feed, curvature, layerTime, layerFan, time, inclinationViolations, decimated: tp.count - n };
}
