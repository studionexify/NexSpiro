// Bambu Lab LAN-mode driver: FTPS (implicit TLS, port 990, user "bblp") for uploads and MQTT over TLS (port 8883) for
// status and commands. The access code is the one on the printer's Network screen. Newer firmware may additionally require
// "Developer mode" for third-party control. Written from the community protocol notes (OpenBambuAPI); not covered by automated tests.
import { Client as FtpClient } from "basic-ftp";
import mqtt from "mqtt";
import { Readable } from "node:stream";

const sessions = new Map(); // host → { client, report, ready, lastUse }
const IDLE_MS = 5 * 60 * 1000;
setInterval(() => { for (const [k, s] of sessions) if (Date.now() - s.lastUse > IDLE_MS) { s.client.end(true); sessions.delete(k); } }, 60_000).unref();

function session(c) {
  const key = `${c.host}|${c.serial}`;
  let s = sessions.get(key);
  if (s) { s.lastUse = Date.now(); return s; }
  const client = mqtt.connect(`mqtts://${c.host}:8883`, { username: "bblp", password: c.code, rejectUnauthorized: false, reconnectPeriod: 4000, connectTimeout: 8000, clientId: `nexspiro_${Math.random().toString(16).slice(2, 10)}` });
  s = { client, report: {}, lastUse: Date.now(), error: null, seq: 0 };
  s.ready = new Promise((resolve, reject) => {
    client.once("connect", () => {
      client.subscribe(`device/${c.serial}/report`, (err) => { if (err) return reject(err); client.publish(`device/${c.serial}/request`, JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } })); resolve(); });
    });
    client.once("error", (e) => { s.error = e; reject(e); });
    setTimeout(() => reject(new Error("Printer did not answer on MQTT (check IP, serial, access code and that LAN mode is on)")), 9000).unref();
  });
  client.on("message", (_t, buf) => { try { const m = JSON.parse(buf.toString()); if (m.print) Object.assign(s.report, m.print); } catch { /* ignore */ } });
  client.on("error", (e) => { s.error = e; });
  sessions.set(key, s);
  s.ready.catch(() => { client.end(true); sessions.delete(key); });
  return s;
}
const publish = (s, c, body) => new Promise((resolve, reject) => s.client.publish(`device/${c.serial}/request`, JSON.stringify({ print: { sequence_id: String(++s.seq), ...body } }), (e) => (e ? reject(e) : resolve())));

export async function status(c) {
  const s = session(c); await s.ready;
  await new Promise((r) => setTimeout(r, s.report.gcode_state ? 0 : 600)); // first report after pushall
  const r = s.report, st = String(r.gcode_state ?? "").toUpperCase();
  const state = st === "RUNNING" || st === "PREPARE" ? "printing" : st === "PAUSE" ? "paused" : st === "FAILED" ? "error" : "idle";
  return {
    state, nozzle: r.nozzle_temper, nozzleTarget: r.nozzle_target_temper, bed: r.bed_temper, bedTarget: r.bed_target_temper,
    progress: typeof r.mc_percent === "number" ? r.mc_percent / 100 : undefined, remainingS: typeof r.mc_remaining_time === "number" ? r.mc_remaining_time * 60 : undefined,
    file: r.gcode_file || r.subtask_name || undefined, layer: r.layer_num, layers: r.total_layer_num, message: st === "FAILED" ? `Print failed (error ${r.print_error ?? "?"})` : undefined,
  };
}
export async function send(c, name, data, print) {
  const ftp = new FtpClient(20_000);
  try {
    await ftp.access({ host: c.host, port: 990, user: "bblp", password: c.code, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
    await ftp.uploadFrom(Readable.from(data), name);
  } finally { ftp.close(); }
  if (print) { const s = session(c); await s.ready; await publish(s, c, { command: "gcode_file", param: `/sdcard/${name}` }); }
}
export async function command(c, cmd) {
  const s = session(c); await s.ready;
  await publish(s, c, { command: cmd === "cancel" ? "stop" : cmd });
}
