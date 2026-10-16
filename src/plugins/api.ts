// Nexspiro plugin API.
// A plugin can change finished toolpaths (post-toolpath, pre-G-code) and add a panel to the right dock.
// Nexspiro always writes the G-code: plugins only edit the move list that Nexspiro then emits.
import type { Config } from '../profiles/settings';
import type { LayerOps } from '../engine/gcode';

/** A set of picked surfaces on one object, sliced into per-layer outlines (plate mm). */
export interface FaceRegion {
  /** "objectId:setId" */
  id: string;
  name: string;
  /** Outline polygons of the picked surfaces at a layer, as [x, y] lists in plate mm. */
  polygonsAt(layer: number): [number, number][][];
}

export interface PluginContext {
  cfg: Config;
  /** Layer tops in mm, one per layer. */
  layerZ: number[];
  faceRegions: FaceRegion[];
  /** Messages shown to the user after slicing. */
  warn(message: string): void;
}

/** Engine side of a plugin. Runs inside the slicing worker, so its config must be plain data. */
export interface EnginePlugin<C = unknown, R = unknown> {
  id: string;
  name: string;
  version: string;
  /** Edits the ordered move list in place. Returns a report for the UI (plain data). */
  postToolpath(layers: LayerOps[], config: C, ctx: PluginContext): R;
  /** Comment lines for the G-code header. */
  gcodeHeader?(config: C): string[];
}
