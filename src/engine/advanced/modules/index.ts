// Technology modules in pipeline order. Within a stage, earlier modules run first (and win the wall
// and infill hooks for the regions they claim).
import type { TechModule } from '../session';

export const MODULES: TechModule[] = [];
