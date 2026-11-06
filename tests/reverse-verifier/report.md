# Batch reverse-verifier summary

Rows: 540, (target, profile) cells: 141, failing cells: 42, failing (target, assertion) pairs: 42

## Pass / fail grid

| Target | Default | Extreme Modulation | Boundary Edge-Cases |
|---|---|---|---|
| core/cube | PASS | PASS | PASS |
| core/cylinder | PASS | PASS | PASS |
| core/tee | PASS | PASS | PASS |
| core/vase | PASS | PASS | PASS |
| core/thick-bridge | PASS | PASS | PASS |
| core/width-mix | PASS | PASS | PASS |
| adv/fea_stress | PASS | PASS | PASS |
| adv/sdf_frep | PASS | PASS | PASS |
| adv/eulerian_spiral | PASS | PASS | PASS |
| adv/conformal_layers | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/hot_on_hot | PASS | PASS | PASS |
| adv/kinematic_extrusion | PASS | PASS | PASS |
| adv/z_weave | PASS | PASS | PASS |
| adv/subvoxel_aa | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/turing_infill | PASS | PASS | PASS |
| adv/corner_overshoot | PASS | PASS | PASS |
| adv/spatial_lattice | PASS | PASS | PASS |
| adv/metamaterial | PASS | PASS | PASS |
| adv/dovetail | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/sgd_slicing | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/eikonal_offsets | PASS | PASS | PASS |
| adv/inverse_warp | PASS | PASS | PASS |
| adv/gloss_modulation | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/foam_control | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/knot_braiding | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/co_molding | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/thick_vase | PASS | PASS | PASS |
| adv/tangent_entry | PASS | PASS | PASS |
| adv/scarf_splice | PASS | PASS | PASS |
| adv/harmonic_dome | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/conformal_ironing | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/perimeter_feathering | PASS | PASS | PASS |
| adv/iso_gloss | PASS | PASS | PASS |
| adv/quasicrystal | PASS | PASS | PASS |
| adv/metric_morph | PASS | PASS | PASS |
| adv/monge_ampere | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/symplectic_shaper | PASS | PASS | PASS |
| adv/morse_router | PASS | PASS | PASS |
| adv/spinor_fields | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/band_gap | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| adv/homogenization | PASS | PASS | PASS |
| plugin/motionex | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran | FAIL [HARNESS] slice-ran |
| plugin/hanex | PASS | PASS | PASS |
| plugin/bulnex | PASS | PASS | PASS |
| plugin/patternex | PASS | PASS | PASS |
| weave/z_weave-cylinder | PASS | PASS | PASS |
| weave/z_weave-pins-cylinder | PASS | PASS | PASS |

## Failing assertions

Type tags: VOLUME volumetric conservation, SAFETY finite/bed, RAMP non-planar angle, ENVELOPE, SIGNATURE spiro, CONTINUITY C0, WEAVE z-weave anti-phase, STATUS advanced tech not run, HARNESS declared-geometry / slice error.

| Target | Profile | Type | Assertion | Count | Worst | Feature breakdown (count, worst %) | Example (one message) |
|---|---|---|---|---|---|---|---|
| adv/conformal_layers | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/conformal_layers | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/conformal_layers | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/subvoxel_aa | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/subvoxel_aa | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/subvoxel_aa | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/dovetail | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/dovetail | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/dovetail | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/sgd_slicing | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/sgd_slicing | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/sgd_slicing | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/gloss_modulation | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/gloss_modulation | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/gloss_modulation | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/foam_control | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/foam_control | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/foam_control | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/knot_braiding | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/knot_braiding | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/knot_braiding | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/co_molding | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/co_molding | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/co_molding | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/harmonic_dome | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/harmonic_dome | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/harmonic_dome | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/conformal_ironing | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/conformal_ironing | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/conformal_ironing | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/monge_ampere | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/monge_ampere | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/monge_ampere | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/spinor_fields | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/spinor_fields | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/spinor_fields | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/band_gap | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/band_gap | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| adv/band_gap | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| plugin/motionex | Default | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| plugin/motionex | Extreme Modulation | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |
| plugin/motionex | Boundary Edge-Cases | HARNESS | slice-ran | 1 | - | - | Error: Start G-code: "retraction_length" is not a vector |

`Worst` for volumetric is the locked maxRelErrPct (tolerance 2 %). Counts are exact (locked checker counts every failure; report keeps the first 5 in report.json).
