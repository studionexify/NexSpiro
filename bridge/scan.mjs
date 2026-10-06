// LAN discovery: Bambu printers announce themselves via SSDP (UDP 1990/2021); Klipper printers answer Moonraker on :7125.
import dgram from "node:dgram";
import os from "node:os";

/** Private IPv4 /24 prefixes of this computer (e.g. "192.168.1."). */
export function localPrefixes() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.add(a.address.replace(/\d+$/, ""));
  return [...out];
}

export function scanBambu(ms = 4000) {
  return new Promise((resolve) => {
    const found = new Map(), socks = [];
    const onMsg = (buf, rinfo) => {
      const t = buf.toString(), h = (k) => new RegExp(`^${k}:\\s*(.+)$`, "im").exec(t)?.[1]?.trim();
      const serial = h("USN"), model = h("DevModel.bambu.com"), name = h("DevName.bambu.com");
      if (serial && (model || /bambu/i.test(t))) found.set(serial, { kind: "bambu", host: h("Location") ?? rinfo.address, serial, model, name: name ?? model ?? "Bambu Lab printer" });
    };
    for (const port of [1990, 2021]) {
      const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
      s.on("message", onMsg); s.on("error", () => {});
      s.bind(port, () => { try { s.setBroadcast(true); s.send(Buffer.from("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1990\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:bambulab-com:device:3dprinter:1\r\n\r\n"), 1990, "255.255.255.255"); } catch { /* ignore */ } });
      socks.push(s);
    }
    setTimeout(() => { for (const s of socks) try { s.close(); } catch { /* ignore */ } resolve([...found.values()]); }, ms).unref?.();
  });
}

async function probe(ip, timeout) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`http://${ip}:7125/printer/info`, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = (await r.json()).result ?? {};
    return { kind: "moonraker", host: ip, name: j.hostname || `Klipper printer ${ip}`, model: j.software_version ? `Klipper ${String(j.software_version).split("-")[0]}` : "Klipper" };
  } catch { return null; } finally { clearTimeout(t); }
}

export async function scanMoonraker(prefixes = localPrefixes(), timeout = 700) {
  const ips = prefixes.flatMap((p) => Array.from({ length: 254 }, (_, i) => `${p}${i + 1}`)), found = [];
  let next = 0;
  await Promise.all(Array.from({ length: 64 }, async () => { while (next < ips.length) { const r = await probe(ips[next++], timeout); if (r) found.push(r); } }));
  return found;
}

export async function scanAll() {
  const [bambu, klipper] = await Promise.all([scanBambu(), scanMoonraker()]);
  return [...bambu, ...klipper];
}
