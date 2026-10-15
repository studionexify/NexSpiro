// Printer connection layer (Phase 3). One interface for every printer family so the
// Device workspace never needs to know which protocol is underneath.
//
// Implementations (Electron main process, because they need raw sockets / TLS / serial):
//   bambu_lan  — MQTT over TLS on :8883 (user "bblp", LAN access code) for status & commands,
//                FTPS on :990 to upload .gcode.3mf, RTSPS/JPEG stream for the camera.
//   moonraker  — Klipper's HTTP + WebSocket JSON-RPC API on :7125 (Creality K/KE series, Elegoo Neptune 4, Voron…).
//   octoprint  — OctoPrint REST API with an API key.
//   serial     — USB serial (Marlin), streaming G-code line by line with ok-acknowledgement.

export type ConnectionKind = 'bambu_lan' | 'moonraker' | 'octoprint' | 'serial';

export interface PrinterStatus {
  state: 'offline' | 'idle' | 'printing' | 'paused' | 'error';
  progress?: number; // 0..1
  layer?: number;
  remainingSeconds?: number;
  nozzleTemp?: number; nozzleTarget?: number;
  bedTemp?: number; bedTarget?: number;
  message?: string;
}

export interface PrinterConnection {
  readonly kind: ConnectionKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): Promise<PrinterStatus>;
  onStatus(cb: (s: PrinterStatus) => void): () => void;
  upload(fileName: string, data: ArrayBuffer): Promise<void>;
  startPrint(fileName: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  sendGcode(line: string): Promise<void>;
  cameraUrl?(): Promise<string | null>;
}

export interface ConnectionConfig {
  kind: ConnectionKind;
  host?: string; // IP / hostname
  port?: number;
  serial?: string; // Bambu printer serial number
  accessCode?: string; // Bambu LAN access code
  apiKey?: string; // OctoPrint
  device?: string; // serial port path
  baudRate?: number;
}

export const CONNECTION_INFO: Record<ConnectionKind, { label: string; description: string }> = {
  bambu_lan: { label: 'Bambu Lab LAN', description: 'Direct LAN control of A1, P1 and X1 series using the printer access code (MQTT + FTPS + camera).' },
  moonraker: { label: 'Klipper / Moonraker', description: 'Creality Ender-3 V3 KE, K1/K2, Elegoo Neptune 4 series and any Klipper printer with Moonraker.' },
  octoprint: { label: 'OctoPrint', description: 'Any printer managed by OctoPrint, using an API key.' },
  serial: { label: 'USB (serial)', description: 'Marlin printers connected by USB cable — streams G-code directly.' },
};
