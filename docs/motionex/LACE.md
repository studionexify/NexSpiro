# Motionex lace walls

Cuts openwork holes into the walls with the toolpath itself: where the lace is open, the nozzle stops extruding, retracts, travels across and starts again on the far side. A single- or double-wall vase becomes a lattice, gothic tracery or your own picture in negative. Works on any FDM printer; no support.

## Printability rule

Every hole is checked layer by layer, from the bottom up:
- Plastic may only be laid over plastic within the overhang reach of the layer below (layer height × tan(*Steepest hole top*)), or across a gap below that is no longer than *Longest flat bridge*.
- Where the pattern wants a flat roof over a wide hole, the hole is drawn on upwards, closing in a point at the overhang angle. The report says how much of the wall this opened.
- Strands shorter than *Shortest strand* are left out (they would print as blobs); holes narrower than *Narrowest hole* are filled (ooze would close them anyway).

The test suite checks the G-code itself: every printed outer wall point of the lace sits on plastic within the reach, or bridges a short anchored gap.

## Patterns

| Pattern | Shape |
| --- | --- |
| Diamond lattice | Diamonds on a centred lattice: unbroken diagonal strands (trellis). |
| Gothic arches | Pointed arch windows, round bottoms. |
| Teardrops | Round holes with pointed tops. |
| Honeycomb | Upright hexagons, points up. |
| Almonds | Vesica (lens) holes, pointed top and bottom. |
| Slots | Tall narrow pointed slots in brick rows. |
| Waves | Wavy slots. |
| Voronoi | Organic cells; tops drawn into points by the rule. *New Voronoi cells* reseeds. |
| Picture | Dark pixels open (or light, with *Light = open*). |

- *Cell width / height* set the grid (cells keep their count round the part, so they widen on bellies).
- *Strand* is the lace left between holes; *Hole size* scales holes in their cells.
- *Grade* grows or shrinks the holes up the band; *Twist* turns the pattern round the part over the band.

## Walls and band

- *Every wall*: holes go right through. *Outer wall only*: the inner wall stays whole behind the holes (a watertight relief lace).
- The band starts at *From* (a solid floor and foot below) and stops a *Solid rim* below the top.

## Print settings

*Set up print settings*: 2 walls (1 for outer-only), 0% infill, no top shell, 4 bottom layers, spiral vase off, aligned seam, no Z hop, no wipe. Use a closed vase body (Plantex shapes) or any solid model.

## Retractions

Each hole is a retraction per wall per layer. The report counts them; above ~120 per layer, use bigger cells or turn *Retract across holes* off for tiny holes.
