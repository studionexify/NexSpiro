// 3MF reader. Reads the start part named in _rels/.rels (3D/3dmodel.model by default) and every model file its
// components point at, applying component and build-item transforms. Returns one triangle soup per build item.
//
// Colour, in the order it is looked for:
//  - painted colour per triangle: Orca / Bambu `paint_color`, PrusaSlicer `slic3rpe:mmu_segmentation`
//    (a hex-coded triangle-split tree; a split triangle takes the colour that covers most of it);
//  - the filament of each part / object from Metadata/model_settings.config (Orca / Bambu) or
//    Metadata/Slic3r_PE_model.config (PrusaSlicer);
//  - core 3MF materials: <basematerials> / <m:colorgroup> referenced by pid / p1, one slot per distinct colour.
// Slot numbers are 1-based in `color` (0 = not painted, the object's own filament), 0-based in `filament`.
// Uses plain string scanning instead of DOMParser, so it also runs in workers and in Node, and stays fast on
// models with millions of triangles.
import JSZip from 'jszip';

type Mat = number[]; // 3x4 affine in 3MF order: m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz (row vectors)
const IDENT: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const parseMat = (s: string | undefined): Mat => {
  const v = s ? s.trim().split(/\s+/).map(Number) : [];
  return v.length === 12 && v.every(Number.isFinite) ? v : IDENT;
};
/** a then b. */
const mul = (a: Mat, b: Mat): Mat => {
  const r: Mat = new Array(12).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    let s = i === 3 ? b[9 + j] : 0;
    for (let k = 0; k < 3; k++) s += (i === 3 ? a[9 + k] : a[i * 3 + k]) * b[k * 3 + j];
    r[i * 3 + j] = s;
  }
  return r;
};

export interface ThreeMFObject {
  name: string;
  soup: Float32Array;
  /** Per soup triangle: 1-based filament slot, 0 = the object's own filament. Absent when nothing is coloured. */
  color?: Uint8Array;
  /** The object's filament, 0-based. */
  filament?: number;
}
export interface ThreeMFResult {
  objects: ThreeMFObject[];
  /** Filament colours stored in the file (Orca / Bambu / Prusa project settings, or the 3MF materials), slot order. */
  filamentColors: string[];
}

