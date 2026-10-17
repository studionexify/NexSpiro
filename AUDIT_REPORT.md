# NexSpiro ↔ Bambu Studio parity audit

| | |
|---|---|
| NexSpiro baseline | `3577c61` (main, before this branch) |
| Bambu Studio reference | `bambulab/BambuStudio@79df7ae` (2.8.3 beta, 2026-10-13) |
| Status legend | **[COMPLETE]** UI and engine behaviour match · **[PARTIAL / STUBBED]** UI exists but the math, engine wiring or micro-markers are incomplete · **[MISSING]** not implemented · **[N/A]** only meaningful for Bambu hardware or Bambu cloud services |

## How this audit was made

1. **Specification source.** The brief names the Bambu Studio wiki (`wiki.bambulab.com`) as ground truth, but this
   build environment's network policy blocks that host (`CONNECT … 403`). Bambu Studio is open source, so the
   audit uses the code that the wiki documents instead. It is a stricter reference:
   * `src/libslic3r/PrintConfig.cpp`: every setting's key, label, unit, range, enum values and default.
   * `src/slic3r/GUI/Tab.cpp`: the on-screen order of the Process / Filament / Printer pages and their groups.
   * `src/slic3r/GUI/Gizmos/*`: the Prepare toolbar gizmos (move, rotate, scale, flatten, cut, measure, painting, text, SVG).
   * `src/slic3r/GUI/KBShortcutsDialog.cpp`: keyboard shortcuts. `src/libslic3r/Calib.cpp`: calibration G-code generators.
2. **Visual inspection.** The wiki screenshots were unreachable. I inspected the instructional images bundled
   with Bambu Studio (`resources/images/*`), which are the same pictures the wiki and the calibration wizard show:
   * `fd_calibration_manual*.png` (Flow Dynamics, PA line). About 50 horizontal lines, each with a slow, fast and
     slow segment, plus a solid label strip on the right with the PA value printed every second line (0, 0.01 … 0.2).
     The user picks "the line with the most uniform thickness".
   * `flow_rate_calibration_coarse*.png` (Pass 1). A 3×3 grid of blocks with a raised number tab on each
     (+20 … −20 in steps of 5). The user picks the smoothest, seamless top surface and types its block number.
   * `flow_rate_calibration_fine*.png` (Pass 2). Ten blocks (0 to −9) in a 1-3-3-3 pyramid, each with its own number tab.
   * `temperature_calibration.png`. A tower of blocks, each with a left overhang ramp, a right bridge with a cone,
     and its temperature embossed on the front, falling 5 °C per block going up (230 → 195).
   * `max_volumetric_speed_calibration.png`. A single-wall serpentine vase whose speed rises with height.
   * The `param_*.svg` / `plate_*.svg` / `im_*.svg` UI icon sets show the parameter-group icons, the per-plate
     icon row (arrange, orient, lock, settings, close, rename), the lock and revert markers on parameters, and the
     preview slider glyphs (pause / custom G-code / delete).
3. **Code scan.** I read every NexSpiro module and generated the per-setting tables at the end of this file with
   `scripts/parity-audit.mjs`. The script parses Bambu's `Tab.cpp` page layout and checks each key against
   NexSpiro's schemas and the engine sources, so anyone with a Bambu checkout can rerun it.

---

## 1. Workspace architecture & UI micro-markers

| Component | Bambu Studio behaviour | Baseline | This branch |
|---|---|---|---|
| Top navigation | Home · Prepare · Preview · Device · Project · Calibration; active tab underline; `Ctrl+Tab` cycles tabs | [PARTIAL] tabs exist; `Ctrl+1…5` was bound to tabs, which collides with Bambu's camera views | see §6 |
| Keyboard shortcuts dialog | `?` / `Shift+?` opens the shortcut list | [MISSING] (static list on Home only) | see §6 |
| Printer preset | Printer + nozzle, plate type selector, editable machine settings | [PARTIAL] machine dialog edits 6 numbers + G-code; no extruder clearance, Z-hop type, wipe, layer-height limits | see §6 |
| Plate-type bed temperatures | Each filament carries Cool / Engineering / Smooth PEI / Textured PEI temps (initial and other layers) | [PARTIAL] one temp per plate type; initial layer = other layers; read-only | see §6 |
| Filament rack / AMS | Slots with colour swatch, material badge, edit, flushing-volume matrix | [PARTIAL] slots, swatches and flush matrix exist; no material-type badge; filament settings read-only | see §6 |
| Flushing volumes modal | From/To matrix, auto-calc from colours, multiplier | [COMPLETE] | [COMPLETE] |
| Process preset | Global / Objects switch, Advanced toggle, search, modified values in orange with revert arrow | [PARTIAL] all present except per-tab modified badges, system-value lock icon and "*" on the dirty preset | see §6 |
| Parameter search | Search box with results grouped by page › group | [COMPLETE] (inline filter) | [COMPLETE] |
| Object list | Plate › object › part tree; per-row printable eye, filament badge, settings gear, paint indicators; height-range modifiers | [PARTIAL] no eye column, no paint badges, no height-range modifiers, no positive "part" volumes | see §6 |

## 2. Top toolbar & 3D viewport gizmos (Prepare)

| Component | Bambu Studio behaviour | Baseline | This branch |
|---|---|---|---|
| Add object / add plate / delete plate | Toolbar + per-plate close icon | [COMPLETE] | [COMPLETE] |
| Auto-arrange | Polygon packing with a settings popup (spacing, auto-rotate, align); overflow to new plates | [PARTIAL] bounding-box shelf packing, fixed 6 mm spacing, no rotation | see §6 |
| Auto-orient | Minimise overhang area, maximise bed contact | [COMPLETE] | [COMPLETE] |
| Move gizmo (M) | Axis arrows, planar handles, drop to bed | [COMPLETE] (three.js TransformControls + numeric panel) | [COMPLETE] |
| Rotate gizmo (R) | Gimbal rings with snap ticks (5° minor, 45° major) | [PARTIAL] rings; 15° snap with Shift; no tick marks | see §6 |
| Scale gizmo (S) | Uniform / per-axis handles, size and % readout | [COMPLETE] | [COMPLETE] |
| Lay on face (F) | Hull facets clustered into flat candidates, highlighted on hover | [PARTIAL] click any triangle; no clustering or hover highlight | see §6 |
| Cut (C) | Plane gizmo, keep upper/lower, connectors (Plug / Dowel / Snap; Prism / Frustum; depth, size, tolerance) | [PARTIAL] tilted plane + capping; **no connectors** | see §6 |
| Mesh boolean | Union / Difference / Intersection | [COMPLETE] | [COMPLETE] |
| Support painting (L) | Circle / sphere / fill / gap-fill tools, overhang-angle highlight, on-overhangs-only | [PARTIAL] circle brush + on-overhangs-only; no fill tools; fixed highlight angle | see §6 |
| Seam painting (P) | Enforce / block on triangles | [COMPLETE] | [COMPLETE] |
| Colour painting (N) | Circle, sphere, triangle, height range, fill with smart edge angle, gap fill | [PARTIAL] circle brush only | see §6 |
| Text (T) | Text as part / negative part / modifier, placed on and projected onto the clicked surface | [PARTIAL] separate object, or boolean into the top face | see §6 |
| SVG | SVG as part / negative / modifier | [MISSING] (Patternex has SVG artwork, not volumes) | see §6 |
| Measure (U) | Point, edge, face, circle features; distance and angle; scale to measurement | [PARTIAL] point-to-point only | see §6 |
| Overhang highlight (Ctrl+L) | Red overhang shading at the support threshold angle | [PARTIAL] fixed 30°, single colour | see §6 |
| View cube | Clickable faces, drag orbit, Ctrl+0…7 views | [PARTIAL] faces + drag; views were on bare 0–6 | see §6 |
| Plate HUD | Plate number, name, arrange / orient / lock / settings / close icons | [COMPLETE] | [COMPLETE] |

## 3. Slicing parameters (Quality · Strength · Speed · Support · Others · Filament · Printer)

Baseline coverage of the 418 settings on Bambu's Process, Filament and Printer pages: **116 complete, 196 missing,
106 N/A**. The biggest missing families:

