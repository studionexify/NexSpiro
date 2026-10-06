// PrusaSlicer / Bambu Studio TriangleSelector serialization (3MF `paint_color`, `paint_supports`, `paint_seam`,
// `slic3rpe:mmu_segmentation`, ...). The hex string is read from its LAST character backwards; each character is
// one 4-bit nibble. Per (sub)triangle, depth-first:
//   nibble c: low 2 bits = number of split sides (0 → leaf).
//     leaf:  state = c >> 2; if state == 3 → state = 3 + next nibble (extended states for extruders ≥ 3)
//     split: (c >> 2) = special side; then (splitSides + 1) children follow recursively.

export type PaintLeaf = { state: number; area: number }; // area as a fraction of the parent facet

export function decodeTriangleSelector(hex: string): PaintLeaf[] {
  const nib: number[] = [];
  for (let i = hex.length - 1; i >= 0; i--) {
    const v = parseInt(hex[i], 16);
    if (Number.isNaN(v)) throw new Error(`Invalid paint string character '${hex[i]}'`);
    nib.push(v);
  }
  let p = 0;
  const next = () => { if (p >= nib.length) throw new Error("Truncated paint string"); return nib[p++]; };
  const leaves: PaintLeaf[] = [];
  const walk = (area: number, depth: number) => {
    if (depth > 32) throw new Error("Paint tree too deep");
    const c = next(), splits = c & 3;
    if (splits === 0) {
      let state = c >> 2;
      if (state === 3) state = 3 + next();
      leaves.push({ state, area });
      return;
    }
    // Sub-triangle areas: 1 split side → 2 halves; 2 → 3 (≈ ¼, ¼, ½ — approximated as equal thirds);
    // 3 → 4 quarters. Exact child geometry is not needed for mask projection at NexSpiro's mask resolution.
    const children = splits + 1;
    for (let k = 0; k < children; k++) walk(area / children, depth + 1);
  };
  if (nib.length) walk(1, 0);
  return leaves;
}

/** Area-weighted dominant state of one facet (0 = unpainted). Painted states win ties against 0. */
export function dominantState(hex: string): number {
  if (!hex) return 0;
  const acc = new Map<number, number>();
  for (const l of decodeTriangleSelector(hex)) acc.set(l.state, (acc.get(l.state) ?? 0) + l.area);
  let best = 0, bestA = -1;
  for (const [s, a] of acc) if (a > bestA + 1e-9 || (Math.abs(a - bestA) < 1e-9 && s > best)) { best = s; bestA = a; }
  return best;
}

/** Encode an unsplit facet with a single state (the inverse of a leaf-only decode). */
export function encodeState(state: number): string {
  if (state <= 0) return "";
  if (state < 3) return (state << 2).toString(16).toUpperCase();
  if (state - 3 > 15) throw new Error(`Paint state ${state} out of range`);
  return (state - 3).toString(16).toUpperCase() + "C"; // nibbles [0xC, state-3], written reversed
}
