<p align="center">
  <img src="public/logo-dark.svg" width="96" alt="NexSpiro logo" />
</p>

<h1 align="center">NexSpiro</h1>
<p align="center">A 3D-printing slicer for Bambu Lab, Creality, Elegoo and more — runs locally as a desktop app, or in any browser.</p>

---

## Features

### Phase 1 — core slicer
| Area | Features |
| --- | --- |
| **Import** | STL (binary + ASCII), OBJ, 3MF (multi-object, components & transforms). Drag-and-drop or File → Import. |
| **Prepare** | Build plate sized to the printer (10/50 mm grid, origin axes, excluded zones), move / rotate / scale gizmos with numeric panels, lay on face, auto-orient, auto-arrange, duplicate, delete, undo/redo, overhang highlight, out-of-bounds warning. |
| **Printers** | Bambu Lab A1, A1 mini, P1S, P1P, X1 Carbon, X1E · Creality Ender-3 V3 KE · Elegoo Neptune 4 Max. Editable retraction and start/end/layer G-code. |
| **Filaments** | PLA, PLA Matte, PETG, ABS, ASA, TPU with per-plate bed temperatures, cooling and max volumetric speed. |
| **Process** | 0.08–0.28 mm presets; Quality / Strength / Speed / Support / Others tabs; modified values in amber with one-click reset; search (Ctrl+F); hover tooltips with internal keys. |
| **Slicing engine** | Mesh slicing with topological loop chaining, XY hole/contour + elephant-foot compensation, classic perimeters, top/bottom/solid/sparse/bridge classification, infill patterns (grid, gyroid, rectilinear, aligned, triangles, concentric), monotonic top skins, ironing, overhang-wall detection, skirt & brim, spiral vase, fuzzy skin, seam placement, cooling slowdown, volumetric-speed limiting, retraction + Z-hop, object labelling (Klipper `EXCLUDE_OBJECT`, `M486`). |
| **Preview** | GPU-instanced toolpaths; colour by line type, filament, speed, layer height, line width, flow or layer time; per-feature visibility; layer and move sliders; time / filament / cost summary. |

### Phase 2 — advanced preparation
| Area | Features |
| --- | --- |
| **Multi-material** | Up to 16 filament slots, filament per object, colour painting (brush, palette, keys 1–9), automatic filament changes with the Bambu AMS sequence (`M620`/`T`/`M621` + flush) or `M600` pauses on manual printers, prime tower sized from the prime volume, per-filament weight & cost, change-time estimate. |
| **Painting** | Support enforcer/blocker painting (with "on overhangs only"), seam enforcer/blocker painting, colour painting. Left drag = enforce/paint, right drag = block/reset, Shift = erase, middle drag = orbit. |
| **Supports** | Normal and tree supports, auto or manual (painted areas / enforcer volumes only), support filament choice, blockers. |
| **Parts** | Negative volumes (cut-outs), infill modifiers, support enforcer and blocker volumes — box, cylinder or sphere, positioned with the same gizmos. |
| **Per-object settings** | Objects tab with the plate/object/part tree; override walls, shells, infill, seam, ironing and fuzzy skin per object. |
| **Variable layer height** | Adaptive profile from surface slope (quality ↔ speed), Gaussian smoothing, fixed-height ranges, profile chart. |
| **Multi-plate** | Add / delete / switch plates, move objects between plates, slice the active plate. |
| **Layer actions** | Pause, filament change or custom G-code at any layer from the Preview slider. |

### Phase 3 — devices, project & calibration
| Area | Features |
| --- | --- |
| **Devices** | Bambu Lab LAN (MQTT/TLS status & control, FTPS upload, A1/P1 camera, AMS & HMS), Klipper/Moonraker, OctoPrint/PrusaLink, USB serial (Marlin host with checksums & resend). Saved printers (access codes encrypted on desktop), live temps, job control, jog, console, file manager. Network Bambu connections need the desktop app. |
| **Print** | *Print plate* dialog: slice → `.gcode.3mf` (Bambu, with thumbnail, MD5, slice info, AMS mapping) or G-code with embedded thumbnails → upload → start. |
| **Project** | Save/open `.3mf` projects (whole scene, settings, paint, parts, plates) readable by other slicers; title, designer, licence, notes, photos, bill of materials. |
| **Calibration** | Temperature tower, pressure advance, flow (coarse/fine), max volumetric speed, retraction — results saved per filament slot and used when slicing. |
| **Engine** | Arachne-style variable-width walls, G2/G3 arc fitting, per-layer setting changes. |

### Phase 4 — catalogue & tools
| Area | Features |
| --- | --- |
| **Printers** | 44 profiles: all current Bambu Lab (incl. H2D single-nozzle), Creality K1/K2/Ender-3 V3 family, Elegoo Neptune 3/4 & Centauri, Prusa MK3S+/MK4S/MINI+/CORE One/XL, Anycubic Kobra, Voron, Qidi, Sovol, Artillery, generic Marlin/Klipper. |
| **Tools** | Cut (tilted plane, capped), Mesh boolean (union/difference/intersection), Text (object/emboss/engrave), Measure, Flushing-volume matrix. |

> Not covered yet: H2D dual-nozzle, Creality CFS / Anycubic ACE multi-colour, X1/H2 camera (RTSPS — open the shown URL in VLC). Profiles beyond the original four printers use generic start G-code — check the first print.

> Painting resolution follows the model's triangles; very coarse meshes paint in large facets.

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
    support.ts   overhang detection, normal & tree supports
    paint.ts     painted triangles → per-layer regions
    layers.ts    variable layer height profiles
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
