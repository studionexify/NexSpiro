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

## Phase 2 — field, PDE & geometric solvers

| Piece | File | Method |
| --- | --- | --- |
| Linear solvers | `solvers.ts` | Jacobi-PCG (3D Laplace with Dirichlet/Neumann cells), multigrid-preconditioned CG for 2D (screened) Poisson, sparse Jacobi-PCG for thin bands |
| Harmonic dome field (#24) | `harmonic.ts` | ∇²φ = 0, φ = 0 on bed cells, φ = 1 on cells under dome/shallow triangles, zero flux elsewhere. Per column, warped height z′ = H·φ(z) is inverted to a displacement d(x, y, z′); a per-column conformity λ keeps every layer under 75 % of the clearance slope, then a global scale enforces slope ≤ 80 % of θ_max and layer ratio within [min, max] |
| Curved layers | `warp.ts` | Meshes are warped z → z′ (bisection on the monotone map), sliced flat, and every move is mapped back with adaptive splitting where the layer bends more than 0.01 mm from the chord; extrusion × ∂z/∂z′. The first 0.45 mm stays flat and the warp fades in over 1.2 mm |
| SGD slicing (#14) | `sgd.ts` | Tensor-product cubic B-spline d(x, y, z′); L = w₁ overhang (angle to the tilted layer under the support threshold) + w₂ clearance (slope over the limit) + w₃ anisotropy (layer ∥ up-facing skin) + w₄ thickness error; exact gradients, Adam, mini-batches. Refines the dome warp when both are on |
| Heat-method walls (#15) | `offsets.ts` | Raster the island; Eikonal distance by fast sweeping (exact distances at the boundary); in a band up to the deepest wall: (I − tΔ)u = 0, X = −∇u/|∇u|, Δφ = ∇·X, anchored to the Eikonal distance on the band's inner edge; marching-squares isolines, cubic B-spline smoothing (C²). Outer wall stays an exact offset; repeated outlines reuse their solution |
| Conformal skins (#4) | `surface.ts` | Top-skin points move to the CAD surface height within ±½ layer (ray cast up), flow for the new bead height |
| Clearance checker (Task 2.3) | `clearance.ts` | Height maps of finished layers and of the current layer (3 mm lag); a non-planar point must keep the nozzle cone, heater block, fan duct and carriage above printed plastic and its tip ≥ 0.03 mm above the finished layer under it. Lifts up to ½ layer, otherwise reports |

Verification: `tests/advanced/phase2.test.ts` — PCG, Laplace linear solution, multigrid Poisson against the analytic square value, heat and Eikonal distance against the exact disk distance, isoline areas, dome-warp limits and inverse map, un-warp flow scaling, SGD loss decrease on a T, clearance lift/report, curved-layer slices with zero unresolved collisions.
