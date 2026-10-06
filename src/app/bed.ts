// Build-plate rendering: draws the printer's bed (plate surface, frame, wiper bump, front tray, engraved labels, grid)
// into a canvas that is mapped onto the 3D bed. The look follows the selected printer and the selected plate type.
export type PlateType = "textured-pei" | "smooth-pei" | "cool" | "engineering" | "high-temp";
export const PLATE_TYPES: { id: PlateType; label: string; hint: string }[] = [
  { id: "textured-pei", label: "Textured PEI Plate", hint: "PLA, PETG, ABS · matte wall finish" },
  { id: "smooth-pei", label: "Smooth PEI Plate", hint: "PLA, PETG · glossy first layer" },
  { id: "cool", label: "Cool Plate", hint: "PLA · low bed temperature" },
  { id: "engineering", label: "Engineering Plate", hint: "PC, PA, ABS · glue stick" },
  { id: "high-temp", label: "High Temp Plate", hint: "PC, PA-CF, high bed temperature" },
];
export type Brand = "bambu" | "prusa" | "voron" | "creality" | "generic";
export const brandOf = (machineName: string, flavor = ""): Brand => {
  const n = machineName.toLowerCase();
  if (n.includes("bambu") || flavor === "bambu") return "bambu";
  if (n.includes("prusa")) return "prusa";
  if (n.includes("voron")) return "voron";
  if (n.includes("creality") || n.includes("ender") || /\bk1\b/.test(n)) return "creality";
  return "generic";
};
export const defaultPlateType = (machineName: string, flavor = ""): PlateType => (brandOf(machineName, flavor) === "bambu" ? "textured-pei" : "smooth-pei");
const plateLabel = (b: Brand, t: PlateType) => `${b === "bambu" ? "Bambu " : ""}${PLATE_TYPES.find((p) => p.id === t)!.label}`;

export type BedLook = {
  body: [string, string];  // plate surface gradient (back → front)
  grid: string; major: string; text: string;
  frame: string; frameEdge: string; bump: string; tray: string; trayText: string;
  noise: number;           // speckle density (textured plates)
  enclosed: boolean;       // draws the frame + wiper bump + front tray
  label: string; model: string;
};
const PLATE_BODY: Record<PlateType, { body: [string, string]; grid: string; major: string; text: string; noise: number }> = {
  "textured-pei": { body: ["#3d4043", "#34373a"], grid: "rgba(255,255,255,.13)", major: "rgba(255,255,255,.22)", text: "rgba(255,255,255,.34)", noise: 1 },
  "smooth-pei": { body: ["#4a5058", "#3a3f46"], grid: "rgba(255,255,255,.12)", major: "rgba(255,255,255,.2)", text: "rgba(255,255,255,.3)", noise: 0 },
  cool: { body: ["#d3d6d9", "#c4c8cc"], grid: "rgba(40,45,52,.14)", major: "rgba(40,45,52,.24)", text: "rgba(40,45,52,.4)", noise: 0.25 },
  engineering: { body: ["#b9aea0", "#ab9f90"], grid: "rgba(40,30,20,.16)", major: "rgba(40,30,20,.26)", text: "rgba(80,40,10,.5)", noise: 0.4 },
  "high-temp": { body: ["#c9a96a", "#bb9a5a"], grid: "rgba(60,40,10,.18)", major: "rgba(60,40,10,.28)", text: "rgba(70,45,10,.5)", noise: 0.4 },
};
export function bedLook(machineName: string, flavor: string, plate: PlateType): BedLook {
  const brand = brandOf(machineName, flavor), p = PLATE_BODY[plate];
  const frame = brand === "voron" ? ["#b8bcc2", "#8e939a"] : brand === "prusa" ? ["#2b2b2b", "#111"] : brand === "creality" ? ["#33373d", "#1f2227"] : ["#2a2c2e", "#18191a"];
  const model = machineName.replace(/\s+0\.\d+.*$/, "").replace(/\s+\d{3}$/, "");
  return {
    ...p, frame: frame[0], frameEdge: frame[1], bump: brand === "voron" ? "#a2a7ae" : "#2f3133", enclosed: brand === "bambu" || brand === "voron" || brand === "prusa",
    tray: brand === "prusa" ? "#f26b1d" : brand === "voron" ? "#c8332c" : "#1d1e20", trayText: brand === "prusa" ? "#fff" : "rgba(255,255,255,.55)",
    label: brand === "prusa" ? "ORIGINAL PRUSA" : brand === "voron" ? "VORON DESIGN" : brand === "creality" ? "CREALITY" : plateLabel(brand, plate), model,
  };
}

export const BED_PAD = { top: 10, side: 14, bottom: 24 }; // mm of frame / tray / plate-number margin around the plate
export const bedCanvasSize = (bed: [number, number]) => ({ w: bed[0] + 2 * BED_PAD.side, h: bed[1] + BED_PAD.top + BED_PAD.bottom });

