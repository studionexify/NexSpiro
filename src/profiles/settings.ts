// Process parameter schema, laid out like Bambu Studio's process tabs (Quality, Strength, Speed, Support, Others):
// same groups, same order, same keys, units and ranges. Every key listed here is read by the engine.
export type ParamType = 'float' | 'int' | 'bool' | 'enum' | 'percent' | 'floatOrPercent' | 'string' | 'text';
export type ProcessTab = 'Quality' | 'Strength' | 'Speed' | 'Support' | 'Others';
export type ConfigValue = number | boolean | string;
export type Config = Record<string, ConfigValue>;

export interface ParamDef {
  key: string;
  label: string;
  /** Page the setting appears on (process tab, filament page or printer page). */
  tab: string;
  group: string;
  type: ParamType;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  def: ConfigValue;
  tip: string;
  /** Shown only with the Advanced switch on (Bambu Studio's advanced / developer mode settings). */
  advanced?: boolean;
  /** Disabled when this returns true for the current config. */
  disabledWhen?: (c: Config) => boolean;
  /** floatOrPercent: what a percentage is taken of (a key, or 'nozzle_diameter'). */
  percentOf?: string;
}

/** A float-or-percent value (number, "12", "50%") resolved against `base`. */
export function floatOrPercent(v: ConfigValue | undefined, base: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean' || v === undefined) return 0;
  const s = v.trim();
  return s.endsWith('%') ? (parseFloat(s) / 100) * base : parseFloat(s) || 0;
}

const vase = (c: Config) => c.spiral_mode === true;
const noSupport = (c: Config) => !c.enable_support;
const noTree = (c: Config) => !c.enable_support || !String(c.support_type).startsWith('tree');
const noIron = (c: Config) => c.ironing_type === 'no_ironing';
const noFuzzy = (c: Config) => c.fuzzy_skin === 'none' || c.fuzzy_skin === 'disabled_fuzzy';
const noScarf = (c: Config) => c.seam_slope_type === 'none';
const notArachne = (c: Config) => c.wall_generator !== 'arachne';
const noRaft = (c: Config) => !(Number(c.raft_layers) > 0);
const noTower = (c: Config) => !c.enable_prime_tower;
const noOverhangSpeed = (c: Config) => !c.enable_overhang_speed;
const noHeightSlow = (c: Config) => !c.enable_height_slowdown;
const noJerk = (c: Config) => !(Number(c.default_jerk) > 0);
const noSupportIron = (c: Config) => !c.enable_support || !c.enable_support_ironing;

const o = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

/** Top / bottom surface patterns (Bambu's list). */
export const SURFACE_PATTERNS = o(
  ['concentric', 'Concentric'], ['rectilinear', 'Rectilinear'], ['monotonic', 'Monotonic'], ['monotonicline', 'Monotonic line'],
  ['aligned_rectilinear', 'Aligned Rectilinear'], ['hilbertcurve', 'Hilbert Curve'], ['archimedeanchords', 'Archimedean Chords'], ['octagramspiral', 'Octagram Spiral'],
);
/** Sparse infill patterns. */
export const SPARSE_PATTERNS = o(
  ['concentric', 'Concentric'], ['rectilinear', 'Rectilinear'], ['grid', 'Grid'], ['line', 'Line'], ['cubic', 'Cubic'], ['triangles', 'Triangles'],
  ['tri-hexagon', 'Tri-hexagon'], ['gyroid', 'Gyroid'], ['honeycomb', 'Honeycomb'], ['adaptivecubic', 'Adaptive Cubic'], ['aligned_rectilinear', 'Aligned Rectilinear'],
  ['3dhoneycomb', '3D Honeycomb'], ['hilbertcurve', 'Hilbert Curve'], ['archimedeanchords', 'Archimedean Chords'], ['octagramspiral', 'Octagram Spiral'],
  ['supportcubic', 'Support Cubic'], ['lightning', 'Lightning'], ['crosshatch', 'Cross Hatch'],
);

