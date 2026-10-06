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
- **Plates**: add, delete, duplicate (Ctrl+D), copy/paste (Ctrl+C / Ctrl+V) and lock plates. Each plate slices in its own background worker, and results are reused until something changes.
- **Plate checks**: warns when the footprint, height (including Z wobble and margin) or toolhead clearance exceeds the printer.
- **Preview**: colour by Feature type, Speed, Height, Layer time, or Curvature & Non-Linear Feedrate. Layer range slider, and a lighter rendering when zoomed out.
- **G-code export**:
  - Header with print time, filament length, volume, weight and cost, plus 300×300 and 96×96 PNG thumbnails in Bambu/Orca format.
  - Start, end and layer-change macros with `{placeholder}` substitution.
  - First-layer temperatures switch to normal temperatures after layer 1.
- **Projects**: `.nexspiro` project files (JSON) save plates, transforms, patterns, paint masks and presets.

## Not yet implemented (needs a mesh pipeline)
STL/3MF import, Cut tool, emboss text, mesh booleans and modifiers, supports, infill/top/bottom shells, multi-material painting, auto-orient and libnest2d-style arranging (each plate holds one object), and .3mf project export. See [docs/SCOPE.md](docs/SCOPE.md).
