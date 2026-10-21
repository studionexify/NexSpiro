# Batch reverse-verifier summary

Rows: 18, (target, profile) cells: 3, failing cells: 0, failing (target, assertion) pairs: 0

## Pass / fail grid

| Target | Default | Extreme Modulation | Boundary Edge-Cases |
|---|---|---|---|
| weave/z_weave-pins-cylinder | PASS | PASS | PASS |

## Failing assertions

Type tags: VOLUME volumetric conservation, SAFETY finite/bed, RAMP non-planar angle, ENVELOPE, SIGNATURE spiro, CONTINUITY C0, WEAVE z-weave anti-phase, STATUS advanced tech not run, HARNESS declared-geometry / slice error.

| Target | Profile | Type | Assertion | Count | Worst | Feature breakdown (count, worst %) | Example (one message) |
|---|---|---|---|---|---|---|---|

`Worst` for volumetric is the locked maxRelErrPct (tolerance 2 %). Counts are exact (locked checker counts every failure; report keeps the first 5 in report.json).
