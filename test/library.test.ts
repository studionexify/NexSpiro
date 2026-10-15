import { test } from "node:test";
import assert from "node:assert/strict";
import { BrushLibrary, parseBrush, serializeBrush } from "../src/plugins/motionex/library.ts";
import { PRESETS } from "../src/plugins/motionex/presets.ts";

const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

test("every preset round-trips through JSON", () => {
  for (const b of PRESETS) assert.deepEqual(parseBrush(serializeBrush(b)), b);
});

test("invalid brushes are rejected with a reason", () => {
  assert.throws(() => parseBrush('{"id":"x","name":"x","amplitude":1,"period_mm":0,"repeat_mode":"tile"}'), /period_mm/);
  assert.throws(() => parseBrush('{"id":"x","name":"x","amplitude":1,"period_mm":2,"repeat_mode":"loop"}'), /repeat_mode/);
});

test("saving a preset stores a copy; saving again bumps version; persists", () => {
  const store = memStore();
  const lib = new BrushLibrary(store);
  const saved = lib.save(PRESETS[0]);
  assert.notEqual(saved.id, PRESETS[0].id);
  assert.equal(lib.save({ ...saved, amplitude: 2 }).version, 2);
  const again = new BrushLibrary(store);
  assert.equal(again.get(saved.id)!.amplitude, 2);
});
