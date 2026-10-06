# NexSpiro Bridge (Bambu Lab LAN mode)

Browsers can't open the MQTT and FTPS connections Bambu printers use, so this small local helper does it for NexSpiro.
Klipper (Moonraker), OctoPrint and PrusaLink printers do **not** need it — NexSpiro talks to them directly.

```bash
cd bridge
npm install
npm start            # http://127.0.0.1:8787
```

On the printer: **Settings → Network → LAN Only Mode** (or LAN mode liveview) and note the **Access code**; the serial number is on the label / Device page. Newer firmware may also require *Developer mode* for third-party control.

In NexSpiro: **Print → Add printer → Bambu Lab (LAN mode)**, enter IP, serial and access code, press *Test connection*.

* The bridge listens on `127.0.0.1` only. Set `ALLOW_ORIGIN=http://localhost:5173` to accept requests from one origin only.
* G-code is uploaded to the printer's SD card via FTPS (`bblp` @ port 990) and started with an MQTT `gcode_file` command.
* Status/commands use MQTT over TLS on port 8883.
* Status: written from community protocol notes; verify on your own printer. Always watch the first layer.
