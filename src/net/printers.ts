// Network printer connectors: upload G-code over the LAN and start / pause / cancel prints.
// Pure and fetch-injectable (unit-testable). Browsers cannot speak MQTT/FTPS, so Bambu Lab printers go through the
// small local NexSpiro Bridge (bridge/server.mjs); Moonraker (Klipper), OctoPrint and PrusaLink are called directly.
export type PrinterKind = "moonraker" | "octoprint" | "prusalink" | "bambu";
export type PrinterConfig = {
  id: string; name: string; kind: PrinterKind;
  host: string;            // IP / hostname[:port], or a full URL
  apiKey?: string;         // Moonraker (optional) / OctoPrint / PrusaLink
  accessCode?: string;     // Bambu LAN access code (printer screen → Network)
  serial?: string;         // Bambu serial number
  bridge?: string;         // Bambu: NexSpiro Bridge URL
};
export type PrinterState = "offline" | "idle" | "printing" | "paused" | "error";
export type PrinterStatus = {
  state: PrinterState; message?: string;
  nozzle?: number; nozzleTarget?: number; bed?: number; bedTarget?: number;
  progress?: number;       // 0..1
  file?: string; remainingS?: number; layer?: number; layers?: number;
};
export type Command = "pause" | "resume" | "cancel";
export interface Connector {
  status(): Promise<PrinterStatus>;
  upload(name: string, gcode: string, print: boolean): Promise<void>;
  command(cmd: Command): Promise<void>;
}
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const PRINTER_KINDS: { id: PrinterKind; label: string; hint: string; port: string }[] = [
  { id: "bambu", label: "Bambu Lab (LAN mode)", hint: "X1, P1, A1 series — needs the NexSpiro Bridge running on this computer", port: "" },
  { id: "moonraker", label: "Klipper · Moonraker", hint: "Voron, Creality K1, Sovol… (Mainsail / Fluidd). Add this site to Moonraker's cors_domains.", port: "7125" },
  { id: "octoprint", label: "OctoPrint", hint: "Needs an application / API key. Enable CORS in OctoPrint's API settings.", port: "" },
  { id: "prusalink", label: "PrusaLink", hint: "Prusa MK4, XL, Mini, Core One — API key from Settings → PrusaLink", port: "" },
];

export const baseUrl = (host: string, fallbackPort = ""): string => {
  let h = host.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(h)) h = `http://${h}${fallbackPort && !/:\d+$/.test(h) ? `:${fallbackPort}` : ""}`;
  return h;
};
const isLocal = (u: string) => /^https?:\/\/(localhost|127\.|\[::1\])/i.test(u);

/** Browsers refuse http:// requests from an https:// page (except to localhost). Returns the explanation, or null when fine. */
export function mixedContentProblem(cfg: PrinterConfig, pageProtocol = typeof location === "undefined" ? "http:" : location.protocol): string | null {
  const target = cfg.kind === "bambu" ? bridgeUrl(cfg) : baseUrl(cfg.host);
  if (pageProtocol === "https:" && target.startsWith("http:") && !isLocal(target))
    return "This page is served over https, so the browser blocks plain-http printers on your network. Open NexSpiro from a local copy (npm run dev / npm run preview) or put the printer behind https.";
  return null;
}
export const bridgeUrl = (cfg: PrinterConfig) => baseUrl(cfg.bridge || "http://localhost:8787");

const TIMEOUT_MS = 10_000;
async function call(f: Fetch, url: string, init: RequestInit = {}, what = "printer"): Promise<Response> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), init.body ? 120_000 : TIMEOUT_MS);
  try {
    const r = await f(url, { ...init, signal: ctl.signal });
    if (!r.ok) {
      let detail = ""; try { detail = (await r.text()).slice(0, 200); } catch { /* ignore */ }
      throw new Error(`${what} answered ${r.status}${r.status === 401 || r.status === 403 ? " — check the API key / access code" : ""}${detail ? `: ${detail}` : ""}`);
    }
    return r;
  } catch (e) {
    if (e instanceof Error && /answered \d+/.test(e.message)) throw e;
    if (e instanceof DOMException && e.name === "AbortError") throw new Error(`${what} did not answer in time`);
    throw new Error(`Could not reach ${what} (offline, wrong address, CORS or mixed-content block)`);
  } finally { clearTimeout(timer); }
}
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function moonraker(cfg: PrinterConfig, f: Fetch): Connector {
  const base = baseUrl(cfg.host, "7125"), h: Record<string, string> = cfg.apiKey ? { "X-Api-Key": cfg.apiKey } : {};
  return {
    async status() {
      const r = await json(await call(f, `${base}/printer/objects/query?print_stats&extruder&heater_bed&virtual_sdcard`, { headers: h }, cfg.host));
      const s = r.result?.status ?? {}, st = String(s.print_stats?.state ?? "");
      const state: PrinterState = st === "printing" ? "printing" : st === "paused" ? "paused" : st === "error" ? "error" : "idle";
      return {
        state, nozzle: num(s.extruder?.temperature), nozzleTarget: num(s.extruder?.target), bed: num(s.heater_bed?.temperature), bedTarget: num(s.heater_bed?.target),
        progress: num(s.virtual_sdcard?.progress), file: s.print_stats?.filename || undefined, layer: num(s.print_stats?.info?.current_layer), layers: num(s.print_stats?.info?.total_layer),
        message: s.print_stats?.message || undefined,
      };
    },
    async upload(name, gcode, print) {
      const fd = new FormData(); fd.append("file", new Blob([gcode], { type: "text/plain" }), name); fd.append("root", "gcodes"); fd.append("print", print ? "true" : "false");
      await call(f, `${base}/server/files/upload`, { method: "POST", body: fd, headers: h }, cfg.host);
    },
    async command(cmd) { await call(f, `${base}/printer/print/${cmd}`, { method: "POST", headers: h }, cfg.host); },
  };
}

