// Runs enabled plugins. Order is fixed by this list: Patternex shifts change points after Motionex
// has changed path lengths (spec §8), so it comes last.
import type { LayerOps } from '../engine/gcode';
import type { EnginePlugin, PluginContext, PluginSession, PrepareContext } from './api';
import { motionexEngine } from './motionex/engine';
import { patternexEngine } from './patternex/engine';

export const ENGINE_PLUGINS: EnginePlugin<any, any>[] = [motionexEngine, patternexEngine];

export interface PluginRun { header: string[]; reports: Record<string, unknown> }
export type Sessions = Map<string, PluginSession>;

export function preparePlugins(configs: Record<string, unknown> | undefined, ctx: PrepareContext): Sessions {
  const out: Sessions = new Map();
  if (!configs) return out;
  for (const p of ENGINE_PLUGINS) {
    const config = configs[p.id];
    if (config === undefined || !p.prepare) continue;
    const s = p.prepare(config, ctx);
    if (s) out.set(p.id, s);
  }
  return out;
}

export function runPlugins(layers: LayerOps[], configs: Record<string, unknown> | undefined, ctx: Omit<PluginContext, 'session' | 'sharedRegions'>, sessions: Sessions = new Map()): PluginRun {
  const header: string[] = [];
  const reports: Record<string, unknown> = {};
  if (!configs) return { header, reports };
  const sharedRegions = [...sessions.values()].flatMap((s) => s.sharedRegions?.() ?? []);
  for (const p of ENGINE_PLUGINS) {
    const config = configs[p.id];
    if (config === undefined) continue;
    reports[p.id] = p.postToolpath(layers, config, { ...ctx, sharedRegions, session: sessions.get(p.id) });
    header.push(`; plugin: ${p.name} ${p.version}`, ...(p.gcodeHeader?.(config) ?? []));
  }
  return { header, reports };
}
