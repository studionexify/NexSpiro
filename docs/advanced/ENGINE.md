# NexSpiro Advanced engine (Physics Core)

The header's centre toggle switches the slicing engine:

- **BASIC (Bambu Engine)** — the classic heuristic slicer, unchanged. `tests/advanced/basic-golden.test.ts` pins its G-code byte for byte.
- **ADVANCED (NexSpiro Physics Core)** — every part is analysed, split into zones, and compiled with the subset of the 35 technologies that the selected **intent** and **machine** call for.

## Pipeline

```
meshes ─▶ fields ─▶ router ─▶ layer plan ─▶ regions ─▶ walls ─▶ infill ─▶ toolpath passes ─▶ plugins ─▶ rheology & motion ─▶ G-code
          (SDF,      (zones,    (curved-layer  (ports,    (PDE     (stress,   (helix, seams,       (Motionex,   (gloss, thermal,
          curvature, Reeb       warp field)    dovetails)  offsets) lattices)  weaving, ironing…)   Patternex)   foam, kinematics)
          thickness) graph)
```

| Stage | Where | Hook |
| --- | --- | --- |
| Fields & zones | `analysis.ts`, `sdf.ts`, `meshfields.ts`, `sections.ts` | `analyzePart()` |
| Layer plan | curved layers are a Z warp `z = z′ + dz(x, y, z′)`; meshes are warped, sliced flat, and every move is un-warped | `TechModule.warp` |
| Regions | cross-section edits before walls | `TechModule.reshape` |
| Walls / infill | replace the classic generator for one island or sparse region | `TechModule.walls`, `TechModule.infill` |
| Toolpath passes | edit the ordered move list (`LayerOps`) before plugins | `TechModule.post` |
| Rheology & motion | speeds, flow, fan and temperature on the final move list | `TechModule.finalize` |

Modules are listed in pipeline order in `src/engine/advanced/modules/index.ts`. A technology runs only when it is enabled (intent default or user override) **and** the machine model allows it.

## Machine capability model

`machine.ts` derives, for every printer profile: kinematics, axis count, firmware features (input shaping, pressure advance, arcs), Z limits, hotend flow, chamber, material changer, frame resonance, and the **head clearance** — the steepest slope a non-planar move can follow before the heater block or fan duct reaches printed plastic:

`θ_max = min over head volumes of atan((lift − margin) / reach)`, with `reach` the farthest point of the volume's footprint from the nozzle (the worst slope direction). Stock Bambu heads give ≈ 11°, a Revo/Stealthburner ≈ 15–20°, a 5-axis machine is not limited by it.

Every technology has a `mould()` rule returning *ok*, *adapted* (runs in a reduced or machine-specific form, with the reason) or *unavailable* (with the reason). Users can edit the capability model (tip length, resonance, flow, chamber, kinematics up to 5-axis) for modified or future machines.

## Zones

| Zone | Found by |
| --- | --- |
| Domes / shallow slopes | up-facing triangles, slope 1–35°, mean curvature |
| Curved walls | slope 35–80° |
| Overhangs | down-facing beyond the support angle |
| High-stress necks | cross-section area minima (< 60 % of both neighbours) |
| Bosses / holes | round holes (circularity > 0.85, r 0.8–12 mm) on ≥ 3 planes |
| Helical zones | steady single-island Z bands (area change < 5 %) |
| Cores | voxels deeper than the shell plus two lines |
| Thin walls / interfaces | wall thickness along the inward normal; paint-colour boundaries |

## Verification

- `tests/advanced/phase1.test.ts`: SDF against analytic distances, curvature (Gauss–Bonnet), thickness, topology (genus), zone detection, slicing in every intent on Bambu, Klipper and Marlin machines.
- `tests/advanced/basic-golden.test.ts`: Basic-mode G-code hashes.
