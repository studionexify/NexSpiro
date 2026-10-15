# Nexspiro — Plugin Framework

Studio Nexify in-house slicer. Phase 1: plugin space (runs today inside Bambu Studio / OrcaSlicer).

## Build (Windows)
```
pip install -e .[dev,mesh]
pytest
pyinstaller nexspiro.spec      # -> dist\nexspiro-plugin.exe
```
Copy `dist\nexspiro-plugin.exe` to `C:\Nexspiro\`. Extra plugins go in `C:\Nexspiro\plugins\` or `NEXSPIRO_PLUGIN_PATH`.

## Hook into Bambu Studio
Process → Others → Post-processing scripts:
```
"C:\Nexspiro\nexspiro-plugin.exe" run speed_scale -p feature="Outer wall" -p factor=0.8;
```
Logs: `%APPDATA%\Nexspiro\logs\plugins.log`. On any error/timeout the G-code is left untouched.

## Writing a plugin
`plugins/<name>/plugin.toml` (id, kind = gcode|mesh, params) + `plugin.py` with `class Plugin(NexPlugin)` implementing `run(ctx, params)`. See `plugins/example_speed_scale`.

CLI: `nexspiro-plugin list | info <id> | run <id> [-p k=v] <file>`
