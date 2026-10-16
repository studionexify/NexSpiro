// Device workspace state: saved printers, live status and the active connection handles.
import { create } from 'zustand';
import { deviceHandle, loadDevices, saveDevices, type DeviceHandle } from '../connect/client';
import type { PrinterStatus, SavedDevice } from '../connect/types';

interface DevState {
  loaded: boolean;
  devices: SavedDevice[];
  status: Record<string, PrinterStatus>;
  selected: string | null;
  busy: Record<string, string | null>; // id -> current operation label
  upload: Record<string, number | null>;
  set: (p: Partial<DevState>) => void;
}

export const useDevices = create<DevState>((set) => ({
  loaded: false, devices: [], status: {}, selected: null, busy: {}, upload: {},
  set: (p) => set(p),
}));

const handles = new Map<string, DeviceHandle>();
const setStatus = (id: string, s: PrinterStatus) => useDevices.setState((st) => ({ status: { ...st.status, [id]: s } }));
const setBusy = (id: string, label: string | null) => useDevices.setState((st) => ({ busy: { ...st.busy, [id]: label } }));

export async function initDevices() {
  if (useDevices.getState().loaded) return;
  const devices = await loadDevices();
  useDevices.setState({ loaded: true, devices, selected: devices[0]?.id ?? null });
}

export function handleOf(id: string): DeviceHandle {
  let h = handles.get(id);
  if (!h) {
    const d = useDevices.getState().devices.find((x) => x.id === id);
    if (!d) throw new Error('Unknown printer');
    h = deviceHandle(d, (s) => setStatus(id, s));
    handles.set(id, h);
  }
  return h;
}

export async function saveDevice(d: SavedDevice) {
  const st = useDevices.getState();
  const exists = st.devices.some((x) => x.id === d.id);
  const devices = exists ? st.devices.map((x) => (x.id === d.id ? d : x)) : [...st.devices, d];
  if (handles.has(d.id)) { await handles.get(d.id)!.disconnect().catch(() => {}); handles.delete(d.id); }
  useDevices.setState({ devices, selected: d.id });
  await saveDevices(devices);
}

export async function removeDevice(id: string) {
  const h = handles.get(id);
  if (h) { await h.disconnect().catch(() => {}); handles.delete(id); }
  const devices = useDevices.getState().devices.filter((d) => d.id !== id);
  useDevices.setState({ devices, selected: devices[0]?.id ?? null });
  await saveDevices(devices);
}

/** Run a device operation with a busy label; errors become a status message and are re-thrown. */
export async function run<T>(id: string, label: string, fn: (h: DeviceHandle) => Promise<T>): Promise<T> {
  setBusy(id, label);
  try { return await fn(handleOf(id)); }
  finally { setBusy(id, null); }
}

export async function connectDevice(id: string) {
  try { await run(id, 'Connecting…', (h) => h.connect()); }
  catch (e: any) { setStatus(id, { state: 'offline', message: e?.message ?? String(e) }); throw e; }
}
export const disconnectDevice = (id: string) => run(id, 'Disconnecting…', (h) => h.disconnect());

export async function uploadAndPrint(id: string, name: string, data: ArrayBuffer, start: boolean, opts: Parameters<DeviceHandle['startPrint']>[1] = {}) {
  const st = useDevices.getState();
  if (!st.status[id] || st.status[id].state === 'offline') await connectDevice(id);
  const setUp = (f: number | null) => useDevices.setState((s) => ({ upload: { ...s.upload, [id]: f } }));
  try {
    setUp(0);
    await run(id, 'Uploading…', (h) => h.upload(name, data, (f) => setUp(f)));
    if (start) await run(id, 'Starting print…', (h) => h.startPrint(name, opts));
  } finally { setUp(null); }
}
