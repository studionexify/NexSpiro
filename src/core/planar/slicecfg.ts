// Typed accessors over a resolved SettingMap (falls back to the schema default / legacy preset field).
import { getSetting, type SettingMap } from "../settings.ts";

export type Cfg = { n(key: string): number; b(key: string): boolean; s(key: string): string; map: SettingMap };
export function makeCfg(process: unknown, settings: SettingMap | undefined): Cfg {
  const raw = (k: string) => getSetting(process, k, settings);
  return {
    map: settings ?? {},
    n: (k) => { const v = Number(raw(k)); return Number.isFinite(v) ? v : 0; },
    b: (k) => { const v = raw(k); return v === true || v === "true" || v === 1 || v === "1"; },
    s: (k) => String(raw(k)),
  };
}
/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
