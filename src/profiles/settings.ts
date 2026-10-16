// Process parameter schema. Every key listed here is honoured by the engine.
export type ParamType = 'float' | 'int' | 'bool' | 'enum' | 'percent';
export type ProcessTab = 'Quality' | 'Strength' | 'Speed' | 'Support' | 'Others';
export type ConfigValue = number | boolean | string;
export type Config = Record<string, ConfigValue>;

export interface ParamDef {
  key: string;
  label: string;
  tab: ProcessTab;
  group: string;
  type: ParamType;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  def: ConfigValue;
  tip: string;
  advanced?: boolean;
  /** Disabled when this returns true for the current config. */
  disabledWhen?: (c: Config) => boolean;
}

const vase = (c: Config) => c.spiral_mode === true;
const noSupport = (c: Config) => !c.enable_support;
const noIron = (c: Config) => c.ironing_type === 'no_ironing';
const noFuzzy = (c: Config) => c.fuzzy_skin === 'none';

const surfacePatterns = [
  { value: 'monotonic', label: 'Monotonic' },
  { value: 'rectilinear', label: 'Rectilinear' },
  { value: 'aligned_rectilinear', label: 'Aligned Rectilinear' },
  { value: 'concentric', label: 'Concentric' },
];

export const PROCESS_PARAMS: ParamDef[] = [
  // ---------------- Quality
  { key: 'layer_height', label: 'Layer height', tab: 'Quality', group: 'Layer height', type: 'float', unit: 'mm', min: 0.04, max: 0.6, step: 0.01, def: 0.2, tip: 'Vertical thickness of each layer. Smaller values give smoother sides but print slower. Rule of thumb: 20–70% of nozzle diameter.' },
  { key: 'initial_layer_print_height', label: 'Initial layer height', tab: 'Quality', group: 'Layer height', type: 'float', unit: 'mm', min: 0.05, max: 0.6, step: 0.01, def: 0.2, tip: 'Thickness of the first layer. A slightly thicker first layer absorbs small bed flatness errors.' },
  { key: 'line_width', label: 'Default', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0.1, max: 2, step: 0.01, def: 0.42, tip: 'Fallback extrusion width when a specific line type is set to 0.' },
  { key: 'initial_layer_line_width', label: 'Initial layer', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.5, tip: 'Wider first layer lines increase bed contact and adhesion.' },
  { key: 'outer_wall_line_width', label: 'Outer wall', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.42, tip: 'Width of the external visible perimeter.' },
  { key: 'inner_wall_line_width', label: 'Inner wall', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.45, tip: 'Width of the internal perimeters.' },
  { key: 'top_surface_line_width', label: 'Top surface', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.42, tip: 'Width of top skin lines. Narrower lines give finer top surfaces.' },
  { key: 'sparse_infill_line_width', label: 'Sparse infill', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.45, tip: 'Width of sparse infill lines.' },
  { key: 'internal_solid_infill_line_width', label: 'Internal solid infill', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.42, tip: 'Width of solid infill below top and above bottom skins.' },
  { key: 'support_line_width', label: 'Support', tab: 'Quality', group: 'Line width', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.42, tip: 'Width of support lines.' },
  { key: 'seam_position', label: 'Seam position', tab: 'Quality', group: 'Seam', type: 'enum', def: 'aligned', options: [
    { value: 'aligned', label: 'Aligned' }, { value: 'nearest', label: 'Nearest' }, { value: 'back', label: 'Back' }, { value: 'random', label: 'Random' }],
    tip: 'Where each perimeter loop starts and ends. Aligned stacks seams into one vertical line; Back hides them at the rear; Random scatters them.' },
  { key: 'wall_generator', label: 'Wall generator', tab: 'Quality', group: 'Wall generator', type: 'enum', def: 'classic', options: [{ value: 'classic', label: 'Classic' }, { value: 'arachne', label: 'Arachne (variable width)' }], tip: 'Arachne varies the line width so thin walls and narrow gaps are filled by a single bead instead of being skipped or overlapped.' },
  { key: 'enable_arc_fitting', label: 'Arc fitting', tab: 'Quality', group: 'Precision', type: 'bool', def: false, tip: 'Replaces chains of short segments on curves with G2/G3 arc moves. Smaller G-code and smoother curves on firmware that supports arcs.' },
  { key: 'flow_ratio_scale', label: 'Flow ratio scale', tab: 'Quality', group: 'Advanced', type: 'float', min: 0.5, max: 1.5, step: 0.01, def: 1, advanced: true, tip: 'Multiplies the filament flow ratio for this object. Used by the flow-rate calibration.' },
  { key: 'resolution', label: 'Resolution', tab: 'Quality', group: 'Precision', type: 'float', unit: 'mm', min: 0, max: 0.2, step: 0.001, def: 0.012, advanced: true, tip: 'Paths are simplified by removing points that deviate less than this distance. Reduces G-code size.' },
  { key: 'xy_hole_compensation', label: 'X-Y hole compensation', tab: 'Quality', group: 'Precision', type: 'float', unit: 'mm', min: -2, max: 2, step: 0.01, def: 0, tip: 'Grows (+) or shrinks (−) holes in the XY plane to correct for shrinkage.' },
  { key: 'xy_contour_compensation', label: 'X-Y contour compensation', tab: 'Quality', group: 'Precision', type: 'float', unit: 'mm', min: -2, max: 2, step: 0.01, def: 0, tip: 'Grows (+) or shrinks (−) outer contours in the XY plane.' },
  { key: 'elefant_foot_compensation', label: 'Elephant foot compensation', tab: 'Quality', group: 'Precision', type: 'float', unit: 'mm', min: 0, max: 1, step: 0.01, def: 0.15, tip: 'Shrinks the first layer inward to cancel the squish bulge ("elephant foot").' },
  { key: 'ironing_type', label: 'Ironing type', tab: 'Quality', group: 'Ironing', type: 'enum', def: 'no_ironing', options: [
    { value: 'no_ironing', label: 'No ironing' }, { value: 'top', label: 'Top surfaces' }, { value: 'topmost', label: 'Topmost surface only' }],
    tip: 'Runs the hot nozzle over top surfaces again with a tiny flow to smooth them.' },
  { key: 'ironing_flow', label: 'Ironing flow', tab: 'Quality', group: 'Ironing', type: 'percent', unit: '%', min: 0, max: 100, def: 10, disabledWhen: noIron, tip: 'Extrusion amount during ironing, as a percentage of a normal layer.' },
  { key: 'ironing_spacing', label: 'Ironing line spacing', tab: 'Quality', group: 'Ironing', type: 'float', unit: 'mm', min: 0.05, max: 1, step: 0.01, def: 0.15, disabledWhen: noIron, tip: 'Distance between ironing passes.' },
  { key: 'ironing_speed', label: 'Ironing speed', tab: 'Quality', group: 'Ironing', type: 'float', unit: 'mm/s', min: 5, max: 300, def: 30, disabledWhen: noIron, tip: 'Nozzle speed while ironing.' },
  { key: 'wall_sequence', label: 'Order of walls', tab: 'Quality', group: 'Advanced', type: 'enum', def: 'inner_outer', options: [
    { value: 'inner_outer', label: 'Inner/Outer' }, { value: 'outer_inner', label: 'Outer/Inner' }, { value: 'inner_outer_inner', label: 'Inner/Outer/Inner' }],
    tip: 'Inner/Outer is best for overhangs; Outer/Inner improves dimensional accuracy.' },
  { key: 'is_infill_first', label: 'Print infill first', tab: 'Quality', group: 'Advanced', type: 'bool', def: false, advanced: true, tip: 'Print infill before walls. Rarely useful; can show infill through the walls.' },
  { key: 'bridge_flow', label: 'Bridge flow', tab: 'Quality', group: 'Advanced', type: 'float', min: 0.5, max: 1.5, step: 0.01, def: 1, tip: 'Extrusion multiplier for bridges. Slightly lower values reduce sagging.' },

  // ---------------- Strength
  { key: 'wall_loops', label: 'Wall loops', tab: 'Strength', group: 'Walls', type: 'int', min: 0, max: 50, def: 2, tip: 'Number of perimeters. More walls add the most strength per gram.' },
  { key: 'top_surface_pattern', label: 'Top surface pattern', tab: 'Strength', group: 'Top/bottom shells', type: 'enum', def: 'monotonic', options: surfacePatterns, tip: 'Fill pattern for the visible top skin. Monotonic prints every line in one direction for an even sheen.' },
  { key: 'top_shell_layers', label: 'Top shell layers', tab: 'Strength', group: 'Top/bottom shells', type: 'int', min: 0, max: 100, def: 5, disabledWhen: vase, tip: 'Number of solid layers at the top of the model.' },
  { key: 'top_shell_thickness', label: 'Top shell thickness', tab: 'Strength', group: 'Top/bottom shells', type: 'float', unit: 'mm', min: 0, max: 10, step: 0.1, def: 1, disabledWhen: vase, tip: 'Minimum top skin thickness. Extra layers are added if the layer count alone is too thin.' },
  { key: 'bottom_surface_pattern', label: 'Bottom surface pattern', tab: 'Strength', group: 'Top/bottom shells', type: 'enum', def: 'monotonic', options: surfacePatterns, tip: 'Fill pattern for bottom skins.' },
  { key: 'bottom_shell_layers', label: 'Bottom shell layers', tab: 'Strength', group: 'Top/bottom shells', type: 'int', min: 0, max: 100, def: 3, tip: 'Number of solid layers at the bottom of the model.' },
  { key: 'bottom_shell_thickness', label: 'Bottom shell thickness', tab: 'Strength', group: 'Top/bottom shells', type: 'float', unit: 'mm', min: 0, max: 10, step: 0.1, def: 0, tip: 'Minimum bottom skin thickness (0 = layer count only).' },
  { key: 'sparse_infill_density', label: 'Sparse infill density', tab: 'Strength', group: 'Sparse infill', type: 'percent', unit: '%', min: 0, max: 100, def: 15, disabledWhen: vase, tip: 'Volume fraction of internal infill. 100% switches to solid infill.' },
  { key: 'sparse_infill_pattern', label: 'Sparse infill pattern', tab: 'Strength', group: 'Sparse infill', type: 'enum', def: 'grid', disabledWhen: vase, options: [
    { value: 'grid', label: 'Grid' }, { value: 'gyroid', label: 'Gyroid' }, { value: 'rectilinear', label: 'Rectilinear' },
    { value: 'aligned_rectilinear', label: 'Aligned Rectilinear' }, { value: 'triangles', label: 'Triangles' }, { value: 'concentric', label: 'Concentric' }],
    tip: 'Internal lattice. Gyroid is strong in all directions with no line crossings; Grid is fast and stiff.' },
  { key: 'infill_wall_overlap', label: 'Infill/Wall overlap', tab: 'Strength', group: 'Advanced', type: 'percent', unit: '%', min: 0, max: 100, def: 15, tip: 'How far infill reaches into the innermost wall to bond with it.' },
  { key: 'infill_direction', label: 'Infill direction', tab: 'Strength', group: 'Advanced', type: 'float', unit: '°', min: 0, max: 360, def: 45, tip: 'Base angle of infill lines.' },
  { key: 'solid_infill_direction', label: 'Solid infill direction', tab: 'Strength', group: 'Advanced', type: 'float', unit: '°', min: 0, max: 360, def: 45, tip: 'Base angle of solid/skin lines (alternates by 90° each layer).' },
  { key: 'minimum_sparse_infill_area', label: 'Minimum sparse infill threshold', tab: 'Strength', group: 'Advanced', type: 'float', unit: 'mm²', min: 0, max: 500, def: 15, tip: 'Sparse regions smaller than this are filled solid instead.' },

  // ---------------- Speed
  { key: 'initial_layer_speed', label: 'Initial layer', tab: 'Speed', group: 'Initial layer speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 50, tip: 'Speed for walls on the first layer.' },
  { key: 'initial_layer_infill_speed', label: 'Initial layer infill', tab: 'Speed', group: 'Initial layer speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 105, tip: 'Speed for solid infill on the first layer.' },
  { key: 'outer_wall_speed', label: 'Outer wall', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 200, tip: 'Speed of the visible outer perimeter.' },
  { key: 'inner_wall_speed', label: 'Inner wall', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 300, tip: 'Speed of inner perimeters.' },
  { key: 'sparse_infill_speed', label: 'Sparse infill', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 270, tip: 'Speed of sparse infill.' },
  { key: 'internal_solid_infill_speed', label: 'Internal solid infill', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 250, tip: 'Speed of internal solid infill.' },
  { key: 'top_surface_speed', label: 'Top surface', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 200, tip: 'Speed of the top skin.' },
  { key: 'support_speed', label: 'Support', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 150, tip: 'Speed of support structures.' },
  { key: 'support_interface_speed', label: 'Support interface', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 80, tip: 'Speed of dense support roof/floor layers.' },
  { key: 'bridge_speed', label: 'Bridge', tab: 'Speed', group: 'Other layers speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 50, tip: 'Speed of unsupported bridge spans.' },
  { key: 'overhang_speed', label: 'Overhang walls', tab: 'Speed', group: 'Overhang speed', type: 'float', unit: 'mm/s', min: 1, max: 1000, def: 30, tip: 'Wall segments that overhang the layer below by more than half a line width are printed at this speed.' },
  { key: 'travel_speed', label: 'Travel', tab: 'Speed', group: 'Travel speed', type: 'float', unit: 'mm/s', min: 1, max: 2000, def: 500, tip: 'Speed of non-printing moves.' },
  { key: 'default_acceleration', label: 'Normal printing', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 10000, tip: 'Default acceleration.' },
  { key: 'initial_layer_acceleration', label: 'Initial layer', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 500, tip: 'Gentle acceleration on the first layer helps adhesion.' },
  { key: 'outer_wall_acceleration', label: 'Outer wall', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 5000, tip: 'Lower outer-wall acceleration reduces ringing.' },
  { key: 'top_surface_acceleration', label: 'Top surface', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 2000, tip: 'Acceleration for top skin.' },
  { key: 'travel_acceleration', label: 'Travel', tab: 'Speed', group: 'Acceleration', type: 'float', unit: 'mm/s²', min: 100, max: 100000, def: 10000, tip: 'Acceleration for travel moves.' },

  // ---------------- Support
  { key: 'enable_support', label: 'Enable support', tab: 'Support', group: 'Support', type: 'bool', def: false, tip: 'Generate support under overhangs steeper than the threshold angle.' },
  { key: 'support_type', label: 'Type', tab: 'Support', group: 'Support', type: 'enum', def: 'normal_auto', disabledWhen: noSupport, options: [
    { value: 'normal_auto', label: 'Normal (auto)' }, { value: 'tree_auto', label: 'Tree (auto)' },
    { value: 'normal_manual', label: 'Normal (manual)' }, { value: 'tree_manual', label: 'Tree (manual)' }],
    tip: 'Normal supports project vertical columns down from overhangs. Tree supports grow branches that steer around the model and merge into trunks. Manual types only support painted enforcer areas and enforcer volumes.' },
  { key: 'support_threshold_angle', label: 'Threshold angle', tab: 'Support', group: 'Support', type: 'float', unit: '°', min: 1, max: 90, def: 30, disabledWhen: noSupport, tip: 'Faces flatter than this angle (measured from the bed) get support.' },
  { key: 'support_on_build_plate_only', label: 'On build plate only', tab: 'Support', group: 'Support', type: 'bool', def: false, disabledWhen: noSupport, tip: 'Never start supports on top of the model itself.' },
  { key: 'support_remove_small_overhang', label: 'Remove small overhangs', tab: 'Support', group: 'Support', type: 'bool', def: true, disabledWhen: noSupport, tip: 'Skip tiny overhangs that print fine without support.' },
  { key: 'support_top_z_distance', label: 'Top Z distance', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.2, disabledWhen: noSupport, tip: 'Vertical gap between support and the model above it. Larger is easier to remove.' },
  { key: 'support_base_pattern_spacing', label: 'Base pattern spacing', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 10, step: 0.1, def: 2.5, disabledWhen: noSupport, tip: 'Gap between support lines.' },
  { key: 'support_angle', label: 'Pattern angle', tab: 'Support', group: 'Advanced', type: 'float', unit: '°', min: 0, max: 359, def: 0, disabledWhen: noSupport, tip: 'Direction of support lines.' },
  { key: 'support_interface_top_layers', label: 'Top interface layers', tab: 'Support', group: 'Advanced', type: 'int', min: 0, max: 10, def: 2, disabledWhen: noSupport, tip: 'Dense layers directly under the model.' },
  { key: 'support_interface_spacing', label: 'Top interface spacing', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 5, step: 0.1, def: 0.5, disabledWhen: noSupport, tip: 'Gap between interface lines.' },
  { key: 'tree_support_branch_angle', label: 'Tree branch angle', tab: 'Support', group: 'Tree supports', type: 'float', unit: '°', min: 5, max: 70, def: 40, disabledWhen: (c) => !c.enable_support || !String(c.support_type).startsWith('tree'), tip: 'How far a branch may lean from vertical. Larger angles reach further around the model.' },
  { key: 'tree_support_tip_diameter', label: 'Tip diameter', tab: 'Support', group: 'Tree supports', type: 'float', unit: 'mm', min: 0.4, max: 5, step: 0.1, def: 1.6, disabledWhen: (c) => !c.enable_support || !String(c.support_type).startsWith('tree'), tip: 'Diameter of branch tips touching the model.' },
  { key: 'tree_support_branch_diameter', label: 'Maximum trunk diameter', tab: 'Support', group: 'Tree supports', type: 'float', unit: 'mm', min: 1, max: 20, step: 0.5, def: 6, disabledWhen: (c) => !c.enable_support || !String(c.support_type).startsWith('tree'), tip: 'Branches thicken as they merge and descend, up to this diameter.' },
  { key: 'tree_support_branch_distance', label: 'Tip spacing', tab: 'Support', group: 'Tree supports', type: 'float', unit: 'mm', min: 1, max: 20, step: 0.5, def: 4, disabledWhen: (c) => !c.enable_support || !String(c.support_type).startsWith('tree'), tip: 'Distance between branch tips under an overhang.' },
  { key: 'support_filament', label: 'Support filament', tab: 'Support', group: 'Advanced', type: 'int', min: 0, max: 16, def: 0, disabledWhen: noSupport, tip: 'Filament slot used for supports (0 = whichever filament is loaded, avoiding extra filament changes).' },
  { key: 'support_object_xy_distance', label: 'Support/object XY distance', tab: 'Support', group: 'Advanced', type: 'float', unit: 'mm', min: 0, max: 5, step: 0.05, def: 0.35, disabledWhen: noSupport, tip: 'Horizontal clearance between supports and the model walls.' },

  // ---------------- Others
  { key: 'skirt_loops', label: 'Skirt loops', tab: 'Others', group: 'Bed adhesion', type: 'int', min: 0, max: 20, def: 0, tip: 'Priming loops drawn around the objects on the first layer(s).' },
  { key: 'skirt_distance', label: 'Skirt distance', tab: 'Others', group: 'Bed adhesion', type: 'float', unit: 'mm', min: 0, max: 50, def: 2, tip: 'Distance between skirt and objects.' },
  { key: 'skirt_height', label: 'Skirt height', tab: 'Others', group: 'Bed adhesion', type: 'int', unit: 'layers', min: 1, max: 1000, def: 1, tip: 'Number of skirt layers. Tall skirts act as a draft shield.' },
  { key: 'brim_type', label: 'Brim type', tab: 'Others', group: 'Bed adhesion', type: 'enum', def: 'auto_brim', options: [
    { value: 'auto_brim', label: 'Auto' }, { value: 'outer_only', label: 'Outer brim only' }, { value: 'inner_only', label: 'Inner brim only' },
    { value: 'outer_and_inner', label: 'Outer and inner brim' }, { value: 'no_brim', label: 'No-brim' }],
    tip: 'Auto adds a brim only to tall, narrow objects with a small footprint.' },
  { key: 'brim_width', label: 'Brim width', tab: 'Others', group: 'Bed adhesion', type: 'float', unit: 'mm', min: 0, max: 100, def: 5, tip: 'Width of the brim flange.' },
  { key: 'brim_object_gap', label: 'Brim-object gap', tab: 'Others', group: 'Bed adhesion', type: 'float', unit: 'mm', min: 0, max: 2, step: 0.01, def: 0.1, tip: 'Small gap between brim and object for easy removal.' },
  { key: 'enable_prime_tower', label: 'Enable prime tower', tab: 'Others', group: 'Prime tower', type: 'bool', def: true, tip: 'Builds a small tower that primes the nozzle after every filament change. Used only when more than one filament is printed.' },
  { key: 'prime_tower_width', label: 'Width', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm', min: 10, max: 100, def: 35, tip: 'X width of the prime tower. Its depth is sized from the prime volume.' },
  { key: 'prime_volume', label: 'Prime volume', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm³', min: 10, max: 1000, def: 45, tip: 'Volume printed on the tower after each filament change.' },
  { key: 'prime_tower_x', label: 'Position X', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm', min: -1, max: 1000, def: -1, tip: 'Front-left corner of the tower (−1 = automatic, back right of the plate).' },
  { key: 'prime_tower_y', label: 'Position Y', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm', min: -1, max: 1000, def: -1, tip: 'Front-left corner of the tower (−1 = automatic).' },
  { key: 'flush_volume', label: 'Flush volume', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm³', min: 0, max: 2000, def: 280, tip: 'Filament purged when changing colour (into the chute on Bambu printers, onto the tower on manual-change printers).' },
  { key: 'mmu_paint_depth', label: 'Painted colour depth', tab: 'Others', group: 'Prime tower', type: 'float', unit: 'mm', min: 0.4, max: 10, step: 0.1, def: 1.5, tip: 'How deep painted colours extend inward from the surface.' },
  { key: 'spiral_mode', label: 'Spiral vase', tab: 'Others', group: 'Special mode', type: 'bool', def: false, tip: 'Prints one continuous rising outer wall with a solid bottom and no top.' },
  { key: 'fuzzy_skin', label: 'Fuzzy skin', tab: 'Others', group: 'Special mode', type: 'enum', def: 'none', options: [
    { value: 'none', label: 'None' }, { value: 'external', label: 'Outer walls' }, { value: 'all', label: 'All walls' }],
    tip: 'Adds random jitter to walls for a textured, grippy finish.' },
  { key: 'fuzzy_skin_thickness', label: 'Fuzzy skin thickness', tab: 'Others', group: 'Special mode', type: 'float', unit: 'mm', min: 0, max: 1, step: 0.01, def: 0.3, disabledWhen: noFuzzy, tip: 'Maximum jitter distance.' },
  { key: 'fuzzy_skin_point_distance', label: 'Fuzzy skin point distance', tab: 'Others', group: 'Special mode', type: 'float', unit: 'mm', min: 0.1, max: 5, step: 0.1, def: 0.8, disabledWhen: noFuzzy, tip: 'Spacing between jittered points.' },
  { key: 'reduce_infill_retraction', label: 'Reduce infill retraction', tab: 'Others', group: 'G-code output', type: 'bool', def: true, tip: 'Skip retractions for travel moves that stay inside sparse infill.' },
  { key: 'label_objects', label: 'Label objects', tab: 'Others', group: 'G-code output', type: 'bool', def: true, tip: 'Tag each object in the G-code so it can be cancelled mid-print (Klipper EXCLUDE_OBJECT / M486).' },
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

/** Settings that may be overridden per object (Objects tab). */
export const OBJECT_KEYS = [
  'wall_loops', 'top_shell_layers', 'bottom_shell_layers', 'top_surface_pattern', 'bottom_surface_pattern',
  'sparse_infill_density', 'sparse_infill_pattern', 'infill_direction', 'seam_position',
  'ironing_type', 'fuzzy_skin', 'fuzzy_skin_thickness', 'infill_wall_overlap', 'flow_ratio_scale',
  'top_shell_thickness', 'bottom_shell_thickness',
  'outer_wall_speed', 'inner_wall_speed', 'overhang_speed', 'sparse_infill_speed', 'internal_solid_infill_speed', 'top_surface_speed',
  'bridge_speed', 'ironing_speed', 'initial_layer_speed', 'initial_layer_infill_speed',
];
/** Settings a modifier volume may change inside its region. */
export const MODIFIER_KEYS = ['sparse_infill_density', 'sparse_infill_pattern'];
