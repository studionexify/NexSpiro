// Workspace-shell UI state for the redesigned layout (pins, inspector context, command palette) and
// the read-only view models the shell and inspector render (intent presets, effects, clearance, summary).
// CONTRACT: the shell and inspector import only from here; the bindings below are filled in against the
// real store, advanced state and plugins. Signatures are fixed; implementations may change.
import { create } from 'zustand';

export type InspectorContext = 'plate' | 'object';

export interface UiState {
  /** Inspector shows the selection's object view, or the plate view. Derived default: 'object' when something is selected. */
  inspectorCtx: InspectorContext;
  /** Process setting keys pinned to the top of the inspector (PROCESS_PARAMS keys). */
  pinnedParams: string[];
  /** Plugin ids pinned to the left rail. */
  pinnedPlugins: string[];
  paletteOpen: boolean;
  set: (p: Partial<UiState>) => void;
  togglePinParam: (key: string) => void;
  togglePinPlugin: (id: string) => void;
}

const LS = 'nexspiro.ui.v1';
const prefs: Partial<UiState> = (() => { try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); } catch { return {}; } })();

export const useUi = create<UiState>((set, get) => ({
  inspectorCtx: 'object',
  pinnedParams: Array.isArray(prefs.pinnedParams) ? prefs.pinnedParams : ['wall_loops', 'sparse_infill_density', 'outer_wall_speed'],
  pinnedPlugins: Array.isArray(prefs.pinnedPlugins) ? prefs.pinnedPlugins : [],
  paletteOpen: false,
  set: (p) => set(p),
  togglePinParam: (key) => { const l = get().pinnedParams; set({ pinnedParams: l.includes(key) ? l.filter((k) => k !== key) : [...l, key] }); },
  togglePinPlugin: (id) => { const l = get().pinnedPlugins; set({ pinnedPlugins: l.includes(id) ? l.filter((k) => k !== id) : [...l, id] }); },
}));
useUi.subscribe((s) => { try { localStorage.setItem(LS, JSON.stringify({ pinnedParams: s.pinnedParams, pinnedPlugins: s.pinnedPlugins })); } catch { /* storage off */ } });

/* ---------- view models (bindings) ---------- */

export interface IntentPreset {
  id: string;
  label: string;
  engine: 'basic' | 'advanced';
  description: string;
}
/** One-click presets; each one sets the engine (and process / advanced intent) — see applyIntentPreset. */
export const INTENT_PRESETS: IntentPreset[] = [];
/** Id of the preset the current settings match, or null when edited away from all of them. */
export function useActiveIntentPreset(): string | null { return null; }
export function applyIntentPreset(_id: string): void { /* bound by Core-Binding */ }

export interface ObjectEffect {
  id: string;
  pluginId: string;
  /** Short badge text, e.g. "Mx". */
  badge: string;
  label: string;
  /** One-line mono summary, e.g. "koi-pond · 3 col · 1.2 mm". */
  detail: string;
  enabled: boolean;
  status: 'ok' | 'warn' | 'error';
}
/** Plugin effects placed on an object (Motionex placements/weave, Patternex regions, …). */
export function useObjectEffects(_objectId: string | null): ObjectEffect[] { return []; }
export function setEffectEnabled(_objectId: string, _effectId: string, _on: boolean): void { /* bound */ }
/** Opens the owning plugin's panel in the plugin dock, focused on this effect. */
export function openEffect(_objectId: string, _effectId: string): void { /* bound */ }

export interface ClearanceStatus {
  state: 'none' | 'ok' | 'warn' | 'collision';
  message: string;
  /** First / last affected layer, when known. */
  layers?: [number, number];
  canAutoFix: boolean;
}
export function useClearanceStatus(): ClearanceStatus { return { state: 'none', message: '', canAutoFix: false }; }
/** Applies the automatic fix (e.g. lowers wave / weave depth) and reports what changed. */
export function autoFixClearance(): string | null { return null; }

export interface SliceSummary {
  status: 'empty' | 'idle' | 'slicing' | 'done' | 'error';
  progress: number;
  time?: string;
  weight?: string;
  cost?: string;
  /** True when a valid slice for the active plate matches the scene (Export enabled). */
  ready: boolean;
}
export function useSliceSummary(): SliceSummary { return { status: 'empty', progress: 0, ready: false }; }

export interface PaletteItem {
  id: string;
  section: 'Settings' | 'Tools' | 'Plugins & effects' | 'Physics Core' | 'Actions';
  label: string;
  hint?: string;
  value?: string;
  run: () => void;
}
/** Everything Ctrl+K can find: process params (jump + pin), tools, plugin actions, advanced techs, global actions. */
export function paletteItems(): PaletteItem[] { return []; }
