# Batch reverse-verifier summary

Rows: 690, (target, profile) cells: 138, failing cells: 63, failing (target, assertion) pairs: 81

## Pass / fail grid

| Target | Default | Extreme Modulation | Boundary Edge-Cases |
|---|---|---|---|
| core/cube | PASS | PASS | FAIL [VOLUME] volumetric-extrusion-conservation |
| core/cylinder | PASS | PASS | PASS |
| core/tee | PASS | PASS | PASS |
| core/vase | FAIL [CONTINUITY] c0-continuity | FAIL [CONTINUITY] c0-continuity | FAIL [CONTINUITY] c0-continuity |
| core/thick-bridge | PASS | PASS | PASS |
| core/width-mix | PASS | PASS | PASS |
| adv/fea_stress | PASS | PASS | PASS |
| adv/sdf_frep | PASS | PASS | PASS |
| adv/eulerian_spiral | PASS | PASS | PASS |
| adv/conformal_layers | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | FAIL [VOLUME] volumetric-extrusion-conservation |
| adv/hot_on_hot | PASS | PASS | PASS |
| adv/kinematic_extrusion | PASS | PASS | PASS |
| adv/z_weave | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | PASS | PASS |
| adv/subvoxel_aa | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation |
| adv/turing_infill | PASS | PASS | PASS |
| adv/corner_overshoot | FAIL [VOLUME] volumetric-extrusion-conservation, [HARNESS] declared-geometry-map | FAIL [VOLUME] volumetric-extrusion-conservation, [HARNESS] declared-geometry-map | FAIL [STATUS] tech-status, [VOLUME] volumetric-extrusion-conservation, [HARNESS] declared-geometry-map |
| adv/spatial_lattice | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle |
| adv/metamaterial | PASS | PASS | PASS |
| adv/dovetail | PASS | FAIL [VOLUME] volumetric-extrusion-conservation | PASS |
| adv/sgd_slicing | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation |
| adv/eikonal_offsets | PASS | PASS | PASS |
| adv/inverse_warp | PASS | PASS | PASS |
| adv/gloss_modulation | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation |
| adv/foam_control | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | PASS |
| adv/knot_braiding | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | PASS | PASS |
| adv/co_molding | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [STATUS] tech-status | FAIL [VOLUME] volumetric-extrusion-conservation |
| adv/thick_vase | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation |
| adv/tangent_entry | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [STATUS] tech-status, [VOLUME] volumetric-extrusion-conservation |
| adv/scarf_splice | FAIL [RAMP] nonplanar-ramp-angle | PASS | PASS |
| adv/harmonic_dome | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle |
| adv/conformal_ironing | PASS | FAIL [VOLUME] volumetric-extrusion-conservation | PASS |
| adv/perimeter_feathering | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | PASS |
| adv/iso_gloss | PASS | PASS | PASS |
| adv/quasicrystal | PASS | PASS | PASS |
| adv/metric_morph | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation |
| adv/monge_ampere | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation |
| adv/symplectic_shaper | PASS | PASS | PASS |
| adv/morse_router | PASS | PASS | PASS |
| adv/spinor_fields | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation |
| adv/band_gap | PASS | FAIL [STATUS] tech-status | PASS |
| adv/homogenization | PASS | PASS | PASS |
| plugin/motionex | PASS | PASS | PASS |
| plugin/hanex | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | PASS |
| plugin/bulnex | FAIL [VOLUME] volumetric-extrusion-conservation, [HARNESS] declared-geometry-map | FAIL [VOLUME] volumetric-extrusion-conservation, [HARNESS] declared-geometry-map | PASS |
| plugin/patternex | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation |
| weave/z_weave-cylinder | FAIL [VOLUME] volumetric-extrusion-conservation, [RAMP] nonplanar-ramp-angle | FAIL [VOLUME] volumetric-extrusion-conservation | FAIL [VOLUME] volumetric-extrusion-conservation |

## Failing assertions

