/// <reference types="vite/client" />
import { importFile, type ImportResult } from "../io/importers/index.ts";
import type { Occt, StepOptions } from "../io/importers/step.ts";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

// Heavy parsing (3MF XML, STEP/OCCT, large PLY/OBJ) off the UI thread. OCCT (~7 MB WASM) loads on first STEP only.
export type IORequest = { id: number; name: string; bytes: Uint8Array; bed?: [number, number]; step?: StepOptions };
export type IOResponse = { id: number; ok: true; result: ImportResult } | { id: number; ok: false; error: string };

let occt: Promise<Occt> | null = null;
const loadOcct = () => (occt ??= import("occt-import-js").then((m) => m.default({ locateFile: () => wasmUrl })));

self.onmessage = async (ev: MessageEvent<IORequest>) => {
  const { id, name, bytes, bed, step } = ev.data;
  try {
    const result = await importFile(name, bytes, { loadOcct, bed, step });
    (self as unknown as Worker).postMessage({ id, ok: true, result } satisfies IOResponse);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies IOResponse);
  }
};
