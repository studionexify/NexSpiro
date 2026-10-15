# Nexspiro

Studio Nexify's slicer, rebuilt from scratch. Web app (TypeScript, Vite, Three.js), with an engine core that also runs headless in Node.

## Run
- `npm install && npm run dev` starts the app.
- `npm test` runs the engine and plugin tests, including the golden G-code tests.
- `npm run typecheck` and `npm run build`.

## What is here
- **Prepare tab:** a 3D build plate sized from the machine profile, cube/cylinder/vase primitives, object transform, and printer/filament/process profiles (Bambu X1C, Voron 2.4 on Klipper, Prusa MK3S on Marlin).
- **Core** (`src/core`): a planar wall slicer, extrusion calculated from the actual 3D move length with a volumetric flow cap, a deterministic G-code emitter for Klipper/Marlin/Bambu, and the plugin host.
- **Plugin API** (`src/core/plugins.ts`): `NexPlugin.postToolpath(layers, ctx)` runs after toolpaths are generated and before G-code is emitted. E is recomputed afterwards, so plugins only edit geometry, feedrate and flow.
- **Motionex** (`src/plugins/motionex`): motion brushes covering spec phases 2–4.
  - 7 presets: sine, zigzag, square, sawtooth, coil, loop/curl, noise.
  - A curve editor for lateral offset, along-path offset, extrusion and speed, with bezier/linear/step curves, handles and numeric entry.
  - Amplitude, period, phase, and repeat mode (tile/once/stretch).
  - Brushes saved as JSON with import/export, flow limits, and a seeded noise brush.
  - A live 2D preview of the brush on a sample path.
  - Brush applications by feature or whole model, with a Z range and fade-in.

## Not yet (Motionex phases 5–9)
Point events (dwell, flow change, retract), Z offset with toolhead profiles and the collision pass, the side-view preview, stacking with override blending, Patternex regions, and the validation report. Marlin and Bambu will need Z-speed gating before Z brushes are enabled.
