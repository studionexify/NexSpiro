// NexSpiro Bridge — HTTP front end. Browsers cannot open MQTT/FTPS sockets, so this tiny local server does it for them.
// The Bambu driver is injected (see bambu.mjs) so the HTTP layer can be tested without a printer.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { scanAll } from "./scan.mjs";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const isPrivateIp = (ip) => net.isIPv4(ip) ? /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) : net.isIPv6(ip) && /^(::1|f[cd]|fe80)/i.test(ip);
/** The relay only talks to machines on the local network, never the internet. */
export async function isLanTarget(url) {
  try { const u = new URL(url); if (u.protocol !== "http:") return false; const h = u.hostname.replace(/^\[|\]$/g, ""); if (net.isIP(h)) return isPrivateIp(h); return (await dns.lookup(h, { all: true })).every((a) => isPrivateIp(a.address)); } catch { return false; }
}

const json = (res, code, body, cors) => { res.writeHead(code, { "Content-Type": "application/json", ...cors }); res.end(JSON.stringify(body)); };
const readBody = (req, limit = 512 * 1024 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on("data", (c) => { n += c.length; if (n > limit) { reject(new Error("File too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks))); req.on("error", reject);
});

/** @param {{status(c:object):Promise<object>, send(c:object, name:string, data:Buffer, print:boolean):Promise<void>, command(c:object, cmd:string):Promise<void>}} driver */
export function createBridge(driver, { allowOrigin = "local", staticDir = "", scan = scanAll } = {}) {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const okOrigin = allowOrigin === "*" || (allowOrigin === "local" ? !origin || LOCAL_ORIGIN.test(origin) : allowOrigin === origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin && origin ? origin : allowOrigin === "*" ? "*" : "null",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Api-Key, Print-After-Upload, Overwrite",
      "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "600", Vary: "Origin",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    try {
      const u = new URL(req.url ?? "/", "http://bridge"), q = u.searchParams;
      const conn = { host: q.get("host") ?? "", serial: q.get("serial") ?? "", code: q.get("code") ?? "" };
      if (u.pathname === "/health") return json(res, 200, { ok: true, name: "nexspiro-bridge" }, cors);
      const guarded = u.pathname === "/scan" || u.pathname === "/relay" || u.pathname.startsWith("/bambu/");
      if (guarded && !okOrigin) return json(res, 403, { error: "origin not allowed — open NexSpiro from the bridge address (see README)" }, cors);
      if (u.pathname === "/scan") return json(res, 200, { printers: await scan() }, cors);
      if (u.pathname === "/relay") {
        const target = q.get("url") ?? "";
        if (!(await isLanTarget(target))) return json(res, 400, { error: "relay only reaches http:// printers on your local network" }, cors);
        const fwd = {}; for (const k of ["content-type", "x-api-key", "print-after-upload", "overwrite"]) if (req.headers[k]) fwd[k] = req.headers[k];
        const hasBody = req.method !== "GET" && req.method !== "HEAD";
        const r = await fetch(target, { method: req.method, headers: fwd, body: hasBody ? req : undefined, duplex: hasBody ? "half" : undefined, signal: AbortSignal.timeout(600_000) });
        const buf = Buffer.from(await r.arrayBuffer());
        res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") ?? "application/octet-stream", ...cors }); return res.end(buf);
      }
      if (staticDir && !u.pathname.startsWith("/bambu/") && req.method === "GET") {
        let f = path.join(staticDir, path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, ""));
        if (!f.startsWith(path.resolve(staticDir))) return json(res, 403, { error: "forbidden" }, cors);
        if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
        if (fs.existsSync(f)) { res.writeHead(200, { "Content-Type": MIME[path.extname(f)] ?? "application/octet-stream" }); return fs.createReadStream(f).pipe(res); }
      }
      if (!u.pathname.startsWith("/bambu/")) return json(res, 404, { error: "unknown route" }, cors);
      if (!conn.host || !conn.serial || !conn.code) return json(res, 400, { error: "host, serial and code are required" }, cors);
      if (u.pathname === "/bambu/status" && req.method === "GET") return json(res, 200, await driver.status(conn), cors);
      if (u.pathname === "/bambu/send" && req.method === "POST") {
        const name = (q.get("name") ?? "nexspiro.gcode").replace(/[^\w.\- ]+/g, "_");
        const data = await readBody(req);
        if (!data.length) return json(res, 400, { error: "empty file" }, cors);
        await driver.send(conn, name, data, q.get("print") === "1");
        return json(res, 200, { ok: true, bytes: data.length, name }, cors);
      }
      if (u.pathname === "/bambu/command" && req.method === "POST") {
        const cmd = q.get("cmd"); if (!["pause", "resume", "cancel"].includes(cmd ?? "")) return json(res, 400, { error: "cmd must be pause, resume or cancel" }, cors);
        await driver.command(conn, cmd); return json(res, 200, { ok: true }, cors);
      }
      return json(res, 405, { error: "method not allowed" }, cors);
    } catch (e) { json(res, 502, { error: e instanceof Error ? e.message : String(e) }, cors); }
  });
}
