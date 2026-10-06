// Bambu Studio / OrcaSlicer-style process settings: one schema drives the settings UI, the planar slicer and exports.
// Keys follow the Bambu/Orca config names (snake_case) so values map 1:1 onto their JSON/3MF settings.
export type SettingValue = number | boolean | string;
export type SettingMap = Record<string, SettingValue>;
export type SettingTab = "quality" | "strength" | "speed" | "support" | "others";
export type SettingDef = {
  key: string; tab: SettingTab; group: string; label: string;
  kind: "num" | "bool" | "enum" | "text";
  def: SettingValue;
  unit?: string; min?: number; max?: number; step?: number;
  options?: [value: string, label: string][];
  level?: 0 | 1 | 2;            // 0 always shown, 1 with Advanced, 2 expert (also only with Advanced)
  tip?: string;
  alias?: string;               // lives in a legacy ProcessPreset field (layerHeight …) instead of `settings`
  wired?: boolean;              // false = stored/exported but the NexSpiro engine does not act on it (yet)
  showIf?: string;              // "otherKey=value" visibility condition
};

const o = (...pairs: string[]): [string, string][] => pairs.map((p) => { const [v, l] = p.split("|"); return [v, l ?? v]; });
type Opts = Partial<Omit<SettingDef, "key" | "tab" | "group" | "label" | "kind" | "def">>;
const D: SettingDef[] = [];
const grp = (tab: SettingTab, group: string) => {
  const add = (kind: SettingDef["kind"]) => (key: string, label: string, def: SettingValue, opt: Opts = {}) => { D.push({ key, tab, group, label, kind, def, level: 0, wired: true, ...opt }); };
  return { num: add("num"), bool: add("bool"), enum: add("enum"), text: add("text") };
};

