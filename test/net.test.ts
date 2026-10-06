import { test } from "node:test";
import assert from "node:assert/strict";
import { connectorFor, baseUrl, mixedContentProblem, validatePrinter, type PrinterConfig } from "../src/net/printers.ts";

type Call = { url: string; init?: RequestInit };
function fake(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { f, calls };
}
const base = { id: "p", name: "Test" };

test("baseUrl adds scheme and default port only when missing", () => {
  assert.equal(baseUrl("192.168.1.5", "7125"), "http://192.168.1.5:7125");
  assert.equal(baseUrl("192.168.1.5:80", "7125"), "http://192.168.1.5:80");
  assert.equal(baseUrl("https://printer.local/"), "https://printer.local");
});
test("Moonraker: status mapping, multipart upload with print flag, commands", async () => {
  const cfg: PrinterConfig = { ...base, kind: "moonraker", host: "voron.local", apiKey: "k" };
  const { f, calls } = fake({ "/printer/objects/query": { result: { status: { print_stats: { state: "printing", filename: "a.gcode", info: { current_layer: 4, total_layer: 40 } }, extruder: { temperature: 215.2, target: 215 }, heater_bed: { temperature: 55, target: 55 }, virtual_sdcard: { progress: 0.25 } } } }, "/server/files/upload": { ok: 1 }, "/printer/print/": {} });
  const c = connectorFor(cfg, f), s = await c.status();
  assert.equal(s.state, "printing"); assert.equal(s.progress, 0.25); assert.equal(s.layers, 40); assert.equal(s.nozzle, 215.2);
  assert.ok(calls[0].url.startsWith("http://voron.local:7125/"));
  assert.equal((calls[0].init?.headers as Record<string, string>)["X-Api-Key"], "k");
  await c.upload("x.gcode", "G28\n", true);
  const fd = calls[1].init!.body as FormData;
  assert.equal(fd.get("print"), "true"); assert.equal(fd.get("root"), "gcodes"); assert.equal((fd.get("file") as File).name, "x.gcode");
  await c.command("pause"); assert.ok(calls[2].url.endsWith("/printer/print/pause")); assert.equal(calls[2].init?.method, "POST");
});
test("OctoPrint: state parsing, upload flags, cancel body", async () => {
  const cfg: PrinterConfig = { ...base, kind: "octoprint", host: "octopi.local", apiKey: "abc" };
  const { f, calls } = fake({ "/api/job": { state: "Paused", progress: { completion: 50, printTimeLeft: 600 }, job: { file: { name: "b.gcode" } } }, "/api/printer": { temperature: { tool0: { actual: 200, target: 210 }, bed: { actual: 60, target: 60 } } }, "/api/files/local": {} });
  const c = connectorFor(cfg, f), s = await c.status();
  assert.equal(s.state, "paused"); assert.equal(s.progress, 0.5); assert.equal(s.nozzleTarget, 210); assert.equal(s.remainingS, 600);
  await c.upload("b.gcode", "G1", false);
  const fd = calls.at(-1)!.init!.body as FormData; assert.equal(fd.get("print"), "false"); assert.equal(fd.get("select"), "true");
  await c.command("cancel");
  const last = calls.at(-1)!; assert.deepEqual(JSON.parse(String(last.init!.body)), { command: "cancel" });
});
test("PrusaLink: PUT upload with Print-After-Upload header", async () => {
  const cfg: PrinterConfig = { ...base, kind: "prusalink", host: "10.0.0.7", apiKey: "pk" };
  const { f, calls } = fake({ "/api/v1/files/usb/": {}, "/api/v1/status": { printer: { state: "IDLE", temp_nozzle: 24, temp_bed: 23 } } });
  const c = connectorFor(cfg, f);
  await c.upload("my part.gcode", "G1", true);
  assert.ok(calls[0].url.endsWith("/api/v1/files/usb/my%20part.gcode")); assert.equal(calls[0].init?.method, "PUT");
  assert.equal((calls[0].init?.headers as Record<string, string>)["Print-After-Upload"], "?1");
  assert.equal((await c.status()).state, "idle");
});
test("Bambu goes through the bridge and passes credentials as query parameters", async () => {
  const cfg: PrinterConfig = { ...base, kind: "bambu", host: "192.168.1.20", serial: "01P00A123", accessCode: "12345678" };
  const { f, calls } = fake({ "/bambu/status": { state: "idle", nozzle: 25 }, "/bambu/send": { ok: true }, "/bambu/command": {} });
  const c = connectorFor(cfg, f);
  assert.equal((await c.status()).state, "idle");
  assert.ok(calls[0].url.startsWith("http://localhost:8787/bambu/status?") && calls[0].url.includes("serial=01P00A123") && calls[0].url.includes("code=12345678"));
  await c.upload("p.gcode", "G28", true); assert.ok(calls[1].url.includes("print=1") && calls[1].url.includes("name=p.gcode")); assert.equal(calls[1].init?.body, "G28");
});
test("errors are readable: auth, unreachable, mixed content, validation", async () => {
  const cfg: PrinterConfig = { ...base, kind: "octoprint", host: "x", apiKey: "bad" };
  const c = connectorFor(cfg, async () => new Response("Invalid API key", { status: 403 }));
  await assert.rejects(c.status(), /403.*API key/);
  const d = connectorFor(cfg, async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(d.status(), /Could not reach x/);
  assert.match(mixedContentProblem({ ...cfg, host: "192.168.1.9" }, "https:")!, /https/);
  assert.equal(mixedContentProblem({ ...cfg, host: "192.168.1.9" }, "http:"), null);
  assert.equal(mixedContentProblem({ ...base, kind: "bambu", host: "192.168.1.9" }, "https:"), null, "bridge on localhost is allowed");
  assert.match(validatePrinter({ kind: "bambu", name: "a", host: "1.2.3.4" })!, /serial/);
  assert.equal(validatePrinter({ kind: "moonraker", name: "a", host: "1.2.3.4" }), null);
});

import { createBridge } from "../bridge/server.mjs";
test("bridge: routes, validation, CORS preflight and file hand-off (fake driver)", async () => {
  const seen: unknown[] = [];
  const driver = {
    status: async (c: object) => ({ state: "idle", nozzle: 21, c }),
    send: async (c: object, name: string, data: Buffer, print: boolean) => { seen.push({ name, bytes: data.length, print }); },
    command: async (_c: object, cmd: string) => { seen.push(cmd); },
  };
  const srv = createBridge(driver); await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port, u = (p: string) => `http://127.0.0.1:${port}${p}`, q = "host=1.2.3.4&serial=S1&code=abc";
  try {
    const pre = await fetch(u("/bambu/status"), { method: "OPTIONS" });
    assert.equal(pre.status, 204); assert.equal(pre.headers.get("access-control-allow-private-network"), "true");
    assert.equal((await fetch(u("/bambu/status?host=x"))).status, 400);
    const st = await (await fetch(u(`/bambu/status?${q}`))).json() as { state: string; c: { serial: string } };
    assert.equal(st.state, "idle"); assert.equal(st.c.serial, "S1");
    const sent = await fetch(u(`/bambu/send?${q}&name=../evil name.gcode&print=1`), { method: "POST", body: "G28\nG1 X1\n" });
    assert.equal(sent.status, 200); assert.deepEqual(seen[0], { name: ".._evil name.gcode", bytes: 10, print: true });
    assert.equal((await fetch(u(`/bambu/command?${q}&cmd=explode`), { method: "POST" })).status, 400);
    await fetch(u(`/bambu/command?${q}&cmd=pause`), { method: "POST" }); assert.equal(seen[1], "pause");
  } finally { srv.close(); }
});
