// Nexspiro plugin API.
// Stage order (spec §6): slice → computeExtrusion (base) → postToolpath hooks → computeExtrusion (final) → emit.
// Plugins mutate toolpath geometry, feedrate and flow; extrusion is recomputed afterwards from the real 3D length.
import type { Layer, SliceWarning } from "./types.ts";
import type { PrintProfiles } from "./profiles.ts";

export interface HookContext { profiles: PrintProfiles; warnings: SliceWarning[] }

export interface NexPlugin {
  id: string;
  name: string;
  version: string;
  /** Post-toolpath, pre-G-code. Returns the modified layers (may be the same array). */
  postToolpath?(layers: Layer[], ctx: HookContext): Layer[];
  /** Extra lines for the G-code header (comments only). */
  gcodeHeader?(): string[];
}

export class PluginHost {
  private plugins: NexPlugin[] = [];
  register(p: NexPlugin): void {
    if (this.plugins.some((q) => q.id === p.id)) throw new Error(`plugin ${p.id} already registered`);
    this.plugins.push(p);
  }
  unregister(id: string): void { this.plugins = this.plugins.filter((p) => p.id !== id); }
  list(): readonly NexPlugin[] { return this.plugins; }
  runPostToolpath(layers: Layer[], ctx: HookContext): Layer[] {
    for (const p of this.plugins) if (p.postToolpath) layers = p.postToolpath(layers, ctx);
    return layers;
  }
  headerLines(): string[] { return this.plugins.flatMap((p) => [`; plugin: ${p.name} ${p.version}`, ...(p.gcodeHeader?.() ?? [])]); }
}
