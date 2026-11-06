// Filament slot → physical head on a tool changer. The slicer writes slot n as head n (T<n>, M104 T<n>…);
// at send time the user may have loaded the colours on other heads (the Print dialog, like Bambu's AMS mapping),
// so the tool numbers in the finished G-code are rewritten. Only the command part of a line is touched.

import { toolMapOf } from '../profiles/changer';

/** Parses "2,0,1,3" into [2,0,1,3]; blanks and junk keep the identity for that slot. */
export const parseToolMap = (v: unknown): number[] => toolMapOf({ changer_type: 'toolchanger', tool_map: String(v ?? '') });

/** True when the map sends every slot to its own head. */
export const isIdentityMap = (map: number[]) => map.every((h, k) => h === k);

/** Problems with a map for the slots a print uses (two slots on one head, a head the printer lacks). */
export function toolMapProblems(map: number[], usedSlots: number[], heads: number): string[] {
  const out: string[] = [];
  const at = (k: number) => map[k] ?? k;
  const seen = new Map<number, number>();
  for (const k of usedSlots) {
    const h = at(k);
    if (h >= heads) out.push(`Filament ${k + 1} is mapped to head T${h}, the printer has ${heads} heads (T0–T${heads - 1}).`);
    const other = seen.get(h);
    if (other !== undefined) out.push(`Filaments ${other + 1} and ${k + 1} are both mapped to head T${h}.`);
    else seen.set(h, k);
  }
  return out;
}

const TOOL_LINE = /^(\s*)T(\d+)(?=\s|;|$)/;
const TEMP_CMD = /^\s*(M104|M109|M106|M107|M568|M221|M218|G10)\b/i;

/** Rewrites tool numbers in G-code: T<n> lines and the T parameter of temperature / fan / offset commands. */
export function remapTools(gcode: string, map: number[]): string {
  if (!map.length || isIdentityMap(map)) return gcode;
  const to = (n: string) => String(map[Number(n)] ?? Number(n));
  return gcode.split('\n').map((line) => {
    const c = line.indexOf(';');
    const cmd = c >= 0 ? line.slice(0, c) : line;
    const rest = c >= 0 ? line.slice(c) : '';
    let out = cmd;
    if (TOOL_LINE.test(cmd)) out = cmd.replace(TOOL_LINE, (_, sp, n) => `${sp}T${to(n)}`);
    else if (TEMP_CMD.test(cmd)) out = cmd.replace(/(\s)T(\d+)\b/g, (_, sp, n) => `${sp}T${to(n)}`);
    return out === cmd ? line : out + rest;
  }).join('\n');
}
