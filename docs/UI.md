# NexSpiro UI: "Soft Clay & Pill"

Stack: Vite + TypeScript + Three.js, DOM UI (no framework). The UI is four floating layers over a full-bleed canvas.

| Layer | Element | Contents |
|---|---|---|
| Top capsule | `#topbar` | project name + status badge (Draft / Slicing / Sliced / Ready), Prepare / Preview / Print switch, plate menu, **Slice & Non-Linear Path**, export menu, drawer toggle, theme toggle |
| Left dock | `#dock` + `#toolcard` | Select, Move, Rotate, Scale, Wall texture, Paint (paint/erase), Auto-arrange. A tool click slides out its parameter card; clicking again collapses it. Cut, Lay flat and Text are shown disabled (they need the mesh pipeline, see SCOPE.md) |
| Right drawer | `#drawer` | Prepare: printer/filament chips (open the preset editor), process presets + Quality/Strength/Speed tiers, **NexSpiro Non-Linear** card (toggle, tilt/clearance/tolerance summary, expandable fine-tune sliders). Preview: colour-by + legend, estimate. Print: estimate + export |
| Bottom tray | `#tray` | Plate carousel (thumbnail, time, weight, planar/non-linear badge, lock/duplicate/delete, add). In Preview it becomes a toolpath scrubber (play + step slider); the layer range is the vertical dual slider `#vlayer` |

`#hud` has `pointer-events: none`; only the cards accept events, so orbit, zoom, pan, Move and Paint work everywhere else. The 3D view centre is eased into the free area between the layers (`updateViewInsets`).

## Files
- `src/app/theme/tokens.css`: colours, elevation, motion, type. Dark overrides under `[data-theme="dark"]`.
- `src/app/theme/clay.css`: raised pills, wells, switch, slider, segmented control, chips, cards, collapse.
- `src/app/theme/workspace.css`: layer layout and responsive rules.
- `src/app/theme/theme.ts`: theme persistence and the matching 3D scene palette.
- `src/app/icons.ts`: single-weight line icons.
- `src/app/components.ts`: pure HTML builders and `DualSlider` (unit-tested in `test/ui.test.ts`).
- `src/app/main.ts`: scene + engine wiring; clicks use `data-act` (table `ACT`), inputs use `data-in` (table `IN`).

## Theme
Light by default or from `prefers-color-scheme`; the top-bar sun/moon button switches and stores `nexspiro.theme` in localStorage. Fonts are the system rounded stack; nothing is downloaded.

## Shortcuts
V select, M move, R rotate, S scale, T texture, P paint, A arrange, Ctrl+C/V/D, Del, Esc.

## Not implemented (the engine does not support it)
Cut, Lay flat, Text, support/seam paint, supports presets, undo/redo, spool colour, sending to a printer ("Print" mode is estimate + export).
