# NexSpiro

Texture-first spiral slicer by Studio Nexify. It generates knit, rope, perforated, ribbed and sine wall textures directly as toolpaths, including in-layer Z motion (non-planar), and outputs G-code for Bambu Lab, Klipper and Marlin printers.

## Run
- `npm install && npm run dev` starts the web app (Vite + Three.js).
- `npm test` runs the core engine tests (Node built-in test runner).
- `npm run typecheck` runs the TypeScript checks.
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
- **STL import**: binary and ASCII, via button or drag-and-drop. Meshes are sliced into one outer contour per layer and resampled into a continuous spiral. Patterns follow the surface normal, and the seam is aligned on +X to avoid twisting.
- **Plates**: add, delete, duplicate and lock plates, with several objects per plate. Objects can be duplicated (Ctrl+D), copied and pasted (Ctrl+C / Ctrl+V), deleted (Del), and positioned with the Move tool (M) or X/Y inputs. Each plate slices in its own background worker, and results are reused until something changes.
- **Arrange** (A): greedy circle packing with toolhead clearance spacing, for the current plate or all plates.
- **Sequential (by-object) printing**: shortest object first; between objects the nozzle retracts, lifts above everything printed, travels, and lowers. Only the last object may exceed the gantry clearance height.
- **Plate checks**: flags objects outside the bed, objects too tall (including Z wobble and margin), objects closer than the toolhead clearance, objects taller than the gantry clearance, and meshes with multiple contours.
- **Preview**: colour by Feature type, Speed, Height, Layer time, or Curvature & Non-Linear Feedrate. Layer range slider, and a lighter rendering when zoomed out.
- **G-code export**:
  - Header with print time, filament length, volume, weight and cost, plus 300×300 and 96×96 PNG thumbnails in Bambu/Orca format.
  - Start, end and layer-change macros with `{placeholder}` substitution.
  - First-layer temperatures switch to normal temperatures after layer 1.
- **Projects**: `.nexspiro` v2 project files (JSON) save plates, objects, embedded meshes, transforms, patterns, paint masks and presets. v1 files are migrated on load.

## Not yet implemented (needs a mesh pipeline)
3MF import/export, Cut tool, emboss text, mesh booleans and modifiers, supports, infill/top/bottom shells, multi-material painting, auto-orient, and printing several objects layer-by-layer together (only by-object is supported). Meshes with several separate walls at the same height print only the largest one. See [docs/SCOPE.md](docs/SCOPE.md).
