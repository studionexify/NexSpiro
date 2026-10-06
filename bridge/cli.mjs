#!/usr/bin/env node
// Starts the bridge AND serves the built NexSpiro app, so everything runs from one http://localhost:8787 address
// (an https page — or the hosted artifact — is not allowed to talk to plain-http printers on your network).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { createBridge } from "./server.mjs";
import * as driver from "./bambu.mjs";
const port = Number(process.env.PORT ?? 8787), host = process.env.HOST ?? "127.0.0.1";
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist"), hasApp = fs.existsSync(path.join(dist, "index.html"));
createBridge(driver, { allowOrigin: process.env.ALLOW_ORIGIN ?? "local", staticDir: hasApp ? dist : "" }).listen(port, host, () => {
  console.log(`NexSpiro Bridge on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  console.log(hasApp ? `  Open that address in your browser — NexSpiro is served from here.` : `  (no ../dist found — run "npm run build" in the repo root to serve NexSpiro from here, or use "npm run dev")`);
  if (host === "0.0.0.0") for (const l of Object.values(os.networkInterfaces())) for (const a of l ?? []) if (a.family === "IPv4" && !a.internal) console.log(`  On your LAN: http://${a.address}:${port}`);
});