// ================= Quality =================
{
  const g = grp("quality", "Layer height");
  g.num("layer_height", "Layer height", 0.2, { unit: "mm", min: 0.05, max: 0.8, step: 0.01, alias: "layerHeight", tip: "Thickness of each printed layer." });
  g.num("initial_layer_print_height", "Initial layer height", 0.2, { unit: "mm", min: 0.05, max: 0.8, step: 0.01, alias: "firstLayerHeight" });
}
{
  const g = grp("quality", "Line width");
  g.num("line_width", "Default", 0.42, { unit: "mm", min: 0.2, max: 1.6, step: 0.01, alias: "lineWidth" });
  g.num("initial_layer_line_width", "Initial layer", 0.5, { unit: "mm", min: 0.2, max: 1.6, step: 0.01 });
  g.num("outer_wall_line_width", "Outer wall", 0.42, { unit: "mm", min: 0.2, max: 1.6, step: 0.01 });
  g.num("inner_wall_line_width", "Inner wall", 0.45, { unit: "mm", min: 0.2, max: 1.6, step: 0.01 });
  g.num("top_surface_line_width", "Top surface", 0.42, { unit: "mm", min: 0.2, max: 1.6, step: 0.01 });
  g.num("sparse_infill_line_width", "Sparse infill", 0.45, { unit: "mm", min: 0.2, max: 1.6, step: 0.01 });
  g.num("internal_solid_infill_line_width", "Internal solid infill", 0.42, { unit: "mm", min: 0.2, max: 1.6, step: 0.01 });
  g.num("support_line_width", "Support", 0.42, { unit: "mm", min: 0.2, max: 1.6, step: 0.01 });
}
{
  const g = grp("quality", "Seam");
  g.enum("seam_position", "Seam position", "aligned", { options: o("nearest|Nearest", "aligned|Aligned", "back|Back", "random|Random") });
  g.bool("staggered_inner_seams", "Staggered inner seams", false, { level: 1 });
  g.num("seam_gap", "Seam gap", 15, { unit: "%", min: 0, max: 100, step: 1, level: 1, wired: false });
  g.bool("role_based_wipe_speed", "Role-based wipe speed", true, { level: 2, wired: false });
  g.bool("wipe_on_loops", "Wipe on loops", false, { level: 1 });
}
{
  const g = grp("quality", "Precision");
  g.num("slice_closing_radius", "Slice gap closing radius", 0.049, { unit: "mm", min: 0, max: 2, step: 0.001, level: 1 });
  g.num("resolution", "Resolution", 0.012, { unit: "mm", min: 0.001, max: 1, step: 0.001, level: 1 });
  g.bool("enable_arc_fitting", "Arc fitting", false, { level: 1, alias: "arcFitting" });
  g.num("xy_hole_compensation", "X-Y hole compensation", 0, { unit: "mm", min: -2, max: 2, step: 0.01, level: 1 });
  g.num("xy_contour_compensation", "X-Y contour compensation", 0, { unit: "mm", min: -2, max: 2, step: 0.01, level: 1 });
  g.bool("elefant_foot_compensation_on", "Elephant-foot compensation", true, { level: 1 });
  g.num("elefant_foot_compensation", "Elephant-foot compensation value", 0.15, { unit: "mm", min: 0, max: 2, step: 0.01, level: 1, showIf: "elefant_foot_compensation_on=true" });
  g.bool("precise_outer_wall", "Precise wall", false, { level: 1, tip: "Improves outer-wall dimensional accuracy by placing the inner wall relative to the outer wall." });
  g.enum("wall_generator", "Wall generator", "classic", { options: o("classic|Classic", "arachne|Arachne"), level: 1, wired: false });
}
{
  const g = grp("quality", "Ironing");
  g.enum("ironing_type", "Ironing type", "no ironing", { options: o("no ironing|No ironing", "top|Top surfaces", "topmost|Topmost surface", "solid|All solid layers") });
  g.enum("ironing_pattern", "Ironing pattern", "zig-zag", { options: o("zig-zag|Rectilinear", "concentric|Concentric"), level: 1, showIf: "ironing_type!=no ironing" });
  g.num("ironing_flow", "Ironing flow", 15, { unit: "%", min: 0, max: 100, step: 1, level: 1, showIf: "ironing_type!=no ironing" });
  g.num("ironing_spacing", "Ironing line spacing", 0.15, { unit: "mm", min: 0.05, max: 1, step: 0.01, level: 1, showIf: "ironing_type!=no ironing" });
  g.num("ironing_speed", "Ironing speed", 20, { unit: "mm/s", min: 5, max: 100, step: 1, level: 1, showIf: "ironing_type!=no ironing" });
}
{
  const g = grp("quality", "Walls & overhangs");
  g.enum("wall_sequence", "Walls printing order", "inner wall/outer wall", { options: o("inner wall/outer wall|Inner / Outer", "outer wall/inner wall|Outer / Inner", "inner-outer-inner wall|Inner-Outer-Inner") });
  g.bool("detect_overhang_wall", "Detect overhang wall", true, { tip: "Slow down on overhanging walls." });
  g.bool("reduce_crossing_wall", "Avoid crossing walls", false, { level: 1, tip: "Detour to avoid travelling across walls (less stringing)." });
  g.num("max_travel_detour_distance", "Max detour length", 0, { unit: "mm", min: 0, max: 200, step: 1, level: 2, showIf: "reduce_crossing_wall=true" });
  g.bool("thick_bridges", "Thick bridges", true, { level: 1 });
  g.num("bridge_flow", "Bridge flow", 1, { min: 0.5, max: 1.5, step: 0.01, level: 1 });
  g.bool("only_one_wall_top", "Only one wall on top surfaces", false, { level: 1 });
  g.bool("only_one_wall_first_layer", "Only one wall on first layer", false, { level: 1 });
  g.bool("make_overhang_printable", "Make overhangs printable", false, { level: 2, wired: false });
}
{
  const g = grp("quality", "Extrusion calibration");
  g.num("print_flow_ratio", "Flow ratio", 1, { min: 0.8, max: 1.2, step: 0.001, level: 1, tip: "Multiplies all extrusion; calibrate with a flow test." });
  g.num("pressure_advance_override", "Pressure advance (K)", 0, { min: 0, max: 2, step: 0.001, level: 1, tip: "0 = use the filament value." });
}

