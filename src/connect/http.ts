// HTTP-based connections: Klipper/Moonraker and OctoPrint. Uses fetch only, so the same code
// runs in the Electron main process (no CORS limits) and in the browser build.
import { Emitter, type ConnectionConfig, type PrinterConnection, type PrinterStatus, type PrintOptions, type RemoteFile } from './types';

abstract class HttpPrinter implements PrinterConnection {
  abstract readonly kind: 'moonraker' | 'octoprint';
  protected st: PrinterStatus = { state: 'offline' };
  protected ev = new Emitter<PrinterStatus>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  constructor(protected cfg: ConnectionConfig, protected fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  protected abstract defaultPort: number;
  protected get base() {
    const h = (this.cfg.host ?? '').trim().replace(/\/+$/, '');
    if (/^https?:\/\//.test(h)) return h;
    return `http://${h}:${this.cfg.port || this.defaultPort}`;
  }
  protected headers(): Record<string, string> { return this.cfg.apiKey ? { 'X-Api-Key': this.cfg.apiKey } : {}; }
  protected async req(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<any> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await this.fetchFn(this.base + path, { ...init, headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) }, signal: ctl.signal });
      const text = await r.text();
      if (!r.ok) {
        let msg = text;
        try { const j = JSON.parse(text); msg = j.error?.message ?? j.error ?? j.message ?? text; } catch { /* plain text */ }
        throw new Error(`${r.status} ${String(msg).slice(0, 200)}`);
      }
      try { return text ? JSON.parse(text) : null; } catch { return text; }
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error(`No response from ${this.base}`);
      throw e;
    } finally { clearTimeout(t); }
  }
  protected set(s: PrinterStatus) { this.st = s; this.ev.emit(s); }

  protected abstract poll(): Promise<PrinterStatus>;

  async connect() {
    this.set({ state: 'connecting' });
    try {
      this.set(await this.poll());
    } catch (e: any) {
      this.set({ state: 'offline', message: e.message });
      throw e;
    }
    this.timer = setInterval(async () => {
      try { this.set(await this.poll()); this.failures = 0; }
      catch (e: any) { if (++this.failures >= 3) this.set({ ...this.st, state: 'offline', message: e.message }); }
    }, 2000);
  }
  async disconnect() { if (this.timer) clearInterval(this.timer); this.timer = null; this.set({ state: 'offline' }); }
  status() { return this.st; }
  onStatus(cb: (s: PrinterStatus) => void) { return this.ev.on(cb); }
  protected async refresh() { try { this.set(await this.poll()); } catch { /* next poll retries */ } }

  abstract upload(fileName: string, data: ArrayBuffer, onProgress?: (f: number) => void): Promise<void>;
  abstract startPrint(fileName: string, opts?: PrintOptions): Promise<void>;
  abstract pause(): Promise<void>;
  abstract resume(): Promise<void>;
  abstract cancel(): Promise<void>;
  abstract sendGcode(line: string): Promise<void>;
  abstract listFiles(): Promise<RemoteFile[]>;
  abstract deleteFile(name: string): Promise<void>;
  abstract cameraUrl(): Promise<string | null>;
}

