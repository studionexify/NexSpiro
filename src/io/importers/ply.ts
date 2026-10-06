import type { Mesh } from "../../core/mesh.ts";

/** Stanford PLY: ascii, binary_little_endian, binary_big_endian. Vertex colours (red/green/blue) are kept per corner. */
export function parsePLY(buf: ArrayBuffer, name = "ply"): Mesh {
  const bytes = new Uint8Array(buf);
  const headEnd = findHeaderEnd(bytes);
  const header = new TextDecoder().decode(bytes.subarray(0, headEnd)).split(/\r?\n/).map((l) => l.trim());
  if (header[0] !== "ply") throw new Error("Not a PLY file");
  let format = "";
  type Prop = { name: string; type: string; list?: { countType: string; itemType: string } };
  const elements: { name: string; count: number; props: Prop[] }[] = [];
  for (const l of header) {
    const p = l.split(/\s+/);
    if (p[0] === "format") format = p[1];
    else if (p[0] === "element") elements.push({ name: p[1], count: parseInt(p[2], 10), props: [] });
    else if (p[0] === "property") {
      const el = elements[elements.length - 1];
      if (!el) throw new Error("PLY property before element");
      if (p[1] === "list") el.props.push({ name: p[4], type: "list", list: { countType: p[2], itemType: p[3] } });
      else el.props.push({ name: p[2], type: p[1] });
    }
  }
  if (!["ascii", "binary_little_endian", "binary_big_endian"].includes(format)) throw new Error(`Unsupported PLY format ${format}`);

  const SIZES: Record<string, number> = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  let read: (type: string) => number;
  if (format === "ascii") {
    const tokens = new TextDecoder().decode(bytes.subarray(headEnd)).split(/\s+/).filter(Boolean);
    let t = 0;
    read = () => { if (t >= tokens.length) throw new Error("PLY: unexpected end of data"); return Number(tokens[t++]); };
  } else {
    const dv = new DataView(buf, headEnd), le = format === "binary_little_endian";
    let o = 0;
    read = (type) => {
      const size = SIZES[type]; if (!size) throw new Error(`PLY: unknown type ${type}`);
      if (o + size > dv.byteLength) throw new Error("PLY: unexpected end of data");
      let v: number;
      switch (type) {
        case "char": case "int8": v = dv.getInt8(o); break;
        case "uchar": case "uint8": v = dv.getUint8(o); break;
        case "short": case "int16": v = dv.getInt16(o, le); break;
        case "ushort": case "uint16": v = dv.getUint16(o, le); break;
        case "int": case "int32": v = dv.getInt32(o, le); break;
        case "uint": case "uint32": v = dv.getUint32(o, le); break;
        case "float": case "float32": v = dv.getFloat32(o, le); break;
        default: v = dv.getFloat64(o, le);
      }
      o += size; return v;
    };
  }

  let verts: Float64Array | null = null, cols: Float32Array | null = null;
  const tris: number[] = [], triCols: number[] = [];
  for (const el of elements) {
    if (el.name === "vertex") {
      verts = new Float64Array(el.count * 3);
      const ix = el.props.findIndex((p) => p.name === "x"), iy = el.props.findIndex((p) => p.name === "y"), iz = el.props.findIndex((p) => p.name === "z");
      const ir = el.props.findIndex((p) => p.name === "red"), ig = el.props.findIndex((p) => p.name === "green"), ib = el.props.findIndex((p) => p.name === "blue");
      if (ix < 0 || iy < 0 || iz < 0) throw new Error("PLY vertex lacks x/y/z");
      if (ir >= 0 && ig >= 0 && ib >= 0) cols = new Float32Array(el.count * 3);
      for (let i = 0; i < el.count; i++) {
        const vals = el.props.map((p) => readProp(p));
        verts[i * 3] = vals[ix] as number; verts[i * 3 + 1] = vals[iy] as number; verts[i * 3 + 2] = vals[iz] as number;
        if (cols) {
          const scale = /float|double/.test(el.props[ir].type) ? 1 : 1 / 255;
          cols[i * 3] = (vals[ir] as number) * scale; cols[i * 3 + 1] = (vals[ig] as number) * scale; cols[i * 3 + 2] = (vals[ib] as number) * scale;
        }
      }
    } else if (el.name === "face") {
      if (!verts) throw new Error("PLY faces before vertices");
      const li = el.props.findIndex((p) => p.list && /vertex_ind/.test(p.name));
      if (li < 0) throw new Error("PLY face lacks vertex_indices");
      const nv = verts.length / 3;
      for (let i = 0; i < el.count; i++) {
        const vals = el.props.map((p) => readProp(p));
        const idx = vals[li] as number[];
        for (const k of idx) if (!(k >= 0 && k < nv)) throw new Error(`PLY face index ${k} out of range`);
        for (let k = 1; k < idx.length - 1; k++) for (const vi of [idx[0], idx[k], idx[k + 1]]) {
          tris.push(verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]);
          if (cols) triCols.push(cols[vi * 3], cols[vi * 3 + 1], cols[vi * 3 + 2]);
        }
      }
    } else for (let i = 0; i < el.count; i++) el.props.forEach(readProp); // skip unknown elements
  }
  if (!tris.length) throw new Error("PLY contains no faces");
  return { name, tris: new Float32Array(tris), colors: cols ? new Float32Array(triCols) : undefined };

  function readProp(p: Prop): number | number[] {
    if (!p.list) return read(p.type);
    const n = read(p.list.countType), out: number[] = [];
    for (let k = 0; k < n; k++) out.push(read(p.list.itemType));
    return out;
  }
}

function findHeaderEnd(b: Uint8Array): number {
  const marker = "end_header";
  for (let i = 0; i < Math.min(b.length, 65536); i++) {
    let ok = true;
    for (let k = 0; k < marker.length && ok; k++) ok = b[i + k] === marker.charCodeAt(k);
    if (ok) {
      let j = i + marker.length;
      if (b[j] === 13) j++;
      if (b[j] === 10) j++;
      return j;
    }
  }
  throw new Error("PLY header has no end_header");
}
