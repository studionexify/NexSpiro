// App updates without any server: "Update from file…" takes a NexSpiro Setup .exe (e.g. from a USB stick),
// checks its version and signature, then runs it silently and relaunches.
import { app, BrowserWindow, dialog } from 'electron';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';

function parentWin() {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function box(opts: Electron.MessageBoxOptions) {
  const win = parentWin();
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

// "1.2.10" > "1.2.9"; pre-release suffixes are ignored
function cmpVersion(a: string, b: string) {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

type InstallerInfo = { version: string; signer: string | null; status: string };

// ProductVersion and Authenticode signer of an .exe, via PowerShell (available on every supported Windows)
function inspectExe(file: string) {
  const script = `$ErrorActionPreference='Stop';$f=$env:NX_FILE;$s=Get-AuthenticodeSignature -LiteralPath $f;`
    + `@{version=(Get-Item -LiteralPath $f).VersionInfo.ProductVersion;status=[string]$s.Status;`
    + `signer=$(if($s.SignerCertificate){$s.SignerCertificate.Subject}else{$null})}|ConvertTo-Json -Compress`;
  return new Promise<InstallerInfo>((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, NX_FILE: file }, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const j = JSON.parse(stdout.trim());
          resolve({ version: String(j.version ?? '').trim(), signer: j.signer ?? null, status: String(j.status ?? '') });
        } catch (e) { reject(e); }
      });
  });
}

export async function updateFromFile() {
  if (process.platform !== 'win32') {
    void box({ type: 'info', message: 'Update from file is available on Windows only.', detail: 'Open the new installer directly on this system.' });
    return;
  }
  const win = parentWin();
  const opts: Electron.OpenDialogOptions = { title: 'Choose a NexSpiro installer', properties: ['openFile'], filters: [{ name: 'NexSpiro installer', extensions: ['exe'] }] };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (r.canceled || !r.filePaths[0]) return;
  const file = r.filePaths[0];

  let info: InstallerInfo;
  let own: InstallerInfo | null = null;
  try {
    info = await inspectExe(file);
    if (app.isPackaged) own = await inspectExe(process.execPath);
  } catch (e) {
    void box({ type: 'error', message: 'Could not read the installer.', detail: String((e as Error)?.message ?? e) });
    return;
  }

  if (!/nexspiro/i.test(path.basename(file)) && !info.version) {
    void box({ type: 'error', message: 'This does not look like a NexSpiro installer.', detail: file });
    return;
  }

  // the installer must be signed by the same publisher as the running app; unsigned builds get an explicit warning
  const ownSigned = own?.status === 'Valid' && own.signer;
  if (ownSigned && (info.status !== 'Valid' || info.signer !== own!.signer)) {
    void box({
      type: 'error', message: 'The installer signature does not match NexSpiro.',
      detail: `Expected: ${own!.signer}\nFound: ${info.signer ?? 'not signed'} (${info.status})\n\nThe file may be damaged or not genuine.`,
    });
    return;
  }

  const current = app.getVersion();
  const cmp = info.version ? cmpVersion(info.version, current) : 1;
  const lines = [`Installed: ${current}`, `Installer: ${info.version || 'unknown'}`];
  if (!ownSigned) lines.push('', 'Warning: this copy of NexSpiro is not code-signed, so the installer cannot be verified. Only continue if you trust where this file came from.');
  const res = await box({
    type: cmp > 0 && ownSigned ? 'question' : 'warning',
    buttons: [cmp > 0 ? 'Install update' : cmp === 0 ? 'Reinstall' : 'Install older version', 'Cancel'], defaultId: cmp > 0 ? 0 : 1, cancelId: 1,
    message: cmp > 0 ? `Update NexSpiro to ${info.version}?` : cmp === 0 ? 'This version is already installed.' : 'This installer is older than the installed version.',
    detail: `${lines.join('\n')}\n\nNexSpiro will close, update and restart.`,
  });
  if (res.response !== 0) return;

  // same switches electron-updater uses: silent NSIS install, then relaunch the app
  const child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => void box({ type: 'error', message: 'Could not start the installer.', detail: e.message }));
  child.once('spawn', () => { child.unref(); app.quit(); });
}
