// Runs enabled plugins over the toolpaths. Order is fixed by this list.
import type { LayerOps } from '../engine/gcode';
import type { EnginePlugin, PluginContext } from './api';
import { motionexEngine } from './motionex/engine';

export const ENGINE_PLUGINS: EnginePlugin<any, any>[] = [motionexEngine];

export interface PluginRun { header: string[]; reports: Record<string, unknown> }

export function runPlugins(layers: LayerOps[], configs: Record<string, unknown> | undefined, ctx: PluginContext): PluginRun {
  const header: string[] = [];
  const reports: Record<string, unknown> = {};
  if (!configs) return { header, reports };
  for (const p of ENGINE_PLUGINS) {
    const config = configs[p.id];
    if (config === undefined) continue;
    reports[p.id] = p.postToolpath(layers, config, ctx);
    header.push(`; plugin: ${p.name} ${p.version}`, ...(p.gcodeHeader?.(config) ?? []));
  }
  return { header, reports };
}
