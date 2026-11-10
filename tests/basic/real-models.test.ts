// Basic slicer on the user's real models: every process enum option, supports, vase, multicolour, seams.
// Each slice goes through the same G-code checks: finite, on the bed, Z climbs, model height reached, no blob moves.
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { loadModelFile, type LoadedModel } from '../../src/io/load';
import { slice } from '../../src/engine/slicer';
import { resolveConfig } from '../../src/profiles/resolve';
import { slotFromConfig } from '../../src/engine/slicer';
import { PROCESS_PARAMS } from '../../src/profiles/settings';
import { printerById } from '../../src/profiles/printers';
import type { MeshInput } from '../../src/engine/types';
import { analyze } from './blob-hunt.test';

const models: Record<string, LoadedModel[]> = {};
beforeAll(async () => {
  for (const f of ['trophy.stl', 'helmet.stl', 'flexi_cat.3mf']) {
    const b = readFileSync(`tests/models/${f}`);
    models[f] = await loadModelFile(f, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
});

/** Model placed on the bed at (cx, cy), optionally scaled. */
function place(m: LoadedModel, id: string, cx: number, cy: number, scale = 1, extra: Partial<MeshInput> = {}): MeshInput {
  const v = new Float32Array(m.mesh.vertices);
  for (let i = 0; i < v.length; i += 3) { v[i] = v[i] * scale + cx; v[i + 1] = v[i + 1] * scale + cy; v[i + 2] *= scale; }
  return { id, name: id, vertices: v, indices: m.mesh.indices, ...extra };
}
const topZ = (ms: MeshInput[]) => Math.max(...ms.map((m) => { let z = 0; for (let i = 2; i < m.vertices.length; i += 3) z = Math.max(z, m.vertices[i]); return z; }));

interface Opts { printer?: string; preset?: string; filament?: string; overrides?: Record<string, unknown>; filaments?: number; vase?: boolean }
function run(ms: MeshInput[], o: Opts = {}) {
  process.stderr.write(`SLICE ${Math.round(process.memoryUsage().heapUsed / 1e6)}MB ${JSON.stringify({ ...o, n: ms.length, z: topZ(ms).toFixed(1) })}\n`);
  const pid = o.printer ?? 'bbl-a1';
  const p = printerById(pid);
  const cfg = resolveConfig({ printerId: pid, plate: p.plates[0].type, filamentId: o.filament ?? 'generic-pla', presetId: o.preset ?? '0.20', overrides: (o.overrides ?? {}) as never });
  const fils = o.filaments ?? 1;
  const a = slotFromConfig(cfg);
  const COL = ['#ffffff', '#cc2222', '#111111', '#2244cc', '#22aa44', '#ffcc00', '#ff8800', '#8800ff'];
  const out = slice(ms, cfg, () => {}, fils > 1 ? { filaments: Array.from({ length: fils }, (_, k) => ({ ...a, name: `F${k + 1}`, color: COL[k % 8] })) } : {});
  check(out, ms, p.bed, o);
  return out;
}

function check(out: ReturnType<typeof slice>, ms: MeshInput[], bed: { x: number; y: number }, o: Opts) {
  const g = out.gcode;
  const body = g.split('\n').filter((l) => !l.startsWith(';')).join('\n');
  expect(/NaN|Infinity|undefined|\{[a-z_]+\}|\[[a-z_]+\]/.exec(body)?.[0] ?? null, 'unexpanded placeholder / NaN').toBe(null);
  expect(out.layers.length).toBeGreaterThan(0);
  expect(out.layers.every((L, i) => i === 0 || L.z > out.layers[i - 1].z), 'layers climb').toBe(true);
  const want = topZ(ms);
  const lastZ = out.layers[out.layers.length - 1].z;
  expect(Math.abs(lastZ - want), `top layer ${lastZ} vs model ${want}`).toBeLessThan(0.45);
  // extrusion stays on the bed
  const start = g.indexOf('end of start G-code');
  let x = 0, y = 0;
  for (const line of g.slice(start > 0 ? start : 0).split('\n')) {
    if (line.includes('start of end G-code')) break;
    const m = /^G[123] (.*)/.exec(line); if (!m) continue;
    const X = / X(-?[\d.]+)/.exec(' ' + m[1]), Y = / Y(-?[\d.]+)/.exec(' ' + m[1]);
    if (X) x = +X[1]; if (Y) y = +Y[1];
    if (/ E\d/.test(' ' + m[1]) && (X || Y)) {
      expect(x, line).toBeGreaterThan(-2); expect(x, line).toBeLessThan(bed.x + 2);
      expect(y, line).toBeGreaterThan(-2); expect(y, line).toBeLessThan(bed.y + 2);
    }
  }
  const r = analyze(g);
  const bad = r.issues.filter((i) => i.kind !== 'flow-spike');
  if (process.env.DUMP && bad.length) { const L = g.split('\n'); const n = bad[0].line; process.stderr.write(`DUMP ${bad.length}\n${L.slice(n - 40, n + 3).map((l, k) => `${n - 40 + k + 1}: ${l}`).join('\n')}\n`); }
  expect(bad.length, `blob moves, first: ${JSON.stringify(bad.slice(0, 3))}`).toBe(0);
  if (!o.vase) expect(r.unretractedLongTravels / Math.max(1, r.travels), `oozing travels: ${r.samples.slice(0, 3).join('\n')}`).toBeLessThan(0.03);
  return r;
}

describe('real models, defaults, every main printer', () => {
  for (const pid of ['bbl-a1', 'bbl-p1s', 'snapmaker-u1']) {
    it(`${pid}: trophy`, () => { run([place(models['trophy.stl'][0], 't', 128, 128)], { printer: pid }); }, 120000);
    it(`${pid}: helmet`, () => { run([place(models['helmet.stl'][0], 'h', 128, 128)], { printer: pid }); }, 60000);
    it(`${pid}: 4 cat keychains`, () => {
      const c = models['flexi_cat.3mf'];
      run([0, 1, 2, 3].map((k) => place(c[k + 1], `cat${k}`, 70 + (k % 2) * 60, 70 + Math.floor(k / 2) * 60)), { printer: pid });
    }, 60000);
  }
});

describe('supports', () => {
  for (const st of ['normal_auto', 'tree_auto']) for (const iface of [0, 2]) {
    it(`trophy ${st}, ${iface} interface layers: support printed and clean`, () => {
      const out = run([place(models['trophy.stl'][0], 't', 128, 128, 0.5)], { overrides: { enable_support: true, support_type: st, support_interface_top_layers: iface } });
      expect(/;TYPE:[Ss]upport/.test(out.gcode), 'G-code should match /;TYPE:[Ss]upport/').toBe(true);
    }, 60000);
  }
  it('trophy without support prints no support', () => {
    const out = run([place(models['trophy.stl'][0], 't', 128, 128, 0.5)], { overrides: { enable_support: false } });
    expect(/;TYPE:[Ss]upport/.test(out.gcode), 'G-code should not match /;TYPE:[Ss]upport/').toBe(false);
  }, 60000);
  it('helmet has no steep overhang: auto support adds nothing', () => {
    const out = run([place(models['helmet.stl'][0], 'h', 128, 128)], { overrides: { enable_support: true } });
    expect(/;TYPE:[Ss]upport/.test(out.gcode), 'G-code should not match /;TYPE:[Ss]upport/').toBe(false);
  }, 60000);
});

describe('multicolour', () => {
  const four = () => [0, 1, 2, 3].map((k) => place(models['flexi_cat.3mf'][k + 1], `cat${k}`, 70 + (k % 2) * 60, 70 + Math.floor(k / 2) * 60, 1, { filament: k }));
  for (const pid of ['bbl-a1', 'bbl-p1s', 'snapmaker-u1']) {
    it(`${pid}: 4 objects, 4 filaments — every filament used, tools change`, () => {
      const out = run(four(), { printer: pid, filaments: 4 });
      const tools = new Set([...out.gcode.matchAll(/^T(\d+)/gm)].map((m) => +m[1]));
      for (const k of [0, 1, 2, 3]) expect(tools.has(k), `T${k} used`).toBe(true);
    }, 120000);
  }
  it('helmet painted in 2 colours (top half filament 2)', () => {
    const h = place(models['helmet.stl'][0], 'h', 128, 128);
    const I = h.indices, V = h.vertices, color = new Uint8Array(I.length / 3);
    for (let t = 0; t < color.length; t++) color[t] = V[I[t * 3] * 3 + 2] > 12 ? 2 : 0;
    const out = run([{ ...h, paint: { color } }], { filaments: 2 });
    expect(/^T1/m.test(out.gcode), 'G-code should match /^T1/m').toBe(true);
  }, 120000);
});

describe('vase mode', () => {
  it('helmet in spiral vase: one continuous wall, no retractions after the bottom', () => {
    const out = run([place(models['helmet.stl'][0], 'h', 128, 128)], { vase: true, overrides: { spiral_mode: true } });
    // the helmet's top 4 layers split into separate islands: a spiral must retract to jump between them (as Orca)
    const after = out.gcode.split(';LAYER_CHANGE').slice(6, -4).join('');
    expect((after.match(/G1 E-|E-\d[\d.]* F/g) ?? []).length, 'retractions inside the spiral').toBe(0);
  }, 60000);
});

describe('layer heights and filaments', () => {
  for (const preset of ['0.08', '0.12', '0.16', '0.20', '0.24', '0.28']) {
    it(`trophy at ${preset} mm`, () => { run([place(models['trophy.stl'][0], 't', 128, 128, 0.3)], { preset }); }, 60000);
  }
  for (const fil of ['generic-pla', 'generic-petg', 'generic-abs', 'generic-asa', 'generic-tpu']) {
    it(`helmet in ${fil}`, () => { run([place(models['helmet.stl'][0], 'h', 128, 128)], { filament: fil }); }, 60000);
  }
});

// every option of every enum process setting (sweep), on a 30 % trophy
const ENUMS = PROCESS_PARAMS.filter((p) => p.type === 'enum' && Array.isArray((p as { options?: unknown[] }).options));
describe('every enum process setting, every option', () => {
  for (const p of ENUMS) {
    const opts = ((p as { options: { value: unknown }[] }).options).map((x) => (typeof x === 'object' && x && 'value' in x ? x.value : x));
    it(`${p.key}: ${opts.join(' | ')}`, () => {
      for (const v of opts) {
        const vase = p.key === 'spiral_mode' || (p.key === 'slicing_mode' && v !== 'regular');
        process.stderr.write(`RUN ${p.key}=${String(v)}\n`);
        try { run([place(models['trophy.stl'][0], 't', 128, 128, 0.25)], { vase, overrides: { [p.key]: v } }); }
        catch (e) { throw new Error(`${p.key} = ${String(v)}: ${(e as Error).message}`); }
      }
    }, 300000);
  }
});
