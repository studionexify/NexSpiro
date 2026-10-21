// Lace before slicing: the print settings an openwork wall needs.
import type { LaceSettings } from './model';

/**
 * Two walls (strands of two lines are strong enough to handle), no infill or top skin inside the band,
 * a solid floor, spiral vase off. Inner walls get the same holes when lace goes on every wall.
 */
export function lacePrintSettings(l: LaceSettings): Record<string, string | number | boolean> {
  return {
    spiral_mode: false, wall_loops: l.walls === 'all' ? 2 : 1, sparse_infill_density: 0, top_shell_layers: 0, top_shell_thickness: 0, bottom_shell_layers: 4,
    seam_position: 'aligned', seam_slope_type: 'none',
    // every hole is a travel: keep retraction short and quick, no Z hop over the wall
    z_hop: 0, wipe: false,
  };
}