* **Quality:** scarf joint seam (all 11 keys), seam gap, slice gap closing radius, precise Z height, ironing
  pattern / inset / direction, Arachne transition settings and minimum wall width / feature size, thick bridges,
  object / top-surface / initial-layer flow ratios, one wall on top surfaces, one wall on the first layer,
  avoid crossing walls.
* **Strength:** alternate extra wall, detect thin wall, top / bottom surface density, internal solid pattern, sparse
  infill anchors. Sparse patterns: only 6 of Bambu's 22 (no Honeycomb, 3D Honeycomb, Cubic, Adaptive Cubic,
  Lightning, Line, Tri-hexagon, Hilbert, Archimedean, Octagram, Cross-hatch, Zig-zag). Also bridge direction,
  infill combination, narrow solid infill detection, ensure vertical shell thickness.
* **Speed:** overhang speed curve (10–25 / 25–50 / 50–75 / 75–100 / 100 %) — baseline had a single overhang speed,
  small perimeters, gap infill, slow-down-by-height, inner wall / sparse infill / travel / initial-layer travel
  accelerations, the whole jerk group.
* **Support:** style (Grid / Snug / Tree Slim / Strong / Hybrid / Organic), raft, bottom Z distance, base and interface
  patterns, bottom interface layers, expansion, don't support bridges, critical regions only, interface filament,
  support ironing, tree diameter angle, tree wall count.
* **Others:** print sequence By Object (with extruder clearance), smooth spiral, timelapse, slicing mode,
  fuzzy skin modes and noise types, prime tower brim / ribs / max speed, flush into infill / objects / support,
  per-feature filaments, line numbers, notes.
* **Filament / cooling:** fan speed by layer time, keep fan always on, don't slow down outer walls, overhang / bridge
  fan, full fan speed layer, first-layers fan speed, ironing fan, auxiliary fan, chamber temperature, pressure
  advance per filament, filament start / end G-code. **Retraction:** Z-hop types (Auto / Normal / Slope / Spiral),
  Z-hop lower / upper bounds, retract on layer change, wipe while retracting and wipe distance, extra restart length.