const absUrl = (base: string, u: string | undefined | null) => {
  if (!u) return null;
  if (/^https?:\/\//.test(u)) return u;
  const host = new URL(base);
  return `${host.protocol}//${host.hostname}${u.startsWith('/') ? '' : '/'}${u}`;
};

export class MoonrakerConnection extends HttpPrinter {
  readonly kind = 'moonraker' as const;
  protected defaultPort = 7125;

  protected async poll(): Promise<PrinterStatus> {
    const r = await this.req('/printer/objects/query?print_stats&virtual_sdcard&extruder&heater_bed&fan&gcode_move&webhooks');
    const s = r.result.status;
    const ps = s.print_stats ?? {};
    const map: Record<string, PrinterStatus['state']> = { standby: 'idle', printing: 'printing', paused: 'paused', complete: 'finished', cancelled: 'idle', error: 'error' };
    const progress = Number(s.virtual_sdcard?.progress ?? 0);
    const dur = Number(ps.print_duration ?? 0);
    const klippy = s.webhooks?.state;
    return {
      state: klippy && klippy !== 'ready' ? 'error' : map[ps.state] ?? 'idle',
      message: klippy && klippy !== 'ready' ? s.webhooks?.state_message : ps.message || undefined,
      progress,
      fileName: ps.filename || undefined,
      layer: ps.info?.current_layer ?? undefined,
      totalLayers: ps.info?.total_layer ?? undefined,
      remainingSeconds: progress > 0.01 && dur > 0 ? Math.max(0, dur / progress - dur) : undefined,
      nozzleTemp: s.extruder?.temperature, nozzleTarget: s.extruder?.target,
      bedTemp: s.heater_bed?.temperature, bedTarget: s.heater_bed?.target,
      fanPercent: s.fan ? Math.round(Number(s.fan.speed) * 100) : undefined,
      speedPercent: s.gcode_move ? Math.round(Number(s.gcode_move.speed_factor) * 100) : undefined,
    };
  }
  async upload(fileName: string, data: ArrayBuffer, onProgress?: (f: number) => void) {
    const fd = new FormData();
    fd.append('root', 'gcodes');
    fd.append('file', new Blob([data]), fileName);
    onProgress?.(0);
    await this.req('/server/files/upload', { method: 'POST', body: fd }, 600000);
    onProgress?.(1);
  }
  async startPrint(fileName: string) { await this.req(`/printer/print/start?filename=${encodeURIComponent(fileName)}`, { method: 'POST' }); await this.refresh(); }
  async pause() { await this.req('/printer/print/pause', { method: 'POST' }); await this.refresh(); }
  async resume() { await this.req('/printer/print/resume', { method: 'POST' }); await this.refresh(); }
  async cancel() { await this.req('/printer/print/cancel', { method: 'POST' }); await this.refresh(); }
  async sendGcode(line: string) { await this.req(`/printer/gcode/script?script=${encodeURIComponent(line)}`, { method: 'POST' }, 120000); }
  async listFiles(): Promise<RemoteFile[]> {
    const r = await this.req('/server/files/list?root=gcodes');
    return (r.result as any[]).map((f) => ({ name: f.path, size: f.size, modified: f.modified ? f.modified * 1000 : undefined })).sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
  }
  async deleteFile(name: string) { await this.req(`/server/files/gcodes/${name.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }); }
  async cameraUrl() {
    try {
      const r = await this.req('/server/webcams/list');
      const cam = (r.result?.webcams ?? []).find((w: any) => w.enabled !== false);
      if (cam) return absUrl(this.base, cam.stream_url || cam.snapshot_url);
    } catch { /* older Moonraker */ }
    return absUrl(this.base, '/webcam/?action=stream');
  }
}

export class OctoPrintConnection extends HttpPrinter {
  readonly kind = 'octoprint' as const;
  protected defaultPort = 80;

  protected async poll(): Promise<PrinterStatus> {
    const job = await this.req('/api/job');
    let pr: any = null;
    try { pr = await this.req('/api/printer?exclude=sd'); } catch { /* 409 when the printer is not connected */ }
    const text = String(job.state ?? '');
    const state: PrinterStatus['state'] = /^Printing|Starting|Resuming|Finishing/.test(text) ? 'printing'
      : /^Paus/.test(text) ? 'paused' : /^Offline|Closed/.test(text) ? 'offline' : /Error/.test(text) ? 'error' : 'idle';
    const t = pr?.temperature ?? {};
    return {
      state, message: state === 'error' || state === 'offline' ? text : undefined,
      progress: job.progress?.completion != null ? job.progress.completion / 100 : undefined,
      remainingSeconds: job.progress?.printTimeLeft ?? undefined,
      fileName: job.job?.file?.name ?? undefined,
      nozzleTemp: t.tool0?.actual, nozzleTarget: t.tool0?.target,
      bedTemp: t.bed?.actual, bedTarget: t.bed?.target,
      chamberTemp: t.chamber?.actual,
    };
  }
  private json(body: unknown): RequestInit { return { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }; }
  async upload(fileName: string, data: ArrayBuffer, onProgress?: (f: number) => void) {
    const fd = new FormData();
    fd.append('file', new Blob([data]), fileName);
    onProgress?.(0);
    await this.req('/api/files/local', { method: 'POST', body: fd }, 600000);
    onProgress?.(1);
  }
  async startPrint(fileName: string) { await this.req(`/api/files/local/${encodeURIComponent(fileName)}`, this.json({ command: 'select', print: true })); await this.refresh(); }
  async pause() { await this.req('/api/job', this.json({ command: 'pause', action: 'pause' })); await this.refresh(); }
  async resume() { await this.req('/api/job', this.json({ command: 'pause', action: 'resume' })); await this.refresh(); }
  async cancel() { await this.req('/api/job', this.json({ command: 'cancel' })); await this.refresh(); }
  async sendGcode(line: string) { await this.req('/api/printer/command', this.json({ commands: line.split('\n').map((l) => l.trim()).filter(Boolean) })); }
  async listFiles(): Promise<RemoteFile[]> {
    const r = await this.req('/api/files/local');
    return (r.files as any[]).filter((f) => f.type !== 'folder').map((f) => ({ name: f.name, size: f.size, modified: f.date ? f.date * 1000 : undefined })).sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
  }
  async deleteFile(name: string) { await this.req(`/api/files/local/${encodeURIComponent(name)}`, { method: 'DELETE' }); }
  async cameraUrl() {
    try {
      const s = await this.req('/api/settings');
      const u = s.webcam?.streamUrl ?? s.webcam?.webcams?.[0]?.streamUrl;
      if (u) return absUrl(this.base, u);
    } catch { /* no permission */ }
    return absUrl(this.base, '/webcam/?action=stream');
  }
}
