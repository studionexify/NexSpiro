import { zipSync, strToU8 } from "fflate";
import type { Plate } from "../../core/project.ts";
import { objectBody } from "../../core/project.ts";
import type { Mesh } from "../../core/mesh.ts";
import { tessellateBody, weld } from "./mesh.ts";
import { maskToPaintColor } from "../paintmap.ts";
import { bambuPlateOrigin } from "../importers/threemf.ts";

export type Export3MFInput = {
  plates: Plate[];
  meshes: Record<string, Mesh>;
  bed: [number, number];
  projectSettings?: Record<string, unknown>;  // Bambu project_settings.config (from toBambuSettings)
  nexspiroArchive?: Uint8Array;                // lossless NexSpiro project (.nexspiro v3) → Metadata/project.nexspiro
  thumbnails?: Uint8Array[];                   // PNG per plate (index = plate)
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const num = (v: number) => (Math.abs(v) < 1e-9 ? "0" : String(+v.toFixed(6)));

/** Core-spec 3MF + Bambu Studio metadata (plates, project settings) + NexSpiro extension file. */
export function export3MF(inp: Export3MFInput): Uint8Array {
  const objs: string[] = [], items: string[] = [], cfgObjects: string[] = [], cfgPlates: string[] = [];
  let id = 0;
  inp.plates.forEach((plate, pi) => {
    const [px, py] = bambuPlateOrigin(pi, inp.plates.length, inp.bed);
    const instances: string[] = [];
    for (const o of plate.objects) {
      const body = objectBody(o, inp.meshes);
      const src = o.source.kind === "mesh" ? inp.meshes[o.source.meshId] : tessellateBody(body, o.name);
      const paintColor = o.mask.regions.length ? maskToPaintColor(src, body, o.mask) : src.paint?.color ?? [];
      const { verts, idx } = weld(src.tris);
      const tri: string[] = [];
      for (let f = 0; f < idx.length / 3; f++) {
        let attrs = "";
        if (paintColor[f]) attrs += ` paint_color="${paintColor[f]}"`;
        if (src.paint?.supports?.[f]) attrs += ` paint_supports="${src.paint.supports[f]}"`;
        if (src.paint?.seam?.[f]) attrs += ` paint_seam="${src.paint.seam[f]}"`;
        tri.push(`<triangle v1="${idx[f * 3]}" v2="${idx[f * 3 + 1]}" v3="${idx[f * 3 + 2]}"${attrs}/>`);
      }
      const vtx: string[] = [];
      for (let i = 0; i < verts.length; i += 3) vtx.push(`<vertex x="${num(verts[i])}" y="${num(verts[i + 1])}" z="${num(verts[i + 2])}"/>`);
      id++;
      objs.push(`<object id="${id}" name="${esc(o.name)}" type="model"><mesh><vertices>${vtx.join("")}</vertices><triangles>${tri.join("")}</triangles></mesh></object>`);
      const t = o.transform, c = Math.cos((t.rotation * Math.PI) / 180), s = Math.sin((t.rotation * Math.PI) / 180);
      const m = [c * t.scaleXY, s * t.scaleXY, 0, -s * t.scaleXY, c * t.scaleXY, 0, 0, 0, t.scaleZ, px + inp.bed[0] / 2 + t.x, py + inp.bed[1] / 2 + t.y, 0];
      items.push(`<item objectid="${id}" transform="${m.map(num).join(" ")}" printable="1"/>`);
      cfgObjects.push(`<object id="${id}"><metadata key="name" value="${esc(o.name)}"/><metadata key="extruder" value="1"/><part id="1" subtype="normal_part"><metadata key="name" value="${esc(o.name)}"/></part></object>`);
      instances.push(`<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/></model_instance>`);
    }
    cfgPlates.push(`<plate><metadata key="plater_id" value="${pi + 1}"/><metadata key="plater_name" value="${esc(plate.name)}"/><metadata key="locked" value="${plate.locked}"/>${inp.thumbnails?.[pi] ? `<metadata key="thumbnail_file" value="Metadata/plate_${pi + 1}.png"/>` : ""}${instances.join("")}</plate>`);
  });
  if (!id) throw new Error("Nothing to export: all plates are empty");

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">NexSpiro (Studio Nexify)</metadata>
<metadata name="CreationDate">${new Date().toISOString().slice(0, 10)}</metadata>
<resources>${objs.join("\n")}</resources>
<build>${items.join("")}</build>
</model>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="config" ContentType="text/xml"/><Default Extension="json" ContentType="application/json"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>${inp.thumbnails?.[0] ? `<Relationship Target="/Metadata/plate_1.png" Id="rel1" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>` : ""}</Relationships>`),
    "3D/3dmodel.model": strToU8(model),
    "Metadata/model_settings.config": strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<config>${cfgObjects.join("")}${cfgPlates.join("")}</config>`),
  };
  if (inp.projectSettings) files["Metadata/project_settings.config"] = strToU8(JSON.stringify(inp.projectSettings, null, 2));
  if (inp.nexspiroArchive) files["Metadata/project.nexspiro"] = inp.nexspiroArchive;
  inp.thumbnails?.forEach((png, i) => { if (png) files[`Metadata/plate_${i + 1}.png`] = png; });
  return zipSync(files, { level: 6 });
}
