<p align="center">
  <img src="public/logo-dark.svg" width="96" alt="NexSpiro logo" />
</p>

<h1 align="center">NexSpiro</h1>
<p align="center">A 3D-printing slicer for Bambu Lab, Creality, Elegoo and more — runs locally as a desktop app, or in any browser.</p>

---

## What works today (Phase 1)

| Area | Features |
| --- | --- |
| **Import** | STL (binary + ASCII), OBJ, 3MF (multi-object, components & transforms). Drag-and-drop or File → Import. |
| **Prepare** | Build plate sized to the printer (10/50 mm grid, origin axes, excluded zones), move / rotate / scale gizmos with numeric panels, lay on face, auto-orient, auto-arrange, duplicate, delete, undo/redo, overhang highlight, out-of-bounds warning. |
| **Printers** | Bambu Lab A1, A1 mini, P1S, P1P, X1 Carbon, X1E · Creality Ender-3 V3 KE · Elegoo Neptune 4 Max. Editable retraction and start/end/layer G-code. |
| **Filaments** | PLA, PLA Matte, PETG, ABS, ASA, TPU with per-plate bed temperatures, cooling and max volumetric speed. |
| **Process** | 0.08–0.28 mm presets; Quality / Strength / Speed / Support / Others tabs; modified values in amber with one-click reset; search (Ctrl+F); hover tooltips with internal keys. |
| **Slicing engine** | Mesh slicing with topological loop chaining, XY hole/contour + elephant-foot compensation, classic perimeters, top/bottom/solid/sparse/bridge classification, infill patterns (grid, gyroid, rectilinear, aligned, triangles, concentric), monotonic top skins, ironing, overhang-wall detection, normal supports with interface layers, skirt & brim (auto/outer/inner), spiral vase, fuzzy skin, seam placement (aligned/nearest/back/random), cooling slowdown, volumetric-speed limiting, retraction + Z-hop, object labelling (Klipper `EXCLUDE_OBJECT`, `M486`). |
| **Preview** | GPU-instanced toolpath rendering; colour by line type, speed, layer height, line width, flow or layer time; per-feature visibility; dual-handle layer slider and move scrubber with nozzle marker; time / filament / cost summary. |
| **Output** | G-code with progress (`M73`), per-printer start/end macros, estimated time & filament comments. |

Planned: **Phase 2** — painting (supports/seams), modifiers, multi-plate, AMS multi-colour + prime tower, tree supports, variable layer height, Arachne walls.
**Phase 3** — Device (Bambu LAN, Klipper/Moonraker, OctoPrint, USB), Project and Calibration workspaces. The connection interface is already defined in `src/connect/types.ts`.

## Download & run

- **Desktop installers** — open the repository's **Actions → Desktop installers** workflow and click *Run workflow*, then download the `NexSpiro-Windows` / `NexSpiro-macOS` / `NexSpiro-Linux` artifact. Pushing a tag such as `v0.1.0` also publishes the installers on the **Releases** page.
  - macOS builds are unsigned: right-click the app → *Open* the first time.
- **Web version** — enable *Settings → Pages → Source: GitHub Actions*; every push to the default branch publishes the app to GitHub Pages so it can be opened from any browser.

## Develop

Requires Node.js 20+.

```bash
npm install
npm run dev            # web app at http://localhost:5173
npm run electron:dev   # desktop app with hot reload
npm test               # engine tests (slices every printer profile)
npm run build          # production web build → dist/
npm run electron:build # installers for the current OS → release/
```

## Project layout

```
src/
  engine/      slicing pipeline (pure TypeScript, runs in a Web Worker)
    slice.ts     mesh ∩ Z-planes → closed loops
    slicer.ts    perimeters, region classification, infill, ordering
    support.ts   overhang detection & support projection
    fill.ts      infill pattern generators
    gcode.ts     timing, cooling, G-code emission
  io/          STL / OBJ / 3MF readers
  profiles/    printers, filaments, process parameter schema & resolution
  state/       app store, scene operations, slicing bridge
  viewport/    Three.js scene and toolpath renderer
  ui/          React components
  connect/     printer connection interfaces (Phase 3)
electron/      desktop shell (app:// protocol, native file dialogs)
```

### Adding a printer

Append an entry to `PRINTERS` in `src/profiles/printers.ts` (bed size, plates, G-code flavour, start/end G-code, speed defaults). Everything else — the selector, plate, slicing and tests — picks it up automatically.

> Always check the first print on a new printer profile. The start G-code is a clean, standard sequence (home → heat → level → purge line). Review it in **Printer → Edit → Machine G-code** before printing.
