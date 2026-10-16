# Nexspiro

Studio Nexify's slicer, rebuilt from scratch. Web app (TypeScript, Vite, Three.js), with an engine core that also runs headless in Node.

## Run
- `npm install && npm run dev` starts the app.
- `npm test` runs the engine and plugin tests, including the golden G-code tests.
- `npm run typecheck` and `npm run build`.

## What is here
- **Prepare tab:**
  - 3D build plate sized from the printer profile; works on phones and narrow windows (side panels slide in)
  - shapes (cube, cylinder, vase)
  - printer, filament and print-setting profiles (Bambu X1C, Voron 2.4 on Klipper, Prusa MK3S on Marlin)
  - regions: height bands and boxes that patterns can be limited to
- **Preview tab:**
  - colour by part, speed, plastic, up/down or problems
  - 3D, front or side view
  - layer slider
- **Printer tab:** printer limits, the print-head shape used for the collision check, and what to do on a hit (lower automatically, leave the pattern out, or stop).
- **Export:** a "Check before export" report covering:
  - print-head hits
  - plastic-flow, speed, up/down and turn limits
  - loops slowed
  - pauses and lift-offs
  - time and filament the patterns add
- **Core** (`src/core`):
  - planar wall slicer that records wall slope at every point
  - extrusion from the real 3D move length with a volumetric cap
  - deterministic G-code for Klipper, Marlin and Bambu, including pauses, blobs and lift-offs
  - print-head collision check (`toolhead.ts`)
  - shared region contract for Patternex (`regions.ts`)
- **Plugin API** (`src/core/plugins.ts`): `postToolpath(layers, ctx)` runs after toolpaths and before G-code. `ctx` carries the profiles, the check report and the shared regions. E is recomputed after every plugin.
- **Motionex** (`src/plugins/motionex`):
  - 195 patterns in 17 groups, with a Size slider
  - curves for side-to-side, forward-and-back, up-and-down, plastic amount and speed
  - layer-by-layer effects for twists, diamonds, bricks, honeycomb, rings and stripes
  - pauses (with blobs), plastic changes and lift-offs
  - masks by height (with blend in and out), wall slope and region (with a soft edge); patterns stack by adding on top or replacing
  - loops print slower and warn
  - live top view and wall view previews
  - JSON pattern files

## Test prints
`npm run testprints` writes G-code for the spec's three test prints. See [docs/test-prints.md](docs/test-prints.md) for what to look for.

## Not yet
Infill and top/bottom shells, mesh import, and the extended spec items (§11): keyframes over height, overhang-aware motion, painted masks, a toolhead preset library, non-planar tops and ironing, arc fitting, the rule engine and Nexcal.
