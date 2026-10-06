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
- `src/app/bed.ts`: draws the build plate (printer frame, wiper bump, front tray, plate engraving, grid) for the selected printer and plate type.
- `src/core/select.ts`: face / edge picking on triangle meshes (welded adjacency, flood fill, sharp-edge chains) — unit-tested.
- `src/core/primitives.ts`: 36 parametric shapes (prisms, polygons, vessels…); each has sliders and clamped parameters.
- `src/net/printers.ts`: network connectors (Moonraker, OctoPrint, PrusaLink, Bambu via the bridge).
- `bridge/`: local helper for Bambu Lab LAN mode (see `bridge/README.md`).
- `src/app/main.ts`: scene + engine wiring; clicks use `data-act` (table `ACT`), inputs use `data-in` (table `IN`).

## Theme
Light by default or from `prefers-color-scheme`; the top-bar sun/moon button switches and stores `nexspiro.theme` in localStorage. Fonts are the system rounded stack; nothing is downloaded.

## Shortcuts
V select, M move, R rotate, S scale, T texture, F faces & edges, P paint, A arrange, Ctrl+C/V/D, Del, Esc.

## Workflow additions
- **Build plate**: the 3D bed is redrawn for the selected printer (Bambu, Prusa, Voron, Creality, generic) and plate type (Textured/Smooth PEI, Cool, Engineering, High Temp). Pick the plate in *Printer & material → Build plate*.
- **Path preview (Prepare)**: toolpaths are hidden in Prepare. The *Path preview* button in the top capsule shows them (model turns into a ghost) and keeps them re-slicing while you edit — no tab switch.
- **Shapes**: *Objects → Add shape…* offers 36 primitives in five groups; the Objects card then shows that shape's dimension sliders.
- **Faces & edges** (F): hover previews, click/drag adds or removes. *Faces* = flat / smooth region grow with an angle tolerance, or a single triangle; *Edges* = nearest sharp edge (optionally the whole loop) with a band width. Selections fill a **zone**; each zone has its own wall texture and non-linear (Z wobble) settings. Unselected wall prints plain, like Bambu Studio. Only surfaces that become the spiral wall can be textured (top/bottom caps and interior faces are ignored).
- **Preview**: toolhead marker follows the scrub position through the objects in print order; the readout shows speed and Z wobble. The drawer carries the full non-linear settings and *Motion tuning* (zone texture, speed, segments/rev, fade-in) and re-slices live.
- **Print → network**: add printers (Moonraker, OctoPrint, PrusaLink directly; Bambu LAN via `bridge/`), see live temperatures/progress, *Send* or *Send & print*, pause/resume/stop. The page must be served over **http** (e.g. `npm run dev`) to reach LAN printers; https pages cannot call plain-http devices.

## Not implemented (the engine does not support it)
Cut, Lay flat, Text, support/seam paint, supports presets, undo/redo, spool colour, printer discovery (browsers cannot scan the network — enter the IP), Bambu cloud (only LAN mode).
