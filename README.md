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
