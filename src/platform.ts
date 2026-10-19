// Desktop (Electron) vs browser file I/O.
declare global {
  interface Window {
    nexspiro?: {
      platform: string;
      saveFile: (opts: { defaultName: string; data: string | ArrayBuffer; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
      openFiles: (opts: { filters?: { name: string; extensions: string[] }[] }) => Promise<{ name: string; data: ArrayBuffer }[]>;
      postProcess?: (opts: { gcode: string; scripts: string[]; env: Record<string, string>; outputName: string }) => Promise<{ gcode: string; skipped?: boolean }>;
    };
  }
}

export const isDesktop = () => typeof window !== 'undefined' && !!window.nexspiro;

export async function saveFile(defaultName: string, data: string | ArrayBuffer, ext: string): Promise<string | null> {
  if (window.nexspiro) return window.nexspiro.saveFile({ defaultName, data, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return defaultName;
}

export const openModelFiles = () => openFiles([{ name: '3D models', extensions: ['stl', 'obj', '3mf', 'step', 'stp', 'iges', 'igs', 'brep'] }]);

export async function openFiles(filters: { name: string; extensions: string[] }[], multiple = true): Promise<{ name: string; data: ArrayBuffer }[]> {
  if (window.nexspiro) return window.nexspiro.openFiles({ filters });
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() }))));
    };
    input.click();
  });
}
