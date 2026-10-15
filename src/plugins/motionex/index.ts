// Motionex plugin entry: owns brush library + application list and plugs into the post-toolpath hook.
import type { NexPlugin } from "../../core/plugins.ts";
import { applyMotion, DEFAULT_OPTIONS, type ModifierOptions } from "./modifier.ts";
import { BrushLibrary, type KeyValueStore } from "./library.ts";
import type { MotionApplication } from "./model.ts";

export interface MotionexState { library: BrushLibrary; applications: MotionApplication[]; options: ModifierOptions }

export function createMotionex(store: KeyValueStore | null): { plugin: NexPlugin; state: MotionexState } {
  const state: MotionexState = { library: new BrushLibrary(store), applications: [], options: { ...DEFAULT_OPTIONS } };
  const plugin: NexPlugin = {
    id: "motionex", name: "Motionex", version: "0.1.0",
    postToolpath(layers, ctx) {
      const r = applyMotion(layers, state.applications, (id) => state.library.get(id), ctx.profiles, state.options);
      ctx.warnings.push(...r.warnings);
      return r.layers;
    },
    gcodeHeader() {
      return state.applications.filter((a) => a.enabled).map((a) => {
        const b = state.library.get(a.brush_id);
        return `; motionex: ${b?.name ?? a.brush_id} v${b?.version ?? "?"} on ${a.target.type}${a.target.ref ? ":" + a.target.ref : ""} z ${a.mask.z_start}-${a.mask.z_end}`;
      });
    },
  };
  return { plugin, state };
}

export function defaultApplication(brush_id: string): MotionApplication {
  return { brush_id, target: { type: "feature", ref: "outer_wall" }, mask: { z_start: 0.6, z_end: 1e4, fade_in_mm: 1, fade_out_mm: 0 }, order: 0, blend: "add", enabled: true };
}
