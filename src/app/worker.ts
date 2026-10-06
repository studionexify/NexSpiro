import { buildSpiral, primitives, type PathSettings, type PrimitiveName, type PaintMask } from "../core/index.ts";

export type BuildRequest = { id: number; primitive: PrimitiveName; settings: Omit<PathSettings, "paint">; paint?: PaintMask };

self.onmessage = (ev: MessageEvent<BuildRequest>) => {
  const { id, primitive, settings, paint } = ev.data;
  const t0 = performance.now();
  const profile = primitives[primitive]();
  const tp = buildSpiral(profile, { ...settings, paint });
  const ms = performance.now() - t0;
  (self as unknown as Worker).postMessage(
    { id, xyz: tp.xyz, e: tp.e, tag: tp.tag, count: tp.count, zClipped: tp.zClipped, height: profile.height, ms },
    [tp.xyz.buffer, tp.e.buffer, tp.tag.buffer],
  );
};
