import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PluginHost } from "../src/core/plugins.ts";
import { runPipeline } from "../src/core/pipeline.ts";
import { makeObject } from "../src/core/primitives.ts";
import { createMotionex, defaultApplication } from "../src/plugins/motionex/index.ts";
import { profiles } from "./helpers.ts";

const GOLDEN = new URL("./golden/cube20-sine.json", import.meta.url);

function run(machine: string) {
  const host = new PluginHost();
  const mx = createMotionex(null);
  mx.state.applications.push(defaultApplication("preset-sine"));
  host.register(mx.plugin);
  const cube = { ...makeObject("cube", 128, 128), id: "cube", name: "Cube" };
  return runPipeline([cube], profiles(machine), host).gcode;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

test("golden: 20 mm cube + sine brush is byte-identical across runs and matches stored hashes", () => {
  const got: Record<string, string> = {};
  for (const m of ["voron-24-350", "prusa-mk3s", "bambu-x1c"]) {
    const a = run(m), b = run(m);
    assert.equal(a, b, `${m} not deterministic`);
    got[m] = hash(a);
  }
  if (!existsSync(GOLDEN) || process.env.UPDATE_GOLDEN) { writeFileSync(GOLDEN, JSON.stringify(got, null, 2) + "\n"); return; }
  assert.deepEqual(got, JSON.parse(readFileSync(GOLDEN, "utf8")));
});

test("brush changes wall geometry: outer wall leaves the cube footprint by ~amplitude", () => {
  const g = run("voron-24-350");
  const xs = [...g.matchAll(/^G1 X([\d.]+) Y/gm)].map((m) => +m[1]);
  // Cube spans 118–138; outer wall centre is inset 0.225; sine amplitude 0.6 pushes ~0.375 outside.
  assert.ok(Math.max(...xs) > 138.3 && Math.max(...xs) < 138.5, String(Math.max(...xs)));
  assert.match(g, /; motionex: Sine wave v1 on feature:outer_wall/);
});
