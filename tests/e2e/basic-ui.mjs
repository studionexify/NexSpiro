// Click-through of the basic slicer UI in a real browser: import real models, press every tool shortcut, click every
// visible button in Prepare and Preview, slice, export. Any page error or console error is a bug.
// Run: npx vite --port 5173 &  then  node tests/e2e/basic-ui.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright');
import path from 'node:path';
const URL = process.argv[2] ?? 'http://localhost:5173/';
const MODELS = path.resolve('tests/models');
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`[pageerror @${_step}] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|DevTools|Download the React/.test(m.text())) errors.push(`[console @${_step}] ${m.text().slice(0, 300)}`); });
page.on('dialog', (d) => d.accept());
let _step = 'load';
const T0 = Date.now();
const stepLog = (s) => { _step = s; console.log(`${((Date.now() - T0) / 1000).toFixed(0)}s ${s}`); };
const wait = (ms) => page.waitForTimeout(ms);
const crashed = async () => (await page.locator('text=ran into a problem').count()) > 0;
async function guard(label) {
  if (await crashed()) {
    const msg = await page.locator('code, pre, .mono').first().textContent().catch(() => '');
    errors.push(`[CRASH SCREEN @${label}] ${msg}`);
    await page.locator('button:has-text("Try again")').click().catch(() => {});
    await wait(300);
  }
}
async function importFiles(files) {
  stepLog(`import ${files.join(',')}`);
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.keyboard.press('Control+i')]);
  await fc.setFiles(files.map((f) => path.join(MODELS, f)));
  await wait(8000);
  for (const b of await page.locator('.modal button:has-text("Yes"), .modal button:has-text("Import"), .modal button:has-text("OK"), .modal button:has-text("Keep")').all()) await b.click().catch(() => {});
  await wait(1500);
  await guard(_step);
}
async function sliceNow(label) {
  stepLog(`slice ${label}`);
  await page.keyboard.press('Control+r');
  await page.waitForFunction(() => !document.body.innerText.includes('Slicing…'), null, { timeout: 600000 }).catch(() => errors.push(`[timeout] ${label}`));
  // wait until the page answers again (preview build; slow on headless software GL)
  for (let k = 0; k < 60; k++) {
    const ok = await Promise.race([page.evaluate(() => 1).then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
    if (ok) break;
    if (k === 59) errors.push(`[unresponsive >5 min] ${label}`);
  }
  await wait(1500);
  await guard(_step);
}
async function clickAll(scope, label) {
  const skip = /slice|delete|remove|new project|close|quit|reload|reset|clear all|print|send|connect|update|export|save|open|import|add model|sign/i;
  const btns = await page.locator(`${scope} button:visible`).all();
  let n = 0;
  for (const b of btns) {
    const name = ((await b.getAttribute('aria-label').catch(() => null)) ?? (await b.getAttribute('title').catch(() => null)) ?? (await b.textContent().catch(() => '')) ?? '').trim().slice(0, 50);
    if (!name || skip.test(name)) continue;
    stepLog(`${label}: ${name}`);
    try { await b.click({ timeout: 1500 }); n++; } catch { continue; }
    await wait(250);
    await guard(_step);
    await page.keyboard.press('Escape'); await wait(100);
  }
  return n;
}

await page.goto(URL); await wait(3000); await guard('startup');
for (const b of await page.locator('button:has-text("Skip"), button:has-text("Got it"), button:has-text("Start")').all()) await b.click().catch(() => {});
await page.evaluate(() => (window).__nxStore?.getState?.().set?.({ workspace: 'prepare' }));

await importFiles(['helmet.stl', 'trophy.stl']);
console.log('objects after import:', await page.evaluate(() => window.__nxStore.getState().objects.length));
await page.keyboard.press('Control+a');
// tool shortcuts on the selection (move, rotate, scale, lay flat, cut, paint support/seam/colour, text, measure…)
for (const k of ['m', 'r', 's', 'f', 'c', 'l', 'p', 'n', 'h', 'e', 'b', 't', 'Delete']) {
  if (k === 'Delete') break;
  stepLog(`shortcut ${k}`);
  await page.mouse.click(720, 450); await page.keyboard.press('Control+a');
  await page.keyboard.press(k); await wait(500); await guard(_step);
  await page.keyboard.press('Escape'); await wait(200);
}
stepLog('arrange'); await page.keyboard.press('a'); await wait(800); await guard(_step);
stepLog('undo/redo'); await page.keyboard.press('Control+z'); await wait(300); await page.keyboard.press('Control+y'); await wait(300); await guard(_step);
const prep = await clickAll('body', 'prepare');
console.log('prepare buttons clicked:', prep);
await page.goto(URL); await wait(2500);
await importFiles(['helmet.stl']);
await sliceNow('helmet');
const prev = await clickAll('body', 'preview');
console.log('preview buttons clicked:', prev);
// edit after slice must return to Prepare and the CTA must say Slice
stepLog('edit after slice');
await page.keyboard.press('Control+a'); await page.keyboard.press('Control+d').catch(() => {}); await wait(800);
const cta = await page.locator('.sh-cta').textContent().catch(() => '');
if (/Export/i.test(cta ?? '')) errors.push(`[bug] CTA still "${cta}" after an edit`);
await importFiles(['flexi_cat.3mf']);
await sliceNow('cat 3mf');
await page.screenshot({ path: process.env.SHOT ?? 'tests/e2e/last.png' });
await browser.close();
const uniq = [...new Set(errors)];
console.log(`\n${uniq.length} problems`);
for (const e of uniq) console.log(' -', e);
process.exit(uniq.length ? 1 : 0);
