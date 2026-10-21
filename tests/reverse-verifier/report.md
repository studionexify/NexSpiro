# Batch reverse-verifier summary

Rows: 690, (target, profile) cells: 138, failing cells: 31, failing (target, assertion) pairs: 37

## Pass / fail grid

| Target | Default | Extreme Modulation | Boundary Edge-Cases |
|---|---|---|---|
| core/cube | PASS | PASS | PASS |
| core/cylinder | PASS | PASS | PASS |
| core/tee | PASS | PASS | PASS |
| core/vase | FAIL [CONTINUITY] c0-continuity | FAIL [CONTINUITY] c0-continuity | FAIL [CONTINUITY] c0-continuity |
| core/thick-bridge | PASS | PASS | PASS |
| core/width-mix | PASS | PASS | PASS |
| adv/fea_stress | PASS | PASS | PASS |
| adv/sdf_frep | PASS | PASS | PASS |
| adv/eulerian_spiral | PASS | PASS | PASS |
| adv/conformal_layers | FAIL [RAMP] nonplanar-ramp-angle | FAIL [RAMP] nonplanar-ramp-angle | PASS |
| adv/hot_on_hot | PASS | PASS | PASS |
| adv/kinematic_extrusion | PASS | PASS | PASS |
| adv/z_weave | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | PASS | PASS |
| adv/subvoxel_aa | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | PASS | PASS |
| adv/turing_infill | PASS | PASS | PASS |
| adv/corner_overshoot | PASS | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [STATUS] tech-status |
| adv/spatial_lattice | FAIL [RAMP] nonplanar-ramp-angle | FAIL [RAMP] nonplanar-ramp-angle | FAIL [RAMP] nonplanar-ramp-angle |
| adv/metamaterial | PASS | PASS | PASS |
| adv/dovetail | PASS | PASS | PASS |
| adv/sgd_slicing | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | FAIL [VOLUME] volumetric-extrusion-conservation | PASS |
| adv/eikonal_offsets | PASS | PASS | PASS |
| adv/inverse_warp | PASS | PASS | PASS |
| adv/gloss_modulation | PASS | PASS | PASS |
| adv/foam_control | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | PASS |
| adv/knot_braiding | FAIL [RAMP] nonplanar-ramp-angle | PASS | PASS |
| adv/co_molding | PASS | FAIL [STATUS] tech-status | PASS |
| adv/thick_vase | PASS | PASS | PASS |
| adv/tangent_entry | PASS | PASS | FAIL [STATUS] tech-status |
| adv/scarf_splice | FAIL [RAMP] nonplanar-ramp-angle | PASS | PASS |
| adv/harmonic_dome | FAIL [VOLUME] volumetric-extrusion-conservation | PASS | FAIL [RAMP] nonplanar-ramp-angle |
| adv/conformal_ironing | PASS | PASS | PASS |
| adv/perimeter_feathering | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | PASS |
| adv/iso_gloss | PASS | PASS | PASS |
| adv/quasicrystal | PASS | PASS | PASS |
| adv/metric_morph | PASS | PASS | PASS |
| adv/monge_ampere | PASS | PASS | PASS |
| adv/symplectic_shaper | PASS | PASS | PASS |
| adv/morse_router | PASS | PASS | PASS |
| adv/spinor_fields | PASS | PASS | PASS |
| adv/band_gap | PASS | FAIL [STATUS] tech-status | PASS |
| adv/homogenization | PASS | PASS | PASS |
| plugin/motionex | PASS | PASS | PASS |
| plugin/hanex | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | PASS |
| plugin/bulnex | FAIL [VOLUME] volumetric-extrusion-conservation, [HARNESS] declared-geometry-map | FAIL [VOLUME] volumetric-extrusion-conservation, [HARNESS] declared-geometry-map | PASS |
| plugin/patternex | PASS | PASS | FAIL [VOLUME] volumetric-extrusion-conservation |
| weave/z_weave-cylinder | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | PASS | PASS |

## Failing assertions

Type tags: VOLUME volumetric conservation, SAFETY finite/bed, RAMP non-planar angle, ENVELOPE, SIGNATURE spiro, CONTINUITY C0, WEAVE z-weave anti-phase, STATUS advanced tech not run, HARNESS declared-geometry / slice error.