// ================= Strength =================
{
  const g = grp("strength", "Walls");
  g.num("wall_loops", "Wall loops", 2, { min: 1, max: 20, step: 1 });
  g.bool("alternate_extra_wall", "Alternate extra wall", false, { level: 1 });
  g.bool("detect_thin_wall", "Detect thin walls", false, { level: 1 });
  g.bool("ensure_vertical_shell_thickness", "Ensure vertical shell thickness", true, { level: 2, wired: false });
}
{
  const g = grp("strength", "Top/bottom shells");
  g.num("top_shell_layers", "Top shell layers", 5, { min: 0, max: 50, step: 1 });
  g.num("top_shell_thickness", "Top shell thickness", 1, { unit: "mm", min: 0, max: 10, step: 0.1 });
  g.enum("top_surface_pattern", "Top surface pattern", "monotonic", { options: o("monotonic|Monotonic", "monotonicline|Monotonic line", "alignedrectilinear|Aligned rectilinear", "zig-zag|Rectilinear", "concentric|Concentric", "hilbertcurve|Hilbert curve", "archimedeanchords|Archimedean chords", "octagramspiral|Octagram spiral") });
  g.num("bottom_shell_layers", "Bottom shell layers", 3, { min: 0, max: 50, step: 1 });
  g.num("bottom_shell_thickness", "Bottom shell thickness", 0, { unit: "mm", min: 0, max: 10, step: 0.1 });
  g.enum("bottom_surface_pattern", "Bottom surface pattern", "monotonic", { options: o("monotonic|Monotonic", "monotonicline|Monotonic line", "alignedrectilinear|Aligned rectilinear", "zig-zag|Rectilinear", "concentric|Concentric", "hilbertcurve|Hilbert curve", "archimedeanchords|Archimedean chords", "octagramspiral|Octagram spiral") });
  g.enum("internal_solid_infill_pattern", "Internal solid infill pattern", "zig-zag", { options: o("zig-zag|Rectilinear", "concentric|Concentric", "monotonic|Monotonic", "alignedrectilinear|Aligned rectilinear"), level: 1 });
  g.num("top_bottom_infill_wall_overlap", "Top/bottom solid infill/wall overlap", 25, { unit: "%", min: 0, max: 100, step: 1, level: 2 });
}
{
  const g = grp("strength", "Sparse infill");
  g.num("sparse_infill_density", "Sparse infill density", 15, { unit: "%", min: 0, max: 100, step: 1 });
  g.enum("sparse_infill_pattern", "Sparse infill pattern", "grid", { options: o("grid|Grid", "line|Rectilinear", "zig-zag|Zig-zag", "crosshatch|Cross hatch", "triangles|Triangles", "tri-hexagon|Tri-hexagon", "cubic|Cubic", "gyroid|Gyroid", "honeycomb|Honeycomb", "3dhoneycomb|3D honeycomb", "concentric|Concentric", "alignedrectilinear|Aligned rectilinear", "adaptivecubic|Adaptive cubic", "lightning|Lightning", "supportcubic|Support cubic", "hilbertcurve|Hilbert curve", "archimedeanchords|Archimedean chords", "octagramspiral|Octagram spiral") });
  g.num("infill_direction", "Infill direction", 45, { unit: "°", min: 0, max: 360, step: 1, level: 1 });
  g.num("solid_infill_direction", "Solid infill direction", 45, { unit: "°", min: 0, max: 360, step: 1, level: 1 });
  g.num("sparse_infill_anchor", "Sparse infill anchor", 400, { unit: "%", min: 0, max: 1000, step: 10, level: 1 });
  g.num("sparse_infill_anchor_max", "Max anchor length", 20, { unit: "mm", min: 0, max: 100, step: 1, level: 1 });
  g.num("infill_wall_overlap", "Infill/wall overlap", 15, { unit: "%", min: 0, max: 100, step: 1, level: 1 });
  g.bool("infill_combination", "Combine infill every N layers", false, { level: 1, tip: "Print sparse infill every other layer at double height." });
  g.num("infill_combination_max_layer_height", "Max combined height", 100, { unit: "%", min: 50, max: 200, step: 5, level: 2, showIf: "infill_combination=true", wired: false });
  g.num("minimum_sparse_infill_area", "Minimum sparse infill area", 15, { unit: "mm²", min: 0, max: 200, step: 1, level: 1 });
  g.bool("filter_out_gap_fill", "Filter out tiny gaps", false, { level: 2 });
  g.num("gap_infill_min_length", "Min gap fill length", 0, { unit: "mm", min: 0, max: 20, step: 0.5, level: 2, wired: false });
}
{
  const g = grp("strength", "Advanced");
  g.num("bridge_angle", "Bridge direction", 0, { unit: "°", min: 0, max: 360, step: 1, level: 1, tip: "0 = automatic." });
  g.bool("enable_extra_bridge_layer", "Extra bridge layers", false, { level: 2, wired: false });
  g.num("infill_lock_depth", "Infill lock depth", 1, { unit: "mm", min: 0, max: 5, step: 0.1, level: 2, wired: false });
  g.bool("skin_infill_depth", "Skin infill", false, { level: 2, wired: false });
}

