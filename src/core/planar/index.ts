export * from "./types.ts";
export { planPrint, type SupportContext, type SupportCallback } from "./plan.ts";
export { sliceMesh, type SliceOpts } from "./slice.ts";
export * from "./geom.ts";
export { fillPolys, orderLines, bridgeAngle, scanSpans, type FillLine, type FillOpts } from "./infill.ts";
export { buildWallGeom, type WallGeom, type WallParams } from "./perimeters.ts";
export { computeRegions, type LayerRegions, type ShellParams } from "./shells.ts";
export { makeBrim, skirtRings, concentricRings } from "./skirt.ts";
