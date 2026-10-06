# NexSpiro Bridge

A small local helper that makes wireless printing work from the browser. It

* **serves NexSpiro itself** at `http://localhost:8787` (an https page — or the hosted artifact — is not allowed to talk to plain-http printers on your network);
* **finds printers** on your Wi-Fi/LAN (Bambu via SSDP, Klipper via Moonraker probe) — *Find printers on my network* in the Add printer dialog;
* **relays** calls to Klipper / OctoPrint / PrusaLink machines so CORS never gets in the way (LAN addresses only);
* **speaks Bambu Lab's LAN protocol** (FTPS 990 + MQTT 8883), which browsers cannot.

```bash
npm run connect      # from the repo root: builds the app, installs the bridge, starts it
# open http://localhost:8787
```

## Your printers

| Printer | Protocol | On the printer |
|---|---|---|
| Bambu Lab A1 / A1 mini combo | Bambu LAN (bridge) | Settings → WLAN, enable **LAN Only Mode**; note IP, **Access code**, **serial** |
| Bambu Lab P1S combo | Bambu LAN (bridge) | Settings → WLAN → Network, enable **LAN Only Mode**; note IP, Access code, serial |
| Creality Ender-3 V3 KE | Klipper · Moonraker :7125 | Connect to Wi-Fi, note IP (Fluidd: `http://IP:4408`) |
| Elegoo Neptune 4 Max | Klipper · Moonraker :7125 | Connect to Wi-Fi, note IP (Fluidd: `http://IP`) |

Pick the model in **Print → Add printer**; the form fills in the protocol and shows the setup steps. Computer and printers must be on the same network.

* Binds to `127.0.0.1`; only `localhost` origins may use it (`ALLOW_ORIGIN=…` to change). `HOST=0.0.0.0` exposes it to your LAN.
* Bambu: G-code goes to the SD card by FTPS (`bblp`@990) and starts with an MQTT `gcode_file` command. Written from community protocol notes and **not yet verified on real hardware**; newer firmware may require Developer mode. Always watch the first layer.
