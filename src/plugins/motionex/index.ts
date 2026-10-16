// Motionex plugin entry: owns the pattern library, the list of applied patterns and the print-head
// settings, and plugs into the post-toolpath hook. The collision check runs after all patterns.
import type { NexPlugin } from "../../core/plugins.ts";
import { checkCollisions, defaultToolhead, type CollisionMode, type ToolheadProfile } from "../../core/toolhead.ts";
import { applyMotion, DEFAULT_OPTIONS, type ModifierOptions } from "./modifier.ts";
import { BrushLibrary, type KeyValueStore } from "./library.ts";
import type { MotionApplication } from "./model.ts";

export interface MotionexState {
  library: BrushLibrary;
  applications: MotionApplication[];
  options: ModifierOptions;
  /** What to do when the print head would hit the print. */
  collisionMode: CollisionMode;
  toolheads: ToolheadLibrary;
}

const TOOLHEAD_KEY = "nexspiro.toolheads.v1";

/** Print-head shapes saved per printer. */
export class ToolheadLibrary {
  private saved: Record<string, ToolheadProfile> = {};
  private store: KeyValueStore | null;
  constructor(store: KeyValueStore | null) {
    this.store = store;
    try { this.saved = JSON.parse(store?.getItem(TOOLHEAD_KEY) ?? "{}"); } catch { this.saved = {}; }
  }
  get(deviceId: string): ToolheadProfile { return structuredClone(this.saved[deviceId] ?? defaultToolhead(deviceId)); }
  isCustom(deviceId: string): boolean { return deviceId in this.saved; }
  save(t: ToolheadProfile): void { this.saved[t.device_id] = structuredClone(t); this.persist(); }
  reset(deviceId: string): void { delete this.saved[deviceId]; this.persist(); }
  private persist(): void { try { this.store?.setItem(TOOLHEAD_KEY, JSON.stringify(this.saved)); } catch { /* storage unavailable */ } }
}

export function createMotionex(store: KeyValueStore | null): { plugin: NexPlugin; state: MotionexState } {
  const state: MotionexState = {
    library: new BrushLibrary(store), applications: [], options: { ...DEFAULT_OPTIONS },
    collisionMode: "clamp", toolheads: new ToolheadLibrary(store),
  };
  const plugin: NexPlugin = {
    id: "motionex", name: "Motionex", version: "0.2.0",
    postToolpath(layers, ctx) {
      const r = applyMotion(layers, state.applications, (id) => state.library.get(id), ctx.profiles, state.options, ctx.check, ctx.regions);
      ctx.warnings.push(...r.warnings);
      // Collision pass (spec §3.4): mandatory whenever any point moves up or down.
      const moved = r.layers.some((l) => l.paths.some((p) => p.points.some((q) => q.zOff)));
      if (moved) checkCollisions(r.layers, state.toolheads.get(ctx.profiles.machine.id), ctx.profiles.machine.bed, state.collisionMode, ctx.check, (w) => ctx.warnings.push(w));
      return r.layers;
    },
    gcodeHeader() {
      return state.applications.filter((a) => a.enabled).map((a) => {
        const b = state.library.get(a.brush_id);
        return `; motionex: ${b?.name ?? a.brush_id} v${b?.version ?? "?"} on ${a.target.type}${a.target.ref ? ":" + a.target.ref : ""} z ${a.mask.z_start}-${a.mask.z_end}${a.scale && a.scale !== 1 ? ` size x${a.scale}` : ""}${a.blend === "override" ? " replace" : ""}`;
      });
    },
  };
  return { plugin, state };
}

export function defaultApplication(brush_id: string): MotionApplication {
  return { brush_id, target: { type: "feature", ref: "outer_wall" }, mask: { z_start: 0.6, z_end: 1e4, fade_in_mm: 1, fade_out_mm: 0 }, order: 0, blend: "add", enabled: true };
}
