// Technology modules in pipeline order. Within a stage, earlier modules run first (and win the wall
// and infill hooks for the regions they claim).
import type { TechModule } from '../session';
import { harmonicDome } from './harmonicDome';
import { sgdSlicing } from './sgdSlicing';
import { eikonalOffsets } from './eikonal';
import { conformalLayers } from './conformal';

export const MODULES: TechModule[] = [
  // layer plan (curved layers): dome field first, SGD refines it
  harmonicDome, sgdSlicing,
  // walls
  eikonalOffsets,
  // toolpath passes
  conformalLayers,
];
