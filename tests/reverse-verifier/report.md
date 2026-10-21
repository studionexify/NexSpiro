# Batch reverse-verifier summary

Rows: 549, (target, profile) cells: 138, failing cells: 92

| Target | Profile | Result | Failing assertions | Max rel. err % (volumetric) | Example message |
|---|---|---|---|---|---|
| core/cube | Default | FAIL | volumetric-extrusion-conservation | 17.51 | dE 0.75038 vs expected 0.90958 (17.50 %), dL3D=24.4206 [bottom surface] |
| core/cube | Extreme Modulation | PASS | - | 0.82 | - |
| core/cube | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 8.33 | run dE 0.00004 vs expected 0.00004 (4.76 %) [internal solid infill/1/0.1/0.08] |
| core/cylinder | Default | FAIL | volumetric-extrusion-conservation | 17.51 | dE 0.53814 vs expected 0.65229 (17.50 %), dL3D=17.5129 [bottom surface] |
| core/cylinder | Extreme Modulation | PASS | - | 0.13 | - |
| core/cylinder | Boundary Edge-Cases | PASS | - | 0.79 | - |
| core/tee | Default | FAIL | volumetric-extrusion-conservation | 17.51 | dE 0.31583 vs expected 0.38284 (17.50 %), dL3D=10.2785 [bottom surface] |
| core/tee | Extreme Modulation | PASS | - | 0.34 | - |
| core/tee | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 30.95 | run dE 0.00002 vs expected 0.00002 (30.95 %) [internal solid infill/1/0.1/0.08] |
| core/vase | Default | FAIL | volumetric-extrusion-conservation, c0-continuity | 21.22 | dE 0.87353 vs expected 1.05885 (17.50 %), dL3D=28.4285 [bottom surface] |
| core/vase | Extreme Modulation | FAIL | c0-continuity | 0.07 | travel jump 2.000 mm inside continuous span |
| core/vase | Boundary Edge-Cases | FAIL | c0-continuity | 0.79 | travel jump 2.000 mm inside continuous span |
| core/thick-bridge | Default | FAIL | volumetric-extrusion-conservation | 66.64 | dE 0.31583 vs expected 0.38284 (17.50 %), dL3D=10.2785 [bottom surface] |
| core/thick-bridge | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 89.39 | dE 0.15276 vs expected 1.44041 (89.39 %), dL3D=2.9840 [bridge] |
| core/thick-bridge | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 1796.30 | run dE 0.00002 vs expected 0.00002 (30.95 %) [internal solid infill/1/0.1/0.08] |
| core/width-mix | Default | FAIL | volumetric-extrusion-conservation | 17.51 | dE 0.53814 vs expected 0.65229 (17.50 %), dL3D=17.5129 [bottom surface] |
| core/width-mix | Extreme Modulation | PASS | - | 0.16 | - |
| core/width-mix | Boundary Edge-Cases | PASS | - | 0.59 | - |
| adv/fea_stress | Default | PASS | - | 0.40 | - |
| adv/fea_stress | Extreme Modulation | PASS | - | 0.39 | - |
| adv/fea_stress | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/sdf_frep | Default | PASS | - | 0.39 | - |
| adv/sdf_frep | Extreme Modulation | PASS | - | 0.39 | - |
| adv/sdf_frep | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/eulerian_spiral | Default | PASS | - | 0.39 | - |
| adv/eulerian_spiral | Extreme Modulation | PASS | - | 0.39 | - |
| adv/eulerian_spiral | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/conformal_layers | Default | FAIL | tech-status | 0.39 | status=idle (No sloped top skins.) |
| adv/conformal_layers | Extreme Modulation | FAIL | tech-status | 0.39 | status=idle (No sloped top skins.) |
| adv/conformal_layers | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=idle (No sloped top skins.) |
| adv/hot_on_hot | Default | PASS | - | 0.39 | - |
| adv/hot_on_hot | Extreme Modulation | PASS | - | 0.39 | - |
| adv/hot_on_hot | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/kinematic_extrusion | Default | PASS | - | 0.39 | - |
| adv/kinematic_extrusion | Extreme Modulation | PASS | - | 0.39 | - |
| adv/kinematic_extrusion | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/z_weave | Default | FAIL | volumetric-extrusion-conservation, nonplanar-ramp-angle | 6246.93 | dE 0.01976 vs expected 0.01647 (19.95 %), dL3D=0.4966 [inner wall] |
| adv/z_weave | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 80.37 | dE 0.08359 vs expected 0.06931 (20.60 %), dL3D=2.0894 [inner wall] |
| adv/z_weave | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 2.26 | run dE 0.04115 vs expected 0.04204 (2.12 %) [sparse infill/5/0.45/0.08] |
| adv/subvoxel_aa | Default | FAIL | tech-status | 0.39 | status=idle (No walls under shallow slopes.) |
| adv/subvoxel_aa | Extreme Modulation | FAIL | tech-status | 0.39 | status=idle (No walls under shallow slopes.) |
| adv/subvoxel_aa | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=idle (No walls under shallow slopes.) |
| adv/turing_infill | Default | PASS | - | 0.39 | - |
| adv/turing_infill | Extreme Modulation | PASS | - | 0.39 | - |
| adv/turing_infill | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/corner_overshoot | Default | FAIL | tech-status | 0.39 | status=idle (No outer-wall corners sharper than the threshold.) |
| adv/corner_overshoot | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 40.07 | run dE 0.00221 vs expected 0.00369 (40.07 %) [outer wall/0/0.5/0.2] |
| adv/corner_overshoot | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=idle (No outer-wall corners sharper than the threshold.) |
| adv/spatial_lattice | Default | FAIL | volumetric-extrusion-conservation, nonplanar-ramp-angle | 47.60 | dE 0.08813 vs expected 0.05971 (47.60 %), dL3D=1.8000 [inner wall] |
| adv/spatial_lattice | Extreme Modulation | FAIL | volumetric-extrusion-conservation, nonplanar-ramp-angle | 87.54 | dE 0.11197 vs expected 0.05971 (87.53 %), dL3D=1.8000 [inner wall] |
| adv/spatial_lattice | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation, nonplanar-ramp-angle | 104.14 | dE 0.06336 vs expected 0.03104 (104.14 %), dL3D=2.2000 [inner wall] |
| adv/metamaterial | Default | FAIL | volumetric-extrusion-conservation | 27.68 | dE 0.04343 vs expected 0.03440 (26.27 %), dL3D=1.0369 [sparse infill] |
| adv/metamaterial | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 30.96 | dE 0.05745 vs expected 0.04387 (30.95 %), dL3D=1.3226 [sparse infill] |
| adv/metamaterial | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 22.13 | dE 0.01306 vs expected 0.01070 (22.05 %), dL3D=0.7585 [sparse infill] |
| adv/dovetail | Default | FAIL | tech-status | 0.39 | status=idle |
| adv/dovetail | Extreme Modulation | FAIL | tech-status | 0.39 | status=idle |
| adv/dovetail | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=idle |
| adv/sgd_slicing | Default | FAIL | tech-status | 0.39 | status=idle (No overhangs to optimise.) |
| adv/sgd_slicing | Extreme Modulation | FAIL | tech-status | 0.39 | status=idle (No overhangs to optimise.) |
| adv/sgd_slicing | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=idle (No overhangs to optimise.) |
| adv/eikonal_offsets | Default | PASS | - | 0.76 | - |
| adv/eikonal_offsets | Extreme Modulation | PASS | - | 0.63 | - |
| adv/eikonal_offsets | Boundary Edge-Cases | PASS | - | 0.33 | - |
| adv/inverse_warp | Default | PASS | - | 0.74 | - |
| adv/inverse_warp | Extreme Modulation | PASS | - | 0.87 | - |
| adv/inverse_warp | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/gloss_modulation | Default | FAIL | tech-status | 0.39 | status=idle (Paint matte or gloss areas with the Advanced paint tool.) |
| adv/gloss_modulation | Extreme Modulation | FAIL | tech-status | 0.39 | status=idle (Paint matte or gloss areas with the Advanced paint tool.) |
| adv/gloss_modulation | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=idle (Paint matte or gloss areas with the Advanced paint tool.) |
| adv/foam_control | Default | FAIL | tech-status | 0.39 | status=unavailable (PLA does not foam: choose a foaming filament (LW-PLA).) |
| adv/foam_control | Extreme Modulation | FAIL | tech-status | 0.39 | status=unavailable (PLA does not foam: choose a foaming filament (LW-PLA).) |
| adv/foam_control | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=unavailable (PLA does not foam: choose a foaming filament (LW-PLA).) |
| adv/knot_braiding | Default | FAIL | tech-status | 0.39 | status=unavailable (Needs at least 3 walls (the outer wall is never braided).) |
| adv/knot_braiding | Extreme Modulation | FAIL | tech-status | 0.39 | status=unavailable (Needs at least 3 walls (the outer wall is never braided).) |
| adv/knot_braiding | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=unavailable (Needs at least 3 walls (the outer wall is never braided).) |
| adv/co_molding | Default | FAIL | volumetric-extrusion-conservation | 67.11 | run dE 0.00119 vs expected 0.00122 (2.44 %) [sparse infill/4/0.45/0.2] |
| adv/co_molding | Extreme Modulation | FAIL | tech-status | 0.39 | status=idle (The part is too thin for a cavity inside its shell.) |
| adv/co_molding | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=idle (The part is too thin for a cavity inside its shell.) |
| adv/thick_vase | Default | FAIL | volumetric-extrusion-conservation | 8.30 | dE 0.65157 vs expected 0.60164 (8.30 %), dL3D=19.5800 [outer wall] |
| adv/thick_vase | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 8.30 | dE 0.65157 vs expected 0.60164 (8.30 %), dL3D=19.5800 [outer wall] |
| adv/thick_vase | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 27.50 | dE 0.09342 vs expected 0.07327 (27.50 %), dL3D=5.5801 [outer wall] |
| adv/tangent_entry | Default | FAIL | volumetric-extrusion-conservation | 99.85 | run dE 0.01937 vs expected 0.08261 (76.55 %) [inner wall/3/0.45/0.2] |
| adv/tangent_entry | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 97.40 | run dE 0.00174 vs expected 0.02943 (94.09 %) [inner wall/2/0.45/0.2] |
| adv/tangent_entry | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=idle (No outer loop with room for a buried entry.) |
| adv/scarf_splice | Default | FAIL | volumetric-extrusion-conservation, nonplanar-ramp-angle | 99.87 | dE 0.00002 vs expected 0.01564 (99.87 %), dL3D=0.5091 [outer wall] |
| adv/scarf_splice | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 99.80 | dE 0.00003 vs expected 0.01530 (99.80 %), dL3D=0.4980 [outer wall] |
| adv/scarf_splice | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 95.74 | dE 0.00028 vs expected 0.00658 (95.74 %), dL3D=0.5009 [outer wall] |
| adv/harmonic_dome | Default | FAIL | tech-status | 0.39 | status=idle (No dome or shallow top surfaces on this part.) |
| adv/harmonic_dome | Extreme Modulation | FAIL | tech-status | 0.39 | status=idle (No dome or shallow top surfaces on this part.) |
| adv/harmonic_dome | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=idle (No dome or shallow top surfaces on this part.) |
| adv/conformal_ironing | Default | FAIL | tech-status | 0.39 | status=idle (No up-facing slopes within 11° to burnish.) |
| adv/conformal_ironing | Extreme Modulation | FAIL | tech-status | 0.39 | status=idle (No up-facing slopes within 11° to burnish.) |
| adv/conformal_ironing | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=idle (No up-facing slopes within 11° to burnish.) |
| adv/perimeter_feathering | Default | FAIL | volumetric-extrusion-conservation | 50.10 | dE 0.02675 vs expected 0.01913 (39.84 %), dL3D=0.6226 [outer wall] |
| adv/perimeter_feathering | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 50.10 | dE 0.02735 vs expected 0.01916 (42.73 %), dL3D=0.6236 [outer wall] |
| adv/perimeter_feathering | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 10.01 | dE 0.00784 vs expected 0.00733 (6.92 %), dL3D=0.5585 [outer wall] |
| adv/iso_gloss | Default | PASS | - | 0.39 | - |
| adv/iso_gloss | Extreme Modulation | PASS | - | 0.39 | - |
| adv/iso_gloss | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/quasicrystal | Default | PASS | - | 1.52 | - |
| adv/quasicrystal | Extreme Modulation | PASS | - | 1.25 | - |
| adv/quasicrystal | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/metric_morph | Default | FAIL | volumetric-extrusion-conservation | 14.49 | dE 0.01515 vs expected 0.01613 (6.10 %), dL3D=0.4332 [outer wall] |
| adv/metric_morph | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 14.49 | dE 0.01515 vs expected 0.01613 (6.10 %), dL3D=0.4332 [outer wall] |
| adv/metric_morph | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 14.49 | dE 0.01515 vs expected 0.01613 (6.10 %), dL3D=0.4332 [outer wall] |
| adv/monge_ampere | Default | FAIL | tech-status | 0.39 | status=unavailable (Load a target image in the Optical intent card.) |
| adv/monge_ampere | Extreme Modulation | FAIL | tech-status | 0.39 | status=unavailable (Load a target image in the Optical intent card.) |
| adv/monge_ampere | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=unavailable (Load a target image in the Optical intent card.) |
| adv/symplectic_shaper | Default | PASS | - | 0.39 | - |
| adv/symplectic_shaper | Extreme Modulation | PASS | - | 0.39 | - |
| adv/symplectic_shaper | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/morse_router | Default | PASS | - | 0.39 | - |
| adv/morse_router | Extreme Modulation | PASS | - | 0.39 | - |
| adv/morse_router | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/spinor_fields | Default | FAIL | tech-status | 0.39 | status=idle (No stress field to smooth: turn on FEA stress-aligned paths or Turing infill.) |
| adv/spinor_fields | Extreme Modulation | FAIL | tech-status | 0.39 | status=idle (No stress field to smooth: turn on FEA stress-aligned paths or Turing infill.) |
| adv/spinor_fields | Boundary Edge-Cases | FAIL | tech-status | 0.58 | status=idle (No stress field to smooth: turn on FEA stress-aligned paths or Turing infill.) |
| adv/band_gap | Default | PASS | - | 0.39 | - |
| adv/band_gap | Extreme Modulation | FAIL | tech-status | 0.39 | status=idle (No resonator cell up to 40 mm reaches 18000 Hz with 0.45 mm lines.) |
| adv/band_gap | Boundary Edge-Cases | PASS | - | 0.58 | - |
| adv/homogenization | Default | FAIL | volumetric-extrusion-conservation | 4.08 | run dE 0.00018 vs expected 0.00019 (4.08 %) [sparse infill/64/0.45/0.2] |
| adv/homogenization | Extreme Modulation | PASS | - | 0.45 | - |
| adv/homogenization | Boundary Edge-Cases | PASS | - | 0.80 | - |
| plugin/motionex | Default | FAIL | volumetric-extrusion-conservation | 17.51 | dE 0.53814 vs expected 0.65229 (17.50 %), dL3D=17.5129 [bottom surface] |
| plugin/motionex | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 17.51 | dE 0.53814 vs expected 0.65229 (17.50 %), dL3D=17.5129 [bottom surface] |
| plugin/motionex | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 17.59 | dE 0.07192 vs expected 0.08718 (17.50 %), dL3D=2.3405 [bottom surface] |
| plugin/hanex | Default | FAIL | volumetric-extrusion-conservation | 39.48 | dE 0.31583 vs expected 0.38284 (17.50 %), dL3D=10.2785 [bottom surface] |
| plugin/hanex | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 39.48 | dE 0.31583 vs expected 0.38284 (17.50 %), dL3D=10.2785 [bottom surface] |
| plugin/hanex | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 17.51 | dE 0.14202 vs expected 0.17214 (17.50 %), dL3D=4.6216 [bottom surface] |
| plugin/bulnex | Default | FAIL | volumetric-extrusion-conservation | 21.22 | dE 0.58788 vs expected 0.71257 (17.50 %), dL3D=19.1315 [bottom surface] |
| plugin/bulnex | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 21.22 | dE 0.58788 vs expected 0.71257 (17.50 %), dL3D=19.1315 [bottom surface] |
| plugin/bulnex | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 17.51 | dE 0.15333 vs expected 0.18583 (17.49 %), dL3D=4.9893 [bottom surface] |
| plugin/patternex | Default | FAIL | volumetric-extrusion-conservation | 58.27 | dE 0.75038 vs expected 0.90958 (17.50 %), dL3D=24.4206 [bottom surface] |
| plugin/patternex | Extreme Modulation | FAIL | volumetric-extrusion-conservation | 17.50 | dE 0.75038 vs expected 0.90958 (17.50 %), dL3D=24.4206 [bottom surface] |
| plugin/patternex | Boundary Edge-Cases | FAIL | volumetric-extrusion-conservation | 54.62 | dE 0.14202 vs expected 0.17214 (17.50 %), dL3D=4.6216 [bottom surface] |
| weave/z_weave-cylinder | Default | FAIL | volumetric-extrusion-conservation, nonplanar-ramp-angle, weave-phase-alternation | 6246.93 | dE 0.01693 vs expected 0.01533 (10.44 %), dL3D=0.4621 [inner wall] |
| weave/z_weave-cylinder | Extreme Modulation | FAIL | volumetric-extrusion-conservation, weave-phase-alternation | 74.20 | dE 0.04065 vs expected 0.03070 (32.39 %), dL3D=0.9256 [inner wall] |
| weave/z_weave-cylinder | Boundary Edge-Cases | FAIL | weave-phase-alternation | 0.48 | layers 3/5 should repeat (period-2 alternation) but RMS=0.0028 |

`Max rel. err %` is the volumetric maxRelErrPct metric; the tolerance is 2 % (locked).
