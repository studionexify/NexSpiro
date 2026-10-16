// Builds the file sent to a printer for the sliced plate: .gcode.3mf for Bambu Lab,
// G-code with embedded thumbnails for everything else. Also used by "Export plate".
import { buildGcode3mf, gcodeThumbnailBlock } from '../io/gcode3mf';
import { filamentById } from '../profiles/filaments';
import { printerById } from '../profiles/printers';
import { saveFile } from '../platform';
import { renderThumbnail } from '../viewport/thumbnail';
import { currentConfig, plateObjects, sliceNow } from './slicing';
import { useStore } from './store';

export interface PrintJob { name: string; data: ArrayBuffer; kind: '3mf' | 'gcode'; usedSlots: number[] }

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'plate';

export async function ensureSliced() {
  const s = useStore.getState();
  if (s.slice.result && !s.slice.dirty && s.slice.plate === s.activePlate) return s.slice.result;
  return sliceNow();
}

export async function buildPrintJob(format?: '3mf' | 'gcode'): Promise<PrintJob | null> {
  const r = await ensureSliced();
  if (!r) return null;
  const s = useStore.getState();
  const p = printerById(s.printerId);
  const objs = plateObjects(s.slice.plate);
  const base = `${safeName(objs[0]?.name ?? 'plate')}${objs.length > 1 ? `_+${objs.length - 1}` : ''}`;
  const kind = format ?? (p.flavor === 'bambu' ? '3mf' : 'gcode');
  const usedSlots = r.stats.perFilament.map((f, k) => (f.mm > 0 ? k : -1)).filter((k) => k >= 0);
  if (kind === '3mf') {
    const thumb = await renderThumbnail(objs, 512);
    const cfg = currentConfig(s.slice.plate);
    const bytes = await buildGcode3mf([{
      gcode: r.gcode, stats: r.stats, thumbnail: thumb ?? undefined,
      objects: objs.map((o, i) => ({ id: i + 1, name: o.name })),
      filaments: s.filaments.map((f) => ({ type: filamentById(f.presetId).type, color: f.color })),
      supportUsed: cfg.enable_support === true,
    }], cfg, p.bambuModelId ?? '', p.nozzle);
    return { name: `${base}.gcode.3mf`, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, kind, usedSlots };
  }
  // PrusaSlicer-style thumbnails right after the header comments (Klipper/Moonraker & printer screens read them)
  let gcode = r.gcode;
  const blocks: string[] = [];
  for (const sz of [32, 300]) {
    const png = await renderThumbnail(objs, sz);
    if (png) blocks.push(gcodeThumbnailBlock(png, sz, sz));
  }
  if (blocks.length) {
    const k = gcode.indexOf('\n\n');
    gcode = k > 0 ? `${gcode.slice(0, k + 1)};\n${blocks.join('\n')}\n${gcode.slice(k + 1)}` : `${blocks.join('\n')}\n${gcode}`;
  }
  const bytes = new TextEncoder().encode(gcode);
  return { name: `${base}_${safeName(p.model)}.gcode`, data: bytes.buffer as ArrayBuffer, kind, usedSlots };
}

export async function exportPlateFile(format: '3mf' | 'gcode') {
  const job = await buildPrintJob(format);
  if (!job) return;
  const saved = await saveFile(job.name, job.data, format === '3mf' ? '3mf' : 'gcode');
  if (saved) useStore.getState().set({ toast: { kind: 'info', text: `Exported ${saved}` } });
}
