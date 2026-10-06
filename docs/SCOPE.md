# NexSpiro — Scope Definition Plan

## Context
- Repo `studionexify/NexSpiro` is empty.
- Goal: a slicer focused on **toolpath-generated textures** (Kowafat knit bowls/lamps, Wontek-style perforated shades). Normal slicers don't generate this geometry; the toolpath creates it.
- How the reference pieces are made:
  - **Knit bowls / mushroom lamp**: single-wall spiral (vase mode). Each layer gets an XY sine offset, and the phase shifts from layer to layer (0° or 180° for stacked loops, an incremental shift for diagonal "rope" lines). Often a **Z oscillation within the layer** (non-planar) is added, plus over-extrusion at the peaks, so the bead droops into loops.
  - **Perforated pendants**: the wave amplitude is larger than the bead width. Adjacent layers touch only at the nodes, which leaves diamond holes. Perforation density = wave frequency × layer pitch.
  - Shared requirements: G-code computed directly as continuous parametric paths; modulation of extrusion, speed and fan along each path; Z moved *within* a layer.
- Prior art to study, not copy: FullControl GCode (parametric design), Orca/Prusa "fuzzy skin" (random, not periodic), CNC Kitchen non-planar work, Bambu/Orca vase mode.

## Proposed product scope (v1 candidate)
1. **Input**: STL/3MF, or built-in parametric primitives (bowl, vase, shade, lamp base), so meshes are optional.
2. **Path engine**: contour from the mesh or primitive → continuous spiral → modulation applied.
3. **Pattern dropdown (per wall / per painted region)**:
   - Sine / triangle / square / sawtooth XY wave
   - Knit (XY wave + Z wobble + extrusion pulse)
   - Rope / diagonal (phase shift per layer)
   - Perforated mesh (amplitude > bead width)
   - Ribbed / fluted (low-frequency)
   - Noise (fuzzy) and image-mapped displacement (later)
4. **Parameters per pattern**: amplitude, wavelength (or count per revolution), phase shift per layer, Z amplitude, extrusion multiplier curve, speed curve, and a fade-in/out band by height.
5. **Painting**: brush on the model surface → mask → the pattern is applied only in masked regions, with blending at the borders.
6. **Preview**: 3D G-code toolpath viewer, bead-width simulation, collision/overhang warnings.
7. **Output**: Marlin/Klipper G-code, with Bambu .gcode.3mf export later. Printer profiles: bed, nozzle, volumetric limit.

## Locked decisions
- Texture-first MVP: single-wall spiral with a pattern dropdown and painting.
- Web app: TypeScript, Vite, React, Three.js.
- Firmware: Bambu (.gcode.3mf), Klipper, Marlin.

## Web performance strategy (answers "will it glitch?")
- Typical load: 200 mm tall at 0.2 mm layers = 1,000 layers. At ~4–8k segments per layer that is 4–8M segments.
- Path math runs in **Web Workers**, chunked per layer, so the UI never blocks. If profiling shows a bottleneck, port the hot loops to Rust→WASM.
- Rendering:
  - One merged `BufferGeometry` per layer band, drawn as instanced tubes or screen-space fat lines (WebGL2), not one mesh per segment.
  - LOD: decimate when zoomed out, full bead detail near the camera, and a layer-range slider like Orca.
  - Typed arrays everywhere, and G-code is streamed to file.
- Benchmark gate: render a 5M-segment knit vase at 60 fps (zoomed out) and ≥30 fps (detail) on a mid-range laptop GPU before adding features.

## MVP milestones
1. Path engine, using parametric primitives only (bowl, vase, shade). Patterns: sine, knit, rope, perforated. G-code export for Marlin and Klipper.
2. Viewer with LOD, layer slider and the performance gate.
3. STL import: slice into contours → spiral.
4. Surface painting masks with per-region patterns.
5. Bambu .gcode.3mf export and printer profiles.
6. Test coupons printed and compared against the reference pieces.

## Open decisions
- Platform: desktop app (Electron/Tauri + TS/Rust) vs web app (WebGL, client-side) vs Python core + UI.
- Scope: vase-mode-only texture generator (fast MVP) vs full general slicer (infill, supports, multi-wall). Full slicer is years of work; recommend forking OrcaSlicer later, or a texture-first MVP now.
- Target printers/firmware: Bambu, Klipper, Marlin.
- True non-planar (Z oscillation) needs nozzle clearance checks per printer.

## Verification (once implemented)
- Unit tests on path math (continuity, extrusion volume).
- Print test coupons per pattern; compare against the reference images.
- Validate G-code in the Orca/Bambu Studio preview.