| Target | Profile | Type | Assertion | Count | Worst | Feature breakdown (count, worst %) | Example (one message) |
|---|---|---|---|---|---|---|---|
| core/vase | Default | CONTINUITY | c0-continuity | 2 | max gap 165.002 mm | - | travel jump 2.000 mm inside continuous span |
| core/vase | Extreme Modulation | CONTINUITY | c0-continuity | 2 | max gap 164.413 mm | - | travel jump 2.000 mm inside continuous span |
| core/vase | Boundary Edge-Cases | CONTINUITY | c0-continuity | 2 | max gap 155.426 mm | - | travel jump 2.000 mm inside continuous span |
| adv/conformal_layers | Default | RAMP | nonplanar-ramp-angle | 103 | max ramp 28.64 deg | - | ramp 11.06 deg > limit 10.6553060508032 deg |
| adv/conformal_layers | Extreme Modulation | RAMP | nonplanar-ramp-angle | 103 | max ramp 28.64 deg | - | ramp 11.06 deg > limit 10.6553060508032 deg |
| adv/z_weave | Default | VOLUME | volumetric-extrusion-conservation | 92 | worst 279.19 % | sparse infill: 92 (279.19 %) | dE 1.12849 vs expected 0.29760 (279.19 %), dL3D=0.5360 [sparse infill] |
| adv/z_weave | Default | RAMP | nonplanar-ramp-angle | 92 | max ramp 90.00 deg | - | ramp 90.00 deg > limit 10.6553060508032 deg |
| adv/subvoxel_aa | Default | VOLUME | volumetric-extrusion-conservation | 85 | worst 2.87 % | outer wall: 85 (2.87 %) | dE 0.01054 vs expected 0.01027 (2.67 %), dL3D=0.3467 [outer wall] |
| adv/subvoxel_aa | Default | RAMP | nonplanar-ramp-angle | 95 | max ramp 11.76 deg | - | ramp 11.71 deg > limit 10.6553060508032 deg |
| adv/corner_overshoot | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 60 | worst 40.08 % | outer wall: 60 (40.08 %) | dE 0.00754 vs expected 0.01257 (40.00 %), dL3D=0.3374 [outer wall] |
| adv/corner_overshoot | Boundary Edge-Cases | STATUS | tech-status | 1 | not run | - | STATUS: No outer-wall corners sharper than the threshold. |
| adv/spatial_lattice | Default | RAMP | nonplanar-ramp-angle | 1530 | max ramp 90.00 deg | - | ramp 90.00 deg > limit 10.6553060508032 deg |
| adv/spatial_lattice | Extreme Modulation | RAMP | nonplanar-ramp-angle | 1530 | max ramp 90.00 deg | - | ramp 90.00 deg > limit 10.6553060508032 deg |
| adv/spatial_lattice | Boundary Edge-Cases | RAMP | nonplanar-ramp-angle | 9 | max ramp 90.00 deg | - | ramp 90.00 deg > limit 10.6553060508032 deg |
| adv/sgd_slicing | Default | VOLUME | volumetric-extrusion-conservation | 218 | worst 21.75 % | internal solid infill: 1 (3.75 %); bridge: 217 (21.75 %) | dE 0.02046 vs expected 0.02606 (21.48 %), dL3D=0.5089 [bridge] |
| adv/sgd_slicing | Default | RAMP | nonplanar-ramp-angle | 1 | max ramp 15.91 deg | - | ramp 15.91 deg > limit 10.6553060508032 deg |
| adv/sgd_slicing | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 24 | worst 21.46 % | bridge: 24 (21.46 %) | dE 0.32607 vs expected 0.41513 (21.45 %), dL3D=8.1080 [bridge] |
| adv/foam_control | Default | VOLUME | volumetric-extrusion-conservation | 1269 | worst 64.20 % | inner wall: 132 (64.18 %); outer wall: 128 (64.20 %); internal solid infill: 1 (56.23 %); sparse infill: 1008 (63.98 %) | dE 1.60341 vs expected 2.59530 (38.22 %), dL3D=68.2860 [inner wall] |
| adv/foam_control | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 3335 | worst 72.22 % | inner wall: 160 (72.22 %); outer wall: 160 (72.22 %); bottom surface: 208 (64.88 %); internal solid infill: 1528 (71.89 %); sparse infill: 1024 (72.22 %); top surface: 255 (64.88 %) | dE 0.99888 vs expected 2.59530 (61.51 %), dL3D=68.2860 [inner wall] |
| adv/knot_braiding | Default | RAMP | nonplanar-ramp-angle | 1216 | max ramp 16.85 deg | - | ramp 16.83 deg > limit 10.6553060508032 deg |
| adv/co_molding | Extreme Modulation | STATUS | tech-status | 1 | not run | - | STATUS: The part is too thin for a cavity inside its shell. |
| adv/tangent_entry | Boundary Edge-Cases | STATUS | tech-status | 1 | not run | - | STATUS: No outer loop with room for a buried entry. |
| adv/scarf_splice | Default | RAMP | nonplanar-ramp-angle | 99 | max ramp 10.87 deg | - | ramp 10.87 deg > limit 10.6553060508032 deg |
| adv/harmonic_dome | Default | VOLUME | volumetric-extrusion-conservation | 1 | worst 3.02 % | internal solid infill: 1 (3.02 %) | dE 0.05052 vs expected 0.04904 (3.02 %), dL3D=1.5261 [internal solid infill] |
| adv/harmonic_dome | Boundary Edge-Cases | RAMP | nonplanar-ramp-angle | 20 | max ramp 23.20 deg | - | ramp 20.72 deg > limit 10.6553060508032 deg |
| adv/perimeter_feathering | Default | VOLUME | volumetric-extrusion-conservation | 30 | worst 18.85 % | outer wall: 30 (18.85 %) | dE 0.02564 vs expected 0.02657 (3.50 %), dL3D=0.6226 [outer wall] |
| adv/perimeter_feathering | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 30 | worst 18.85 % | outer wall: 30 (18.85 %) | dE 0.02615 vs expected 0.02711 (3.53 %), dL3D=0.6236 [outer wall] |
| adv/band_gap | Extreme Modulation | STATUS | tech-status | 1 | not run | - | STATUS: No resonator cell up to 40 mm reaches 18000 Hz with 0.45 mm lines. |
| plugin/hanex | Default | VOLUME | volumetric-extrusion-conservation | 3407 | worst 43.85 % | wave overhang: 3407 (43.85 %) | dE 0.00459 vs expected 0.00814 (43.62 %), dL3D=0.2454 [wave overhang] |
| plugin/hanex | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 3407 | worst 43.85 % | wave overhang: 3407 (43.85 %) | dE 0.00459 vs expected 0.00814 (43.62 %), dL3D=0.2454 [wave overhang] |
| plugin/bulnex | Default | VOLUME | volumetric-extrusion-conservation | 98 | worst 21.36 % | inner wall: 8 (12.28 %); outer wall: 8 (21.22 %); bottom surface: 82 (21.36 %) | dE 0.53209 vs expected 0.47389 (12.28 %), dL3D=14.2860 [inner wall] |
| plugin/bulnex | Default | HARNESS | declared-geometry-map | 3230 | max pos err 0.0005 mm, fallback 0 | - | no declared move on G-code line 4958 |
| plugin/bulnex | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 392 | worst 21.36 % | inner wall: 32 (12.28 %); outer wall: 32 (21.22 %); bottom surface: 328 (21.36 %) | dE 0.53209 vs expected 0.47389 (12.28 %), dL3D=14.2860 [inner wall] |
| plugin/bulnex | Extreme Modulation | HARNESS | declared-geometry-map | 12920 | max pos err 0.0005 mm, fallback 0 | - | no declared move on G-code line 4983 |
| plugin/patternex | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 3760 | worst 0.44 % | outer wall: 2640 (0.07 %); prime tower: 1040 (0.07 %); gap infill: 72 (0.23 %); (unattributed): 8 (0.00 %) | extrusion with 2.000 mm of filament still retracted |
| weave/z_weave-cylinder | Default | VOLUME | volumetric-extrusion-conservation | 92 | worst 279.19 % | sparse infill: 92 (279.19 %) | dE 1.12849 vs expected 0.29760 (279.19 %), dL3D=0.5360 [sparse infill] |
| weave/z_weave-cylinder | Default | RAMP | nonplanar-ramp-angle | 92 | max ramp 90.00 deg | - | ramp 90.00 deg > limit 10.6553060508032 deg |

`Worst` for volumetric is the locked maxRelErrPct (tolerance 2 %). Counts are exact (locked checker counts every failure; report keeps the first 5 in report.json).
