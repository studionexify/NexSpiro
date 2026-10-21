// Shared fixtures for the stress suites.
import { weld } from '../../src/engine/mesh';
import { resolveConfig } from '../../src/profiles/resolve';
import type { Config, ParamDef } from '../../src/profiles/settings';
import type { MeshInput } from '../../src/engine/types';

export const PRINTER = 'bbl-a1';
export const mesh = (soup: Float32Array, name = 'part'): MeshInput => { const m = weld(soup); return { id: name, name, vertices: m.vertices, indices: m.indices }; };
export const cfgWith = (sel: { overrides?: Config; machineOverrides?: Config; filamentOverrides?: Config } = {}, printerId = PRINTER, presetId = '0.20'): Config =>
  resolveConfig({ printerId, plate: 'textured_pei_plate', filamentId: 'generic-pla', presetId, overrides: sel.overrides ?? {}, machineOverrides: sel.machineOverrides, filamentOverrides: sel.filamentOverrides });

/** Values a user can reach for a setting in the UI (inputs clamp to [min, max]): both ends, 0 when allowed, every option. */
export function edgeValues(p: ParamDef): Config[string][] {
  if (p.type === 'bool') return [!p.def];
  if (p.type === 'enum') return (p.options ?? []).map((o) => o.value).filter((v) => v !== p.def);
  if (p.type === 'string' || p.type === 'text') return [];
  if (p.type === 'floatOrPercent') return ['0', '0%', '400%', String(p.max ?? 10)];
  const vs = new Set<number>();
  if (p.min !== undefined) vs.add(p.min);
  if (p.max !== undefined) vs.add(p.max);
  if ((p.min ?? 0) <= 0) vs.add(0);
  vs.delete(p.def as number);
  return [...vs];
}

/** Seeded random numbers (Park–Miller), so a failing combination can be replayed. */
export function rng(seed: number) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
