import { test } from "node:test";
import assert from "node:assert/strict";
import { materialOf, statusBadge, slicingKind, pct, rangeRow, rampGradient, slug, esc } from "../src/app/components.ts";
import { ICON_NAMES, icon } from "../src/app/icons.ts";
import { PALETTE_3D, REGION_COLORS, hex } from "../src/app/theme/theme.ts";

test("materialOf recognises common filament families", () => {
  assert.equal(materialOf("Generic PETG"), "PETG");
  assert.equal(materialOf("Matte PLA"), "PLA");
  assert.equal(materialOf("Bambu TPU 95A"), "TPU");
  assert.equal(materialOf("Mystery spool"), "Custom");
});
test("statusBadge reflects the slicing lifecycle", () => {
  assert.equal(statusBadge("idle", false, []).text, "Draft");
  assert.equal(statusBadge("slicing", false, []).text, "Slicing…");
  assert.equal(statusBadge("done", false, []).text, "Draft"); // stale result
  assert.deepEqual(statusBadge("done", true, []), { text: "Ready", tone: "sage" });
  assert.equal(statusBadge("done", true, [{ level: "warn" }]).tone, "amber");
  assert.equal(statusBadge("done", true, [{ level: "error" }]).tone, "coral");
  assert.equal(statusBadge("error", false, []).text, "Error");
});
test("slicingKind distinguishes planar from non-linear plates", () => {
  assert.equal(slicingKind(undefined), "none");
  assert.equal(slicingKind(0), "planar");
  assert.equal(slicingKind(12.5), "nonlinear");
});
test("pct clamps and rangeRow embeds the fill position", () => {
  assert.equal(pct(5, 0, 10), 50);
  assert.equal(pct(-3, 0, 10), 0);
  assert.equal(pct(30, 0, 10), 100);
  assert.equal(pct(1, 1, 1), 0);
  assert.match(rangeRow("Tilt", 'data-in="x"', 25, 0, 100, 1, { unit: "°" }), /--p:25\.0%/);
});
test("helpers: gradient, slug, escaping", () => {
  assert.match(rampGradient(70, 50, 4), /^linear-gradient\(90deg, hsl\(240 70% 50%\).*hsl\(0 70% 50%\)\)$/);
  assert.equal(slug("  My <vase> v2! "), "My_vase_v2");
  assert.equal(slug("***"), "project");
  assert.equal(esc('<a "b">'), "&lt;a &quot;b&quot;&gt;");
});
test("every dock/UI icon used exists and renders", () => {
  for (const n of ["select", "move", "rotate", "scale", "layflat", "cut", "texture", "paint", "erase", "text", "arrange", "support", "seam", "planar", "nonlinear", "printer", "spool", "cube", "cylinder", "play", "pause", "export", "sun", "moon"])
    assert.ok(ICON_NAMES.includes(n), n);
  assert.match(icon("move"), /<svg[^>]*viewBox="0 0 24 24"/);
});
test("3D palettes cover both themes with the accent region colours", () => {
  assert.deepEqual(Object.keys(PALETTE_3D.light).sort(), Object.keys(PALETTE_3D.dark).sort());
  assert.equal(hex(REGION_COLORS[0]), "#7ea8be");
  assert.equal(REGION_COLORS.length, 7);
});
