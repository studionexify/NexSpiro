// 3MF reader: parses 3D/3dmodel.model (and referenced component models), applying
// component & build-item transforms. Returns one triangle soup per build item.
import JSZip from 'jszip';

type Mat = number[]; // 3x4 row-major affine as 12 numbers: m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz (3MF order)
const IDENT: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const parseMat = (s: string | null): Mat => (s ? s.trim().split(/\s+/).map(Number) : IDENT);
// 3MF transform: [x y z 1] * M where M columns are as listed (row vector convention)
const mul = (a: Mat, b: Mat): Mat => {
  // apply a then b
  const r: Mat = new Array(12).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    let s = i === 3 ? b[9 + j] : 0;
    for (let k = 0; k < 3; k++) s += (i === 3 ? a[9 + k] : a[i * 3 + k]) * b[k * 3 + j];
    r[i * 3 + j] = s;
  }
  return r;
};
const apply = (m: Mat, x: number, y: number, z: number): [number, number, number] => [
  x * m[0] + y * m[3] + z * m[6] + m[9],
  x * m[1] + y * m[4] + z * m[7] + m[10],
  x * m[2] + y * m[5] + z * m[8] + m[11],
];

export interface ThreeMFObject { name: string; soup: Float32Array }

export async function parse3MF(buf: ArrayBuffer): Promise<ThreeMFObject[]> {
  const zip = await JSZip.loadAsync(buf);
  const docs = new Map<string, Document>();
  const load = async (path: string) => {
    const key = path.replace(/^\//, '');
    if (docs.has(key)) return docs.get(key)!;
    const f = zip.file(key) ?? zip.file(Object.keys(zip.files).find((k) => k.toLowerCase() === key.toLowerCase()) ?? '');
    if (!f) throw new Error(`3MF is missing ${key}`);
    const doc = new DOMParser().parseFromString(await f.async('text'), 'application/xml');
    docs.set(key, doc);
    return doc;
  };
  const rootPath = '3D/3dmodel.model';
  const root = await load(rootPath);
  const byTag = (el: Document | Element, tag: string) => Array.from(el.getElementsByTagNameNS('*', tag));

  const collect = async (docPath: string, objectId: string, m: Mat, out: number[]): Promise<string> => {
    const doc = await load(docPath);
    const obj = byTag(doc, 'object').find((o) => o.getAttribute('id') === objectId);
    if (!obj) return '';
    const mesh = byTag(obj, 'mesh')[0];
    if (mesh) {
      const v = byTag(mesh, 'vertex').map((e) => [+e.getAttribute('x')!, +e.getAttribute('y')!, +e.getAttribute('z')!]);
      for (const t of byTag(mesh, 'triangle')) {
        for (const a of ['v1', 'v2', 'v3']) {
          const p = v[+t.getAttribute(a)!];
          out.push(...apply(m, p[0], p[1], p[2]));
        }
      }
    }
    for (const c of byTag(obj, 'component')) {
      const path = c.getAttributeNS('http://schemas.microsoft.com/3dmanufacturing/production/2015/06', 'path') ?? c.getAttribute('p:path');
      await collect(path ? path : docPath, c.getAttribute('objectid')!, mul(parseMat(c.getAttribute('transform')), m), out);
    }
    return obj.getAttribute('name') ?? '';
  };

  const result: ThreeMFObject[] = [];
  const items = byTag(root, 'item');
  for (const it of items) {
    const out: number[] = [];
    const name = await collect(rootPath, it.getAttribute('objectid')!, parseMat(it.getAttribute('transform')), out);
    if (out.length) result.push({ name: name || `Object ${result.length + 1}`, soup: new Float32Array(out) });
  }
  if (!result.length) throw new Error('3MF contains no printable meshes.');
  return result;
}
