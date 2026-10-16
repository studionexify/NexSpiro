// Wavefront OBJ reader (v / f, polygons fan-triangulated, negative indices supported).
export function parseOBJ(text: string): Float32Array {
  const verts: number[] = [];
  const out: number[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      verts.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('f ')) {
      const idx = line.split(/\s+/).slice(1).map((tok) => {
        const i = parseInt(tok.split('/')[0], 10);
        return i < 0 ? verts.length / 3 + i : i - 1;
      });
      for (let k = 1; k + 1 < idx.length; k++) {
        for (const i of [idx[0], idx[k], idx[k + 1]]) out.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
      }
    }
  }
  if (!out.length) throw new Error('OBJ file has no faces.');
  return new Float32Array(out);
}