Type tags: VOLUME volumetric conservation, SAFETY finite/bed, RAMP non-planar angle, ENVELOPE, SIGNATURE spiro, CONTINUITY C0, WEAVE z-weave anti-phase, STATUS advanced tech not run, HARNESS declared-geometry / slice error.

| Target | Profile | Type | Assertion | Count | Worst | Feature breakdown (count, worst %) | Example (one message) |
|---|---|---|---|---|---|---|---|
| core/cube | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 2 | worst 2.14 % | internal solid infill: 2 (2.14 %) | run dE 0.00039 vs expected 0.00038 (2.14 %) [internal solid infill/2/0.10000000149011612/0.07999999821186066] |
| core/vase | Default | CONTINUITY | c0-continuity | 2 | max gap 165.002 mm | - | travel jump 2.000 mm inside continuous span |
| core/vase | Extreme Modulation | CONTINUITY | c0-continuity | 2 | max gap 164.413 mm | - | travel jump 2.000 mm inside continuous span |
| core/vase | Boundary Edge-Cases | CONTINUITY | c0-continuity | 2 | max gap 155.426 mm | - | travel jump 2.000 mm inside continuous span |
| adv/conformal_layers | Default | VOLUME | volumetric-extrusion-conservation | 503 | worst 51.95 % | top surface: 503 (51.95 %) | dE 0.02186 vs expected 0.01568 (39.42 %), dL3D=0.5103 [top surface] |
| adv/conformal_layers | Default | RAMP | nonplanar-ramp-angle | 103 | max ramp 28.64 deg | - | ramp 11.06 deg > limit 10.6553060508032 deg |
| adv/conformal_layers | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 503 | worst 51.95 % | top surface: 503 (51.95 %) | dE 0.02186 vs expected 0.01568 (39.42 %), dL3D=0.5103 [top surface] |
| adv/conformal_layers | Extreme Modulation | RAMP | nonplanar-ramp-angle | 103 | max ramp 28.64 deg | - | ramp 11.06 deg > limit 10.6553060508032 deg |
| adv/conformal_layers | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 68 | worst 49.24 % | top surface: 68 (49.24 %) | dE 0.00688 vs expected 0.00463 (48.73 %), dL3D=0.3523 [top surface] |
| adv/z_weave | Default | VOLUME | volumetric-extrusion-conservation | 233 | worst 279.19 % | sparse infill: 233 (279.19 %) | dE 0.01477 vs expected 0.01236 (19.49 %), dL3D=0.4760 [sparse infill] |
| adv/z_weave | Default | RAMP | nonplanar-ramp-angle | 92 | max ramp 90.00 deg | - | ramp 90.00 deg > limit 10.6553060508032 deg |
| adv/subvoxel_aa | Default | VOLUME | volumetric-extrusion-conservation | 3264 | worst 41.22 % | outer wall: 3264 (41.22 %) | dE 0.01434 vs expected 0.01571 (8.71 %), dL3D=0.5112 [outer wall] |
| adv/subvoxel_aa | Default | RAMP | nonplanar-ramp-angle | 95 | max ramp 11.76 deg | - | ramp 11.71 deg > limit 10.6553060508032 deg |
| adv/subvoxel_aa | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 3264 | worst 10.25 % | outer wall: 3264 (10.25 %) | dE 0.01434 vs expected 0.01571 (8.71 %), dL3D=0.5112 [outer wall] |
| adv/subvoxel_aa | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 96 | worst 31.92 % | outer wall: 96 (31.92 %) | dE 0.00451 vs expected 0.00662 (31.92 %), dL3D=0.5045 [outer wall] |
| adv/corner_overshoot | Default | VOLUME | volumetric-extrusion-conservation | 32 | worst 171.20 % | (none): 2 (171.20 %); outer wall: 30 (39.85 %) | dE 15.00000 vs expected 5.53090 (171.20 %), dL3D=180.0000 [?] |
| adv/corner_overshoot | Default | HARNESS | declared-geometry-map | 2 | max pos err 0.0005 mm, fallback 0 | - | no declared move on G-code line 22 |
| adv/corner_overshoot | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 62 | worst 171.20 % | (none): 2 (171.20 %); outer wall: 60 (40.08 %) | dE 15.00000 vs expected 5.53090 (171.20 %), dL3D=180.0000 [?] |
| adv/corner_overshoot | Extreme Modulation | HARNESS | declared-geometry-map | 2 | max pos err 0.0005 mm, fallback 0 | - | no declared move on G-code line 22 |
| adv/corner_overshoot | Boundary Edge-Cases | STATUS | tech-status | 1 | not run | - | STATUS: No outer-wall corners sharper than the threshold. |
| adv/corner_overshoot | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 2 | worst 534.67 % | (none): 2 (534.67 %) | dE 15.00000 vs expected 2.36345 (534.67 %), dL3D=180.0000 [?] |
| adv/corner_overshoot | Boundary Edge-Cases | HARNESS | declared-geometry-map | 2 | max pos err 0.0005 mm, fallback 0 | - | no declared move on G-code line 22 |
| adv/spatial_lattice | Default | VOLUME | volumetric-extrusion-conservation | 2970 | worst 13.26 % | inner wall: 2970 (13.26 %) | dE 0.08813 vs expected 0.10160 (13.26 %), dL3D=1.8000 [inner wall] |
| adv/spatial_lattice | Default | RAMP | nonplanar-ramp-angle | 1530 | max ramp 90.00 deg | - | ramp 90.00 deg > limit 10.6553060508032 deg |
| adv/spatial_lattice | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 2970 | worst 10.21 % | inner wall: 2970 (10.21 %) | dE 0.11197 vs expected 0.10160 (10.21 %), dL3D=1.8000 [inner wall] |
| adv/spatial_lattice | Extreme Modulation | RAMP | nonplanar-ramp-angle | 1530 | max ramp 90.00 deg | - | ramp 90.00 deg > limit 10.6553060508032 deg |
| adv/spatial_lattice | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 21 | worst 48.98 % | inner wall: 21 (48.98 %) | dE 0.06336 vs expected 0.12418 (48.98 %), dL3D=2.2000 [inner wall] |
| adv/spatial_lattice | Boundary Edge-Cases | RAMP | nonplanar-ramp-angle | 9 | max ramp 90.00 deg | - | ramp 90.00 deg > limit 10.6553060508032 deg |
| adv/dovetail | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 85 | worst 6.21 % | internal solid infill: 85 (6.21 %) | run dE 0.00111 vs expected 0.00109 (2.18 %) [internal solid infill/8/0.41999998688697815/0.20000000298023224] |
| adv/sgd_slicing | Default | VOLUME | volumetric-extrusion-conservation | 530 | worst 55.83 % | outer wall: 1 (13.51 %); internal solid infill: 229 (55.83 %); top surface: 18 (26.15 %); bridge: 282 (21.99 %) | dE 0.09304 vs expected 0.08927 (4.22 %), dL3D=2.9036 [top surface] |
| adv/sgd_slicing | Default | RAMP | nonplanar-ramp-angle | 1 | max ramp 15.91 deg | - | ramp 15.91 deg > limit 10.6553060508032 deg |
| adv/sgd_slicing | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 48 | worst 21.45 % | internal solid infill: 2 (18.21 %); bridge: 46 (21.45 %) | dE 0.41518 vs expected 0.52857 (21.45 %), dL3D=8.1080 [bridge] |
| adv/sgd_slicing | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 70 | worst 21.47 % | bridge: 70 (21.47 %) | dE 0.41136 vs expected 0.52379 (21.46 %), dL3D=8.0320 [bridge] |
| adv/gloss_modulation | Default | VOLUME | volumetric-extrusion-conservation | 2 | worst 6.31 % | bottom surface: 2 (6.31 %) | run dE 0.00027 vs expected 0.00026 (2.52 %) [bottom surface/0/0.5/0.20000000298023224] |
| adv/gloss_modulation | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 2 | worst 6.31 % | bottom surface: 2 (6.31 %) | run dE 0.00027 vs expected 0.00026 (2.52 %) [bottom surface/0/0.5/0.20000000298023224] |
| adv/gloss_modulation | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 2 | worst 6.31 % | bottom surface: 2 (6.31 %) | run dE 0.00027 vs expected 0.00026 (2.52 %) [bottom surface/0/0.5/0.20000000298023224] |
| adv/foam_control | Default | VOLUME | volumetric-extrusion-conservation | 1777 | worst 64.20 % | inner wall: 132 (64.18 %); outer wall: 128 (64.20 %); internal solid infill: 509 (64.19 %); sparse infill: 1008 (63.98 %) | dE 1.60341 vs expected 2.59530 (38.22 %), dL3D=68.2860 [inner wall] |
| adv/foam_control | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 3849 | worst 72.30 % | inner wall: 160 (72.22 %); outer wall: 160 (72.22 %); bottom surface: 208 (64.88 %); internal solid infill: 2042 (72.30 %); sparse infill: 1024 (72.22 %); top surface: 255 (64.88 %) | dE 0.99888 vs expected 2.59530 (61.51 %), dL3D=68.2860 [inner wall] |
| adv/knot_braiding | Default | VOLUME | volumetric-extrusion-conservation | 1064 | worst 4.50 % | inner wall: 1064 (4.50 %) | dE 0.00978 vs expected 0.01020 (4.10 %), dL3D=0.3074 [inner wall] |
| adv/knot_braiding | Default | RAMP | nonplanar-ramp-angle | 1216 | max ramp 16.85 deg | - | ramp 16.83 deg > limit 10.6553060508032 deg |
| adv/co_molding | Default | VOLUME | volumetric-extrusion-conservation | 201 | worst 21.48 % | bridge: 201 (21.48 %) | dE 0.10310 vs expected 0.13129 (21.47 %), dL3D=2.0140 [bridge] |
| adv/co_molding | Extreme Modulation | STATUS | tech-status | 1 | not run | - | STATUS: The part is too thin for a cavity inside its shell. |
| adv/co_molding | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 361 | worst 21.61 % | internal solid infill: 94 (4.97 %); bridge: 267 (21.61 %) | run dE 0.00038 vs expected 0.00039 (2.55 %) [internal solid infill/10/0.41999998688697815/0.07999999821186066] |
| adv/thick_vase | Default | VOLUME | volumetric-extrusion-conservation | 1 | worst 8.30 % | outer wall: 1 (8.30 %) | dE 0.65157 vs expected 0.60164 (8.30 %), dL3D=19.5800 [outer wall] |
| adv/thick_vase | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 1 | worst 8.30 % | outer wall: 1 (8.30 %) | dE 0.65157 vs expected 0.60164 (8.30 %), dL3D=19.5800 [outer wall] |
| adv/thick_vase | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 3 | worst 27.50 % | outer wall: 3 (27.50 %) | dE 0.09342 vs expected 0.07327 (27.50 %), dL3D=5.5801 [outer wall] |
| adv/tangent_entry | Default | VOLUME | volumetric-extrusion-conservation | 2 | worst 6.31 % | bottom surface: 2 (6.31 %) | run dE 0.00027 vs expected 0.00026 (2.52 %) [bottom surface/0/0.5/0.20000000298023224] |
| adv/tangent_entry | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 2 | worst 6.31 % | bottom surface: 2 (6.31 %) | run dE 0.00027 vs expected 0.00026 (2.52 %) [bottom surface/0/0.5/0.20000000298023224] |
| adv/tangent_entry | Boundary Edge-Cases | STATUS | tech-status | 1 | not run | - | STATUS: No outer loop with room for a buried entry. |
| adv/tangent_entry | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 11 | worst 6.31 % | bottom surface: 2 (6.31 %); internal solid infill: 8 (2.04 %); top surface: 1 (2.04 %) | run dE 0.00027 vs expected 0.00026 (2.52 %) [bottom surface/0/0.5/0.20000000298023224] |
| adv/scarf_splice | Default | RAMP | nonplanar-ramp-angle | 99 | max ramp 10.87 deg | - | ramp 10.87 deg > limit 10.6553060508032 deg |
| adv/harmonic_dome | Default | VOLUME | volumetric-extrusion-conservation | 9710 | worst 28.70 % | inner wall: 2296 (5.39 %); outer wall: 2398 (22.49 %); internal solid infill: 3444 (28.70 %); sparse infill: 1370 (17.85 %); top surface: 202 (23.64 %) | dE 0.01652 vs expected 0.01686 (2.02 %), dL3D=0.6480 [outer wall] |
| adv/harmonic_dome | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 218 | worst 19.20 % | outer wall: 4 (19.20 %); internal solid infill: 15 (13.06 %); sparse infill: 197 (5.47 %); top surface: 2 (3.82 %) | dE 0.79003 vs expected 0.75848 (4.16 %), dL3D=19.0332 [internal solid infill] |
| adv/harmonic_dome | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 17145 | worst 98.67 % | inner wall: 3226 (48.53 %); outer wall: 7140 (49.52 %); internal solid infill: 5276 (98.67 %); sparse infill: 1442 (95.34 %); top surface: 61 (46.88 %) | dE 0.03221 vs expected 0.03118 (3.32 %), dL3D=2.5886 [outer wall] |
| adv/harmonic_dome | Boundary Edge-Cases | RAMP | nonplanar-ramp-angle | 20 | max ramp 23.20 deg | - | ramp 20.72 deg > limit 10.6553060508032 deg |
| adv/conformal_ironing | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 621 | worst 2.33 % | ironing: 621 (2.33 %) | dE 0.00235 vs expected 0.00230 (2.02 %), dL3D=0.8330 [ironing] |
| adv/perimeter_feathering | Default | VOLUME | volumetric-extrusion-conservation | 30 | worst 18.85 % | outer wall: 30 (18.85 %) | dE 0.02564 vs expected 0.02657 (3.50 %), dL3D=0.6226 [outer wall] |
| adv/perimeter_feathering | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 30 | worst 18.85 % | outer wall: 30 (18.85 %) | dE 0.02615 vs expected 0.02711 (3.53 %), dL3D=0.6236 [outer wall] |
| adv/metric_morph | Default | VOLUME | volumetric-extrusion-conservation | 1556 | worst 2.69 % | outer wall: 576 (2.17 %); internal solid infill: 980 (2.69 %) | dE 0.01360 vs expected 0.01331 (2.17 %), dL3D=0.4332 [outer wall] |
| adv/metric_morph | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 3501 | worst 2.69 % | outer wall: 1296 (2.17 %); internal solid infill: 2205 (2.69 %) | dE 0.01360 vs expected 0.01331 (2.17 %), dL3D=0.4332 [outer wall] |
| adv/metric_morph | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 130 | worst 2.95 % | outer wall: 64 (2.17 %); internal solid infill: 66 (2.95 %) | dE 0.01360 vs expected 0.01331 (2.17 %), dL3D=0.4332 [outer wall] |
| adv/monge_ampere | Default | VOLUME | volumetric-extrusion-conservation | 267 | worst 21.50 % | top surface: 1 (3.01 %); bridge: 266 (21.50 %) | dE 0.09627 vs expected 0.12256 (21.45 %), dL3D=1.8800 [bridge] |
| adv/monge_ampere | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 212 | worst 21.69 % | bridge: 212 (21.69 %) | dE 0.06438 vs expected 0.08194 (21.43 %), dL3D=1.2570 [bridge] |
| adv/monge_ampere | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 993 | worst 30.97 % | internal solid infill: 1 (2.39 %); overhang wall: 4 (2.34 %); bridge: 988 (30.97 %) | dE 0.01455 vs expected 0.01851 (21.41 %), dL3D=0.2840 [bridge] |
| adv/spinor_fields | Default | VOLUME | volumetric-extrusion-conservation | 2 | worst 6.31 % | bottom surface: 2 (6.31 %) | run dE 0.00027 vs expected 0.00026 (2.52 %) [bottom surface/0/0.5/0.20000000298023224] |
| adv/spinor_fields | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 2 | worst 6.31 % | bottom surface: 2 (6.31 %) | run dE 0.00027 vs expected 0.00026 (2.52 %) [bottom surface/0/0.5/0.20000000298023224] |
| adv/spinor_fields | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 2 | worst 6.31 % | bottom surface: 2 (6.31 %) | run dE 0.00027 vs expected 0.00026 (2.52 %) [bottom surface/0/0.5/0.20000000298023224] |
| adv/band_gap | Extreme Modulation | STATUS | tech-status | 1 | not run | - | STATUS: No resonator cell up to 40 mm reaches 18000 Hz with 0.45 mm lines. |
| plugin/hanex | Default | VOLUME | volumetric-extrusion-conservation | 3564 | worst 43.94 % | wave overhang: 3564 (43.94 %) | run dE 0.00510 vs expected 0.00906 (43.71 %) [wave overhang/50/0.44999998807907104/0.20000000298023224] |
| plugin/hanex | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 3564 | worst 43.94 % | wave overhang: 3564 (43.94 %) | run dE 0.00510 vs expected 0.00906 (43.71 %) [wave overhang/50/0.44999998807907104/0.20000000298023224] |
| plugin/bulnex | Default | VOLUME | volumetric-extrusion-conservation | 100 | worst 21.41 % | inner wall: 8 (12.28 %); outer wall: 8 (21.22 %); bottom surface: 84 (21.41 %) | dE 0.53209 vs expected 0.47389 (12.28 %), dL3D=14.2860 [inner wall] |
| plugin/bulnex | Default | HARNESS | declared-geometry-map | 3230 | max pos err 0.0005 mm, fallback 0 | - | no declared move on G-code line 4958 |
| plugin/bulnex | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 400 | worst 21.41 % | inner wall: 32 (12.28 %); outer wall: 32 (21.22 %); bottom surface: 336 (21.41 %) | dE 0.53209 vs expected 0.47389 (12.28 %), dL3D=14.2860 [inner wall] |
| plugin/bulnex | Extreme Modulation | HARNESS | declared-geometry-map | 12920 | max pos err 0.0005 mm, fallback 0 | - | no declared move on G-code line 4983 |
| plugin/patternex | Default | VOLUME | volumetric-extrusion-conservation | 4 | worst 5.30 % | brim: 4 (5.30 %) | run dE 0.00119 vs expected 0.00116 (2.27 %) [brim/0/0.5/0.20000000298023224] |
| plugin/patternex | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 4 | worst 5.30 % | brim: 4 (5.30 %) | run dE 0.00119 vs expected 0.00116 (2.27 %) [brim/0/0.5/0.20000000298023224] |
| plugin/patternex | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 3762 | worst 4.54 % | outer wall: 2640 (0.16 %); prime tower: 1040 (0.53 %); internal solid infill: 2 (4.54 %); gap infill: 72 (0.23 %); (unattributed): 8 (0.00 %) | run dE 0.00033 vs expected 0.00032 (4.54 %) [internal solid infill/1/0.41999998688697815/0.07999999821186066] |
| weave/z_weave-cylinder | Default | VOLUME | volumetric-extrusion-conservation | 184 | worst 279.19 % | sparse infill: 184 (279.19 %) | dE 0.01477 vs expected 0.01426 (3.60 %), dL3D=0.4960 [sparse infill] |
| weave/z_weave-cylinder | Default | RAMP | nonplanar-ramp-angle | 92 | max ramp 90.00 deg | - | ramp 90.00 deg > limit 10.6553060508032 deg |
| weave/z_weave-cylinder | Extreme Modulation | VOLUME | volumetric-extrusion-conservation | 1 | worst 7.43 % | sparse infill: 1 (7.43 %) | dE 0.06153 vs expected 0.05727 (7.43 %), dL3D=2.2235 [sparse infill] |
| weave/z_weave-cylinder | Boundary Edge-Cases | VOLUME | volumetric-extrusion-conservation | 1 | worst 6.01 % | inner wall: 1 (6.01 %) | run dE 0.00156 vs expected 0.00147 (6.01 %) [inner wall/60/0.44999998807907104/0.08056128025054932] |

`Worst` for volumetric is the locked maxRelErrPct (tolerance 2 %). Counts are exact (locked checker counts every failure; report keeps the first 5 in report.json).