// ================= Speed =================
{
  const g = grp("speed", "Initial layer");
  g.num("initial_layer_speed", "Initial layer speed", 50, { unit: "mm/s", min: 1, max: 600, step: 1, alias: "firstLayerSpeed" });
  g.num("initial_layer_infill_speed", "Initial layer infill", 80, { unit: "mm/s", min: 1, max: 600, step: 1 });
  g.num("initial_layer_travel_speed", "Initial layer travel", 100, { unit: "%", min: 10, max: 200, step: 5, level: 1 });
  g.num("slow_down_layers", "Number of slow layers", 0, { min: 0, max: 20, step: 1, level: 1 });
}
{
  const g = grp("speed", "Other layers speed");
  g.num("outer_wall_speed", "Outer wall", 60, { unit: "mm/s", min: 1, max: 600, step: 1, alias: "wallSpeed" });
  g.num("inner_wall_speed", "Inner wall", 120, { unit: "mm/s", min: 1, max: 600, step: 1 });
  g.num("small_perimeter_speed", "Small perimeters", 50, { unit: "%", min: 10, max: 100, step: 5, level: 1 });
  g.num("small_perimeter_threshold", "Small perimeters threshold", 0, { unit: "mm", min: 0, max: 50, step: 1, level: 1 });
  g.num("sparse_infill_speed", "Sparse infill", 150, { unit: "mm/s", min: 1, max: 600, step: 1 });
  g.num("internal_solid_infill_speed", "Internal solid infill", 150, { unit: "mm/s", min: 1, max: 600, step: 1 });
  g.num("top_surface_speed", "Top surface", 80, { unit: "mm/s", min: 1, max: 600, step: 1 });
  g.num("gap_infill_speed", "Gap infill", 50, { unit: "mm/s", min: 1, max: 600, step: 1, level: 1 });
  g.num("support_speed", "Support", 80, { unit: "mm/s", min: 1, max: 600, step: 1 });
  g.num("support_interface_speed", "Support interface", 80, { unit: "mm/s", min: 1, max: 600, step: 1 });
}
{
  const g = grp("speed", "Overhang speed");
  g.enum("enable_overhang_speed", "Slow down for overhangs", "true", { options: o("true|On", "false|Off") });
  g.num("overhang_1_4_speed", "(10%, 25%) overhang", 0, { unit: "mm/s", min: 0, max: 600, step: 1, level: 1, tip: "0 = no slowdown." });
  g.num("overhang_2_4_speed", "[25%, 50%) overhang", 0, { unit: "mm/s", min: 0, max: 600, step: 1, level: 1 });
  g.num("overhang_3_4_speed", "[50%, 75%) overhang", 0, { unit: "mm/s", min: 0, max: 600, step: 1, level: 1 });
  g.num("overhang_4_4_speed", "[75%, 100%] overhang", 0, { unit: "mm/s", min: 0, max: 600, step: 1, level: 1 });
  g.num("bridge_speed", "Bridge", 50, { unit: "mm/s", min: 1, max: 600, step: 1 });
}
{
  const g = grp("speed", "Travel");
  g.num("travel_speed", "Travel speed", 500, { unit: "mm/s", min: 10, max: 1000, step: 10 });
}
{
  const g = grp("speed", "Acceleration");
  g.num("default_acceleration", "Normal printing", 10000, { unit: "mm/s²", min: 100, max: 50000, step: 100 });
  g.num("initial_layer_acceleration", "Initial layer", 500, { unit: "mm/s²", min: 100, max: 50000, step: 100 });
  g.num("outer_wall_acceleration", "Outer wall", 5000, { unit: "mm/s²", min: 100, max: 50000, step: 100, level: 1 });
  g.num("inner_wall_acceleration", "Inner wall", 0, { unit: "mm/s²", min: 0, max: 50000, step: 100, level: 1, tip: "0 = use normal printing acceleration." });
  g.num("top_surface_acceleration", "Top surface", 2000, { unit: "mm/s²", min: 100, max: 50000, step: 100, level: 1 });
  g.num("sparse_infill_acceleration", "Sparse infill", 100, { unit: "%", min: 10, max: 100, step: 5, level: 1 });
  g.num("bridge_acceleration", "Bridge", 50, { unit: "%", min: 10, max: 100, step: 5, level: 1 });
  g.num("travel_acceleration", "Travel", 10000, { unit: "mm/s²", min: 100, max: 50000, step: 100 });
}
{
  const g = grp("speed", "Jerk (XY)");
  g.num("default_jerk", "Default", 0, { unit: "mm/s", min: 0, max: 50, step: 1, level: 1, tip: "0 = leave firmware default." });
  g.num("outer_wall_jerk", "Outer wall", 9, { unit: "mm/s", min: 0, max: 50, step: 1, level: 2 });
  g.num("inner_wall_jerk", "Inner wall", 9, { unit: "mm/s", min: 0, max: 50, step: 1, level: 2 });
  g.num("infill_jerk", "Infill", 9, { unit: "mm/s", min: 0, max: 50, step: 1, level: 2 });
  g.num("top_surface_jerk", "Top surface", 9, { unit: "mm/s", min: 0, max: 50, step: 1, level: 2 });
  g.num("initial_layer_jerk", "Initial layer", 9, { unit: "mm/s", min: 0, max: 50, step: 1, level: 2 });
  g.num("travel_jerk", "Travel", 9, { unit: "mm/s", min: 0, max: 50, step: 1, level: 2 });
}

