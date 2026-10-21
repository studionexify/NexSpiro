# Motionex weave mode

Weaves a picture into the wall of a part, the way jacquard-style woven vases are printed.

## How it works

- **Colour weave:** every layer is printed in one filament, and the colours take turns (A, B, A, B… or A, B, C…). On each layer the line is pushed out where the picture shows that layer's colour, and pulled in where it doesn't. Seen from outside, every pixel shows the colour whose layers stand proud.
- **Mono relief:** one filament, no filament changes.
  - *Dark = woven texture*: dark pixels get an in/out texture, light ones a smooth wall.
  - *Light out, dark in*: light pixels stand out and dark ones are recessed.
- **Rows:** one picture row is one turn of the colours (2 layers for two colours at 1 layer per colour). With *Measure rows along the curve*, rows are spaced along the wall's profile, so bellies and flares don't stretch the picture.
- **Columns:** columns are placed by distance round each loop from a fixed direction (+X), so pixels stack straight whatever the seam does. *Twist* drifts the picture by a fraction of a column per row.

## Seam

- *Seam inside the wall*: each layer starts with a lead-in from inside the wall and ends with a tail going inside. The slicer's wipe is turned inward too, and the travel arrives at the inside start point, not on the outer surface. The start blob and end string sit on the inside.
- *Seam line*: every layer starts on this line (degrees from +X).

## Filament change

| Mode | What happens |
| --- | --- |
| Full purge | The flush from the flushing-volume matrix, as usual. |
| Small purge | A flush of the chosen volume (mm³) for each weave change. |
| Bleed (no purge) | Flush length 0 and no prime-tower band: the new colour prints straight away, and the old colour left in the nozzle bleeds into the start of the layer. *Set up print settings* also turns the prime tower off. |

The panel estimates the number of changes, the extra time (the printer's `filament_change_time` plus flush time) and the purged grams before you slice.

## Print settings

*Set up print settings* sets the following, giving one woven skin over a solid floor:
- 1 wall, 0% infill, no top shell, 4 bottom layers;
- spiral vase off, aligned seam, no scarf seam;
- no prime tower when bleeding.

Use a solid body (Plantex *Weave* presets, or any closed vase model).

## Calibration

*Add calibration ring* places a Ø50 × 22 mm ring. It weaves a checker as a depth ladder: 5 bands from 0.5× to 1.5× of the chosen depth, from the bottom up. Pick the band that looks best and set that depth.

## Code

- `src/plugins/motionex/weave/model.ts`: settings.
- `src/plugins/motionex/weave/core.ts`: the layer plan and per-point offset, plus `weaveLoop`, which offsets a loop and starts it at the seam.
- `src/plugins/motionex/weave/engine.ts`: per-layer filament regions, purge per change, and the move-list pass with the inward seam.
- `src/plugins/motionex/weave/image.ts`, `motifs.ts`: turning pictures into the colour grid (nearest colour, dithering, grey levels), and the built-in motifs.
- `src/plugins/motionex/weave/plan.ts`, `preview.ts`: the estimate, print settings and quick preview.
- `src/plugins/motionex/ui/WeavePanel.tsx`: the panel.
- Tests: `tests/motionex/weave.test.ts`.
