// Technology modules in pipeline order. Within a stage, earlier modules run first (and win the wall
// and infill hooks for the regions they claim).
import type { TechModule } from '../session';
import { harmonicDome } from './harmonicDome';
import { sgdSlicing } from './sgdSlicing';
import { eikonalOffsets } from './eikonal';
import { conformalLayers } from './conformal';
import { thickVase } from './thickVase';
import { eulerianSpiral } from './eulerianSpiral';
import { tangentEntry, scarfSplice } from './seams';
import { conformalIroning, perimeterFeathering, subvoxelAA } from './surfacePasses';
import { knotBraiding, zWeave } from './weave';

export const MODULES: TechModule[] = [
  // layer plan (curved layers): dome field first, SGD refines it
  harmonicDome, sgdSlicing,
  // walls, then wall post-edits
  eikonalOffsets, knotBraiding,
  // infill: helical bands claim their regions first
  thickVase, eulerianSpiral,
  // toolpath passes, in order: surfaces, helix, interlocking, seams, final burnishing
  conformalLayers, subvoxelAA, perimeterFeathering, zWeave, tangentEntry, scarfSplice, conformalIroning,
];
