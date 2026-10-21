// Motionex UI-side state: motion library, applied motions and print-head shapes.
// The engine side (engine.ts) receives a plain-data snapshot of this through toConfig().
import { defaultToolhead, type CollisionMode, type ToolheadProfile } from './core/toolhead';
import { DEFAULT_OPTIONS, type ModifierOptions } from './modifier';
import { BrushLibrary, type KeyValueStore } from './library';
import type { MotionApplication } from './model';
import type { MotionexConfig } from './engine';
import type { PreviewView } from './preview';
import { defaultWeave, type WeaveSettings } from './weave/model';

export interface MotionexState {
  library: BrushLibrary;
  applications: MotionApplication[];
  options: ModifierOptions;
  /** What to do when the print head would hit the print. */
  collisionMode: CollisionMode;
  toolheads: ToolheadLibrary;
  /** What the quick preview on the model is coloured by. */
  previewView: PreviewView;
  /** Weave mode: a picture woven into the wall. */
  weave: WeaveSettings;
}

const TOOLHEAD_KEY = 'nexspiro.toolheads.v1';
const APPS_KEY = 'nexspiro.motionex.state.v1';

/** Print-head shapes saved per printer. */
export class ToolheadLibrary {
  private saved: Record<string, ToolheadProfile> = {};
  private store: KeyValueStore | null;
  constructor(store: KeyValueStore | null) {
    this.store = store;
    try { this.saved = JSON.parse(store?.getItem(TOOLHEAD_KEY) ?? '{}'); } catch { this.saved = {}; }
  }
  get(deviceId: string): ToolheadProfile { return structuredClone(this.saved[deviceId] ?? defaultToolhead(deviceId)); }
  isCustom(deviceId: string): boolean { return deviceId in this.saved; }
  save(t: ToolheadProfile): void { this.saved[t.device_id] = structuredClone(t); this.persist(); }
  reset(deviceId: string): void { delete this.saved[deviceId]; this.persist(); }
  private persist(): void { try { this.store?.setItem(TOOLHEAD_KEY, JSON.stringify(this.saved)); } catch { /* storage unavailable */ } }
}

export function createMotionexState(store: KeyValueStore | null): MotionexState {
  const state: MotionexState = {
    library: new BrushLibrary(store), applications: [], options: { ...DEFAULT_OPTIONS },
    collisionMode: 'clamp', toolheads: new ToolheadLibrary(store), previewView: 'motion', weave: defaultWeave(),
  };
  try {
    const s = JSON.parse(store?.getItem(APPS_KEY) ?? 'null');
    if (s) { state.applications = s.applications ?? []; state.options = { ...DEFAULT_OPTIONS, ...s.options }; state.collisionMode = s.collisionMode ?? 'clamp'; state.previewView = s.previewView ?? 'motion'; state.weave = loadWeave(s.weave); }
  } catch { /* fresh start */ }
  return state;
}

export function saveMotionexState(state: MotionexState, store: KeyValueStore | null): void {
  try { store?.setItem(APPS_KEY, JSON.stringify({ applications: state.applications, options: state.options, collisionMode: state.collisionMode, previewView: state.previewView, weave: state.weave })); } catch { /* storage unavailable */ }
}

/** Plain-data snapshot for the slicing worker. */
export function toConfig(state: MotionexState, printerId: string): MotionexConfig {
  const used = new Set(state.applications.filter((a) => a.enabled && !a.brush).map((a) => a.brush_id));
  return {
    applications: structuredClone(state.applications),
    brushes: [...used].map((id) => state.library.get(id)).filter((b): b is NonNullable<typeof b> => !!b).map((b) => structuredClone(b)),
    options: { ...state.options }, collisionMode: state.collisionMode,
    toolhead: state.toolheads.get(printerId), printerId,
    ...(state.weave.enabled ? { weave: structuredClone(state.weave) } : {}),
  };
}

/** Saved weave settings over the defaults (older saves have none, newer fields fall back). */
export function loadWeave(d: unknown): WeaveSettings {
  const base = defaultWeave();
  const w = d as Partial<WeaveSettings> | null | undefined;
  if (!w || typeof w !== 'object') return base;
  return { ...base, ...w, seam: { ...base.seam, ...w.seam }, change: { ...base.change, ...w.change }, image: w.image?.px?.length ? w.image : base.image };
}

export function defaultApplication(brush_id: string): MotionApplication {
  return { brush_id, target: { type: 'body', walls: 'outer' }, mask: { z_start: 0.6, z_end: 1e4, fade_in_mm: 1, fade_out_mm: 0 }, order: 0, blend: 'add', enabled: true };
}
