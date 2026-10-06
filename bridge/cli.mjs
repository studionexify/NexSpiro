#!/usr/bin/env node
import { createBridge } from "./server.mjs";
import * as driver from "./bambu.mjs";
const port = Number(process.env.PORT ?? 8787), host = process.env.HOST ?? "127.0.0.1";
createBridge(driver, { allowOrigin: process.env.ALLOW_ORIGIN ?? "*" }).listen(port, host, () =>
  console.log(`NexSpiro Bridge listening on http://${host}:${port}\nIn NexSpiro → Print → Add printer → Bambu Lab, leave "Bridge URL" as http://localhost:${port}.`));