The full per-key tables, with baseline and current status, are in [§7](#7-per-setting-tables).

## 4. Slicing engine & Preview

| Component | Bambu Studio behaviour | Baseline | This branch |
|---|---|---|---|
| Parameter → engine wiring | Every visible setting changes the toolpaths or the G-code | [COMPLETE] for the 116 implemented settings | see §6 |
| Toolpath renderer | Volumetric extrusion tubes | [COMPLETE] (instanced boxes, GPU) | [COMPLETE] |
| Colour schemes | Line type, Height, Width, Speed, Fan speed, Temperature, Volumetric flow, Layer time (linear / log), Filament, Tool | [PARTIAL] no Fan speed, Temperature or log Layer time | see §6 |
| Legend | Per-type visibility, time, percentage, filament usage per line type | [PARTIAL] time and % only | see §6 |
| Layer slider | Dual thumbs, layer number + Z, `+` to add pause / filament change / custom G-code, one-layer mode (`L`) | [PARTIAL] no one-layer mode | see §6 |
| Move slider | Scrubs moves; G-code lines shown next to it; tool position marker | [PARTIAL] scrubbing only | see §6 |
| Cost / time estimator | Time + filament per line type, per filament, tool changes, prime tower | [PARTIAL] time per type; filament per slot | see §6 |

## 5. Calibration & Device

| Component | Bambu Studio behaviour | Baseline | This branch |
|---|---|---|---|
| Flow Dynamics (PA) | Manual **PA Line** and **PA Pattern** G-code tests; PA tower | [PARTIAL] tower only | see §6 |
| Flow rate | Pass 1 (3×3 blocks, ±20 %) and Pass 2 (10 blocks, 0 to −9 %), numbered tabs | [PARTIAL] coarse / fine patches without number tabs | see §6 |
| Temperature tower | Temperature blocks with overhang + bridge, labelled | [PARTIAL] plain blocks, ascending temperatures | see §6 |
| Max volumetric speed | Vase with rising speed | [COMPLETE] | [COMPLETE] |
| Retraction tower | Two towers, retraction rising per step | [COMPLETE] | [COMPLETE] |
| Device connections | Bambu LAN (MQTT / FTPS), Moonraker, OctoPrint / PrusaLink, serial | [COMPLETE] | [COMPLETE] |
| Device controls | Jog, temperatures, fan, console, camera, files, AMS | [PARTIAL] no temperature history graph | see §6 |

---

## 6. What this branch changes

### Milestone: slicing parameters and engine wiring

Parameter coverage against Bambu's `Tab.cpp` layout went from 116 to 296 of 418 settings (110 do not apply, 11 still missing; see §7). Every key a settings page shows is read by the engine, and `tests/bambu-parity.test.ts` checks that statically.

- **Settings model**: process, filament and machine settings are split into three files that follow Bambu's page and group order and its Simple/Advanced mode. Settings can now be percentages of another setting (`floatOrPercent`). Filament overrides take the place of machine retraction settings. Each plate type has its own bed temperatures. Old project and pref keys migrate automatically (`CONFIG_VERSION` 2).
- **Quality**: there are three slicing modes (regular, even-odd, close holes) and a slice gap closing radius. Precise Z is supported. Walls can be classic or Arachne (minimum bead width, minimum feature size). The engine detects thin walls and fills the gaps between walls. Wall options: only one wall on top surfaces (with a top area threshold), only one wall on the first layer, and alternate extra wall. Seams: seam gap, keeping seams away from overhangs, and scarf seams (conditional, steps, start height, slope gap, inner walls). Also ironing pattern, inset and direction; initial-layer and top-surface flow ratios; thick bridges; and avoiding wall crossings on travel, with a maximum detour.
- **Strength**: vertical shell thickness (disabled, partial or enabled), floating vertical shells, a separate pattern for the layer under the top surface, and infill combination. There are 18 sparse infill patterns, including lightning, adaptive cubic, support cubic, cross hatch, 3D honeycomb, Hilbert, Archimedean and octagram. Infill can be anchored to the walls, and solid infill can replace top and bottom shells.
- **Speed**: four overhang speed buckets plus a totally-overhanging speed, small perimeter and height-based slowdowns, volumetric speed caps, jerk and accel-to-decel (Klipper).
- **Support**: Z gap at the bottom, number of bottom interface layers, expansion, Grid style, and the slim, strong, hybrid and organic tree styles. Overhang filtering: critical regions only, and no support under bridges. Raft layers, raft contact distance and raft expansion. Support interface filament, and support ironing.
- **Cooling**: Bambu's layer-time fan formula, fan held at full speed from a set layer, overhang and bridge fans, ironing fan, auxiliary fan, chamber temperature, and the slow-down rules (minimum speed, outer walls exempt).
- **Others**: fuzzy skin (classic, Perlin, Billow, ridged multifractal and Voronoi noise; displacement, extrusion or combined), smooth spiral vase, brim ears, and by-object print order with clearance warnings. Z-hop types (normal, slope, spiral, auto) with lift bounds. Wipe, retraction on layer change, the reduce-infill-retraction mode, and filaments chosen per feature. Purge into infill, support or objects. Timelapse G-code. Filament start and end G-code. Optional absolute E, line numbers, a config block, and exclude-object labels.
- **Preview data**: each move now records its fan speed, temperature and G-code line, which the preview colour modes use.


## 7. Per-setting tables

<!-- PARAMS:BEGIN -->
Generated by `node scripts/parity-audit.mjs --bambu <BambuStudio checkout> --baseline 3577c61` from Bambu Studio's `Tab.cpp` page layout (418 settings).

| | Complete | Partial | Missing | N/A |
|---|---:|---:|---:|---:|
| Baseline (`3577c61`) | 116 | 0 | 192 | 110 |
| This branch | 296 | 1 | 11 | 110 |


#### Process › Quality

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Layer height | `layer_height` | Layer height | [COMPLETE] | [COMPLETE] |  |
| Layer height | `initial_layer_print_height` | Initial layer height | [COMPLETE] | [COMPLETE] |  |
| Layer height | `enable_mixed_color_sublayer` | Mixed color sublayer | [N/A] | [N/A] | H2D mixed-colour sub-layers |
| Line width | `line_width` | Default | [COMPLETE] | [COMPLETE] |  |
| Line width | `initial_layer_line_width` | Initial layer | [COMPLETE] | [COMPLETE] |  |
| Line width | `initial_layer_infill_line_width` | Initial layer infill | [MISSING] | [COMPLETE] |  |
| Line width | `outer_wall_line_width` | Outer wall | [COMPLETE] | [COMPLETE] |  |
| Line width | `inner_wall_line_width` | Inner wall | [COMPLETE] | [COMPLETE] |  |
| Line width | `top_surface_line_width` | Top surface | [COMPLETE] | [COMPLETE] |  |
| Line width | `sparse_infill_line_width` | Sparse infill | [COMPLETE] | [COMPLETE] |  |
| Line width | `internal_solid_infill_line_width` | Internal solid infill | [COMPLETE] | [COMPLETE] |  |
| Line width | `support_line_width` | Support | [COMPLETE] | [COMPLETE] |  |
| Seam | `seam_position` | Seam position | [COMPLETE] | [COMPLETE] |  |
| Seam | `seam_placement_away_from_overhangs` | Seam placement away from overhangs(experimental) | [MISSING] | [COMPLETE] |  |
| Seam | `seam_gap` | Seam gap | [MISSING] | [COMPLETE] |  |
| Seam | `seam_slope_conditional` | Smart scarf seam application | [MISSING] | [COMPLETE] |  |
| Seam | `scarf_angle_threshold` | Scarf application angle threshold | [MISSING] | [COMPLETE] |  |
| Seam | `seam_slope_entire_loop` | Scarf around entire wall | [MISSING] | [COMPLETE] |  |
| Seam | `seam_slope_steps` | Scarf steps | [MISSING] | [COMPLETE] |  |
| Seam | `seam_slope_inner_walls` | Scarf joint for inner walls | [MISSING] | [COMPLETE] |  |
| Seam | `override_filament_scarf_seam_setting` | Override filament scarf seam setting | [MISSING] | [COMPLETE] |  |
| Seam | `seam_slope_type` | Scarf seam type | [MISSING] | [COMPLETE] |  |
| Seam | `seam_slope_start_height` | Scarf start height | [MISSING] | [COMPLETE] |  |
| Seam | `seam_slope_gap` | Scarf slope gap | [MISSING] | [COMPLETE] |  |
| Seam | `seam_slope_min_length` | Scarf length | [MISSING] | [COMPLETE] |  |
| Seam | `wipe_speed` | Wipe speed | [MISSING] | [COMPLETE] |  |
| Seam | `role_base_wipe_speed` | Role-based wipe speed | [N/A] | [N/A] | Bambu wipe planner detail |
| Precision | `slice_closing_radius` | Slice gap closing radius | [MISSING] | [COMPLETE] |  |
| Precision | `resolution` | Resolution | [COMPLETE] | [COMPLETE] |  |
| Precision | `enable_arc_fitting` | Arc fitting | [COMPLETE] | [COMPLETE] |  |
| Precision | `xy_hole_compensation` | X-Y hole compensation | [COMPLETE] | [COMPLETE] |  |
| Precision | `xy_contour_compensation` | X-Y contour compensation | [COMPLETE] | [COMPLETE] |  |
| Precision | `enable_circle_compensation` | Auto circle contour-hole compensation | [N/A] | [N/A] | Bambu hole calibration |
| Precision | `circle_compensation_manual_offset` | User Customized Offset | [N/A] | [N/A] | Bambu hole calibration |
| Precision | `elefant_foot_compensation` | Elephant foot compensation | [COMPLETE] | [COMPLETE] |  |
| Precision | `precise_outer_wall` | Precise wall | [MISSING] | [MISSING] |  |
| Precision | `precise_z_height` | Precise Z height | [MISSING] | [COMPLETE] |  |
| Ironing | `ironing_type` | Ironing Type | [COMPLETE] | [COMPLETE] |  |
| Ironing | `ironing_pattern` | Ironing Pattern | [MISSING] | [COMPLETE] |  |
| Ironing | `ironing_speed` | Ironing speed | [COMPLETE] | [COMPLETE] |  |
| Ironing | `ironing_flow` | Ironing flow | [COMPLETE] | [COMPLETE] |  |
| Ironing | `ironing_spacing` | Ironing line spacing | [COMPLETE] | [COMPLETE] |  |
| Ironing | `ironing_inset` | Ironing inset | [MISSING] | [COMPLETE] |  |
| Ironing | `ironing_direction` | ironing direction | [MISSING] | [COMPLETE] |  |
| Wall generator | `wall_generator` | Wall generator | [COMPLETE] | [COMPLETE] |  |
| Wall generator | `wall_transition_angle` | Wall transitioning threshold angle | [MISSING] | [MISSING] |  |
| Wall generator | `wall_transition_filter_deviation` | Wall transitioning filter margin | [MISSING] | [COMPLETE] |  |
| Wall generator | `wall_transition_length` | Wall transition length | [MISSING] | [MISSING] |  |
| Wall generator | `wall_distribution_count` | Wall distribution count | [MISSING] | [MISSING] |  |
| Wall generator | `min_bead_width` | Minimum wall width | [MISSING] | [COMPLETE] |  |
| Wall generator | `min_feature_size` | Minimum feature size | [MISSING] | [COMPLETE] |  |
| Advanced | `wall_sequence` | Order of walls | [COMPLETE] | [COMPLETE] |  |
| Advanced | `is_infill_first` | Print infill first | [COMPLETE] | [COMPLETE] |  |
| Advanced | `bridge_flow` | Bridge flow | [COMPLETE] | [COMPLETE] |  |
| Advanced | `thick_bridges` | Thick bridges | [MISSING] | [COMPLETE] |  |
| Advanced | `counterbore_hole_bridging` | Bridge counterbore holes | [N/A] | [N/A] | Bambu counterbore bridging |
| Advanced | `print_flow_ratio` | Object flow ratio | [MISSING] | [COMPLETE] |  |
| Advanced | `top_solid_infill_flow_ratio` | Top surface flow ratio | [MISSING] | [COMPLETE] |  |
| Advanced | `initial_layer_flow_ratio` | Initial layer flow ratio | [MISSING] | [COMPLETE] |  |
| Advanced | `top_one_wall_type` | Only one wall on top surfaces | [MISSING] | [COMPLETE] |  |
| Advanced | `top_area_threshold` | Top area threshold | [MISSING] | [COMPLETE] |  |
| Advanced | `only_one_wall_first_layer` | Only one wall on first layer | [MISSING] | [COMPLETE] |  |
| Advanced | `detect_overhang_wall` | Detect overhang wall | [MISSING] | [COMPLETE] |  |
| Advanced | `smooth_speed_discontinuity_area` | Smooth speed discontinuity area | [N/A] | [N/A] | Bambu speed smoothing (H2D) |
| Advanced | `smooth_coefficient` | Smooth coefficient | [N/A] | [N/A] | Bambu speed smoothing (H2D) |
| Advanced | `reduce_crossing_wall` | Avoid crossing wall | [MISSING] | [COMPLETE] |  |
| Advanced | `max_travel_detour_distance` | Avoid crossing wall - Max detour length | [MISSING] | [COMPLETE] |  |
| Advanced | `avoid_crossing_wall_includes_support` | Avoid crossing wall - Includes support | [N/A] | [N/A] | Bambu travel planner detail |
| Advanced | `z_direction_outwall_speed_continuous` | Smoothing wall speed along Z(experimental) | [N/A] | [N/A] | Bambu speed smoothing (H2D) |

#### Process › Strength

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Walls | `wall_loops` | Wall loops | [COMPLETE] | [COMPLETE] |  |
| Walls | `alternate_extra_wall` | Alternate extra wall | [MISSING] | [COMPLETE] |  |
| Walls | `embedding_wall_into_infill` | Embedding the wall into the infill | [N/A] | [N/A] | Bambu beta walls |
| Walls | `detect_thin_wall` | Detect thin wall | [MISSING] | [COMPLETE] |  |
| Top/bottom shells | `interface_shells` | Interface shells | [MISSING] | [MISSING] |  |
| Top/bottom shells | `top_surface_pattern` |  | [COMPLETE] | [COMPLETE] |  |
| Top/bottom shells | `top_surface_density` | Top surface density | [MISSING] | [COMPLETE] |  |
| Top/bottom shells | `top_shell_layers` | Top shell layers | [COMPLETE] | [COMPLETE] |  |
| Top/bottom shells | `top_shell_thickness` | Top shell thickness | [COMPLETE] | [COMPLETE] |  |
| Top/bottom shells | `top_color_penetration_layers` | Top paint penetration layers | [N/A] | [N/A] | Bambu colour painting depth |
| Top/bottom shells | `bottom_surface_pattern` | Bottom surface pattern | [COMPLETE] | [COMPLETE] |  |
| Top/bottom shells | `bottom_surface_density` | Bottom surface density | [MISSING] | [COMPLETE] |  |
| Top/bottom shells | `bottom_shell_layers` | Bottom shell layers | [COMPLETE] | [COMPLETE] |  |
| Top/bottom shells | `bottom_shell_thickness` | Bottom shell thickness | [COMPLETE] | [COMPLETE] |  |
| Top/bottom shells | `bottom_color_penetration_layers` | Bottom paint penetration layers | [N/A] | [N/A] | Bambu colour painting depth |
| Top/bottom shells | `infill_instead_top_bottom_surfaces` | Use infill instead of top and bottom surfaces | [MISSING] | [COMPLETE] |  |
| Top/bottom shells | `internal_solid_infill_pattern` | Internal solid infill pattern | [MISSING] | [COMPLETE] |  |
| Sparse infill | `sparse_infill_density` | Sparse infill density | [COMPLETE] | [COMPLETE] |  |
| Sparse infill | `fill_multiline` | Fill multiline | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `sparse_infill_pattern` | Sparse infill pattern | [COMPLETE] | [COMPLETE] |  |
| Sparse infill | `conformal_infill` | Conformal infill | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `conformal_stagger` | Layer stagger | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `conformal_link_keep_layers` | Forward layers | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `conformal_link_flip_layers` | Reverse layers | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `conformal_pole` | Radial center | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `conformal_ray_count` | Radial line count | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `conformal_hub_radius` | Center region radius | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `locked_skin_infill_pattern` | Skin infill pattern | [N/A] | [N/A] | Bambu Locked Zag infill |
| Sparse infill | `skin_infill_density` | Skin infill density | [N/A] | [N/A] | Bambu Locked Zag infill |
| Sparse infill | `locked_skeleton_infill_pattern` | Skeleton infill pattern | [N/A] | [N/A] | Bambu Locked Zag infill |
| Sparse infill | `skeleton_infill_density` | Skeleton infill density | [N/A] | [N/A] | Bambu Locked Zag infill |
| Sparse infill | `infill_lock_depth` | Infill lock depth | [N/A] | [N/A] | Bambu Locked Zag infill |
| Sparse infill | `skin_infill_depth` | Skin infill depth | [N/A] | [N/A] | Bambu Locked Zag infill |
| Sparse infill | `skin_infill_line_width` | Skin line width | [N/A] | [N/A] | Bambu Locked Zag infill |
| Sparse infill | `skeleton_infill_line_width` | Skeleton line width | [N/A] | [N/A] | Bambu Locked Zag infill |
| Sparse infill | `symmetric_infill_y_axis` | Symmetric infill y axis | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `infill_shift_step` | Infill shift step | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `sparse_infill_lattice_angle_1` | Lattice angle 1 | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `sparse_infill_lattice_angle_2` | Lattice angle 2 | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `infill_rotate_step` | Infill rotate step | [N/A] | [N/A] | Bambu beta infill |
| Sparse infill | `sparse_infill_anchor` |  | [MISSING] | [COMPLETE] |  |
| Sparse infill | `sparse_infill_anchor_max` | Maximum length of sparse infill anchor | [MISSING] | [COMPLETE] |  |
| Sparse infill | `filter_out_gap_fill` | Filter out tiny gaps | [MISSING] | [COMPLETE] |  |
| Advanced | `infill_wall_overlap` | Infill/Wall overlap | [COMPLETE] | [COMPLETE] |  |
| Advanced | `monotonic_travel_into_wall` | Monotonic line travel extend | [MISSING] | [MISSING] |  |
| Advanced | `infill_direction` | Infill direction | [COMPLETE] | [COMPLETE] |  |
| Advanced | `bridge_angle` | Bridge direction | [MISSING] | [COMPLETE] |  |
| Advanced | `minimum_sparse_infill_area` | Minimum sparse infill threshold | [COMPLETE] | [COMPLETE] |  |
| Advanced | `infill_combination` | Infill combination | [MISSING] | [COMPLETE] |  |
| Advanced | `detect_narrow_internal_solid_infill` | Detect narrow internal solid infill | [MISSING] | [COMPLETE] |  |
| Advanced | `sub_top_surface_pattern` | Sub-top surface pattern | [MISSING] | [COMPLETE] |  |
| Advanced | `ensure_vertical_shell_thickness` | Ensure vertical shell thickness | [MISSING] | [COMPLETE] |  |
| Advanced | `detect_floating_vertical_shell` | Detect floating vertical shells | [MISSING] | [COMPLETE] |  |

#### Process › Speed

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Initial layer speed | `initial_layer_speed` | Initial layer | [COMPLETE] | [COMPLETE] |  |
| Initial layer speed | `initial_layer_infill_speed` | Initial layer infill | [COMPLETE] | [COMPLETE] |  |
| Other layers speed | `outer_wall_speed` | Outer wall | [COMPLETE] | [COMPLETE] |  |
| Other layers speed | `inner_wall_speed` | Inner wall | [COMPLETE] | [COMPLETE] |  |
| Other layers speed | `small_perimeter_speed` | Small perimeters | [MISSING] | [COMPLETE] |  |
| Other layers speed | `small_perimeter_threshold` | Small perimeter threshold | [MISSING] | [COMPLETE] |  |
| Other layers speed | `sparse_infill_speed` | Sparse infill | [COMPLETE] | [COMPLETE] |  |
| Other layers speed | `internal_solid_infill_speed` | Internal solid infill | [COMPLETE] | [COMPLETE] |  |
| Other layers speed | `vertical_shell_speed` | Vertical shell speed | [MISSING] | [COMPLETE] |  |
| Other layers speed | `top_surface_speed` | Top surface | [COMPLETE] | [COMPLETE] |  |
| Other layers speed | `enable_overhang_speed` | Slow down for overhang | [MISSING] | [COMPLETE] |  |
| Other layers speed | `overhang_1_4_speed` |  | [MISSING] | [COMPLETE] |  |
| Other layers speed | `overhang_2_4_speed` |  | [MISSING] | [COMPLETE] |  |
| Other layers speed | `overhang_3_4_speed` |  | [MISSING] | [COMPLETE] |  |
| Other layers speed | `overhang_4_4_speed` |  | [MISSING] | [COMPLETE] |  |
| Other layers speed | `overhang_totally_speed` | 100% | [MISSING] | [COMPLETE] |  |
| Other layers speed | `enable_height_slowdown` | Slow down by height | [MISSING] | [COMPLETE] |  |
| Other layers speed | `slowdown_start_height` | Starting height | [MISSING] | [COMPLETE] |  |
| Other layers speed | `slowdown_start_speed` | Speed at starting height | [MISSING] | [COMPLETE] |  |
| Other layers speed | `slowdown_start_acc` | Acceleration at starting height | [MISSING] | [COMPLETE] |  |
| Other layers speed | `slowdown_end_height` | Ending height | [MISSING] | [COMPLETE] |  |
| Other layers speed | `slowdown_end_speed` | Speed at ending height | [MISSING] | [COMPLETE] |  |
| Other layers speed | `slowdown_end_acc` | Acceleration at ending height | [MISSING] | [COMPLETE] |  |
| Other layers speed | `bridge_speed` | Bridge | [COMPLETE] | [COMPLETE] |  |
| Other layers speed | `gap_infill_speed` | Gap infill | [MISSING] | [COMPLETE] |  |
| Other layers speed | `support_speed` | Support | [COMPLETE] | [COMPLETE] |  |
| Other layers speed | `support_interface_speed` | Support interface | [COMPLETE] | [COMPLETE] |  |
| Travel speed | `travel_speed` | Travel | [COMPLETE] | [COMPLETE] |  |
| Acceleration | `default_acceleration` | Normal printing | [COMPLETE] | [COMPLETE] |  |
| Acceleration | `travel_acceleration` | Travel | [COMPLETE] | [COMPLETE] |  |
| Acceleration | `travel_short_distance_acceleration` | Short travel | [MISSING] | [MISSING] |  |
| Acceleration | `initial_layer_travel_acceleration` | Initial layer travel | [MISSING] | [COMPLETE] |  |
| Acceleration | `initial_layer_acceleration` | Initial layer | [COMPLETE] | [COMPLETE] |  |
| Acceleration | `outer_wall_acceleration` | Outer wall | [COMPLETE] | [COMPLETE] |  |
| Acceleration | `inner_wall_acceleration` | Inner wall | [MISSING] | [COMPLETE] |  |
| Acceleration | `top_surface_acceleration` | Top surface | [COMPLETE] | [COMPLETE] |  |
| Acceleration | `sparse_infill_acceleration` | Sparse infill | [MISSING] | [COMPLETE] |  |
| Acceleration | `accel_to_decel_enable` | Enable accel_to_decel | [MISSING] | [COMPLETE] |  |
| Acceleration | `accel_to_decel_factor` | accel_to_decel | [MISSING] | [COMPLETE] |  |
| Jerk(XY) | `default_jerk` | Default | [MISSING] | [COMPLETE] |  |
| Jerk(XY) | `outer_wall_jerk` | Outer wall | [MISSING] | [COMPLETE] |  |
| Jerk(XY) | `inner_wall_jerk` | Inner wall | [MISSING] | [COMPLETE] |  |
| Jerk(XY) | `infill_jerk` | Infill | [MISSING] | [COMPLETE] |  |
| Jerk(XY) | `top_surface_jerk` | Top surface | [MISSING] | [COMPLETE] |  |
| Jerk(XY) | `initial_layer_jerk` | First layer | [MISSING] | [COMPLETE] |  |
| Jerk(XY) | `travel_jerk` | Travel | [MISSING] | [COMPLETE] |  |
| Jerk(XY) | `max_volumetric_extrusion_rate_slope_positive` |  | [MISSING] | [MISSING] |  |
| Jerk(XY) | `max_volumetric_extrusion_rate_slope_negative` |  | [MISSING] | [MISSING] |  |

#### Process › Support

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Support | `enable_support` | Enable support | [COMPLETE] | [COMPLETE] |  |
| Support | `support_type` | Type | [COMPLETE] | [COMPLETE] |  |
| Support | `support_style` | Style | [MISSING] | [COMPLETE] |  |
| Support | `support_threshold_angle` | Threshold angle | [COMPLETE] | [COMPLETE] |  |
| Support | `support_on_build_plate_only` | On build plate only | [COMPLETE] | [COMPLETE] |  |
| Support | `support_critical_regions_only` | Support critical regions only | [MISSING] | [COMPLETE] |  |
| Support | `support_remove_small_overhang` | Remove small overhangs | [COMPLETE] | [COMPLETE] |  |
| Raft | `raft_layers` | Raft layers | [MISSING] | [COMPLETE] |  |
| Raft | `raft_contact_distance` | Raft contact Z distance | [MISSING] | [COMPLETE] |  |
| Support filament | `support_filament` | Support/raft base | [COMPLETE] | [COMPLETE] |  |
| Support filament | `support_interface_filament` | Support/raft interface | [MISSING] | [COMPLETE] |  |
| Support filament | `support_interface_not_for_body` | Avoid interface filament for base | [MISSING] | [COMPLETE] |  |
| Support ironing | `enable_support_ironing` | Enable ironing support interface | [MISSING] | [COMPLETE] |  |
| Support ironing | `support_ironing_pattern` | Support ironing pattern | [MISSING] | [COMPLETE] |  |
| Support ironing | `support_ironing_speed` | Support ironing speed | [MISSING] | [COMPLETE] |  |
| Support ironing | `support_ironing_flow` | Support ironing flow | [MISSING] | [COMPLETE] |  |
| Support ironing | `support_ironing_spacing` | Support ironing line spacing | [MISSING] | [COMPLETE] |  |
| Support ironing | `support_ironing_inset` | Support ironing inset | [MISSING] | [COMPLETE] |  |
| Support ironing | `support_ironing_direction` | Support ironing direction | [MISSING] | [COMPLETE] |  |
| Advanced | `raft_first_layer_density` | Initial layer density | [MISSING] | [COMPLETE] |  |
| Advanced | `raft_first_layer_expansion` | Initial layer expansion | [MISSING] | [COMPLETE] |  |
| Advanced | `tree_support_wall_count` | Support wall loops | [MISSING] | [COMPLETE] |  |
| Advanced | `support_top_z_distance` | Top Z distance | [COMPLETE] | [COMPLETE] |  |
| Advanced | `support_bottom_z_distance` | Bottom Z distance | [MISSING] | [COMPLETE] |  |
| Advanced | `support_base_pattern` | Base pattern | [MISSING] | [COMPLETE] |  |
| Advanced | `support_base_pattern_spacing` | Base pattern spacing | [COMPLETE] | [COMPLETE] |  |
| Advanced | `support_angle` | Pattern angle | [COMPLETE] | [COMPLETE] |  |
| Advanced | `support_interface_top_layers` |  | [COMPLETE] | [COMPLETE] |  |
| Advanced | `support_interface_bottom_layers` | Bottom interface layers | [MISSING] | [COMPLETE] |  |
| Advanced | `support_interface_pattern` | Interface pattern | [MISSING] | [COMPLETE] |  |
| Advanced | `support_interface_spacing` | Top interface spacing | [COMPLETE] | [COMPLETE] |  |
| Advanced | `support_bottom_interface_spacing` | Bottom interface spacing | [MISSING] | [COMPLETE] |  |
| Advanced | `support_expansion` | Normal Support expansion | [MISSING] | [COMPLETE] |  |
| Advanced | `support_object_xy_distance` | Support/object xy distance | [COMPLETE] | [COMPLETE] |  |
| Advanced | `top_z_overrides_xy_distance` | Z overrides X/Y | [MISSING] | [COMPLETE] |  |
| Advanced | `support_object_first_layer_gap` | Support/object first layer gap | [MISSING] | [COMPLETE] |  |
| Advanced | `bridge_no_support` | Don't support bridges | [MISSING] | [COMPLETE] |  |
| Advanced | `max_bridge_length` | Max bridge length | [MISSING] | [COMPLETE] |  |
| Advanced | `independent_support_layer_height` | Independent support layer height | [MISSING] | [MISSING] |  |
| Tree Support | `tree_support_branch_distance` | Branch distance | [COMPLETE] | [COMPLETE] |  |
| Tree Support | `tree_support_branch_diameter` | Branch diameter | [COMPLETE] | [COMPLETE] |  |
| Tree Support | `tree_support_branch_angle` | Branch angle | [COMPLETE] | [COMPLETE] |  |
| Tree Support | `tree_support_branch_diameter_angle` | Branch diameter angle | [MISSING] | [COMPLETE] |  |

#### Process › Others

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Bed adhension | `skirt_loops` | Skirt loops | [COMPLETE] | [COMPLETE] |  |
| Bed adhension | `skirt_height` | Skirt height | [COMPLETE] | [COMPLETE] |  |
| Bed adhension | `skirt_distance` | Skirt distance | [COMPLETE] | [COMPLETE] |  |
| Bed adhension | `brim_type` | Brim type | [COMPLETE] | [COMPLETE] |  |
| Bed adhension | `brim_width` | Brim width | [COMPLETE] | [COMPLETE] |  |
| Bed adhension | `brim_object_gap` | Brim-object gap | [COMPLETE] | [COMPLETE] |  |
| Prime tower | `enable_prime_tower` | Enable | [COMPLETE] | [COMPLETE] |  |
| Prime tower | `prime_tower_skip_points` | Skip points | [N/A] | [N/A] | H2D prime tower tuning |
| Prime tower | `prime_tower_enable_framework` | Internal ribs | [N/A] | [N/A] | H2D prime tower tuning |
| Prime tower | `prime_tower_width` | Width | [COMPLETE] | [COMPLETE] |  |
| Prime tower | `prime_tower_max_speed` | Max speed | [MISSING] | [COMPLETE] |  |
| Prime tower | `prime_tower_brim_width` | Brim width | [MISSING] | [COMPLETE] |  |
| Prime tower | `prime_tower_infill_gap` | Infill gap | [MISSING] | [COMPLETE] |  |
| Prime tower | `prime_tower_rib_wall` | Rib wall | [MISSING] | [COMPLETE] |  |
| Prime tower | `prime_tower_extra_rib_length` | Extra rib length | [MISSING] | [COMPLETE] |  |
| Prime tower | `prime_tower_rib_width` | Rib width | [MISSING] | [COMPLETE] |  |
| Prime tower | `prime_tower_fillet_wall` | Fillet wall | [MISSING] | [COMPLETE] |  |
| Prime tower | `enable_tower_interface_features` | Enable tower interface features | [N/A] | [N/A] | H2D prime tower tuning |
| Prime tower | `wipe_tower_no_sparse_layers` | No sparse layers (experimental) | [N/A] | [N/A] | H2D prime tower tuning |
| Flush options | `flush_into_infill` | Flush into objects' infill | [MISSING] | [COMPLETE] |  |
| Flush options | `flush_into_objects` | Flush into this object | [MISSING] | [COMPLETE] |  |
| Flush options | `flush_into_support` | Flush into objects' support | [MISSING] | [COMPLETE] |  |
| Special mode | `slicing_mode` | Slicing Mode | [MISSING] | [COMPLETE] |  |
| Special mode | `print_sequence` | Print sequence | [MISSING] | [COMPLETE] |  |
| Special mode | `spiral_mode` | Spiral vase | [COMPLETE] | [COMPLETE] |  |
| Special mode | `spiral_mode_smooth` | Smooth Spiral | [MISSING] | [COMPLETE] |  |
| Special mode | `spiral_mode_max_xy_smoothing` | Max XY Smoothing | [MISSING] | [COMPLETE] |  |
| Special mode | `timelapse_type` | Timelapse | [MISSING] | [COMPLETE] |  |
| Special mode | `fuzzy_skin` | Fuzzy Skin | [COMPLETE] | [COMPLETE] |  |
| Special mode | `fuzzy_skin_mode` | Fuzzy skin generator mode | [MISSING] | [COMPLETE] |  |
| Special mode | `fuzzy_skin_noise_type` | Fuzzy skin noise type | [MISSING] | [COMPLETE] |  |
| Special mode | `fuzzy_skin_point_distance` | Fuzzy skin point distance | [COMPLETE] | [COMPLETE] |  |
| Special mode | `fuzzy_skin_thickness` | Fuzzy skin thickness | [COMPLETE] | [COMPLETE] |  |
| Special mode | `fuzzy_skin_scale` | Fuzzy skin feature size | [MISSING] | [COMPLETE] |  |
| Special mode | `fuzzy_skin_octaves` | Fuzzy skin noise octaves | [MISSING] | [COMPLETE] |  |
| Special mode | `fuzzy_skin_persistence` | Fuzzy skin noise persistence | [MISSING] | [COMPLETE] |  |
| Special mode | `fuzzy_skin_first_layer` | Apply fuzzy skin to first layer | [MISSING] | [COMPLETE] |  |
| Advanced | `enable_wrapping_detection` | Enable clumping detection | [N/A] | [N/A] | H2D nozzle clumping probe |
| Advanced | `enable_order_independent_overlap_carving` | Order-independent overlap carving | [N/A] | [N/A] | Bambu multi-part carving |
| Advanced | `interlocking_beam` | Use beam interlocking | [N/A] | [N/A] | Bambu multi-material interlocking |
| Advanced | `mmu_segmented_region_interlocking_depth` | Interlocking depth of a segmented region | [N/A] | [N/A] | Bambu multi-material interlocking |
| Advanced | `interlocking_beam_width` | Interlocking beam width | [N/A] | [N/A] | Bambu multi-material interlocking |
| Advanced | `interlocking_orientation` | Interlocking direction | [N/A] | [N/A] | Bambu multi-material interlocking |
| Advanced | `interlocking_beam_layer_count` | Interlocking beam layers | [N/A] | [N/A] | Bambu multi-material interlocking |
| Advanced | `interlocking_depth` | Interlocking depth | [N/A] | [N/A] | Bambu multi-material interlocking |
| Advanced | `interlocking_boundary_avoidance` | Interlocking boundary avoidance | [N/A] | [N/A] | Bambu multi-material interlocking |
| Advanced | `sparse_infill_filament` | Sparse infill filament | [MISSING] | [COMPLETE] |  |
| Advanced | `solid_infill_filament` | Solid infill | [MISSING] | [COMPLETE] |  |
| Advanced | `wall_filament` | Walls | [MISSING] | [COMPLETE] |  |
| G-code output | `reduce_infill_retraction_mode` | Reduce infill retraction | [COMPLETE] | [COMPLETE] | as `reduce_infill_retraction` |
| G-code output | `gcode_add_line_number` | Add line number | [MISSING] | [COMPLETE] |  |
| G-code output | `exclude_object` | Exclude objects | [COMPLETE] | [COMPLETE] | as `label_objects` |
| G-code output | `filename_format` | Filename format | [MISSING] | [PARTIAL / STUBBED] | in the UI, not read by the engine |
| Post-processing scripts | `post_process` | Post-processing Scripts | [MISSING] | [MISSING] |  |
| Notes | `process_notes` | Process notes | [MISSING] | [COMPLETE] |  |

#### Filament › Filament

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Basic information | `filament_type` | Type | [COMPLETE] | [COMPLETE] |  |
| Basic information | `filament_vendor` | Vendor | [MISSING] | [COMPLETE] |  |
| Basic information | `filament_soluble` | Soluble material | [MISSING] | [COMPLETE] |  |
| Basic information | `filament_is_support` | Support material | [MISSING] | [COMPLETE] |  |
| Basic information | `impact_strength_z` | Impact Strength Z | [N/A] | [N/A] | Bambu filament database |
| Basic information | `required_nozzle_HRC` | Required nozzle HRC | [N/A] | [N/A] | Bambu filament database |
| Basic information | `default_filament_colour` | Default color | [N/A] | [N/A] | filament colour is chosen per slot |
| Basic information | `filament_diameter` | Diameter | [COMPLETE] | [COMPLETE] |  |
| Basic information | `filament_adhesiveness_category` | Adhesiveness Category | [N/A] | [N/A] | H2D prime tower tuning |
| Basic information | `filament_metal_stickiness` | Metal stickiness | [N/A] | [N/A] | Bambu filament database |
| Basic information | `filament_flow_ratio` | Flow ratio | [COMPLETE] | [COMPLETE] |  |
| Basic information | `enable_pressure_advance` | Enable pressure advance | [MISSING] | [COMPLETE] |  |
| Basic information | `pressure_advance` | Pressure advance | [MISSING] | [COMPLETE] |  |
| Basic information | `filament_density` | Density | [COMPLETE] | [COMPLETE] |  |
| Basic information | `filament_shrink` | Shrinkage | [N/A] | [N/A] | Bambu shrinkage compensation |
| Basic information | `filament_velocity_adaptation_factor` | Velocity Adaptation Factor | [N/A] | [N/A] | Bambu adaptive volumetric speed model |
| Basic information | `filament_cost` | Price | [COMPLETE] | [COMPLETE] |  |
| Basic information | `temperature_vitrification` | Softening temperature | [N/A] | [N/A] | Bambu filament database |
| Basic information | `filament_printable` | Filament printable | [N/A] | [N/A] | Bambu filament database |
| Basic information | `filament_cooling_before_tower` | Wipe tower cooling | [N/A] | [N/A] | H2D prime tower tuning |
| Basic information | `filament_tower_interface_pre_extrusion_dist` | Interface layer pre-extrusion distance | [N/A] | [N/A] | H2D prime tower tuning |
| Basic information | `filament_tower_interface_pre_extrusion_length` | Interface layer pre-extrusion length | [N/A] | [N/A] | H2D prime tower tuning |
| Basic information | `filament_tower_ironing_area` | Tower ironing area | [N/A] | [N/A] | H2D prime tower tuning |
| Basic information | `filament_tower_interface_purge_volume` | Interface layer purge length | [N/A] | [N/A] | H2D prime tower tuning |
| Basic information | `filament_tower_interface_print_temp` | Interface layer print temperature | [N/A] | [N/A] | H2D prime tower tuning |
| Basic information | `filament_prime_volume` | Filament change | [MISSING] | [COMPLETE] |  |
| Basic information | `filament_prime_volume_nc` | Hotend change | [N/A] | [N/A] | H2D dual nozzle |
| Basic information | `filament_change_length` | Extruder change | [N/A] | [N/A] | multi-extruder change length |
| Basic information | `filament_change_length_nc` | Hotend change | [N/A] | [N/A] | H2D dual nozzle |
| Basic information | `filament_ramming_travel_time` | Extruder change | [N/A] | [N/A] | H2D dual nozzle |
| Basic information | `filament_ramming_travel_time_nc` | Hotend change | [N/A] | [N/A] | H2D dual nozzle |
| Basic information | `filament_pre_cooling_temperature` | Extruder change | [N/A] | [N/A] | H2D dual nozzle |
| Basic information | `filament_pre_cooling_temperature_nc` | Hotend change | [N/A] | [N/A] | H2D dual nozzle |
| Basic information | `nozzle_temperature_range_low` | Min | [MISSING] | [COMPLETE] |  |
| Basic information | `nozzle_temperature_range_high` | Max | [MISSING] | [COMPLETE] |  |
| Print temperature | `chamber_temperatures` | Chamber temperature | [MISSING] | [COMPLETE] |  |
| Print temperature | `supertack_plate_temp_initial_layer` | Initial layer | [N/A] | [N/A] | Bambu SuperTack plate |
| Print temperature | `supertack_plate_temp` | Other layers | [N/A] | [N/A] | Bambu SuperTack plate |
| Print temperature | `cool_plate_temp_initial_layer` | Initial layer | [COMPLETE] | [COMPLETE] | as `bed_temperature_initial_layer` |
| Print temperature | `cool_plate_temp` | Other layers | [COMPLETE] | [COMPLETE] | as `bed_temperature` |
| Print temperature | `eng_plate_temp_initial_layer` | Initial layer | [COMPLETE] | [COMPLETE] | as `bed_temperature_initial_layer` |
| Print temperature | `eng_plate_temp` | Other layers | [COMPLETE] | [COMPLETE] | as `bed_temperature` |
| Print temperature | `hot_plate_temp_initial_layer` | Initial layer | [COMPLETE] | [COMPLETE] | as `bed_temperature_initial_layer` |
| Print temperature | `hot_plate_temp` | Other layers | [COMPLETE] | [COMPLETE] | as `bed_temperature` |
| Print temperature | `textured_plate_temp_initial_layer` | Initial layer | [COMPLETE] | [COMPLETE] | as `bed_temperature_initial_layer` |
| Print temperature | `textured_plate_temp` | Other layers | [COMPLETE] | [COMPLETE] | as `bed_temperature` |
| Print temperature | `nozzle_temperature_initial_layer` | Initial layer | [COMPLETE] | [COMPLETE] |  |
| Print temperature | `nozzle_temperature` | Other layers | [COMPLETE] | [COMPLETE] |  |
| Volumetric speed limitation | `filament_adaptive_volumetric_speed` | Adaptive volumetric speed | [N/A] | [N/A] | Bambu adaptive volumetric speed model |
| Volumetric speed limitation | `filament_max_volumetric_speed` | Max volumetric speed | [COMPLETE] | [COMPLETE] |  |
| Volumetric speed limitation | `filament_ramming_volumetric_speed` | Extruder change | [N/A] | [N/A] | H2D dual nozzle |
| Volumetric speed limitation | `filament_ramming_volumetric_speed_nc` | Hotend change | [N/A] | [N/A] | H2D dual nozzle |
| Filament scarf seam settings | `filament_scarf_seam_type` | Scarf seam type | [MISSING] | [COMPLETE] |  |
| Filament scarf seam settings | `filament_scarf_height` | Scarf start height | [MISSING] | [COMPLETE] |  |
| Filament scarf seam settings | `filament_scarf_gap` | Scarf slope gap | [MISSING] | [COMPLETE] |  |
| Filament scarf seam settings | `filament_scarf_length` | Scarf length | [MISSING] | [COMPLETE] |  |

#### Filament › Cooling

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Part cooling fan | `close_fan_the_first_x_layers` | For the first | [COMPLETE] | [COMPLETE] |  |
| Part cooling fan | `first_x_layer_part_fan_speed` | Fan speed | [MISSING] | [COMPLETE] |  |
| Part cooling fan | `full_fan_speed_layer` | Full fan speed at layer | [MISSING] | [COMPLETE] |  |
| Part cooling fan | `fan_min_speed` | Fan speed | [COMPLETE] | [COMPLETE] |  |
| Part cooling fan | `fan_cooling_layer_time` | Layer time | [MISSING] | [COMPLETE] |  |
| Part cooling fan | `fan_max_speed` | Fan speed | [COMPLETE] | [COMPLETE] |  |
| Part cooling fan | `slow_down_layer_time` | Layer time | [COMPLETE] | [COMPLETE] |  |
| Part cooling fan | `reduce_fan_stop_start_freq` | Keep fan always on | [MISSING] | [COMPLETE] |  |
| Part cooling fan | `slow_down_for_layer_cooling` | Slow printing down for better layer cooling | [MISSING] | [COMPLETE] |  |
| Part cooling fan | `no_slow_down_for_cooling_on_outwalls` | Don't slow down outer walls | [MISSING] | [COMPLETE] |  |
| Part cooling fan | `cooling_slowdown_logic` | Cooling slowdown logic | [N/A] | [N/A] | Bambu cooling heuristics |
| Part cooling fan | `cooling_perimeter_transition_distance` | Perimeter transition distance | [N/A] | [N/A] | Bambu cooling heuristics |
| Part cooling fan | `slow_down_min_speed` | Min print speed | [COMPLETE] | [COMPLETE] |  |
| Part cooling fan | `enable_overhang_bridge_fan` | Force cooling for overhang and bridge | [MISSING] | [COMPLETE] |  |
| Part cooling fan | `overhang_fan_threshold` | Cooling overhang threshold | [MISSING] | [COMPLETE] |  |
| Part cooling fan | `overhang_threshold_participating_cooling` | Overhang threshold for participating cooling | [N/A] | [N/A] | Bambu cooling heuristics |
| Part cooling fan | `overhang_fan_speed` | Fan speed for overhang | [MISSING] | [COMPLETE] |  |
| Part cooling fan | `pre_start_fan_time` | Pre start fan time | [N/A] | [N/A] | Bambu fan pre-spin |
| Part cooling fan | `ironing_fan_speed` | Ironing fan speed | [MISSING] | [COMPLETE] |  |
| Auxiliary part cooling fan | `close_additional_fan_first_x_layers` | For the first | [MISSING] | [COMPLETE] |  |
| Auxiliary part cooling fan | `first_x_layer_fan_speed` | Fan speed | [MISSING] | [COMPLETE] |  |
| Auxiliary part cooling fan | `additional_fan_full_speed_layer` | Full fan speed at layer | [MISSING] | [COMPLETE] |  |
| Auxiliary part cooling fan | `additional_cooling_fan_speed` | Fan speed | [MISSING] | [COMPLETE] |  |
| Exhaust fan | `activate_air_filtration` | Activate air filtration | [N/A] | [N/A] | X1/P1 exhaust fan |
| Exhaust fan | `during_print_exhaust_fan_speed` | Fan speed | [N/A] | [N/A] | X1/P1 exhaust fan |
| Exhaust fan | `complete_print_exhaust_fan_speed` | Fan speed | [N/A] | [N/A] | X1/P1 exhaust fan |

#### Filament › Advanced

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Filament start G-code | `filament_start_gcode` | Start G-code | [MISSING] | [COMPLETE] |  |
| Filament end G-code | `filament_end_gcode` | End G-code | [MISSING] | [COMPLETE] |  |

#### Filament › Notes

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Notes | `filament_notes` | Filament notes | [MISSING] | [COMPLETE] |  |

#### Filament › Multi Filament

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Multi Filament | `filament_flush_temp` | Flush temperature | [N/A] | [N/A] | H2D flush temperature |
| Multi Filament | `filament_flush_temp_fast` | Flush temperature | [N/A] | [N/A] | H2D dual nozzle |
| Multi Filament | `filament_flush_volumetric_speed` | Flush volumetric speed | [N/A] | [N/A] | H2D flush speed |
| Multi Filament | `long_retractions_when_ec` | Long retraction when extruder change | [N/A] | [N/A] | H2D dual nozzle |
| Multi Filament | `retraction_distances_when_ec` | Retraction distance when extruder change | [N/A] | [N/A] | H2D dual nozzle |

#### Printer › Basic information

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Printable space | `bed_exclude_area` | Bed exclude area | [COMPLETE] | [COMPLETE] | as `excludedAreas` |
| Printable space | `printable_height` | Printable height | [COMPLETE] | [COMPLETE] | as `bed_z` |
| Printable space | `best_object_pos` | Best object position | [N/A] | [N/A] | H2D dual nozzle |
| Advanced | `printer_structure` | Printer structure | [N/A] | [N/A] | Bambu device database |
| Advanced | `gcode_flavor` | G-code flavor | [COMPLETE] | [COMPLETE] |  |
| Advanced | `thumbnail_size` | Thumbnail size | [N/A] | [N/A] | fixed thumbnail sizes |
| Advanced | `scan_first_layer` | Scan first layer | [N/A] | [N/A] | X1 lidar |
| Advanced | `print_in_clockwise` | Print loops in clockwise | [N/A] | [N/A] | H2 kinematics option |
| Advanced | `use_relative_e_distances` | Use relative E distances | [MISSING] | [COMPLETE] |  |
| Advanced | `use_firmware_retraction` | Use firmware retraction | [N/A] | [N/A] | Bambu firmware |
| Advanced | `bed_temperature_formula` | Bed temperature type | [N/A] | [N/A] | H2D heated bed zones |
| Advanced | `machine_load_filament_time` | Filament load time | [N/A] | [N/A] | AMS timing table |
| Advanced | `machine_unload_filament_time` | Filament unload time | [N/A] | [N/A] | AMS timing table |
| Advanced | `machine_switch_extruder_time` | Extruder switch time | [N/A] | [N/A] | H2D dual nozzle |
| Advanced | `machine_hotend_change_time` | Hotend change time | [N/A] | [N/A] | H2C hot-end changer |
| Extruder Clearance | `extruder_clearance_max_radius` | Max Radius | [MISSING] | [COMPLETE] |  |
| Extruder Clearance | `extruder_clearance_dist_to_rod` | Distance to rod | [N/A] | [N/A] | X1/P1 gantry rod (covered by height to rod) |
| Extruder Clearance | `extruder_clearance_height_to_rod` | Height to rod | [MISSING] | [COMPLETE] |  |
| Extruder Clearance | `extruder_clearance_height_to_lid` | Height to lid | [MISSING] | [COMPLETE] |  |
| Accessory | `auxiliary_fan` | Auxiliary part cooling fan | [MISSING] | [COMPLETE] |  |
| Accessory | `fan_direction` | Fan direction | [N/A] | [N/A] | H2 fan duct |
| Accessory | `support_chamber_temp_control` | Support control chamber temperature | [N/A] | [N/A] | X1E/H2 chamber heater |
| Accessory | `support_air_filtration` | Air filtration enhancement | [N/A] | [N/A] | X1/P1 exhaust fan |
| Accessory | `cooling_filter_enabled` | Use cooling filter | [N/A] | [N/A] | H2 cooling filter |

#### Printer › Machine gcode

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Machine start G-code | `machine_start_gcode` | Start G-code | [COMPLETE] | [COMPLETE] |  |
| Machine end G-code | `machine_end_gcode` | End G-code | [COMPLETE] | [COMPLETE] |  |
| Printing by object G-code | `printing_by_object_gcode` | Between Object Gcode | [MISSING] | [COMPLETE] |  |
| Before layer change G-code | `before_layer_change_gcode` | Before layer change G-code | [MISSING] | [COMPLETE] |  |
| Layer change G-code | `layer_change_gcode` | Layer change G-code | [COMPLETE] | [COMPLETE] |  |
| Time lapse G-code | `time_lapse_gcode` | Time lapse G-code | [MISSING] | [COMPLETE] |  |
| Clumping Detection G-code | `wrapping_detection_gcode` | Clumping detection G-code | [N/A] | [N/A] | H2D nozzle clumping probe |
| Change filament G-code | `change_filament_gcode` | Change filament G-code | [COMPLETE] | [COMPLETE] |  |
| Pause G-code | `machine_pause_gcode` | Pause G-code | [COMPLETE] | [COMPLETE] |  |
| Template Custom G-code | `template_custom_gcode` | Custom G-code | [N/A] | [N/A] | Bambu G-code template |

#### Printer › Notes

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Notes | `printer_notes` | Printer notes | [MISSING] | [COMPLETE] |  |

#### Printer › Extruder

| Group | Bambu key | Label | Baseline | Now | Note |
|---|---|---|---|---|---|
| Basic information | `extruder_type` | Type | [N/A] | [N/A] | H2D dual nozzle |
| Basic information | `nozzle_diameter` | Nozzle diameter | [COMPLETE] | [COMPLETE] |  |
| Basic information | `nozzle_volume` | Nozzle volume | [N/A] | [N/A] | H2D dual nozzle |
| Basic information | `extruder_printable_height` | Extruder printable height | [N/A] | [N/A] | H2D dual nozzle |
| Basic information | `extruder_printable_area` | Extruder printable area | [N/A] | [N/A] | multi-extruder printers |
| Layer height limits | `min_layer_height` | Min | [MISSING] | [COMPLETE] |  |
| Layer height limits | `max_layer_height` | Max | [MISSING] | [COMPLETE] |  |
| Position | `extruder_offset` | Extruder offset | [N/A] | [N/A] | single-nozzle printers |
| Retraction | `retraction_length` | Length | [COMPLETE] | [COMPLETE] |  |
| Retraction | `z_hop` | Z hop when retract | [COMPLETE] | [COMPLETE] |  |
| Retraction | `retract_lift_above` | Z hop lower boundary | [MISSING] | [COMPLETE] |  |
| Retraction | `retract_lift_below` | Z hop upper boundary | [MISSING] | [COMPLETE] |  |
| Retraction | `z_hop_types` | Z Hop Type | [MISSING] | [COMPLETE] |  |
| Retraction | `retraction_speed` | Retraction Speed | [COMPLETE] | [COMPLETE] |  |
| Retraction | `deretraction_speed` | Deretraction Speed | [COMPLETE] | [COMPLETE] |  |
| Retraction | `retract_restart_extra` | Extra length on restart | [MISSING] | [COMPLETE] |  |
| Retraction | `retraction_minimum_travel` | Travel distance threshold | [COMPLETE] | [COMPLETE] |  |
| Retraction | `retract_when_changing_layer` | Retract when change layer | [MISSING] | [COMPLETE] |  |
| Retraction | `wipe` | Wipe while retracting | [MISSING] | [COMPLETE] |  |
| Retraction | `wipe_distance` | Wipe Distance | [MISSING] | [COMPLETE] |  |
| Retraction | `retract_before_wipe` | Retract amount before wipe | [MISSING] | [COMPLETE] |  |
| Retraction when switching material | `retract_length_toolchange` | Length | [MISSING] | [COMPLETE] |  |
| Retraction when switching material | `retract_restart_extra_toolchange` | Extra length on restart | [MISSING] | [COMPLETE] |  |
| Retraction when switching material | `long_retractions_when_cut` | Long retraction when cut(experimental) | [N/A] | [N/A] | Bambu filament cutter |
| Retraction when switching material | `retraction_distances_when_cut` | Retraction distance when cut | [N/A] | [N/A] | Bambu filament cutter |
<!-- PARAMS:END -->