export type BedDraw = { bed: [number, number]; look: BedLook; plateNo: number; active: boolean; locked: boolean; accent: string; lockColor: string; ppm?: number; nozzle?: number };
export function drawBed(canvas: HTMLCanvasElement, d: BedDraw) {
  const { w, h } = bedCanvasSize(d.bed), ppm = d.ppm ?? Math.min(4, 3900 / Math.max(w, h));
  canvas.width = Math.round(w * ppm); canvas.height = Math.round(h * ppm);
  const g = canvas.getContext("2d")!, L = d.look, mm = (v: number) => v * ppm;
  const px = BED_PAD.side, py = BED_PAD.top, [bx, by] = d.bed;
  const rr = (x: number, y: number, ww: number, hh: number, r: number) => { g.beginPath(); g.roundRect(mm(x), mm(y), mm(ww), mm(hh), mm(r)); };
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (L.enclosed) { // frame around the plate + front tray
    const fx = px - 8, fy = py - 8, fw = bx + 16, fh = by + 8 + 8 + 9;
    const gr = g.createLinearGradient(0, mm(fy), 0, mm(fy + fh)); gr.addColorStop(0, L.frame); gr.addColorStop(1, L.frameEdge);
    rr(fx, fy, fw, fh, 7); g.fillStyle = gr; g.fill();
    // wiper bump at the back centre
    g.fillStyle = L.bump; g.beginPath();
    g.moveTo(mm(px + bx / 2 - 22), mm(fy + 0.5)); g.lineTo(mm(px + bx / 2 - 17), mm(fy - 5)); g.lineTo(mm(px + bx / 2 + 17), mm(fy - 5)); g.lineTo(mm(px + bx / 2 + 22), mm(fy + 0.5)); g.closePath(); g.fill();
    // front tray strip with the printer model and nozzle
    rr(px + 6, py + by + 3.5, bx - 12, 8.5, 3); g.fillStyle = L.tray; g.fill();
    g.fillStyle = L.trayText; g.textBaseline = "middle"; g.font = `600 ${mm(4.2)}px system-ui, sans-serif`; g.textAlign = "left";
    g.fillText(L.model.toUpperCase(), mm(px + 12), mm(py + by + 7.8)); g.textAlign = "right";
    g.fillText(`⌀ ${(d.nozzle ?? 0.4).toFixed(1)}`, mm(px + bx - 12), mm(py + by + 7.8));
  } else { // open-frame printers: thin metal edge only
    rr(px - 2.5, py - 2.5, bx + 5, by + 5, 4); g.fillStyle = L.frameEdge; g.fill();
  }
  // plate surface
  const gp = g.createLinearGradient(0, mm(py), 0, mm(py + by)); gp.addColorStop(0, L.body[0]); gp.addColorStop(1, L.body[1]);
  rr(px, py, bx, by, 3); g.fillStyle = gp; g.fill();
  g.save(); rr(px, py, bx, by, 3); g.clip();
  if (L.noise > 0) { // fine powder-coat speckle
    let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const n = Math.round(bx * by * 0.5 * L.noise);
    for (let i = 0; i < n; i++) { g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.10)"; g.fillRect(mm(px + rnd() * bx), mm(py + rnd() * by), Math.max(1, ppm * 0.35), Math.max(1, ppm * 0.35)); }
  }
  g.lineWidth = Math.max(1, ppm * 0.18);
  for (let x = 10; x < bx; x += 10) { g.strokeStyle = x % 50 === 0 ? L.major : L.grid; g.beginPath(); g.moveTo(mm(px + x), mm(py)); g.lineTo(mm(px + x), mm(py + by)); g.stroke(); }
  for (let y = 10; y < by; y += 10) { g.strokeStyle = (by - y) % 50 === 0 ? L.major : L.grid; g.beginPath(); g.moveTo(mm(px), mm(py + y)); g.lineTo(mm(px + bx), mm(py + y)); g.stroke(); }
  // engraved plate name along the left edge (reads bottom → top, like the physical plate)
  g.save(); g.translate(mm(px + 9), mm(py + by / 2)); g.rotate(-Math.PI / 2);
  g.fillStyle = L.text; g.font = `600 ${mm(6)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(L.label, 0, 0); g.restore();
  g.restore();
  // active / locked outline
  if (d.locked || d.active) {
    g.lineWidth = mm(d.active ? 1.1 : 0.8); g.strokeStyle = d.locked ? d.lockColor : d.accent; if (d.locked) g.setLineDash([mm(3), mm(2)]);
    rr(px, py, bx, by, 3); g.stroke(); g.setLineDash([]);
  }
  if (!d.active) { rr(px - (L.enclosed ? 8 : 2.5), py - (L.enclosed ? 8 : 2.5), bx + (L.enclosed ? 16 : 5), by + (L.enclosed ? 25 : 5), 7); g.fillStyle = "rgba(245,244,240,.5)"; g.fill(); }
  // plate number, bottom right
  g.font = `800 ${mm(13)}px system-ui, sans-serif`; g.textAlign = "right"; g.textBaseline = "alphabetic";
  g.fillStyle = d.active ? d.accent : "rgba(130,134,140,.9)"; g.fillText(String(d.plateNo).padStart(2, "0"), mm(px + bx), mm(py + by + (L.enclosed ? 22.5 : 20)));
}
