// Model import: dispatches by extension, welds, centres, and returns scene objects.
import { weld, meshBounds, openEdgeCount, type IndexedMesh } from '../engine/mesh';
import { parseSTL } from './stl';
import { parseOBJPolys } from './obj';
import { parse3MF } from './threemf';

export interface LoadedModel {
  name: string; mesh: IndexedMesh; openEdges: number; offset: [number, number, number];
  /** Per-triangle colour paint (1-based slot, 0 = the object's filament), from a coloured 3MF. */
  color?: Uint8Array;
  /** 0-based filament slot of the object. */
  filament?: number;
  /** Filament colours stored in the file, slot order. */
  filamentColors?: string[];
}

export const SUPPORTED_EXT = ['.stl', '.obj', '.3mf'];

/** Centre a mesh on XY origin with min Z = 0; returns the original placement offset. */
export function centreMesh(m: IndexedMesh): [number, number, number] {
  const b = meshBounds(m.vertices);
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = b.min[2];
  for (let i = 0; i < m.vertices.length; i += 3) { m.vertices[i] -= cx; m.vertices[i + 1] -= cy; m.vertices[i + 2] -= cz; }
  return [cx, cy, cz];
}

export async function loadModelFile(name: string, data: ArrayBuffer): Promise<LoadedModel[]> {
  const lower = name.toLowerCase();
  const base = name.replace(/\.[^.]+$/, '');
  const soups: { name: string; soup: Float32Array; groups?: Uint32Array; color?: Uint8Array; filament?: number }[] = [];
  let filamentColors: string[] | undefined;
  if (lower.endsWith('.stl')) soups.push({ name: base, soup: parseSTL(data) });
  else if (lower.endsWith('.obj')) soups.push({ name: base, ...parseOBJPolys(new TextDecoder().decode(data)) });
  else if (lower.endsWith('.3mf')) {
    const r = await parse3MF(data);
    if (r.filamentColors.length) filamentColors = r.filamentColors;
    soups.push(...r.objects.map((o, _i, a) => ({ name: a.length > 1 ? o.name : base, soup: o.soup, color: o.color, filament: o.filament })));
  }
  else throw new Error(`Unsupported file type: ${name}. Supported: ${SUPPORTED_EXT.join(', ')}`);
  return soups.map(({ name: n, soup, groups, color, filament }) => {
    // colour rides through the weld as face groups (degenerate triangles are dropped there)
    const mesh = weld(soup, 1e-5, color ?? groups);
    if (!mesh.indices.length) throw new Error(`${n} contains no triangles.`);
    let paint: Uint8Array | undefined;
    if (color) { paint = Uint8Array.from(mesh.faceGroups ?? []); delete mesh.faceGroups; }
    const offset = centreMesh(mesh);
    return { name: n, mesh, openEdges: openEdgeCount(mesh), offset, color: paint, filament, filamentColors };
  });
}
