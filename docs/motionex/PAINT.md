# Motionex velocity paint

Prints a picture into the outer wall with one filament and no filament changes. Each pixel sets the speed of the outer wall line where it crosses that pixel. Speed changes how the plastic leaves the nozzle — its gloss, how it scatters light and, without pressure advance, its width — so the picture shows as sheen. Works on any printer.

## How it works

- The picture is reduced to 2–8 grey levels. Level 0 (light) prints at *Light pixels* speed, the darkest level at *Dark pixels* speed, the levels in between evenly spread.
- After toolpaths are made, every outer wall move in the band is cut at pixel edges (no piece longer than *Finest step*) and each piece gets its pixel's speed. Extrusion per mm is unchanged, so the line keeps its width.
- Painted moves are kept out of arc fitting (an arc has one speed) and out of the cooling slowdown (it would squeeze the speeds together).
- **Wrap round:** columns go round the part by distance from the +X side, like the weave; *Times round* repeats the picture; *Twist* drifts it per row.
- **One side:** the picture is projected from one direction (*Seen from*), like a slide projector. Only the side facing that way is painted; the rest keeps the print's own speed.
- **Rows:** *Fit to band* stretches the picture over the band; *Repeat up* keeps square pixels and repeats. *Measure rows along the curve* spaces rows along the wall's profile.

## Limits checked

| Check | Why |
| --- | --- |
| Filament melt limit | Above max volumetric speed ÷ (line width × layer height) the hot end can't keep up. Faster levels are capped there and the panel says so. |
| Speed ramp vs pixel | The head needs \|v₂² − v₁²\| ÷ 2a mm to change speed. If that is more than 60% of a pixel, the picture blurs. Use bigger pixels, closer speeds, or a *Painting accel* (set around painted walls, then put back). |
| Pressure equalizer | Smooths speed steps: *Set up print settings* turns it off. |
| Minimum layer time | Painted layers are not slowed for cooling. Small parts printed fast may need two parts at once. |

## Filament

- Silk and high-gloss PLA show the strongest contrast. Matte filament shows little.
- Which way a filament goes (faster = duller or shinier) depends on the filament and temperature. Print the *speed ladder ring* first: 6 stripes from slowest to fastest, twice round a Ø50 × 30 mm ring. Pick two stripes that differ most and use their speeds.

## Print settings

*Set up print settings*: aligned seam (at the back, out of the picture), no scarf seam, pressure equalizer off. Wall count, infill and the rest stay as you have them.
