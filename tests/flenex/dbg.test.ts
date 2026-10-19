import { beforeAll, it } from 'vitest';
import { initKernel } from '../../src/plugins/flenex/csg';
import { autoCuts, buildCreature, keepOut } from '../../src/plugins/flenex/creature';
import { PRESETS, designFromPreset } from '../../src/plugins/flenex/presets';
beforeAll(initKernel);
it('ko', () => {
  for (const id of ['turtle', 'frog']) {
    const d = designFromPreset(PRESETS.find((p) => p.id === id)!);
    const b = buildCreature(d);
    console.log(id, 'L', d.body.length, 'from', d.segments.from * d.body.length, 'to', d.segments.to * d.body.length, JSON.stringify(keepOut(d, b.stations).map((x) => x.map((v) => Math.round(v)))), autoCuts(d, b.stations).length);
  }
});