// ================= Support =================
{
  const g = grp("support", "Support");
  g.bool("enable_support", "Enable support", false);
  g.enum("support_type", "Type", "normal(auto)", { options: o("normal(auto)|Normal (auto)", "tree(auto)|Tree (auto)", "normal(manual)|Normal (manual)", "tree(manual)|Tree (manual)"), showIf: "enable_support=true" });
  g.enum("support_style", "Style", "default", { options: o("default|Default", "grid|Grid", "snug|Snug", "tree_slim|Tree slim", "tree_strong|Tree strong", "tree_hybrid|Tree hybrid", "tree_organic|Tree organic"), level: 1, showIf: "enable_support=true" });
  g.num("support_threshold_angle", "Threshold angle", 30, { unit: "°", min: 0, max: 90, step: 1, showIf: "enable_support=true", tip: "Overhangs steeper than this (from vertical) get support. 0 = auto." });
  g.bool("support_on_build_plate_only", "On build plate only", false, { showIf: "enable_support=true" });
  g.bool("support_critical_regions_only", "Support critical regions only", false, { level: 1, showIf: "enable_support=true", wired: false });
  g.bool("support_remove_small_overhang", "Remove small overhangs", true, { level: 1, showIf: "enable_support=true" });
}
{
  const g = grp("support", "Raft");
  g.num("raft_layers", "Raft layers", 0, { min: 0, max: 20, step: 1, showIf: "enable_support=true" });
  g.num("raft_contact_distance", "Raft contact Z distance", 0.1, { unit: "mm", min: 0, max: 1, step: 0.01, level: 1, showIf: "enable_support=true" });
  g.num("raft_expansion", "Raft expansion", 1.5, { unit: "mm", min: 0, max: 10, step: 0.5, level: 1, showIf: "enable_support=true" });
  g.num("raft_first_layer_density", "Raft first layer density", 90, { unit: "%", min: 10, max: 100, step: 5, level: 1, showIf: "enable_support=true" });
}
{
  const g = grp("support", "Filament");
  g.num("support_filament", "Support/raft base", 0, { min: 0, max: 16, step: 1, level: 1, wired: false, showIf: "enable_support=true" });
  g.bool("support_interface_not_for_body", "No interface filament for body", true, { level: 2, wired: false, showIf: "enable_support=true" });
}
{
  const g = grp("support", "Advanced");
  g.enum("support_base_pattern", "Base pattern", "default", { options: o("default|Default", "rectilinear|Rectilinear", "rectilinear-grid|Rectilinear grid", "honeycomb|Honeycomb", "lightning|Lightning", "hollow|Hollow"), level: 1, showIf: "enable_support=true" });
  g.num("support_base_pattern_spacing", "Base pattern spacing", 2.5, { unit: "mm", min: 0, max: 30, step: 0.1, level: 1, showIf: "enable_support=true" });
  g.num("support_angle", "Pattern angle", 0, { unit: "°", min: 0, max: 360, step: 1, level: 1, showIf: "enable_support=true" });
  g.num("support_top_z_distance", "Top Z distance", 0.2, { unit: "mm", min: 0, max: 2, step: 0.05, level: 1, showIf: "enable_support=true" });
  g.num("support_bottom_z_distance", "Bottom Z distance", 0.2, { unit: "mm", min: 0, max: 2, step: 0.05, level: 1, showIf: "enable_support=true" });
  g.num("support_object_xy_distance", "Support/object XY distance", 0.35, { unit: "mm", min: 0, max: 5, step: 0.05, level: 1, showIf: "enable_support=true" });
  g.num("support_object_first_layer_gap", "Support/object first-layer gap", 0.2, { unit: "mm", min: 0, max: 5, step: 0.05, level: 2, showIf: "enable_support=true" });
  g.num("support_expansion", "Normal support expansion", 0, { unit: "mm", min: -5, max: 5, step: 0.1, level: 2, showIf: "enable_support=true" });
  g.bool("independent_support_layer_height", "Independent support layer height", false, { level: 2, wired: false, showIf: "enable_support=true" });
}
{
  const g = grp("support", "Support interface");
  g.num("support_interface_top_layers", "Top interface layers", 3, { min: 0, max: 20, step: 1, showIf: "enable_support=true" });
  g.num("support_interface_bottom_layers", "Bottom interface layers", 0, { min: 0, max: 20, step: 1, level: 1, showIf: "enable_support=true" });
  g.enum("support_interface_pattern", "Interface pattern", "auto", { options: o("auto|Default", "rectilinear|Rectilinear", "concentric|Concentric", "rectilinear_interlaced|Rectilinear interlaced", "grid|Grid"), level: 1, showIf: "enable_support=true" });
  g.num("support_interface_spacing", "Top interface spacing", 0.5, { unit: "mm", min: 0, max: 5, step: 0.1, level: 1, showIf: "enable_support=true" });
}
{
  const g = grp("support", "Tree support");
  g.num("tree_support_branch_distance", "Branch distance", 5, { unit: "mm", min: 1, max: 20, step: 0.5, level: 1, showIf: "support_type=tree(auto)" });
  g.num("tree_support_branch_diameter", "Branch diameter", 5, { unit: "mm", min: 1, max: 20, step: 0.5, level: 1, showIf: "support_type=tree(auto)" });
  g.num("tree_support_branch_angle", "Branch angle", 40, { unit: "°", min: 0, max: 85, step: 1, level: 1, showIf: "support_type=tree(auto)" });
  g.num("tree_support_wall_count", "Tree wall loops", 0, { min: 0, max: 5, step: 1, level: 1, showIf: "support_type=tree(auto)" });
  g.num("tree_support_tip_diameter", "Tip diameter", 0.8, { unit: "mm", min: 0.2, max: 5, step: 0.1, level: 2, showIf: "support_type=tree(auto)" });
  g.bool("tree_support_auto_brim", "Auto brim width", true, { level: 2, showIf: "support_type=tree(auto)", wired: false });
}

