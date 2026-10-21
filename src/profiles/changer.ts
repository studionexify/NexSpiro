// How a printer changes filament, from its machine settings. One place, so the slicer, the plugins and
// the panels agree:
//   ams          one nozzle, filaments swapped by a unit (Bambu AMS, MMU, CFS, ACE): purge on every change
//   toolchanger  one nozzle per filament (Prusa XL, Snapmaker U1, Klipper tool changers, IDEX): the next
//                head is picked up already loaded, so no purge, only a small prime and a few seconds
//   manual       one nozzle, the printer pauses (M600) and someone swaps the spool
import type { Config } from './settings';

export type ChangerKind = 'ams' | 'toolchanger' | 'manual';

export function changerOf(cfg: Config | undefined): ChangerKind {
  const t = String(cfg?.changer_type ?? '');
  if (t === 'toolchanger' || t === 'ams' || t === 'manual') return t;
  return cfg?.has_ams === true ? 'ams' : 'manual';
}

/** Filament changes happen without anyone at the printer. */
export const autoChanges = (cfg: Config | undefined) => changerOf(cfg) !== 'manual';

/** Toolheads on a tool changer (1 for every other printer). */
export const toolheadCount = (cfg: Config | undefined) => (changerOf(cfg) === 'toolchanger' ? Math.max(1, Math.round(Number(cfg?.toolhead_count) || 1)) : 1);

/** Short label for the printer's filament change, for panels and badges. */
export function changerLabel(cfg: Config | undefined): string {
  const k = changerOf(cfg);
  return k === 'toolchanger' ? `${toolheadCount(cfg)} toolheads` : k === 'ams' ? 'AMS' : 'Manual';
}