// ---------- tiny XML scanning ----------
const ATTR = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
function attrs(tag: string): Record<string, string> {
  const r: Record<string, string> = {};
  ATTR.lastIndex = 0;
  for (let m; (m = ATTR.exec(tag)); ) r[m[1]] = m[3] ?? m[4] ?? '';
  return r;
}
const local = (n: string) => n.slice(n.indexOf(':') + 1);
/** attribute by local name (ignores the namespace prefix). */
const at = (a: Record<string, string>, name: string): string | undefined => {
  if (name in a) return a[name];
  for (const k in a) if (local(k) === name) return a[k];
  return undefined;
};
/** Every element <name ...> (any prefix) with its attributes and, for non-empty ones, its inner text. */
function* elements(xml: string, name: string, from = 0, to = xml.length): Generator<{ a: Record<string, string>; start: number; inner: [number, number] | null }> {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?=[\\s/>])`, 'g');
  re.lastIndex = from;
  for (let m; (m = re.exec(xml)) && m.index < to; ) {
    const end = xml.indexOf('>', m.index);
    if (end < 0) return;
    const head = xml.slice(m.index, end + 1);
    const selfClosing = head.endsWith('/>');
    let inner: [number, number] | null = null;
    if (!selfClosing) {
      const prefix = m[0].slice(1, m[0].length - name.length);
      const close = xml.indexOf(`</${prefix}${name}>`, end);
      inner = [end + 1, close < 0 ? to : close];
      re.lastIndex = close < 0 ? to : close;
    }
    yield { a: attrs(head), start: m.index, inner };
  }
}
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---------- painted colour (TriangleSelector serialisation) ----------
/** The colour that covers most of a painted triangle. The string is read from its end, one hex digit at a time:
 *  low 2 bits = number of split sides (0 = leaf), high 2 bits = state (3 = the next digit + 3). Children of a
 *  split cover (split sides + 1) equal shares. */
export function paintState(code: string): number {
  if (!code) return 0;
  let pos = code.length - 1;
  const next = () => (pos >= 0 ? parseInt(code[pos--], 16) || 0 : 0);
  const area = new Map<number, number>();
  const walk = (share: number) => {
    const d = next();
    const split = d & 3;
    if (split) {
      for (let c = 0; c <= split; c++) walk(share / (split + 1));
      return;
    }
    let st = d >> 2;
    if (st === 3) st = next() + 3;
    area.set(st, (area.get(st) ?? 0) + share);
  };
  try { walk(1); } catch { return 0; }
  let best = 0, bestA = 0;
  for (const [st, a] of area) if (a > bestA + 1e-9 || (Math.abs(a - bestA) < 1e-9 && st > best)) { best = st; bestA = a; }
  return best;
}

// ---------- reader ----------
interface ObjDef { a: Record<string, string>; body: [number, number] | null }
interface Doc { xml: string; objects: Map<string, ObjDef>; materials: Map<string, string[]> }

export async function parse3MF(buf: ArrayBuffer): Promise<ThreeMFResult> {
  const zip = await JSZip.loadAsync(buf);
  const find = (p: string) => {
    const key = p.replace(/^\//, '');
    return zip.file(key) ?? zip.file(Object.keys(zip.files).find((k) => k.toLowerCase() === key.toLowerCase()) ?? '\0');
  };
  const text = async (p: string) => { const f = find(p); return f ? f.async('text') : null; };

  // start part
  let rootPath = '3D/3dmodel.model';
  const rels = await text('_rels/.rels');
  if (rels) for (const r of elements(rels, 'Relationship')) if (/3dmodel$/i.test(r.a.Type ?? '') && r.a.Target) { rootPath = r.a.Target.replace(/^\//, ''); break; }

  // colours from the slicer's own project settings
  const filamentColors: string[] = [];
  const proj = await text('Metadata/project_settings.config');
  if (proj) {
    try {
      const j = JSON.parse(proj);
      const c = j.filament_colour ?? j.filament_color;
      if (Array.isArray(c)) filamentColors.push(...c.map(String));
    } catch { /* not JSON */ }
  }
  if (!filamentColors.length) {
    const prusa = await text('Metadata/Slic3r_PE.config');
    const m = prusa?.match(/;\s*extruder_colour\s*=\s*(.+)/);
    if (m) filamentColors.push(...m[1].split(';').map((s) => s.trim()).filter((s) => /^#/.test(s)));
  }

  const docs = new Map<string, Doc>();
  const load = async (path: string): Promise<Doc> => {
    const key = path.replace(/^\//, '').toLowerCase();
    const hit = docs.get(key);
    if (hit) return hit;
    const xml = await text(path);
    if (xml == null) throw new Error(`3MF is missing ${path.replace(/^\//, '')}`);
    const objects = new Map<string, ObjDef>();
    for (const o of elements(xml, 'object')) if (o.a.id) objects.set(o.a.id, { a: o.a, body: o.inner });
    const materials = new Map<string, string[]>();
    for (const g of elements(xml, 'basematerials')) if (g.a.id && g.inner) materials.set(g.a.id, [...elements(xml, 'base', ...g.inner)].map((b) => (b.a.displaycolor ?? '#808080').slice(0, 7)));
    for (const g of elements(xml, 'colorgroup')) if (g.a.id && g.inner) materials.set(g.a.id, [...elements(xml, 'color', ...g.inner)].map((b) => (b.a.color ?? '#808080').slice(0, 7)));
    const d = { xml, objects, materials };
    docs.set(key, d);
    return d;
  };
  const root = await load(rootPath);

  // per-object / per-part filament from the slicer's model settings (1-based there)
  const objFil = new Map<string, number>(), partFil = new Map<string, number>(), skipPart = new Set<string>(), objName = new Map<string, string>();
  const ms = (await text('Metadata/model_settings.config')) ?? (await text('Metadata/Slic3r_PE_model.config'));
  if (ms) {
    for (const o of elements(ms, 'object')) {
      if (!o.inner) continue;
      const id = o.a.id;
      const partRanges: [number, number][] = [];
      for (const p of elements(ms, 'part', ...o.inner)) {
        if (!p.inner) continue;
        partRanges.push(p.inner);
        // modifiers, negative volumes and support blockers / enforcers are not printed
        if (p.a.subtype && p.a.subtype !== 'normal_part') skipPart.add(`${id}/${p.a.id}`);
        for (const md of elements(ms, 'metadata', ...p.inner)) {
          if (md.a.key === 'name' && md.a.value) objName.set(id, unesc(md.a.value));
        if (md.a.key === 'extruder') { const v = +(md.a.value ?? 0); if (v > 0) partFil.set(`${id}/${p.a.id}`, v); }
          if (md.a.key === 'volume_type' && md.a.value && md.a.value !== 'ModelPart') skipPart.add(`${id}/${p.a.id}`);
        }
      }
      for (const md of elements(ms, 'metadata', ...o.inner)) {
        if (partRanges.some(([a, b]) => md.start >= a && md.start < b)) continue;
        if (md.a.key === 'name' && md.a.value) objName.set(id, unesc(md.a.value));
        if (md.a.key === 'extruder') { const v = +(md.a.value ?? 0); if (v > 0) objFil.set(id, v); }
      }
    }
  }

  // core-material colours become slots after the slicer's own ones
  const matSlot = new Map<string, number>();
  const slotOfColor = (c: string) => {
    const key = c.toLowerCase();
    let s = matSlot.get(key);
    if (s === undefined) {
      const k = filamentColors.findIndex((x) => x.toLowerCase().slice(0, 7) === key);
      s = k >= 0 ? k + 1 : (filamentColors.push(c), filamentColors.length);
      matSlot.set(key, s);
    }
    return s;
  };

  const result: ThreeMFObject[] = [];
  let anyColor = false;
  /** Adds the triangles of an object (and its components) to out. `slot` is the filament inherited from above (1-based, 0 = none). */
  const collect = async (doc: Doc, objectId: string, m: Mat, slot: number, top: string, pos: number[], col: number[]): Promise<string> => {
    const obj = doc.objects.get(objectId);
    if (!obj || !obj.body) return '';
    if (/^(other|support)$/.test(obj.a.type ?? '')) return '';
    if (skipPart.has(`${top}/${objectId}`)) return '';
    const [b0, b1] = obj.body;
    const pid = obj.a.pid, pindex = obj.a.pindex;
    const objMat = pid && doc.materials.has(pid) ? doc.materials.get(pid)![+(pindex ?? 0)] : undefined;
    const own = partFil.get(`${top}/${objectId}`) ?? (doc === root ? objFil.get(objectId) : undefined);
    const base = own ?? (objMat ? slotOfColor(objMat) : slot);
    const MRE = /<(?:[\w.-]+:)?(mesh|components)[\s>]/g;
    MRE.lastIndex = b0;
    const first = MRE.exec(doc.xml);
    if (first && first.index < b1 && first[1] === 'mesh') {
      const vEnd = doc.xml.indexOf('triangles', b0);
      const vs: number[] = [];
      const VRE = /<(?:[\w.-]+:)?vertex\s([^>]*)>/g;
      VRE.lastIndex = b0;
      for (let v; (v = VRE.exec(doc.xml)) && v.index < (vEnd < 0 ? b1 : vEnd); ) {
        const a = attrs(v[1]);
        vs.push(+a.x, +a.y, +a.z);
      }
      const TRE = /<(?:[\w.-]+:)?triangle\s([^>]*)>/g;
      TRE.lastIndex = vEnd < 0 ? b0 : vEnd;
      const tp: number[] = [0, 0, 0];
      for (let t; (t = TRE.exec(doc.xml)) && t.index < b1; ) {
        const a = attrs(t[1]);
        for (let c = 0; c < 3; c++) {
          const i = +a[`v${c + 1}`] * 3;
          const x = vs[i], y = vs[i + 1], z = vs[i + 2];
          tp[0] = x * m[0] + y * m[3] + z * m[6] + m[9];
          tp[1] = x * m[1] + y * m[4] + z * m[7] + m[10];
          tp[2] = x * m[2] + y * m[5] + z * m[8] + m[11];
          pos.push(tp[0], tp[1], tp[2]);
        }
        let c = 0;
        const paint = at(a, 'paint_color') ?? at(a, 'mmu_segmentation');
        if (paint) c = paintState(paint);
        else if (a.pid && doc.materials.has(a.pid)) { const g = doc.materials.get(a.pid)!; const hex = g[+(a.p1 ?? pindex ?? 0)]; if (hex) c = slotOfColor(hex); }
        if (!c) c = base;
        if (c) anyColor = true;
        col.push(Math.min(255, c));
      }
    }
    for (const comp of elements(doc.xml, 'component', b0, b1)) {
      const path = at(comp.a, 'path');
      const sub = path ? await load(path) : doc;
      await collect(sub, comp.a.objectid, mul(parseMat(comp.a.transform), m), base, top, pos, col);
    }
    return unesc(obj.a.name ?? '');
  };

  for (const it of elements(root.xml, 'item')) {
    if (it.a.printable === '0') continue;
    const id = it.a.objectid;
    const pos: number[] = [], col: number[] = [];
    anyColor = false;
    const name = objName.get(id) ?? (await collect(root, id, parseMat(it.a.transform), 0, id, pos, col));
    if (objName.has(id)) await collect(root, id, parseMat(it.a.transform), 0, id, pos, col);
    if (!pos.length) continue;
    const o: ThreeMFObject = { name: name || `Object ${result.length + 1}`, soup: new Float32Array(pos) };
    if (anyColor) {
      const used = new Set(col);
      if (used.size === 1) o.filament = Math.max(0, [...used][0] - 1);
      else o.color = Uint8Array.from(col);
    }
    result.push(o);
  }
  if (!result.length) throw new Error('3MF contains no printable meshes.');
  return { objects: result, filamentColors: filamentColors.map((c) => (/^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7) : '#808080')) };
}