// ================= Others =================
{
  const g = grp("others", "Skirt");
  g.num("skirt_loops", "Skirt loops", 1, { min: 0, max: 20, step: 1 });
  g.num("skirt_distance", "Skirt distance", 2, { unit: "mm", min: 0, max: 20, step: 0.5, level: 1 });
  g.num("skirt_height", "Skirt height", 1, { unit: "layers", min: 1, max: 100, step: 1 });
  g.bool("draft_shield", "Draft shield", false, { level: 2, wired: false });
}
{
  const g = grp("others", "Brim");
  g.enum("brim_type", "Brim type", "auto_brim", { options: o("auto_brim|Auto", "brim_ears|Mouse ears", "outer_only|Outer brim only", "inner_only|Inner brim only", "outer_and_inner|Outer and inner brim", "no_brim|None") });
  g.num("brim_width", "Brim width", 5, { unit: "mm", min: 0, max: 50, step: 0.5, showIf: "brim_type!=no_brim" });
  g.num("brim_object_gap", "Brim-object gap", 0, { unit: "mm", min: 0, max: 5, step: 0.05, showIf: "brim_type!=no_brim" });
  g.num("brim_ears_max_angle", "Mouse-ear max angle", 125, { unit: "°", min: 0, max: 180, step: 5, level: 1, showIf: "brim_type=brim_ears" });
  g.num("brim_ears_detection_length", "Mouse-ear detection length", 1, { unit: "mm", min: 0, max: 10, step: 0.5, level: 2, showIf: "brim_type=brim_ears", wired: false });
}
{
  const g = grp("others", "Prime tower");
  g.bool("enable_prime_tower", "Enable", false, { tip: "Needed only for multi-material prints; this build prints single-material.", wired: false });
  g.bool("prime_tower_skip_points", "Skip points", true, { level: 1, wired: false });
  g.num("prime_tower_width", "Width", 35, { unit: "mm", min: 10, max: 100, step: 1, level: 1, wired: false });
  g.num("prime_volume", "Max speed", 45, { unit: "mm³", min: 0, max: 200, step: 1, level: 2, wired: false });
  g.num("prime_tower_brim_width", "Brim width", 3, { unit: "mm", min: 0, max: 20, step: 0.5, level: 1, wired: false });
}
{
  const g = grp("others", "Special mode");
  g.enum("slicing_mode", "Slicing mode", "regular", { options: o("regular|Regular", "even_odd|Even-odd", "close_holes|Close holes"), level: 1 });
  g.enum("print_sequence", "Print sequence", "by layer", { options: o("by layer|By layer", "by object|By object") });
  g.bool("spiral_mode", "Spiral vase", false, { tip: "Single continuous wall, no top infill — the NexSpiro texture and non-linear mode." });
  g.bool("spiral_mode_smooth", "Smooth spiral", true, { level: 1, showIf: "spiral_mode=true", wired: false });
  g.enum("timelapse_type", "Timelapse", "0", { options: o("0|Traditional", "1|Smooth"), level: 1, wired: false });
  g.enum("fuzzy_skin", "Fuzzy skin", "none", { options: o("none|None", "external|Outer walls", "all|All walls"), level: 1 });
  g.num("fuzzy_skin_thickness", "Fuzzy skin thickness", 0.3, { unit: "mm", min: 0, max: 1.5, step: 0.05, level: 1, showIf: "fuzzy_skin!=none" });
  g.num("fuzzy_skin_point_distance", "Fuzzy skin point distance", 0.8, { unit: "mm", min: 0.1, max: 5, step: 0.05, level: 1, showIf: "fuzzy_skin!=none" });
}
{
  const g = grp("others", "G-code output");
  g.bool("reduce_infill_retraction", "Reduce infill retraction", true, { level: 1 });
  g.bool("gcode_add_line_number", "Add line numbers", false, { level: 1 });
  g.bool("gcode_comments", "Verbose G-code comments", false, { level: 1 });
  g.bool("gcode_label_objects", "Label objects", true, { level: 1, tip: "Adds EXCLUDE_OBJECT / object markers so you can cancel one object while printing." });
  g.text("filename_format", "Filename format", "{input_filename_base}_{plate_name}.gcode", { level: 2 });
  g.text("post_process", "Post-processing scripts", "", { level: 2, wired: false });
}
{
  const g = grp("others", "Notes");
  g.text("process_notes", "Notes", "", { level: 1, wired: false });
}

