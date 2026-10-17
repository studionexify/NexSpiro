// Derived Advanced-mode data for the UI: machine capabilities and the resolved technology list,
// computed with the same functions the slicing worker uses.
import { useMemo } from 'react';
import { machineCaps } from '../../engine/advanced/machine';
import { resolveTechs } from '../../engine/advanced/techs';
import { filamentById } from '../../profiles/filaments';
import { resolveConfig } from '../../profiles/resolve';
import { useAdvanced } from '../../state/advanced';
import { useStore } from '../../state/store';

export function useCaps() {
  const s = useStore();
  const machine = useAdvanced((a) => a.machine);
  return useMemo(() => {
    const cfg = resolveConfig({ printerId: s.printerId, plate: s.plate, filamentId: s.filaments[0].presetId, presetId: s.presetId, overrides: s.overrides, machineOverrides: s.machineOverrides });
    return { caps: machineCaps(s.printerId, cfg, machine), cfg };
  }, [s.printerId, s.plate, s.filaments, s.presetId, s.overrides, s.machineOverrides, machine]);
}

export function useResolved() {
  const { caps, cfg } = useCaps();
  const a = useAdvanced();
  const objects = useStore((s) => s.objects);
  const filaments = useStore((s) => s.filaments);
  return useMemo(() => {
    const used = new Set<number>();
    for (const o of objects) { used.add(o.filament ?? 0); o.paint?.color?.forEach((c) => { if (c) used.add(c - 1); }); }
    return resolveTechs({ intent: a.intent, printerId: caps.printerId, techs: a.techs, machine: a.machine }, {
      caps, filamentType: filamentById(filaments[0].presetId).type, materials: used.size,
      wallLoops: Math.round(Number(cfg.wall_loops ?? 2)), hasCaustic: !!a.caustic?.pixels.length,
    });
  }, [caps, cfg, a.intent, a.techs, a.machine, a.caustic, objects, filaments]);
}
