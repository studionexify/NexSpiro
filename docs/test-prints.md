# Motionex test prints

`npm run testprints` writes G-code for three test prints on each printer profile to `out/test-prints/`.
`test/testprints.test.ts` checks the same prints automatically. Print them to confirm the software result matches real plastic.

| Print | File | Settings |
|---|---|---|
| 20 mm cube with a wave wall | `cube-sine-<printer>.gcode` | 0.20 mm layers, "Wave" pattern on the outer wall from 0.6 mm up |
| Vase with a rolling top rim | `vase-z-rim-<printer>.gcode` | 60 × 60 × 80 mm vase, 0.30 mm layers, single wall, "Rolling top" on the top 10 mm with a 3 mm blend in |
| Dot pattern panel | `dot-panel-<printer>.gcode` | 60 × 4 × 30 mm panel, "Dots" pattern (pause 250 ms + 1.5 mm³ blob every 3 mm) from 2 mm up |

## What to look for

### 20 mm cube with a wave wall
- **Expected:** even waves about 0.6 mm deep on all four outer faces, with smooth, closed corners.
- **Software check:** no print-head hits. The printer rounds a few tight turns at the corners (reported as "turns sharper than the printer can take at full speed"). Adds about 24 s.
- **Fail if:** the wall has gaps or blobs at the corners, layers separate, or the inner wall shows through.

### Vase with a rolling top rim
- **Expected:**
  - The top 10 mm rises and falls in smooth humps, up to 0.6 mm higher at each crest.
  - The humps stay stacked straight up even where the vase flares.
  - The lower 70 mm is plain.
- **Software check:**
  - Only the top 10 mm moves up and down.
  - Every move stays within the printer's up/down speed limit.
  - The print head clears the print: 0 adjustments on Bambu and Prusa, 2 small ones on the Voron.
  - Prusa and Bambu warn that up-and-down moves print slower.
- **Fail if:**
  - The nozzle scrapes or knocks the rim. Listen for clicking and look for drag marks.
  - Layers tear at the crests. That means the up/down height is too big for the layer height: try a lower "Up-and-down height".

### Dot pattern panel
- **Expected:** a regular grid of small round blobs, one every 3 mm along each layer, on both faces of the panel.
- **Software check:** 6063 pauses (one `G4 P250` per dot), adding about 25 minutes.
- **Fail if:**
  - The blobs are stringy: lower the blob size or raise the pause.
  - The blobs are missing: check that the printer honours `G4`, since some printer setups strip it.
  - The panel bulges: the blobs are too big for the 4 mm panel.

## Recording results
For each print, note:
- the printer and filament
- predicted vs actual print time
- photos of the patterned faces
- anything from "Fail if" above

Compare the actual time with "What the patterns add" in **Export → Check before export**.