export const SETTING_DEFS: readonly SettingDef[] = D;
export const SETTING_TABS: { id: SettingTab; label: string }[] = [
  { id: "quality", label: "Quality" }, { id: "strength", label: "Strength" }, { id: "speed", label: "Speed" }, { id: "support", label: "Support" }, { id: "others", label: "Others" },
];
export const SETTING_BY_KEY: Record<string, SettingDef> = Object.fromEntries(D.map((d) => [d.key, d]));
export const SETTING_DEFAULTS: SettingMap = Object.fromEntries(D.filter((d) => !d.alias).map((d) => [d.key, d.def]));

/** Resolved value of a setting: object override → process `settings` → legacy alias field → schema default. */
export function getSetting(process: unknown, key: string, overrides?: SettingMap): SettingValue {
  if (overrides && key in overrides) return overrides[key];
  const d = SETTING_BY_KEY[key], p = process as Record<string, unknown> & { settings?: SettingMap };
  if (p.settings && key in p.settings) return p.settings[key];
  if (d?.alias && p[d.alias] !== undefined) return p[d.alias] as SettingValue;
  return d ? d.def : 0;
}
/** Every setting resolved into one flat map (what the slicer receives). */
export function resolveSettings(process: unknown, overrides?: SettingMap): SettingMap {
  const out: SettingMap = {};
  for (const d of D) out[d.key] = getSetting(process, d.key, overrides);
  return out;
}
/** Evaluates a `showIf` condition ("key=value" or "key!=value") against resolved values. */
export function visible(d: SettingDef, get: (k: string) => SettingValue): boolean {
  if (!d.showIf) return true;
  const m = /^(\w+)(!?=)(.*)$/.exec(d.showIf); if (!m) return true;
  const eq = String(get(m[1])) === m[3];
  return m[2] === "=" ? eq : !eq;
}
