// NexSpiro Bridge — HTTP front end. Browsers cannot open MQTT/FTPS sockets, so this tiny local server does it for them.
// The Bambu driver is injected (see bambu.mjs) so the HTTP layer can be tested without a printer.
import http from "node:http";

const json = (res, code, body, cors) => { res.writeHead(code, { "Content-Type": "application/json", ...cors }); res.end(JSON.stringify(body)); };
const readBody = (req, limit = 512 * 1024 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on("data", (c) => { n += c.length; if (n > limit) { reject(new Error("File too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks))); req.on("error", reject);
});

/** @param {{status(c:object):Promise<object>, send(c:object, name:string, data:Buffer, print:boolean):Promise<void>, command(c:object, cmd:string):Promise<void>}} driver */
export function createBridge(driver, { allowOrigin = "*" } = {}) {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = {
      "Access-Control-Allow-Origin": allowOrigin === "*" ? "*" : allowOrigin === origin ? origin : "null",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "600", Vary: "Origin",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    try {
      const u = new URL(req.url ?? "/", "http://bridge"), q = u.searchParams;
      const conn = { host: q.get("host") ?? "", serial: q.get("serial") ?? "", code: q.get("code") ?? "" };
      if (u.pathname === "/health") return json(res, 200, { ok: true, name: "nexspiro-bridge" }, cors);
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
