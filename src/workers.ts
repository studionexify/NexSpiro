// Starting the app's Web Workers so that a new deploy of the web version never breaks a tab that is already open.
//
// Each build gives the worker scripts new hashed file names and a deploy removes the old ones, so a page loaded
// before the deploy asks for a script that is gone (404) the next time it starts a worker: slicing failed with
// "the slicer stopped unexpectedly". Self-contained worker scripts are therefore read once while the page is fresh
// and later workers start from that in-memory copy, which always matches the page's own code.
import slicerUrl from './engine/worker.ts?worker&url';
import nestUrl from './engine/nestWorker.ts?worker&url';
import analysisUrl from './engine/advanced/analysisWorker.ts?worker&url';

export const WORKERS = { slicer: slicerUrl, nest: nestUrl, analysis: analysisUrl } as const;
export type WorkerName = keyof typeof WORKERS;

const blobs = new Map<WorkerName, string>();
const loading = new Map<WorkerName, Promise<void>>();

/**
 * Read a worker script into memory (production builds only: in development the worker is an ES module importing
 * other modules by relative path, which a blob URL cannot resolve). Failures are left to `startWorker`, which then
 * loads the script from its URL as usual.
 */
export function preloadWorker(name: WorkerName): Promise<void> {
  if (!import.meta.env.PROD || typeof fetch === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve();
  let p = loading.get(name);
  if (!p) {
    p = fetch(new URL(WORKERS[name], location.href))
      .then(async (r) => {
        if (!r.ok) return;
        const code = await r.text();
        // a script that imports other chunks cannot run from a blob URL: keep using its real URL
        if (/^\s*import\s*[\w{*'"]/m.test(code)) return;
        blobs.set(name, URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      })
      .catch(() => { loading.delete(name); });
    loading.set(name, p);
  }
  return p;
}

/** Read every worker script once the page has loaded, while the files of this version are still on the server. */
export function preloadWorkers() {
  const run = () => { for (const n of Object.keys(WORKERS) as WorkerName[]) void preloadWorker(n); };
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(run, { timeout: 3000 }); else setTimeout(run, 1000);
}

export function startWorker(name: WorkerName): Worker {
  return new Worker(blobs.get(name) ?? new URL(WORKERS[name], location.href), { type: 'module' });
}

/**
 * Why a worker failed to start or died without an error message. A worker script that is no longer on the server
 * means the app was updated while this page was open; anything else is a crash, usually the browser tab running
 * out of memory.
 */
export async function workerFailure(name: WorkerName, what: string): Promise<string> {
  if (!blobs.has(name)) {
    try {
      const r = await fetch(new URL(WORKERS[name], location.href), { method: 'HEAD', cache: 'no-store' });
      if (r.status === 404) return `NexSpiro was updated while this page was open, so the ${what} could not be loaded. Save your project (Ctrl+S), then reload the page.`;
    } catch { /* offline: fall through */ }
  }
  return `the ${what} stopped unexpectedly (the browser may have run out of memory — try a coarser Resolution, a bigger layer height or fewer objects)`;
}
