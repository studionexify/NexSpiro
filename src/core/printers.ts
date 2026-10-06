import type { Flavor } from "./gcode.ts";

// zWobbleMax: max in-layer Z excursion (mm) the printer's nozzle/hotend geometry tolerates
// before the nozzle body or shroud drags across the previous layer.
export type PrinterProfile = {
  id: string; name: string; flavor: Flavor;
  bed: [number, number]; maxHeight: number;
  nozzle: number; zWobbleMax: number; maxVolumetric: number; // mm³/s
};

export const printers: PrinterProfile[] = [
  { id: "bambu-x1", name: "Bambu Lab X1/P1", flavor: "bambu", bed: [256, 256], maxHeight: 250, nozzle: 0.4, zWobbleMax: 0.5, maxVolumetric: 21 },
  { id: "bambu-a1", name: "Bambu Lab A1", flavor: "bambu", bed: [256, 256], maxHeight: 256, nozzle: 0.4, zWobbleMax: 0.5, maxVolumetric: 21 },
  { id: "voron-24", name: "Voron 2.4 (Klipper)", flavor: "klipper", bed: [300, 300], maxHeight: 280, nozzle: 0.4, zWobbleMax: 1.0, maxVolumetric: 24 },
  { id: "creality-k1", name: "Creality K1 (Klipper)", flavor: "klipper", bed: [220, 220], maxHeight: 250, nozzle: 0.4, zWobbleMax: 0.6, maxVolumetric: 20 },
  { id: "ender3", name: "Ender 3 (Marlin)", flavor: "marlin", bed: [220, 220], maxHeight: 250, nozzle: 0.4, zWobbleMax: 0.8, maxVolumetric: 12 },
  { id: "prusa-mk4", name: "Prusa MK4 (Marlin)", flavor: "marlin", bed: [250, 210], maxHeight: 220, nozzle: 0.4, zWobbleMax: 0.7, maxVolumetric: 15 },
];
export const printerById = (id: string) => printers.find((p) => p.id === id) ?? printers[0];
