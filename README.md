# NexSpiro

Texture-first spiral slicer by Studio Nexify. It generates knit, rope, perforated, ribbed and sine wall textures directly as toolpaths, including in-layer Z motion (non-planar), and outputs G-code for Bambu Lab, Klipper and Marlin printers.

## Run
- `npm install && npm run dev` starts the web app (Vite + Three.js).
- `npm test` runs the core engine tests (Node built-in test runner).
- `npm run typecheck` runs the TypeScript checks.
- UI design system and layout: [docs/UI.md](docs/UI.md).
- `npm run generate -- bowl knit machine/voron-24 out.gcode` generates G-code from the command line.

## Features
- **Presets**: three tiers (Printer / Filament / Process) with `inherits` chains. User presets store only the values that differ from their parent and are saved in browser storage and in project files.
- **NexSpiro Non-Linear Motion** (Process tab):
  - On/off toggle; off gives a planar spiral.
  - Curve deviation tolerance (point decimation).
  - Maximum surface inclination.
  - Toolhead collision margin.
  - Z feedrate / jerk smoothing.
- **Motion planner**:
  - Feedrate limited by max volumetric speed, cornering speed (from acceleration and curvature) and max Z speed, then smoothed for acceleration.
  - Layers that print too fast are slowed down to meet the minimum layer time.
  - Fan speed per layer.
- **Painting**: paint on the outer surface to apply a different pattern to any region, with soft blended borders.
- **Import** (button or drag-and-drop; parsed in a background IO worker):
  - **STL** binary/ASCII, **OBJ** (groups → objects, materials kept), **PLY** ascii/binary LE/BE with vertex colours.
  - **STEP/STP** via OpenCASCADE (`occt-import-js`, WASM, ~7.6 MB, loaded only on first STEP). Tessellation tolerance is configurable; analytic surface normals are kept.
  - **3MF**: core spec plus Bambu Studio extras: `3D/Objects/*.model` components, plates and names from `model_settings.config`, presets from `project_settings.config`. Colour paint (`paint_color` / `mmu_segmentation`) on extruder N maps to NexSpiro paint region N. Support and seam paint are kept for round-trip but ignored for printing.
  - **Profiles**: Bambu Studio / OrcaSlicer JSON and PrusaSlicer / SuperSlicer INI (single config or bundle). Placeholders are converted; unsupported placeholders and `{if}` blocks are reported for review.
  - **Machine geometry**: a toolhead mesh (STL/STEP) sets the clearance radius and gantry height; a bed-exclusion SVG adds keep-out zones enforced by arrange and plate checks; a bed texture PNG is shown in the viewer.
- **Export**: G-code; 3MF (Bambu-style plates and settings, paint as `paint_color`, plus an embedded `.nexspiro` for a lossless NexSpiro round trip); `.nexspiro` v3 zip; STL/OBJ of the selected object; baked textured wall STL (the toolpath swept as a watertight bead); trajectory CSV/JSON (x, y, z, e, f, normal, curvature, layer, region, Z offset; developer mode).
- **STL slicing**: meshes are sliced into one outer contour per layer and resampled into a continuous spiral. Patterns follow the surface normal, and the seam is aligned on +X to avoid twisting.
- **Plates**: add, delete, duplicate and lock plates, with several objects per plate. Objects can be duplicated (Ctrl+D), copied and pasted (Ctrl+C / Ctrl+V), deleted (Del), and positioned with the Move tool (M) or X/Y inputs. Each plate slices in its own background worker, and results are reused until something changes.
- **Arrange** (A): greedy circle packing with toolhead clearance spacing, for the current plate or all plates.
- **Sequential (by-object) printing**: shortest object first; between objects the nozzle retracts, lifts above everything printed, travels, and lowers. Only the last object may exceed the gantry clearance height.
- **Plate checks**: flags objects outside the bed, objects too tall (including Z wobble and margin), objects closer than the toolhead clearance, objects taller than the gantry clearance, and meshes with multiple contours.
- **Preview**: colour by Feature type, Speed, Height, Layer time, or Curvature & Non-Linear Feedrate. Layer range slider, and a lighter rendering when zoomed out.
- **G-code export**:
  - Header with print time, filament length, volume, weight, cost and non-linear motion distance, plus 32×32, 300×300 and 600×600 PNG thumbnails in Bambu/Orca format.
  - Optional helical arc fitting (`G2`/`G3` with Z and E), only on runs that fit a circle within tolerance and carry no non-planar Z offset.
  - Refuses to export if any move's Z velocity exceeds the printer's max Z speed.
  - Start, end and layer-change macros with `{placeholder}` substitution.
  - First-layer temperatures switch to normal temperatures after layer 1.
- **Projects**: `.nexspiro` v3 is a zip archive (`project.json`, binary meshes and paint masks, plate thumbnails). v1 and v2 JSON projects still open.

## Not yet implemented (needs a mesh pipeline)
Cut tool, emboss text, mesh booleans and modifiers, supports, infill/top/bottom shells, multi-material painting, auto-orient, and printing several objects layer-by-layer together (only by-object is supported). Meshes with several separate walls at the same height print only the largest one. See [docs/SCOPE.md](docs/SCOPE.md).