function octoprint(cfg: PrinterConfig, f: Fetch): Connector {
  const base = baseUrl(cfg.host), h: Record<string, string> = { "X-Api-Key": cfg.apiKey ?? "" };
  return {
    async status() {
      const job = await json(await call(f, `${base}/api/job`, { headers: h }, cfg.host)), st = String(job.state ?? "");
      const state: PrinterState = /print/i.test(st) && !/paus/i.test(st) ? "printing" : /paus/i.test(st) ? "paused" : /offline|closed/i.test(st) ? "offline" : /error/i.test(st) ? "error" : "idle";
      let temps: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
      try { temps = (await json(await call(f, `${base}/api/printer`, { headers: h }, cfg.host))).temperature ?? {}; } catch { /* 409 while the printer is not connected */ }
      const pc = num(job.progress?.completion);
      return { state, nozzle: num(temps.tool0?.actual), nozzleTarget: num(temps.tool0?.target), bed: num(temps.bed?.actual), bedTarget: num(temps.bed?.target), progress: pc === undefined ? undefined : pc / 100, file: job.job?.file?.name || undefined, remainingS: num(job.progress?.printTimeLeft), message: state === "error" ? st : undefined };
    },
    async upload(name, gcode, print) {
      const fd = new FormData(); fd.append("file", new Blob([gcode], { type: "text/plain" }), name); fd.append("select", "true"); fd.append("print", print ? "true" : "false");
      await call(f, `${base}/api/files/local`, { method: "POST", body: fd, headers: h }, cfg.host);
    },
    async command(cmd) {
      const body = cmd === "cancel" ? { command: "cancel" } : { command: "pause", action: cmd === "pause" ? "pause" : "resume" };
      await call(f, `${base}/api/job`, { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body) }, cfg.host);
    },
  };
}

function prusalink(cfg: PrinterConfig, f: Fetch): Connector {
  const base = baseUrl(cfg.host), h: Record<string, string> = { "X-Api-Key": cfg.apiKey ?? "" };
  return {
    async status() {
      const r = await json(await call(f, `${base}/api/v1/status`, { headers: h }, cfg.host)), st = String(r.printer?.state ?? "").toUpperCase();
      const state: PrinterState = st === "PRINTING" ? "printing" : st === "PAUSED" ? "paused" : st === "ERROR" || st === "ATTENTION" ? "error" : "idle";
      const pr = num(r.job?.progress);
      return { state, nozzle: num(r.printer?.temp_nozzle), nozzleTarget: num(r.printer?.target_nozzle), bed: num(r.printer?.temp_bed), bedTarget: num(r.printer?.target_bed), progress: pr === undefined ? undefined : pr / 100, remainingS: num(r.job?.time_remaining) };
    },
    async upload(name, gcode, print) {
      await call(f, `${base}/api/v1/files/usb/${encodeURIComponent(name)}`, { method: "PUT", body: gcode, headers: { ...h, "Content-Type": "application/octet-stream", "Print-After-Upload": print ? "?1" : "?0", Overwrite: "?1" } }, cfg.host);
    },
    async command(cmd) {
      const id = (await json(await call(f, `${base}/api/v1/job`, { headers: h }, cfg.host))).id;
      if (id === undefined) throw new Error("No job is running");
      await call(f, `${base}/api/v1/job/${id}${cmd === "cancel" ? "" : `/${cmd}`}`, { method: cmd === "cancel" ? "DELETE" : "PUT", headers: h }, cfg.host);
    },
  };
}

function bambu(cfg: PrinterConfig, f: Fetch): Connector {
  const base = bridgeUrl(cfg), q = new URLSearchParams({ host: cfg.host, serial: cfg.serial ?? "", code: cfg.accessCode ?? "" });
  return {
    async status() { return (await json(await call(f, `${base}/bambu/status?${q}`, {}, "the NexSpiro Bridge"))) as PrinterStatus; },
    async upload(name, gcode, print) {
      const p = new URLSearchParams(q); p.set("name", name); p.set("print", print ? "1" : "0");
      await call(f, `${base}/bambu/send?${p}`, { method: "POST", body: gcode, headers: { "Content-Type": "text/plain" } }, "the NexSpiro Bridge");
    },
    async command(cmd) { const p = new URLSearchParams(q); p.set("cmd", cmd); await call(f, `${base}/bambu/command?${p}`, { method: "POST" }, "the NexSpiro Bridge"); },
  };
}

export function connectorFor(cfg: PrinterConfig, fetchFn: Fetch = (u, i) => fetch(u, i)): Connector {
  switch (cfg.kind) {
    case "moonraker": return moonraker(cfg, fetchFn);
    case "octoprint": return octoprint(cfg, fetchFn);
    case "prusalink": return prusalink(cfg, fetchFn);
    case "bambu": return bambu(cfg, fetchFn);
  }
}

/** Fields the printer form must collect for each kind; returns the first problem found. */
export function validatePrinter(c: Partial<PrinterConfig>): string | null {
  if (!c.name?.trim()) return "Give the printer a name";
  if (!c.host?.trim()) return "Enter the printer's IP address or hostname";
  if (c.kind === "bambu") { if (!c.serial?.trim()) return "Enter the printer serial number"; if (!c.accessCode?.trim()) return "Enter the LAN access code shown on the printer"; }
  if ((c.kind === "octoprint" || c.kind === "prusalink") && !c.apiKey?.trim()) return "Enter the API key";
  return null;
}
