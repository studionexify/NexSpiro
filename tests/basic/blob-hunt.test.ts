// Basic-slicer quality: parse real G-code and look for the things that print as blobs/zits.
import { describe, expect, it } from 'vitest';
import { weld } from '../../src/engine/mesh';
import { slice } from '../../src/engine/slicer';
import { resolveConfig } from '../../src/profiles/resolve';
import { box, cylinder, cone } from '../fixtures';

const mesh = (soup: Float32Array, name: string) => { const m = weld(soup); return { id: name, name, vertices: m.vertices, indices: m.indices }; };

export interface Issue { line: number; kind: string; text: string }
export function analyze(gcode: string) {
  const lines = gcode.split('\n');
  const start = lines.findIndex((l) => l.includes('end of start G-code'));
  let rel = false, x = NaN, y = NaN, z = 0, e = 0, retracted = 0, type = '';
  const issues: Issue[] = [];
  const ratios: Record<string, number[]> = {};
  let unretractedLongTravels = 0, travels = 0;
  const samples: string[] = [];
  for (let i = Math.max(0, start); i < lines.length; i++) {
    const raw = lines[i]; const l = raw.split(';')[0].trim();
    if (raw.startsWith(';TYPE:')) type = raw.slice(6).trim();
    if (raw.includes('start of end G-code') || raw.includes('MACHINE_END')) break;
    if (!l) continue;
    if (l.startsWith('M83')) rel = true; else if (l.startsWith('M82')) rel = false;
    if (/^G92\b/.test(l)) { const m = / E(-?[\d.]+)/.exec(l); if (m) e = +m[1]; continue; }
    const g = /^G([0123])\b(.*)/.exec(l); if (!g) continue;
    const v: Record<string, number> = {};
    for (const t of g[2].trim().split(/\s+/)) if (t) v[t[0]] = parseFloat(t.slice(1));
    const nx = v.X ?? x, ny = v.Y ?? y; if (v.Z !== undefined) z = v.Z;
    let de = 0; if (v.E !== undefined) { de = rel ? v.E : v.E - e; e = rel ? e + v.E : v.E; }
    const d = Number.isFinite(x) ? Math.hypot(nx - x, ny - y) : 0;
    const arc = g[1] === '2' || g[1] === '3';
    if (de < 0) retracted -= de;
    else if (de > 0) {
      if (d < 1e-4 && !arc) {
        // pure unretract: must not push more than was pulled (excess = a blob at the seam)
        if (de > retracted + 0.05) issues.push({ line: i + 1, kind: 'prime-excess', text: `${raw} (retracted ${retracted.toFixed(3)})` });
        retracted = Math.max(0, retracted - de);
      } else {
        if (retracted > 0.05) issues.push({ line: i + 1, kind: 'extrude-while-retracted', text: raw });
        if (!arc && d > 0.05) (ratios[type] ??= []).push(de / d);
      }
    } else if (d > 0 && v.E === undefined) {
      travels++;
      // travels that stay inside sparse infill may skip the retract (reduce_infill_retraction, as Bambu/Orca)
      if (d > 3 && retracted < 0.01 && type !== 'Travel' && !/sparse infill/i.test(type)) { unretractedLongTravels++; if (samples.length < 12) samples.push(`${i + 1}[${type}] ${lines.slice(Math.max(0, i - 3), i + 2).join(' | ')}`); }
    }
    x = nx; y = ny;
  }
  // flow spikes: a single move > 3x its feature's median E/mm is a blob
  for (const [t, r] of Object.entries(ratios)) {
    const s = [...r].sort((a, b) => a - b); const med = s[s.length >> 1];
    const spikes = r.filter((q) => q > med * 3).length;
    if (spikes) issues.push({ line: 0, kind: 'flow-spike', text: `${t}: ${spikes}/${r.length} moves >3x median ${med.toFixed(4)}` });
  }
  return { issues, travels, unretractedLongTravels, ratios, samples };
}

function sphere(cx: number, cy: number, r: number, seg = 48, rings = 32): Float32Array {
  const out: number[] = [];
  const P = (i: number, j: number) => { const th = (j / rings) * Math.PI, ph = (i / seg) * Math.PI * 2; return [cx + r * Math.sin(th) * Math.cos(ph), cy + r * Math.sin(th) * Math.sin(ph), r - r * Math.cos(th)]; };
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    out.push(...a, ...c, ...b, ...a, ...d, ...c);
  }
  return new Float32Array(out);
}
const SHAPES: [string, () => Float32Array][] = [
  ['sphere', () => sphere(128, 128, 12)],
  ['cube', () => box(110, 110, 0, 20, 20, 10)],
  ['cylinder', () => cylinder(128, 128, 10, 12)],
  ['cone', () => cone(128, 128, 12, 4, 15)],
];
const PRINTERS = ['bbl-p1s', 'bbl-a1', 'bbl-x1c', 'snapmaker-u1'];

describe('basic slicer: blob hunt', () => {
  for (const pid of PRINTERS) for (const [name, make] of SHAPES) {
    it(`${pid} / ${name}: no blob-causing moves`, () => {
      let cfg;
      try { cfg = resolveConfig({ printerId: pid, plate: 'textured_pei_plate', filamentId: 'generic-pla', presetId: '0.20', overrides: {} }); }
      catch { return; }
      const out = slice([mesh(make(), name)], cfg);
      const r = analyze(out.gcode);
      if (r.issues.length) console.log(pid, name, r.issues.slice(0, 6));
      expect(r.issues.filter((i) => i.kind !== 'flow-spike')).toEqual([]);
      expect(r.issues.filter((i) => i.kind === 'flow-spike')).toEqual([]);
      // oozing travels (A1 timelapse used to park the head unretracted every layer: 150+ per cube)
      expect(r.unretractedLongTravels / Math.max(1, r.travels)).toBeLessThan(0.03);
    });
  }
});