export const PROCESS_PARAMS: ParamDef[] = [
  // ======================================================================== Quality
  { key: 'layer_height', label: 'Layer height', tab: 'Quality', group: 'Layer height', type: 'float', unit: 'mm', min: 0.04, max: 0.6, step: 0.01, def: 0.2, tip: 'Vertical thickness of each layer. Smaller values give smoother sides but print slower. Rule of thumb: 20–70% of nozzle diameter.' },
  { key: 'initial_layer_print_height', label: 'Initial layer height', tab: 'Quality', group: 'Layer height', type: 'float', unit: 'mm', min: 0.05, max: 0.6, step: 0.01, def: 0.2, tip: 'Thickness of the first layer. A slightly thicker first layer absorbs small bed flatness errors.' },

  { key: 'line_width', label: 'Default', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0.1, max: 2, step: 0.01, def: 0.42, advanced: true, tip: 'Fallback extrusion width when a specific line type is set to 0.' },
  { key: 'initial_layer_line_width', label: 'Initial layer', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.5, advanced: true, tip: 'Width of walls on the first layer. Wider first-layer lines increase bed contact and adhesion.' },
  { key: 'initial_layer_infill_line_width', label: 'Initial layer infill', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0, advanced: true, tip: 'Width of the bottom surface lines on the first layer (0 = same as Initial layer).' },
  { key: 'outer_wall_line_width', label: 'Outer wall', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.42, advanced: true, tip: 'Width of the external visible perimeter.' },
  { key: 'inner_wall_line_width', label: 'Inner wall', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.45, advanced: true, tip: 'Width of the internal perimeters.' },
  { key: 'top_surface_line_width', label: 'Top surface', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.42, advanced: true, tip: 'Width of top skin lines. Narrower lines give finer top surfaces.' },
  { key: 'sparse_infill_line_width', label: 'Sparse infill', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.45, advanced: true, tip: 'Width of sparse infill lines.' },
  { key: 'internal_solid_infill_line_width', label: 'Internal solid infill', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.42, advanced: true, tip: 'Width of solid infill below top and above bottom skins.' },
  { key: 'support_line_width', label: 'Support', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.42, advanced: true, tip: 'Width of support lines.' },

  { key: 'seam_position', label: 'Seam position', tab: 'Quality', group: 'Seam', type: 'enum', def: 'aligned', options: o(['nearest', 'Nearest'], ['aligned', 'Aligned'], ['back', 'Back'], ['random', 'Random']),
    tip: 'Where each perimeter loop starts and ends. Aligned stacks seams into one vertical line; Back hides them at the rear; Random scatters them.' },
  { key: 'seam_placement_away_from_overhangs', label: 'Seam placement away from overhangs (experimental)', tab: 'Quality', group: 'Seam', type: 'bool', def: false, advanced: true, tip: 'Keep Aligned and Back seams off wall sections that overhang the layer below, where a seam blob would sag.' },
  { key: 'seam_gap', label: 'Seam gap', tab: 'Quality', group: 'Seam', type: 'percent', unit: '%', min: 0, max: 100, def: 15, advanced: true, tip: 'Closed loops stop short of their start point by this percentage of the nozzle diameter, which hides the seam bump.' },
  { key: 'seam_slope_conditional', label: 'Smart scarf seam application', tab: 'Quality', group: 'Seam', type: 'bool', def: true, advanced: true, disabledWhen: noScarf, tip: 'Use the scarf joint only on smooth loops, where a sharp corner cannot hide the seam.' },
  { key: 'scarf_angle_threshold', label: 'Scarf application angle threshold', tab: 'Quality', group: 'Seam', type: 'int', unit: '°', min: 0, max: 180, def: 155, advanced: true, disabledWhen: (c) => noScarf(c) || !c.seam_slope_conditional, tip: 'A loop counts as smooth when every corner is wider than this angle; only smooth loops get a scarf joint.' },
  { key: 'seam_slope_entire_loop', label: 'Scarf around entire wall', tab: 'Quality', group: 'Seam', type: 'bool', def: false, advanced: true, disabledWhen: noScarf, tip: 'The scarf ramp spans the whole loop instead of the scarf length.' },
  { key: 'seam_slope_steps', label: 'Scarf steps', tab: 'Quality', group: 'Seam', type: 'int', min: 1, max: 100, def: 10, advanced: true, disabledWhen: noScarf, tip: 'Number of height and flow steps along the scarf ramp.' },
  { key: 'seam_slope_inner_walls', label: 'Scarf joint for inner walls', tab: 'Quality', group: 'Seam', type: 'bool', def: true, advanced: true, disabledWhen: noScarf, tip: 'Also use scarf joints on inner walls.' },
  { key: 'override_filament_scarf_seam_setting', label: 'Override filament scarf seam setting', tab: 'Quality', group: 'Seam', type: 'bool', def: false, advanced: true, tip: 'Use the scarf settings below instead of the ones stored with each filament.' },
  { key: 'seam_slope_type', label: 'Scarf seam type', tab: 'Quality', group: 'Seam', type: 'enum', def: 'none', advanced: true, options: o(['none', 'None'], ['external', 'Contour'], ['all', 'Contour and hole']),
    tip: 'A scarf joint ramps the start of a loop up from below the layer while the end of the loop overlaps it with falling flow, so the seam blends instead of leaving a bump.' },
  { key: 'seam_slope_start_height', label: 'Scarf start height', tab: 'Quality', group: 'Seam', type: 'floatOrPercent', unit: 'mm/%', def: '10%', percentOf: 'layer_height', advanced: true, disabledWhen: noScarf, tip: 'Height the scarf ramp starts at, in mm or as a percentage of the layer height.' },
  { key: 'seam_slope_gap', label: 'Scarf slope gap', tab: 'Quality', group: 'Seam', type: 'floatOrPercent', unit: 'mm/%', def: 0, percentOf: 'nozzle_diameter', advanced: true, disabledWhen: noScarf, tip: 'The overlapping end of the scarf stops this far short of the seam (mm or % of the nozzle diameter).' },
  { key: 'seam_slope_min_length', label: 'Scarf length', tab: 'Quality', group: 'Seam', type: 'float', unit: 'mm', min: 0, max: 100, def: 10, advanced: true, disabledWhen: noScarf, tip: 'Length of the scarf ramp. 0 disables the scarf joint.' },
  { key: 'wipe_speed', label: 'Wipe speed', tab: 'Quality', group: 'Seam', type: 'percent', unit: '%', min: 1, max: 100, def: 80, advanced: true, tip: 'Speed of the wipe move as a percentage of the travel speed.' },

  { key: 'slice_closing_radius', label: 'Slice gap closing radius', tab: 'Quality', group: 'Precision', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.001, def: 0.049, advanced: true, tip: 'Cracks smaller than twice this radius are closed while slicing. Larger values can fill small intended gaps.' },
  { key: 'resolution', label: 'Resolution', tab: 'Quality', group: 'Precision', type: 'float', unit: 'mm', min: 0, max: 0.2, step: 0.001, def: 0.012, advanced: true, tip: 'Paths are simplified by removing points that deviate less than this distance. Reduces G-code size.' },
  { key: 'enable_arc_fitting', label: 'Arc fitting', tab: 'Quality', group: 'Precision', type: 'bool', def: false, advanced: true, tip: 'Replaces chains of short segments on curves with G2/G3 arc moves. Smaller G-code and smoother curves on firmware that supports arcs.' },
  { key: 'xy_hole_compensation', label: 'X-Y hole compensation', tab: 'Quality', group: 'Precision', type: 'float', unit: 'mm', min: -2, max: 2, step: 0.01, def: 0, advanced: true, tip: 'Grows (+) or shrinks (−) holes in the XY plane to correct for shrinkage.' },
  { key: 'xy_contour_compensation', label: 'X-Y contour compensation', tab: 'Quality', group: 'Precision', type: 'float', unit: 'mm', min: -2, max: 2, step: 0.01, def: 0, advanced: true, tip: 'Grows (+) or shrinks (−) outer contours in the XY plane.' },
  { key: 'elefant_foot_compensation', label: 'Elephant foot compensation', tab: 'Quality', group: 'Precision', type: 'float', unit: 'mm', min: 0, max: 1, step: 0.01, def: 0.15, advanced: true, tip: 'Shrinks the first layer inward to cancel the squish bulge ("elephant foot").' },
  { key: 'precise_z_height', label: 'Precise Z height', tab: 'Quality', group: 'Precision', type: 'bool', def: false, advanced: true, tip: 'Adjusts the last layers so the top of the print lands exactly on the model height instead of the nearest layer boundary.' },

  { key: 'precise_outer_wall', label: 'Precise wall', tab: 'Quality', group: 'Precision', type: 'bool', def: false, advanced: true, tip: 'Improve shell precision by adjusting outer wall spacing: the first inner wall sits a full half-line from the outer wall, so the outer wall is not squeezed outwards. This also improves layer consistency.' },
  { key: 'ironing_type', label: 'Ironing type', tab: 'Quality', group: 'Ironing', type: 'enum', def: 'no_ironing', advanced: true, options: o(['no_ironing', 'No ironing'], ['top', 'Top surfaces'], ['topmost', 'Topmost surface'], ['solid', 'All solid layer']),
    tip: 'Runs the hot nozzle over top surfaces again with a tiny flow to smooth them.' },
  { key: 'ironing_pattern', label: 'Ironing pattern', tab: 'Quality', group: 'Ironing', type: 'enum', def: 'rectilinear', advanced: true, disabledWhen: noIron, options: o(['concentric', 'Concentric'], ['rectilinear', 'Rectilinear'], ['archimedeanchords', 'Archimedean Chords']), tip: 'Path pattern of the ironing pass.' },
  { key: 'ironing_speed', label: 'Ironing speed', tab: 'Quality', group: 'Ironing', type: 'float', unit: 'mm/s', min: 5, max: 300, def: 30, advanced: true, disabledWhen: noIron, tip: 'Nozzle speed while ironing.' },
  { key: 'ironing_flow', label: 'Ironing flow', tab: 'Quality', group: 'Ironing', type: 'percent', unit: '%', min: 0, max: 100, def: 10, advanced: true, disabledWhen: noIron, tip: 'Extrusion amount during ironing, as a percentage of a normal layer.' },
  { key: 'ironing_spacing', label: 'Ironing line spacing', tab: 'Quality', group: 'Ironing', type: 'float', unit: 'mm', min: 0.05, max: 1, step: 0.01, def: 0.15, advanced: true, disabledWhen: noIron, tip: 'Distance between ironing passes.' },
  { key: 'ironing_inset', label: 'Ironing inset', tab: 'Quality', group: 'Ironing', type: 'float', unit: 'mm', min: 0, max: 100, step: 0.05, def: 0, advanced: true, disabledWhen: noIron, tip: 'Keeps ironing this far inside the edges of the surface.' },
  { key: 'ironing_direction', label: 'Ironing direction', tab: 'Quality', group: 'Ironing', type: 'float', unit: '°', min: 0, max: 360, def: 45, advanced: true, disabledWhen: noIron, tip: 'Angle of the ironing lines.' },

  { key: 'wall_generator', label: 'Wall generator', tab: 'Quality', group: 'Wall generator', type: 'enum', def: 'classic', advanced: true, options: o(['classic', 'Classic'], ['arachne', 'Arachne']), tip: 'Arachne varies the line width so thin walls and narrow gaps are filled by a single bead instead of being skipped or overlapped.' },
  { key: 'wall_transition_filter_deviation', label: 'Wall transitioning filter margin', tab: 'Quality', group: 'Wall generator', type: 'percent', unit: '%', min: 0, max: 100, def: 25, advanced: true, disabledWhen: notArachne, tip: 'How far a region may stray from a whole number of walls (in % of the nozzle) before the wall count changes. Larger values give fewer transitions.' },
  { key: 'wall_transition_length', label: 'Wall transition length', tab: 'Quality', group: 'Wall generator', type: 'percent', unit: '%', min: 0, max: 500, def: 100, advanced: true, disabledWhen: notArachne, tip: 'When the number of walls changes as the part gets thinner, the length (as a percentage of the nozzle diameter) over which the bead widths blend. Narrow stretches shorter than this keep the wider neighbour\'s walls.' },
  { key: 'wall_transition_angle', label: 'Wall transitioning threshold angle', tab: 'Quality', group: 'Wall generator', type: 'float', unit: '°', min: 1, max: 59, def: 10, advanced: true, disabledWhen: notArachne, tip: 'When to create transitions between even and odd numbers of walls. A wedge sharper than this angle gets no transition, so its tip stays empty instead of getting a centre bead. Lower values print fewer centre beads in sharp corners.' },
  { key: 'wall_distribution_count', label: 'Wall distribution count', tab: 'Quality', group: 'Wall generator', type: 'int', min: 1, max: 10, def: 1, advanced: true, disabledWhen: notArachne, tip: 'The number of walls, counted from the centre, over which a width difference is spread. Higher values keep the outer walls at their nominal width.' },
  { key: 'min_bead_width', label: 'Minimum wall width', tab: 'Quality', group: 'Wall generator', type: 'percent', unit: '%', min: 0, max: 200, def: 85, advanced: true, disabledWhen: notArachne, tip: 'Narrowest wall printed where a feature is thinner than the line width, in % of the nozzle diameter.' },
  { key: 'min_feature_size', label: 'Minimum feature size', tab: 'Quality', group: 'Wall generator', type: 'percent', unit: '%', min: 0, max: 100, def: 25, advanced: true, disabledWhen: notArachne, tip: 'Features thinner than this (in % of the nozzle diameter) are not printed; thicker ones are widened to the minimum wall width.' },

  { key: 'wall_sequence', label: 'Order of walls', tab: 'Quality', group: 'Advanced', type: 'enum', def: 'inner_outer', advanced: true, options: o(['inner_outer', 'Inner/Outer'], ['outer_inner', 'Outer/Inner'], ['inner_outer_inner', 'Inner/Outer/Inner']),
    tip: 'Inner/Outer is best for overhangs; Outer/Inner improves dimensional accuracy.' },
  { key: 'is_infill_first', label: 'Print infill first', tab: 'Quality', group: 'Advanced', type: 'bool', def: false, advanced: true, tip: 'Print infill before walls. Rarely useful; can show infill through the walls.' },
  { key: 'bridge_flow', label: 'Bridge flow', tab: 'Quality', group: 'Advanced', type: 'float', min: 0.5, max: 2, step: 0.01, def: 1, advanced: true, tip: 'Extrusion multiplier for bridges. Slightly lower values reduce sagging.' },
  { key: 'thick_bridges', label: 'Thick bridges', tab: 'Quality', group: 'Advanced', type: 'bool', def: false, advanced: true, tip: 'Bridges are extruded as round strands as thick as the nozzle. Stronger and more reliable over long spans, but they look coarser.' },
  { key: 'print_flow_ratio', label: 'Object flow ratio', tab: 'Quality', group: 'Advanced', type: 'float', min: 0.01, max: 2, step: 0.01, def: 1, advanced: true, tip: 'Multiplies the filament flow ratio for this object.' },
  { key: 'top_solid_infill_flow_ratio', label: 'Top surface flow ratio', tab: 'Quality', group: 'Advanced', type: 'float', min: 0, max: 2, step: 0.01, def: 1, advanced: true, tip: 'Flow multiplier for top surfaces.' },
  { key: 'initial_layer_flow_ratio', label: 'Initial layer flow ratio', tab: 'Quality', group: 'Advanced', type: 'float', min: 0, max: 2, step: 0.01, def: 1, advanced: true, tip: 'Flow multiplier for the first layer.' },
  { key: 'top_one_wall_type', label: 'Only one wall on top surfaces', tab: 'Quality', group: 'Advanced', type: 'enum', def: 'all_top', options: o(['not_apply', 'Not apply'], ['all_top', 'Top surfaces'], ['topmost', 'Topmost surface']),
    tip: 'Top surfaces get a single outer wall; the space of the inner walls is filled with top-surface lines, which looks cleaner.' },
  { key: 'top_area_threshold', label: 'Top area threshold', tab: 'Quality', group: 'Advanced', type: 'percent', unit: '%', min: 0, max: 500, def: 200, advanced: true, tip: 'Top areas narrower than this (in % of the outer wall width) keep all their walls.' },
  { key: 'only_one_wall_first_layer', label: 'Only one wall on first layer', tab: 'Quality', group: 'Advanced', type: 'bool', def: false, tip: 'Print a single wall on the first layer so the bottom surface pattern covers more of it.' },
  { key: 'detect_overhang_wall', label: 'Detect overhang wall', tab: 'Quality', group: 'Advanced', type: 'bool', def: true, advanced: true, tip: 'Measure how far each wall overhangs the layer below, to slow it down and cool it.' },
  { key: 'reduce_crossing_wall', label: 'Avoid crossing wall', tab: 'Quality', group: 'Advanced', type: 'bool', def: false, advanced: true, tip: 'Travel moves detour inside the part instead of crossing outer walls, which avoids marks on the surface.' },
  { key: 'max_travel_detour_distance', label: 'Avoid crossing wall - Max detour length', tab: 'Quality', group: 'Advanced', type: 'floatOrPercent', unit: 'mm or %', def: 0, percentOf: 'travel_length', advanced: true, disabledWhen: (c) => !c.reduce_crossing_wall, tip: 'Longest detour allowed, in mm or as a percentage of the direct travel. 0 = no limit.' },

  // ======================================================================== Strength
  { key: 'monotonic_travel_into_wall', label: 'Monotonic line travel extend', tab: 'Quality', group: 'Advanced', type: 'percent', unit: '%', min: 0, max: 200, def: 0, advanced: true, tip: 'Before each monotonic top or bottom line, the nozzle travels this far (percent of the line width) into the wall and starts the line from there, improving adhesion between the monotonic lines and the walls.' },
  { key: 'wall_loops', label: 'Wall loops', tab: 'Strength', group: 'Walls', type: 'int', min: 0, max: 50, def: 2, tip: 'Number of perimeters. More walls add the most strength per gram.' },
  { key: 'alternate_extra_wall', label: 'Alternate extra wall', tab: 'Strength', group: 'Walls', type: 'bool', def: false, advanced: true, tip: 'Adds an extra wall on every other layer so the infill locks between the walls.' },
  { key: 'detect_thin_wall', label: 'Detect thin wall', tab: 'Strength', group: 'Walls', type: 'bool', def: false, advanced: true, disabledWhen: (c) => c.wall_generator === 'arachne', tip: 'Prints walls that are too thin for two lines as a single line (classic wall generator).' },

  { key: 'top_surface_pattern', label: 'Top surface pattern', tab: 'Strength', group: 'Top/bottom shells', type: 'enum', def: 'monotonic', options: SURFACE_PATTERNS, tip: 'Fill pattern for the visible top skin. Monotonic prints every line in one direction for an even sheen.' },
  { key: 'top_surface_density', label: 'Top surface density', tab: 'Strength', group: 'Top/bottom shells', type: 'percent', unit: '%', min: 0, max: 100, def: 100, advanced: true, tip: 'Density of the top surface layer. Less than 100% leaves deliberate gaps (decorative or translucent tops).' },
  { key: 'top_shell_layers', label: 'Top shell layers', tab: 'Strength', group: 'Top/bottom shells', type: 'int', min: 0, max: 100, def: 5, disabledWhen: vase, tip: 'Number of solid layers at the top of the model.' },
  { key: 'top_shell_thickness', label: 'Top shell thickness', tab: 'Strength', group: 'Top/bottom shells', type: 'float', unit: 'mm', min: 0, max: 10, step: 0.1, def: 1, disabledWhen: vase, tip: 'Minimum top skin thickness. Extra layers are added if the layer count alone is too thin.' },
  { key: 'bottom_surface_pattern', label: 'Bottom surface pattern', tab: 'Strength', group: 'Top/bottom shells', type: 'enum', def: 'monotonic', options: SURFACE_PATTERNS, tip: 'Fill pattern for bottom skins.' },
  { key: 'bottom_surface_density', label: 'Bottom surface density', tab: 'Strength', group: 'Top/bottom shells', type: 'percent', unit: '%', min: 10, max: 100, def: 100, advanced: true, tip: 'Density of the bottom surface layer.' },
  { key: 'bottom_shell_layers', label: 'Bottom shell layers', tab: 'Strength', group: 'Top/bottom shells', type: 'int', min: 0, max: 100, def: 3, tip: 'Number of solid layers at the bottom of the model.' },
  { key: 'bottom_shell_thickness', label: 'Bottom shell thickness', tab: 'Strength', group: 'Top/bottom shells', type: 'float', unit: 'mm', min: 0, max: 10, step: 0.1, def: 0, tip: 'Minimum bottom skin thickness (0 = layer count only).' },
  { key: 'interface_shells', label: 'Interface shells', tab: 'Strength', group: 'Top/bottom shells', type: 'bool', def: false, advanced: true, tip: 'Force solid shells where the object touches another object or volume above or below (multi-material interfaces). Useful for multi-material prints with translucent materials or soluble supports.' },
  { key: 'infill_instead_top_bottom_surfaces', label: 'Use infill instead of top and bottom surfaces', tab: 'Strength', group: 'Top/bottom shells', type: 'bool', def: false, tip: 'Top and bottom shells are printed with the sparse infill pattern and density, for open lattice parts.' },
  { key: 'internal_solid_infill_pattern', label: 'Internal solid infill pattern', tab: 'Strength', group: 'Top/bottom shells', type: 'enum', def: 'rectilinear', options: SURFACE_PATTERNS, tip: 'Pattern of solid infill between the shells.' },

  { key: 'sparse_infill_density', label: 'Sparse infill density', tab: 'Strength', group: 'Sparse infill', type: 'percent', unit: '%', min: 0, max: 100, def: 15, disabledWhen: vase, tip: 'Volume fraction of internal infill. 100% switches to solid infill.' },
  { key: 'sparse_infill_pattern', label: 'Sparse infill pattern', tab: 'Strength', group: 'Sparse infill', type: 'enum', def: 'grid', disabledWhen: vase, options: SPARSE_PATTERNS,
    tip: 'Internal lattice. Gyroid is strong in all directions with no line crossings; Grid is fast and stiff; Lightning only supports the top surfaces; Adaptive Cubic is dense near the walls and sparse inside.' },
  { key: 'sparse_infill_anchor', label: 'Length of sparse infill anchor', tab: 'Strength', group: 'Sparse infill', type: 'floatOrPercent', unit: 'mm or %', def: '400%', percentOf: 'sparse_infill_line_width', advanced: true,
    tip: 'Infill lines are joined to their neighbours along the inner wall when the walk is shorter than the maximum below; otherwise each end follows the wall for this length. 0 disables anchors.' },
  { key: 'sparse_infill_anchor_max', label: 'Maximum length of sparse infill anchor', tab: 'Strength', group: 'Sparse infill', type: 'floatOrPercent', unit: 'mm or %', def: 20, percentOf: 'sparse_infill_line_width', advanced: true, tip: 'Longest wall segment used to join two infill lines. 0 disables joining.' },
  { key: 'filter_out_gap_fill', label: 'Filter out tiny gaps', tab: 'Strength', group: 'Sparse infill', type: 'float', unit: 'mm', min: 0, max: 10, step: 0.1, def: 0, advanced: true, tip: 'Gap-fill lines shorter than this are dropped.' },

  { key: 'infill_wall_overlap', label: 'Infill/Wall overlap', tab: 'Strength', group: 'Advanced', type: 'percent', unit: '%', min: 0, max: 100, def: 15, advanced: true, tip: 'How far infill reaches into the innermost wall to bond with it.' },
  { key: 'infill_direction', label: 'Infill direction', tab: 'Strength', group: 'Advanced', type: 'float', unit: '°', min: 0, max: 360, def: 45, advanced: true, tip: 'Base angle of infill lines.' },
  { key: 'solid_infill_direction', label: 'Solid infill direction', tab: 'Strength', group: 'Advanced', type: 'float', unit: '°', min: 0, max: 360, def: 45, advanced: true, tip: 'Base angle of solid/skin lines (alternates by 90° each layer).' },
  { key: 'bridge_angle', label: 'Bridge direction', tab: 'Strength', group: 'Advanced', type: 'float', unit: '°', min: 0, max: 360, def: 0, advanced: true, tip: 'Fixed angle for bridge lines. 0 = the shortest span is chosen automatically.' },
  { key: 'minimum_sparse_infill_area', label: 'Minimum sparse infill threshold', tab: 'Strength', group: 'Advanced', type: 'float', unit: 'mm²', min: 0, max: 500, def: 15, advanced: true, tip: 'Sparse regions smaller than this are filled solid instead.' },
  { key: 'infill_combination', label: 'Infill combination', tab: 'Strength', group: 'Advanced', type: 'bool', def: false, advanced: true, tip: 'Prints sparse infill only every few layers at the combined height, which saves time. Walls keep the normal layer height.' },
  { key: 'detect_narrow_internal_solid_infill', label: 'Detect narrow internal solid infill', tab: 'Strength', group: 'Advanced', type: 'bool', def: true, advanced: true, tip: 'Narrow solid areas are filled with concentric lines, which avoids short back-and-forth moves.' },
  { key: 'sub_top_surface_pattern', label: 'Sub-top surface pattern', tab: 'Strength', group: 'Advanced', type: 'enum', def: 'monotonic', advanced: true, options: SURFACE_PATTERNS, tip: 'Pattern of the solid layer right under a top surface.' },
  { key: 'ensure_vertical_shell_thickness', label: 'Ensure vertical shell thickness', tab: 'Strength', group: 'Advanced', type: 'enum', def: 'enabled', advanced: true, options: o(['disabled', 'Disabled'], ['partial', 'Partial'], ['enabled', 'Enabled']),
    tip: 'Adds solid infill near sloping surfaces so the shell is as thick horizontally as the walls are. Partial only does this under sloping top surfaces.' },
  { key: 'detect_floating_vertical_shell', label: 'Detect floating vertical shells', tab: 'Strength', group: 'Advanced', type: 'bool', def: true, advanced: true, tip: 'Solid infill that hangs over sparse infill or air is printed as a bridge, at bridge speed.' },

  // ======================================================================== Speed
  { key: 'initial_layer_speed', label: 'Initial layer', tab: 'Speed', group: 'Initial layer speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 50, advanced: true, tip: 'Speed for walls on the first layer.' },
  { key: 'initial_layer_infill_speed', label: 'Initial layer infill', tab: 'Speed', group: 'Initial layer speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 105, advanced: true, tip: 'Speed for solid infill on the first layer.' },
  { key: 'outer_wall_speed', label: 'Outer wall', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 200, advanced: true, tip: 'Speed of the visible outer perimeter.' },
  { key: 'inner_wall_speed', label: 'Inner wall', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 300, advanced: true, tip: 'Speed of inner perimeters.' },
  { key: 'small_perimeter_speed', label: 'Small perimeters', tab: 'Speed', group: 'Other layers speed', type: 'floatOrPercent', unit: 'mm/s or %', def: '50%', percentOf: 'outer_wall_speed', advanced: true, tip: 'Speed of walls shorter than the threshold below, in mm/s or as a percentage of their normal speed.' },
  { key: 'small_perimeter_threshold', label: 'Small perimeter threshold', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm', min: 0, max: 1000, def: 0, advanced: true, tip: 'Walls whose loop is shorter than this use the small perimeter speed. 0 disables it.' },
  { key: 'sparse_infill_speed', label: 'Sparse infill', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 270, advanced: true, tip: 'Speed of sparse infill.' },
  { key: 'internal_solid_infill_speed', label: 'Internal solid infill', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 250, advanced: true, tip: 'Speed of internal solid infill.' },
  { key: 'vertical_shell_speed', label: 'Vertical shell speed', tab: 'Speed', group: 'Other layers speed', type: 'floatOrPercent', unit: 'mm/s or %', def: '80%', percentOf: 'internal_solid_infill_speed', advanced: true, tip: 'Speed of the solid infill added near sloping surfaces (Ensure vertical shell thickness), in mm/s or % of internal solid infill speed.' },
  { key: 'top_surface_speed', label: 'Top surface', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 200, advanced: true, tip: 'Speed of the top skin.' },
  { key: 'enable_overhang_speed', label: 'Slow down for overhang', tab: 'Speed', group: 'Other layers speed', type: 'bool', def: true, advanced: true, tip: 'Slow walls down by how much of the line width hangs over the layer below.' },
  { key: 'overhang_1_4_speed', label: 'Overhang speed 10-25%', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 0, max: 1000, def: 0, advanced: true, disabledWhen: noOverhangSpeed, tip: 'Speed for walls overhanging by 10–25% of their width. 0 = no slowdown.' },
  { key: 'overhang_2_4_speed', label: 'Overhang speed 25-50%', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 0, max: 1000, def: 50, advanced: true, disabledWhen: noOverhangSpeed, tip: 'Speed for walls overhanging by 25–50% of their width. 0 = no slowdown.' },
  { key: 'overhang_3_4_speed', label: 'Overhang speed 50-75%', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 0, max: 1000, def: 30, advanced: true, disabledWhen: noOverhangSpeed, tip: 'Speed for walls overhanging by 50–75% of their width. 0 = no slowdown.' },
  { key: 'overhang_4_4_speed', label: 'Overhang speed 75-100%', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 0, max: 1000, def: 10, advanced: true, disabledWhen: noOverhangSpeed, tip: 'Speed for walls overhanging by 75–100% of their width. 0 = no slowdown.' },
  { key: 'overhang_totally_speed', label: 'Overhang speed 100%', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 0, max: 1000, def: 10, advanced: true, disabledWhen: noOverhangSpeed, tip: 'Speed for wall sections with nothing at all underneath.' },
  { key: 'enable_height_slowdown', label: 'Slow down by height', tab: 'Speed', group: 'Other layers speed', type: 'bool', def: false, advanced: true, tip: 'Cap speed and acceleration by height, for tall or wobbly prints.' },
  { key: 'slowdown_start_height', label: 'Starting height', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm', min: 0, max: 1000, def: 0, advanced: true, disabledWhen: noHeightSlow, tip: 'Height where the cap begins.' },
  { key: 'slowdown_start_speed', label: 'Speed at starting height', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 1000, advanced: true, disabledWhen: noHeightSlow, tip: 'Speed cap at the starting height.' },
  { key: 'slowdown_start_acc', label: 'Acceleration at starting height', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s²', min: 1, max: 100000, def: 100000, advanced: true, disabledWhen: noHeightSlow, tip: 'Acceleration cap at the starting height.' },
  { key: 'slowdown_end_height', label: 'Ending height', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm', min: 0, max: 1000, def: 400, advanced: true, disabledWhen: noHeightSlow, tip: 'Height where the cap reaches its end values; the cap is interpolated in between.' },
  { key: 'slowdown_end_speed', label: 'Speed at ending height', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 1000, advanced: true, disabledWhen: noHeightSlow, tip: 'Speed cap from the ending height up.' },
  { key: 'slowdown_end_acc', label: 'Acceleration at ending height', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s²', min: 1, max: 100000, def: 100000, advanced: true, disabledWhen: noHeightSlow, tip: 'Acceleration cap from the ending height up.' },
  { key: 'bridge_speed', label: 'Bridge', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 50, advanced: true, tip: 'Speed of unsupported bridge spans.' },
  { key: 'gap_infill_speed', label: 'Gap infill', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 250, advanced: true, tip: 'Speed of gap fill: the narrow lines between walls that are too thin for another wall.' },
  { key: 'support_speed', label: 'Support', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 150, advanced: true, tip: 'Speed of support structures.' },
  { key: 'support_interface_speed', label: 'Support interface', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 80, advanced: true, tip: 'Speed of dense support roof/floor layers.' },
  { key: 'travel_speed', label: 'Travel', tab: 'Speed', group: 'Travel speed', type: 'float', unit: 'mm/s', min: 1, max: 2000, def: 500, advanced: true, tip: 'Speed of non-printing moves.' },
  { key: 'default_acceleration', label: 'Normal printing', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 10000, advanced: true, tip: 'Default acceleration.' },
  { key: 'travel_acceleration', label: 'Travel', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 10000, advanced: true, tip: 'Acceleration for travel moves.' },
  { key: 'initial_layer_travel_acceleration', label: 'Initial layer travel', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 6000, advanced: true, tip: 'Acceleration of travel moves on the first layer.' },
  { key: 'travel_short_distance_acceleration', label: 'Short travel', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 0, max: 100000, def: 250, advanced: true, tip: 'Acceleration for travel moves shorter than the retraction minimum travel distance, which are mostly hops between nearby walls. A low value reduces ringing on the outer wall. 0 uses the travel acceleration.' },
  { key: 'initial_layer_acceleration', label: 'Initial layer', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 500, advanced: true, tip: 'Gentle acceleration on the first layer helps adhesion.' },
  { key: 'outer_wall_acceleration', label: 'Outer wall', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 5000, advanced: true, tip: 'Lower outer-wall acceleration reduces ringing.' },
  { key: 'inner_wall_acceleration', label: 'Inner wall', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 0, max: 100000, def: 0, advanced: true, tip: 'Acceleration of inner walls. 0 = normal printing acceleration.' },
  { key: 'top_surface_acceleration', label: 'Top surface', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 2000, advanced: true, tip: 'Acceleration for top skin.' },
  { key: 'sparse_infill_acceleration', label: 'Sparse infill', tab: 'Speed', group: 'Acceleration', type: 'floatOrPercent', unit: 'mm/s² or %', def: '100%', percentOf: 'default_acceleration', advanced: true, tip: 'Acceleration of sparse infill, in mm/s² or % of the normal printing acceleration.' },
  { key: 'accel_to_decel_enable', label: 'Enable accel_to_decel', tab: 'Speed', group: 'Acceleration', type: 'bool', def: false, advanced: true, tip: 'Klipper: set max_accel_to_decel to a fraction of the acceleration, which softens short zig-zags.' },
  { key: 'accel_to_decel_factor', label: 'accel_to_decel', tab: 'Speed', group: 'Acceleration', type: 'percent', unit: '%', min: 1, max: 100, def: 50, advanced: true, disabledWhen: (c) => !c.accel_to_decel_enable, tip: 'max_accel_to_decel as a percentage of the acceleration.' },
  { key: 'default_jerk', label: 'Default', tab: 'Speed', group: 'Jerk(XY)', type: 'float', unit: 'mm/s', min: 0, max: 100, def: 0, advanced: true, tip: 'Default jerk (Marlin M205 / Klipper square corner velocity). 0 = leave the printer\'s jerk alone.' },
  { key: 'outer_wall_jerk', label: 'Outer wall', tab: 'Speed', group: 'Jerk(XY)', type: 'float', unit: 'mm/s', min: 0, max: 100, def: 9, advanced: true, disabledWhen: noJerk, tip: 'Jerk for outer walls.' },
  { key: 'inner_wall_jerk', label: 'Inner wall', tab: 'Speed', group: 'Jerk(XY)', type: 'float', unit: 'mm/s', min: 0, max: 100, def: 9, advanced: true, disabledWhen: noJerk, tip: 'Jerk for inner walls.' },
  { key: 'infill_jerk', label: 'Infill', tab: 'Speed', group: 'Jerk(XY)', type: 'float', unit: 'mm/s', min: 0, max: 100, def: 9, advanced: true, disabledWhen: noJerk, tip: 'Jerk for infill.' },
  { key: 'top_surface_jerk', label: 'Top surface', tab: 'Speed', group: 'Jerk(XY)', type: 'float', unit: 'mm/s', min: 0, max: 100, def: 9, advanced: true, disabledWhen: noJerk, tip: 'Jerk for top surfaces.' },
  { key: 'initial_layer_jerk', label: 'First layer', tab: 'Speed', group: 'Jerk(XY)', type: 'float', unit: 'mm/s', min: 0, max: 100, def: 9, advanced: true, disabledWhen: noJerk, tip: 'Jerk on the first layer.' },
  { key: 'travel_jerk', label: 'Travel', tab: 'Speed', group: 'Jerk(XY)', type: 'float', unit: 'mm/s', min: 0, max: 100, def: 9, advanced: true, disabledWhen: noJerk, tip: 'Jerk for travel moves.' },

  // ======================================================================== Support
  { key: 'max_volumetric_extrusion_rate_slope_positive', label: 'Max volumetric slope positive', tab: 'Speed', group: 'Jerk(XY)', type: 'float', unit: 'mm³/s²', min: 0, max: 10000, def: 0, advanced: true, tip: 'Limits how fast the volumetric flow may rise, by easing the speed of the following extrusions (a pressure equalizer). 0 disables it.' },
  { key: 'max_volumetric_extrusion_rate_slope_negative', label: 'Max volumetric slope negative', tab: 'Speed', group: 'Jerk(XY)', type: 'float', unit: 'mm³/s²', min: 0, max: 10000, def: 0, advanced: true, tip: 'Limits how fast the volumetric flow may fall, by easing the speed of the following extrusions. 0 disables it.' },
  { key: 'enable_support', label: 'Enable support', tab: 'Support', group: 'Support', type: 'bool', def: false, tip: 'Generate support under overhangs steeper than the threshold angle.' },
  { key: 'support_type', label: 'Type', tab: 'Support', group: 'Support', type: 'enum', def: 'normal_auto', disabledWhen: noSupport, options: o(['normal_auto', 'normal(auto)'], ['tree_auto', 'tree(auto)'], ['normal_manual', 'normal(manual)'], ['tree_manual', 'tree(manual)']),
    tip: 'Normal supports project columns straight down from overhangs. Tree supports grow branches that steer around the model and merge into trunks. Manual types only support painted enforcer areas and enforcer volumes.' },
  { key: 'support_style', label: 'Style', tab: 'Support', group: 'Support', type: 'enum', def: 'default', advanced: true, disabledWhen: noSupport,
    options: o(['default', 'Default'], ['grid', 'Grid'], ['snug', 'Snug'], ['tree_slim', 'Tree Slim'], ['tree_strong', 'Tree Strong'], ['tree_hybrid', 'Tree Hybrid'], ['tree_organic', 'Tree Organic']),
    tip: 'Grid makes stable blocks; Snug hugs the overhang outline. Tree Slim has thin branches and fewer walls, Tree Strong thick ones, Tree Hybrid uses normal support under large flat areas, Tree Organic merges branches smoothly.' },
  { key: 'support_threshold_angle', label: 'Threshold angle', tab: 'Support', group: 'Support', type: 'float', unit: '°', min: 1, max: 90, def: 30, disabledWhen: noSupport, tip: 'Faces flatter than this angle (measured from the bed) get support.' },
  { key: 'independent_support_layer_height', label: 'Independent support layer height', tab: 'Support', group: 'Support', type: 'bool', def: false, advanced: true, disabledWhen: noSupport, tip: 'Support uses layer heights independent of the object: support base is printed every second layer at double height (when that stays within the printer\'s maximum layer height), saving time. Interfaces keep the object layers so the Z gap stays exact.' },
  { key: 'support_on_build_plate_only', label: 'On build plate only', tab: 'Support', group: 'Support', type: 'bool', def: false, disabledWhen: noSupport, tip: 'Never start supports on top of the model itself.' },
  { key: 'support_critical_regions_only', label: 'Support critical regions only', tab: 'Support', group: 'Support', type: 'bool', def: false, advanced: true, disabledWhen: noSupport, tip: 'Only support regions that start in mid-air (islands, cantilever tips and sharp tails).' },
  { key: 'support_remove_small_overhang', label: 'Remove small overhangs', tab: 'Support', group: 'Support', type: 'bool', def: true, advanced: true, disabledWhen: noSupport, tip: 'Skip tiny overhangs that print fine without support.' },

  { key: 'raft_layers', label: 'Raft layers', tab: 'Support', group: 'Raft', type: 'int', unit: 'layers', min: 0, max: 100, def: 0, advanced: true, tip: 'Prints the object on top of this many raft layers. Rafts help with warping and uneven beds.' },
  { key: 'raft_contact_distance', label: 'Raft contact Z distance', tab: 'Support', group: 'Raft', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.1, advanced: true, disabledWhen: noRaft, tip: 'Gap between the raft top and the object.' },

  { key: 'support_filament', label: 'Support/raft base', tab: 'Support', group: 'Support filament', type: 'int', min: 0, max: 16, def: 0, disabledWhen: noSupport, tip: 'Filament slot for support and raft bodies (0 = whichever filament is loaded, avoiding extra filament changes).' },
  { key: 'support_interface_filament', label: 'Support/raft interface', tab: 'Support', group: 'Support filament', type: 'int', min: 0, max: 16, def: 0, disabledWhen: noSupport, tip: 'Filament slot for support interface layers (0 = same as the base). A soluble or breakaway material here makes support easy to remove.' },
  { key: 'support_interface_not_for_body', label: 'Avoid interface filament for base', tab: 'Support', group: 'Support filament', type: 'bool', def: true, disabledWhen: noSupport, tip: 'Never print the support body with the interface filament, to save the more expensive material.' },

  { key: 'enable_support_ironing', label: 'Enable ironing support interface', tab: 'Support', group: 'Support ironing', type: 'bool', def: false, advanced: true, disabledWhen: noSupport, tip: 'Iron the top support interface so the surface printed on it comes out smoother.' },
  { key: 'support_ironing_pattern', label: 'Support ironing pattern', tab: 'Support', group: 'Support ironing', type: 'enum', def: 'rectilinear', advanced: true, disabledWhen: noSupportIron, options: o(['concentric', 'Concentric'], ['rectilinear', 'Rectilinear']), tip: 'Pattern of support ironing.' },
  { key: 'support_ironing_speed', label: 'Support ironing speed', tab: 'Support', group: 'Support ironing', type: 'float', unit: 'mm/s', min: 1, max: 300, def: 20, advanced: true, disabledWhen: noSupportIron, tip: 'Speed of support ironing.' },
  { key: 'support_ironing_flow', label: 'Support ironing flow', tab: 'Support', group: 'Support ironing', type: 'percent', unit: '%', min: 0, max: 100, def: 10, advanced: true, disabledWhen: noSupportIron, tip: 'Flow of support ironing.' },
  { key: 'support_ironing_spacing', label: 'Support ironing line spacing', tab: 'Support', group: 'Support ironing', type: 'float', unit: 'mm', min: 0.05, max: 1, step: 0.01, def: 0.1, advanced: true, disabledWhen: noSupportIron, tip: 'Line spacing of support ironing.' },
  { key: 'support_ironing_inset', label: 'Support ironing inset', tab: 'Support', group: 'Support ironing', type: 'float', unit: 'mm', min: 0, max: 100, def: 0, advanced: true, disabledWhen: noSupportIron, tip: 'Keeps support ironing this far inside the interface edge.' },
  { key: 'support_ironing_direction', label: 'Support ironing direction', tab: 'Support', group: 'Support ironing', type: 'float', unit: '°', min: 0, max: 360, def: 0, advanced: true, disabledWhen: noSupportIron, tip: 'Angle of the support ironing lines.' },

  { key: 'raft_first_layer_density', label: 'Initial layer density', tab: 'Support', group: 'Advanced', type: 'percent', unit: '%', min: 10, max: 100, def: 90, advanced: true, tip: 'Density of the first raft or support layer.' },
  { key: 'raft_first_layer_expansion', label: 'Initial layer expansion', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: -1, max: 20, step: 0.1, def: -1, advanced: true, tip: 'Grows the first raft or support layer for better adhesion. −1 = automatic.' },
  { key: 'tree_support_wall_count', label: 'Support wall loops', tab: 'Support', group: 'Advanced', type: 'int', min: -1, max: 2, def: -1, advanced: true, disabledWhen: noSupport, tip: 'Walls around support areas. −1 = automatic (1 for normal, by style for tree support).' },
  { key: 'support_top_z_distance', label: 'Top Z distance', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.2, advanced: true, disabledWhen: noSupport, tip: 'Vertical gap between support and the model above it. Larger is easier to remove.' },
  { key: 'support_bottom_z_distance', label: 'Bottom Z distance', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.2, advanced: true, disabledWhen: noSupport, tip: 'Vertical gap between the model and support standing on it.' },
  { key: 'support_base_pattern', label: 'Base pattern', tab: 'Support', group: 'Advanced', type: 'enum', def: 'default', advanced: true, disabledWhen: noSupport,
    options: o(['default', 'Default'], ['rectilinear', 'Rectilinear'], ['rectilinear-grid', 'Rectilinear grid'], ['honeycomb', 'Honeycomb'], ['lightning', 'Lightning'], ['hollow', 'Hollow']), tip: 'Infill pattern of the support body. Hollow prints only the support walls.' },
  { key: 'support_base_pattern_spacing', label: 'Base pattern spacing', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 10, step: 0.1, def: 2.5, advanced: true, disabledWhen: noSupport, tip: 'Gap between support lines.' },
  { key: 'support_angle', label: 'Pattern angle', tab: 'Support', group: 'Advanced', type: 'float', unit: '°', min: 0, max: 359, def: 0, advanced: true, disabledWhen: noSupport, tip: 'Direction of support lines.' },
  { key: 'support_interface_top_layers', label: 'Top interface layers', tab: 'Support', group: 'Advanced', type: 'int', unit: 'layers', min: 0, max: 10, def: 2, disabledWhen: noSupport, tip: 'Dense layers directly under the model.' },
  { key: 'support_interface_bottom_layers', label: 'Bottom interface layers', tab: 'Support', group: 'Advanced', type: 'int', unit: 'layers', min: -1, max: 10, def: 0, advanced: true, disabledWhen: noSupport, tip: 'Dense layers where support stands on the model. −1 = same as top.' },
  { key: 'support_interface_pattern', label: 'Interface pattern', tab: 'Support', group: 'Advanced', type: 'enum', def: 'auto', advanced: true, disabledWhen: noSupport,
    options: o(['auto', 'Default'], ['rectilinear', 'Rectilinear'], ['concentric', 'Concentric'], ['rectilinear_interlaced', 'Rectilinear Interlaced'], ['grid', 'Grid']), tip: 'Pattern of the interface layers.' },
  { key: 'support_interface_spacing', label: 'Top interface spacing', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 5, step: 0.1, def: 0.5, advanced: true, disabledWhen: noSupport, tip: 'Gap between top interface lines. 0 = solid.' },
  { key: 'support_bottom_interface_spacing', label: 'Bottom interface spacing', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 5, step: 0.1, def: 0.5, advanced: true, disabledWhen: noSupport, tip: 'Gap between bottom interface lines.' },
  { key: 'support_expansion', label: 'Normal support expansion', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: -5, max: 20, step: 0.1, def: 0, advanced: true, disabledWhen: noSupport, tip: 'Grows (or shrinks) normal support horizontally.' },
  { key: 'support_object_xy_distance', label: 'Support/object XY distance', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 10, step: 0.05, def: 0.35, advanced: true, disabledWhen: noSupport, tip: 'Horizontal clearance between supports and the model walls.' },
  { key: 'top_z_overrides_xy_distance', label: 'Z overrides X/Y', tab: 'Support', group: 'Advanced', type: 'bool', def: false, advanced: true, disabledWhen: noSupport, tip: 'Under steep overhangs, support may come closer than the XY distance; the top Z distance keeps it removable.' },
  { key: 'support_object_first_layer_gap', label: 'Support/object first layer gap', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 10, step: 0.05, def: 0.2, advanced: true, disabledWhen: noSupport, tip: 'XY gap between support and the model on the first layer.' },
  { key: 'bridge_no_support', label: 'Don\'t support bridges', tab: 'Support', group: 'Advanced', type: 'bool', def: false, advanced: true, disabledWhen: noSupport, tip: 'Overhangs anchored on two sides and no longer than the max bridge length are bridged instead of supported.' },
  { key: 'max_bridge_length', label: 'Max bridge length', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 500, def: 10, advanced: true, disabledWhen: noSupport, tip: 'Longest bridge printed without support.' },
  { key: 'tree_support_branch_distance', label: 'Tree support branch distance', tab: 'Support', group: 'Tree Support', type: 'float', unit: 'mm', min: 1, max: 20, step: 0.5, def: 4, advanced: true, disabledWhen: noTree, tip: 'Distance between branch tips under an overhang.' },
  { key: 'tree_support_branch_diameter', label: 'Tree support branch diameter', tab: 'Support', group: 'Tree Support', type: 'float', unit: 'mm', min: 1, max: 20, step: 0.5, def: 6, advanced: true, disabledWhen: noTree, tip: 'Branches thicken as they merge and descend, up to this diameter.' },
  { key: 'tree_support_branch_angle', label: 'Tree support branch angle', tab: 'Support', group: 'Tree Support', type: 'float', unit: '°', min: 5, max: 70, def: 40, advanced: true, disabledWhen: noTree, tip: 'How far a branch may lean from vertical. Larger angles reach further around the model.' },
  { key: 'tree_support_branch_diameter_angle', label: 'Branch diameter angle', tab: 'Support', group: 'Tree Support', type: 'float', unit: '°', min: 0, max: 15, step: 0.5, def: 5, advanced: true, disabledWhen: noTree, tip: 'Angle at which branches get thicker going down. Larger angles make the base sturdier.' },
  { key: 'tree_support_tip_diameter', label: 'Tip diameter', tab: 'Support', group: 'Tree Support', type: 'float', unit: 'mm', min: 0.4, max: 5, step: 0.1, def: 1.6, advanced: true, disabledWhen: noTree, tip: 'Diameter of branch tips touching the model.' },

  // ======================================================================== Others
  { key: 'skirt_loops', label: 'Skirt loops', tab: 'Others', group: 'Bed adhesion', type: 'int', min: 0, max: 20, def: 0, tip: 'Priming loops drawn around the objects on the first layer(s).' },
  { key: 'skirt_height', label: 'Skirt height', tab: 'Others', group: 'Bed adhesion', type: 'int', unit: 'layers', min: 1, max: 1000, def: 1, tip: 'Number of skirt layers. Tall skirts act as a draft shield.' },
  { key: 'skirt_distance', label: 'Skirt distance', tab: 'Others', group: 'Bed adhesion', type: 'float', unit: 'mm', min: 0, max: 55, def: 2, advanced: true, tip: 'Distance between skirt and objects.' },
  { key: 'brim_type', label: 'Brim type', tab: 'Others', group: 'Bed adhesion', type: 'enum', def: 'auto_brim', options: o(['auto_brim', 'Auto'], ['brim_ears', 'Painted'], ['outer_only', 'Outer brim only'], ['inner_only', 'Inner brim only'], ['outer_and_inner', 'Outer and inner brim'], ['no_brim', 'No-brim']),
    tip: 'Auto adds a brim only to tall, narrow objects with a small footprint. Painted puts round brim ears on the points marked with the Brim ears tool (or, if none are marked, on sharp corners).' },
  { key: 'brim_width', label: 'Brim width', tab: 'Others', group: 'Bed adhesion', type: 'float', unit: 'mm', min: 0, max: 100, def: 5, tip: 'Width of the brim flange (radius of brim ears).' },
  { key: 'brim_object_gap', label: 'Brim-object gap', tab: 'Others', group: 'Bed adhesion', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.1, advanced: true, tip: 'Small gap between brim and object for easy removal.' },

  { key: 'enable_prime_tower', label: 'Enable', tab: 'Others', group: 'Prime tower', type: 'bool', def: true, tip: 'Builds a small tower that primes the nozzle after every filament change. Used only when more than one filament is printed.' },
  { key: 'prime_tower_width', label: 'Width', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm', min: 10, max: 100, def: 35, disabledWhen: noTower, tip: 'X width of the prime tower. Its depth is sized from the prime volume.' },
  { key: 'prime_tower_max_speed', label: 'Max speed', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm/s', min: 10, max: 1000, def: 90, advanced: true, disabledWhen: noTower, tip: 'Speed cap for printing the tower.' },
  { key: 'prime_tower_brim_width', label: 'Brim width', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm', min: -1, max: 20, step: 0.5, def: 3, advanced: true, disabledWhen: noTower, tip: 'Brim around the tower on the first layer. −1 = automatic.' },
  { key: 'prime_tower_infill_gap', label: 'Infill gap', tab: 'Others', group: 'Prime tower', type: 'percent', unit: '%', min: 100, max: 500, def: 150, advanced: true, disabledWhen: noTower, tip: 'Spacing of the tower\'s sparse layers, in % of the line width.' },
  { key: 'prime_tower_rib_wall', label: 'Rib wall', tab: 'Others', group: 'Prime tower', type: 'bool', def: true, advanced: true, disabledWhen: noTower, tip: 'Adds diagonal ribs to the tower wall, which keeps tall towers from wobbling.' },
  { key: 'prime_tower_extra_rib_length', label: 'Extra rib length', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm', min: 0, max: 300, def: 0, advanced: true, disabledWhen: (c) => noTower(c) || !c.prime_tower_rib_wall, tip: 'Extends the ribs beyond the tower corners.' },
  { key: 'prime_tower_rib_width', label: 'Rib width', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm', min: 0, max: 300, def: 8, advanced: true, disabledWhen: (c) => noTower(c) || !c.prime_tower_rib_wall, tip: 'Width of the ribs.' },
  { key: 'prime_tower_fillet_wall', label: 'Fillet wall', tab: 'Others', group: 'Prime tower', type: 'bool', def: true, advanced: true, disabledWhen: noTower, tip: 'Rounds the tower\'s outer corners.' },
  { key: 'prime_volume', label: 'Prime volume', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm³', min: 10, max: 1000, def: 45, disabledWhen: noTower, tip: 'Volume printed on the tower after each filament change (unless the filament sets its own).' },
  { key: 'prime_tower_x', label: 'Position X', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm', min: -1, max: 1000, def: -1, disabledWhen: noTower, tip: 'Front-left corner of the tower (−1 = automatic, back right of the plate).' },
  { key: 'prime_tower_y', label: 'Position Y', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm', min: -1, max: 1000, def: -1, disabledWhen: noTower, tip: 'Front-left corner of the tower (−1 = automatic).' },
  { key: 'flush_volume', label: 'Flush volume', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm³', min: 0, max: 2000, def: 280, advanced: true, tip: 'Filament purged when changing colour if the flushing-volume matrix has no value (into the chute on Bambu printers, onto the tower on manual-change printers).' },
  { key: 'mmu_paint_depth', label: 'Painted colour depth', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm', min: 0.4, max: 10, step: 0.1, def: 1.5, advanced: true, tip: 'How deep painted colours extend inward from the surface.' },

  { key: 'flush_into_infill', label: 'Flush into objects\' infill', tab: 'Others', group: 'Flush options', type: 'bool', def: false, tip: 'After a filament change, the sparse infill still to be printed is printed with the new filament and counted as flush, so less is wasted.' },
  { key: 'flush_into_objects', label: 'Flush into this object', tab: 'Others', group: 'Flush options', type: 'bool', def: false, advanced: true, tip: 'Per object: the whole object is printed right after filament changes and counted as flush. Its colour will be mixed.' },
  { key: 'flush_into_support', label: 'Flush into objects\' support', tab: 'Others', group: 'Flush options', type: 'bool', def: true, tip: 'After a filament change, the support of the layer is printed with the new filament and counted as flush.' },

  { key: 'slicing_mode', label: 'Slicing mode', tab: 'Others', group: 'Special mode', type: 'enum', def: 'regular', advanced: true, options: o(['regular', 'Regular'], ['even_odd', 'Even-odd'], ['close_holes', 'Close holes']),
    tip: 'Regular merges overlapping shells. Even-odd treats each nested shell as a hole (for 3DLabPrint-style models). Close holes fills all holes.' },
  { key: 'print_sequence', label: 'Print sequence', tab: 'Others', group: 'Special mode', type: 'enum', def: 'by_layer', options: o(['by_layer', 'By layer'], ['by_object', 'By object']),
    tip: 'By object prints each object completely before starting the next. Objects must be spaced by the extruder clearance radius and, except the last, be lower than the gantry rod.' },
  { key: 'spiral_mode', label: 'Spiral vase', tab: 'Others', group: 'Special mode', type: 'bool', def: false, tip: 'Prints one continuous rising outer wall with a solid bottom and no top.' },
  { key: 'spiral_mode_smooth', label: 'Smooth Spiral', tab: 'Others', group: 'Special mode', type: 'bool', def: false, disabledWhen: (c) => !vase(c), tip: 'Blends each spiral loop into the next one in XY as well, so no seam line shows.' },
  { key: 'spiral_mode_max_xy_smoothing', label: 'Max XY Smoothing', tab: 'Others', group: 'Special mode', type: 'floatOrPercent', unit: 'mm or %', def: '200%', percentOf: 'nozzle_diameter', advanced: true, disabledWhen: (c) => !vase(c) || !c.spiral_mode_smooth, tip: 'Furthest a point may move to blend loops, in mm or % of the nozzle diameter.' },
  { key: 'timelapse_type', label: 'Timelapse', tab: 'Others', group: 'Special mode', type: 'enum', def: 'traditional', options: o(['traditional', 'Instant'], ['smooth', 'Smooth']),
    tip: 'Instant takes a snapshot at each layer change wherever the head is. Smooth parks the head (over the prime tower) first; it needs a prime tower to wipe the nozzle.' },
  { key: 'fuzzy_skin', label: 'Fuzzy Skin', tab: 'Others', group: 'Special mode', type: 'enum', def: 'none', options: o(['none', 'None (allow paint)'], ['external', 'Contour'], ['all', 'Contour and hole'], ['allwalls', 'All walls'], ['disabled_fuzzy', 'Disabled']),
    tip: 'Adds jitter to walls for a textured, grippy finish.' },
  { key: 'fuzzy_skin_mode', label: 'Fuzzy skin generator mode', tab: 'Others', group: 'Special mode', type: 'enum', def: 'displacement', disabledWhen: noFuzzy, options: o(['displacement', 'Displacement'], ['extrusion', 'Extrusion'], ['combined', 'Combined']),
    tip: 'Displacement moves the wall in and out. Extrusion keeps the path and varies the line width. Combined does both.' },
  { key: 'fuzzy_skin_noise_type', label: 'Fuzzy skin noise type', tab: 'Others', group: 'Special mode', type: 'enum', def: 'classic', disabledWhen: noFuzzy, options: o(['classic', 'Classic'], ['perlin', 'Perlin'], ['billow', 'Billow'], ['ridgedmulti', 'Ridged Multifractal'], ['voronoi', 'Voronoi']),
    tip: 'Classic is white noise. Perlin, Billow, Ridged and Voronoi are coherent 3D noises that make the texture flow across layers.' },
  { key: 'fuzzy_skin_point_distance', label: 'Fuzzy skin point distance', tab: 'Others', group: 'Special mode', type: 'float', unit: 'mm', min: 0.1, max: 5, step: 0.1, def: 0.8, disabledWhen: noFuzzy, tip: 'Spacing between jittered points.' },
  { key: 'fuzzy_skin_thickness', label: 'Fuzzy skin thickness', tab: 'Others', group: 'Special mode', type: 'float', unit: 'mm', min: 0, max: 1, step: 0.01, def: 0.3, disabledWhen: noFuzzy, tip: 'Maximum jitter distance.' },
  { key: 'fuzzy_skin_scale', label: 'Fuzzy skin feature size', tab: 'Others', group: 'Special mode', type: 'float', unit: 'mm', min: 0.1, max: 500, step: 0.1, def: 1, advanced: true, disabledWhen: (c) => noFuzzy(c) || c.fuzzy_skin_noise_type === 'classic', tip: 'Size of the coherent noise features.' },
  { key: 'fuzzy_skin_octaves', label: 'Fuzzy skin noise octaves', tab: 'Others', group: 'Special mode', type: 'int', min: 1, max: 10, def: 4, advanced: true, disabledWhen: (c) => noFuzzy(c) || c.fuzzy_skin_noise_type === 'classic' || c.fuzzy_skin_noise_type === 'voronoi', tip: 'Layers of finer noise added on top of each other.' },
  { key: 'fuzzy_skin_persistence', label: 'Fuzzy skin noise persistence', tab: 'Others', group: 'Special mode', type: 'float', min: 0.01, max: 1, step: 0.01, def: 0.5, advanced: true, disabledWhen: (c) => noFuzzy(c) || c.fuzzy_skin_noise_type === 'classic' || c.fuzzy_skin_noise_type === 'voronoi', tip: 'How strongly each finer octave counts. Lower values are smoother.' },
  { key: 'fuzzy_skin_first_layer', label: 'Apply fuzzy skin to first layer', tab: 'Others', group: 'Special mode', type: 'bool', def: false, disabledWhen: noFuzzy, tip: 'Also roughen the first layer (can hurt bed adhesion and dimensional accuracy).' },

  { key: 'sparse_infill_filament', label: 'Sparse infill filament', tab: 'Others', group: 'Advanced', type: 'int', min: 0, max: 16, def: 0, advanced: true, tip: 'Filament slot for sparse infill (0 = the object\'s filament).' },
  { key: 'solid_infill_filament', label: 'Solid infill', tab: 'Others', group: 'Advanced', type: 'int', min: 0, max: 16, def: 0, advanced: true, tip: 'Filament slot for solid infill and top/bottom skins (0 = the object\'s filament).' },
  { key: 'wall_filament', label: 'Walls', tab: 'Others', group: 'Advanced', type: 'int', min: 0, max: 16, def: 0, advanced: true, tip: 'Filament slot for walls (0 = the object\'s filament).' },

  { key: 'reduce_infill_retraction_mode', label: 'Reduce infill retraction', tab: 'Others', group: 'G-code output', type: 'enum', def: 'auto', advanced: true, options: o(['disabled', 'Disabled'], ['auto', 'Auto'], ['enabled', 'Enabled']),
    tip: 'Skip retraction for travel that stays over sparse infill, where oozing is hidden. Auto also skips it for travel inside the same island of infill.' },
  { key: 'gcode_add_line_number', label: 'Add line number', tab: 'Others', group: 'G-code output', type: 'bool', def: false, advanced: true, tip: 'Prefix every G-code command with a line number (Nx).' },
  { key: 'exclude_object', label: 'Exclude objects', tab: 'Others', group: 'G-code output', type: 'bool', def: true, advanced: true, tip: 'Tag each object in the G-code so it can be cancelled mid-print (Klipper EXCLUDE_OBJECT / M486).' },
  { key: 'filename_format', label: 'Filename format', tab: 'Others', group: 'G-code output', type: 'string', def: '[input_filename_base]_[layer_height]mm_[filament_type]_[print_time].gcode', advanced: true,
    tip: 'Name of exported files. Placeholders: [input_filename_base], [plate_name], [layer_height], [filament_type], [printer_model], [print_time], [total_weight].' },
  { key: 'post_process', label: 'Post-processing Scripts', tab: 'Others', group: 'Post-processing scripts', type: 'text', def: '', advanced: true, tip: 'One command per line. Each runs with the absolute path of the exported G-code as its last argument and may rewrite the file in place (desktop app only). The environment carries SLIC3R_PP_OUTPUT_NAME and the settings as SLIC3R_<KEY>.' },
  { key: 'process_notes', label: 'Process notes', tab: 'Others', group: 'Notes', type: 'text', def: '', advanced: true, tip: 'Free text kept with the settings and written into the G-code config block.' },
];

export const PROCESS_DEFAULTS: Config = Object.fromEntries(PROCESS_PARAMS.map((p) => [p.key, p.def]));
export const PARAM_BY_KEY: Record<string, ParamDef> = Object.fromEntries(PROCESS_PARAMS.map((p) => [p.key, p]));
export const PROCESS_TABS: ProcessTab[] = ['Quality', 'Strength', 'Speed', 'Support', 'Others'];

/** Layer-height process presets (system presets). */
export const PROCESS_PRESETS: { id: string; name: string; values: Config }[] = [
  { id: '0.08', name: '0.08mm Extra Fine', values: { layer_height: 0.08, top_shell_layers: 9, bottom_shell_layers: 5 } },
  { id: '0.12', name: '0.12mm Fine', values: { layer_height: 0.12, top_shell_layers: 7, bottom_shell_layers: 4 } },
  { id: '0.16', name: '0.16mm Optimal', values: { layer_height: 0.16, top_shell_layers: 6, bottom_shell_layers: 4 } },
  { id: '0.20', name: '0.20mm Standard', values: { layer_height: 0.2 } },
  { id: '0.24', name: '0.24mm Draft', values: { layer_height: 0.24, top_shell_layers: 4 } },
  { id: '0.28', name: '0.28mm Extra Draft', values: { layer_height: 0.28, top_shell_layers: 4, bottom_shell_layers: 3 } },
];

/** Settings that only make sense for the whole plate; everything else may be overridden per object. */
export const GLOBAL_ONLY_KEYS = new Set([
  'travel_short_distance_acceleration', 'max_volumetric_extrusion_rate_slope_positive', 'max_volumetric_extrusion_rate_slope_negative', 'post_process', 'interface_shells',
  'layer_height', 'initial_layer_print_height', 'initial_layer_line_width', 'initial_layer_infill_line_width', 'support_line_width', 'precise_z_height', 'slice_closing_radius',
  'reduce_crossing_wall', 'max_travel_detour_distance', 'travel_speed', 'travel_acceleration', 'initial_layer_travel_acceleration', 'accel_to_decel_enable', 'accel_to_decel_factor',
  'default_jerk', 'travel_jerk', 'initial_layer_jerk', 'enable_height_slowdown', 'slowdown_start_height', 'slowdown_start_speed', 'slowdown_start_acc', 'slowdown_end_height', 'slowdown_end_speed', 'slowdown_end_acc',
  ...PROCESS_PARAMS.filter((p) => p.tab === 'Support').map((p) => p.key),
  'skirt_loops', 'skirt_height', 'skirt_distance', 'brim_type', 'brim_width', 'brim_object_gap', 'enable_prime_tower', 'prime_tower_width', 'prime_tower_max_speed', 'prime_tower_brim_width',
  'prime_tower_infill_gap', 'prime_tower_rib_wall', 'prime_tower_extra_rib_length', 'prime_tower_rib_width', 'prime_tower_fillet_wall', 'prime_volume', 'prime_tower_x', 'prime_tower_y',
  'flush_volume', 'mmu_paint_depth', 'flush_into_infill', 'flush_into_support', 'slicing_mode', 'print_sequence', 'spiral_mode', 'spiral_mode_smooth', 'spiral_mode_max_xy_smoothing',
  'timelapse_type', 'reduce_infill_retraction_mode', 'gcode_add_line_number', 'exclude_object', 'filename_format', 'process_notes', 'enable_arc_fitting', 'resolution',
]);
/** Settings that may be overridden per object (Objects tab). */
export const OBJECT_KEYS = PROCESS_PARAMS.map((p) => p.key).filter((k) => !GLOBAL_ONLY_KEYS.has(k)).concat(['flush_into_objects', 'flow_ratio_scale']);
/** Settings a height range modifier may change for its layers. */
export const HEIGHT_RANGE_KEYS = OBJECT_KEYS.filter((k) => k !== 'flush_into_objects' && k !== 'slicing_mode');
/** Settings a modifier volume may change inside its region. */
export const MODIFIER_KEYS = ['sparse_infill_density', 'sparse_infill_pattern', 'infill_direction', 'sparse_infill_speed'];

/**
 * Brings settings saved by older NexSpiro versions up to date: renamed keys and changed enum values.
 * `from` is the version the settings were saved with (1 = before the Bambu Studio key alignment).
 */
export function migrateConfig(c: Config | undefined, from: number): Config {
  if (!c) return {};
  const out: Config = { ...c };
  if (from < 2) {
    if ('label_objects' in out) { out.exclude_object = out.label_objects; delete out.label_objects; }
    if ('reduce_infill_retraction' in out) { out.reduce_infill_retraction_mode = out.reduce_infill_retraction ? 'auto' : 'disabled'; delete out.reduce_infill_retraction; }
    if ('overhang_speed' in out) { out.overhang_totally_speed = out.overhang_speed; delete out.overhang_speed; }
    // NexSpiro 1 called "all walls" 'all'; Bambu's 'all' is outer walls of contours and holes
    if (out.fuzzy_skin === 'all') out.fuzzy_skin = 'allwalls';
  }
  return out;
}
export const CONFIG_VERSION = 2;
