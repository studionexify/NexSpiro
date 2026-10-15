# Nexspiro — Plugin Framework

Studio Nexify in-house slicer. Phase 1: plugin space (runs today inside Bambu Studio / OrcaSlicer).

## Desktop app
`nexspiro` (or `dist\Nexspiro.exe`) opens the Plugin Space: printer selector (all Bambu Lab printers; P1S and A1 marked ★ primary), plugin library with search/category, auto-generated settings form, Apply panel, and "Copy Bambu Studio command". Prepare/Preview tabs are placeholders for the slicer core.

Printers: `nexspiro/core/printers.toml`. Plugins may restrict support with `printers = ["P1S", "A1"]` in `plugin.toml`.

## Build (Windows)
```
pip install -e .[dev,mesh]
pytest
pyinstaller nexspiro.spec      # -> dist\Nexspiro.exe + dist\nexspiro-plugin.exe
```
Copy `dist\nexspiro-plugin.exe` to `C:\Nexspiro\`. Extra plugins go in `C:\Nexspiro\plugins\` or `NEXSPIRO_PLUGIN_PATH`.

## Hook into Bambu Studio
Process → Others → Post-processing scripts:
```
"C:\Nexspiro\nexspiro-plugin.exe" run speed_scale --printer P1S -p feature="Outer wall" -p factor=0.8;
```
Logs: `%APPDATA%\Nexspiro\logs\plugins.log`. On any error/timeout the G-code is left untouched.

## Writing a plugin
`plugins/<name>/plugin.toml` (id, kind = gcode|mesh, params) + `plugin.py` with `class Plugin(NexPlugin)` implementing `run(ctx, params)`. See `plugins/example_speed_scale`.

CLI: `nexspiro-plugin list | info <id> | run <id> [-p k=v] <file>`

---

# Nexspiro web app (Prepare tab + Motionex)

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
