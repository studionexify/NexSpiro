import { test } from "node:test";
import assert from "node:assert/strict";
import { TEST_PRINTS, buildTestPrint } from "../scripts/testprints.ts";

const byId = (id: string) => TEST_PRINTS.find((t) => t.id === id)!;

for (const m of ["voron-24-350", "prusa-mk3s", "bambu-x1c"]) {
  test(`test prints on ${m}: cube wave, vase rim, dot panel`, () => {
    const cube = buildTestPrint(byId("cube-sine"), m).result;
    assert.equal(cube.check.collisionCount, 0);
    assert.ok(cube.layers.some((l) => l.paths.some((p) => p.modifiedBy === "motionex")));

    const vase = buildTestPrint(byId("vase-z-rim"), m);
    const top = vase.result.layers.at(-1)!.z;
    const zMoves = vase.result.layers.filter((l) => l.paths.some((p) => p.points.some((q) => q.zOff)));
    assert.ok(zMoves.length > 10, "rim layers move up and down");
    assert.ok(zMoves.every((l) => l.z >= top - 10 - 1e-6), "only the top 10 mm");
    assert.ok(!vase.result.check.blocking);
    for (const l of vase.result.layers) for (const p of l.paths) for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1], q = p.points[i], len = Math.hypot(q.x - a.x, q.y - a.y, q.z - a.z);
      if (len > 0) assert.ok((q.f * Math.abs(q.z - a.z)) / len <= vase.profiles.machine.maxSpeed.z + 1e-6);
    }

    const panel = buildTestPrint(byId("dot-panel"), m);
    assert.ok(panel.result.check.events.dwell > 200);
    assert.ok((panel.result.gcode.match(/^G4 P250/gm) ?? []).length === panel.result.check.events.dwell);
    assert.ok(panel.result.stats.seconds > panel.baseSeconds + panel.result.check.events.dwell * 0.25 - 1e-6);
  });
}
