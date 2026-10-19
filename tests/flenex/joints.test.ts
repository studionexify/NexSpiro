import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { boolean, bounds, cylinder, initKernel, minDistance, pieces, transform, volume, type V3 } from '../../src/plugins/flenex/csg';
import { buildFlexi, cutFrame, newCut } from '../../src/plugins/flenex/flexi';
import { defaultJoint, type JointKind } from '../../src/plugins/flenex/joints';
import { fitFor } from '../../src/plugins/flenex/fit';
import { openEdgeCount } from '../../src/engine/mesh';

beforeAll(initKernel);

/** Piece A is the one below the cut plane. */
const lower = (ps: ReturnType<typeof pieces>['meshes']) => ps.slice().sort((a, b) => bounds(a).max[2] - bounds(b).max[2]);

function rotateAbout(m: ReturnType<typeof cylinder>, pivot: THREE.Vector3, axis: THREE.Vector3, deg: number) {
  const M = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis.clone().normalize(), (deg * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  return transform(m, M);
}

describe('print-in-place joints', () => {
  for (const kind of ['ball', 'hinge', 'swivel'] as JointKind[]) for (const r of [9, 14]) {
    it(`${kind} in a Ø${2 * r} rod: closed, two pieces, clearance kept, moves through its range`, () => {
      const fit = fitFor(0.4);
      const body = cylinder(r, r, -45, 45, 48);
      const res = buildFlexi(body, [newCut('1', [0.3, 0.2, 0], [0, 0, 1], defaultJoint(kind))], fit);
      expect(res.reports[0].ok).toBe(true);
      expect(openEdgeCount(res.mesh)).toBe(0);
      expect(res.pieces.length).toBe(2);
      const [A, B] = lower(res.pieces);
      expect(volume(A)).toBeGreaterThan(0);
      expect(minDistance(A, B)).toBeGreaterThan(fit.clearance - 0.03);
      // articulate piece A about the joint pivot, to the range of motion the joint reports
      const info = res.reports[0].info!;
      const M = cutFrame(res.reports[0].centre, [0, 0, 1], 0);
      const pivot = new THREE.Vector3(...info.pivot).applyMatrix4(M);
      const axes: THREE.Vector3[] = info.axis
        ? [new THREE.Vector3(...info.axis).transformDirection(M)]
        : [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 1, 0)];
      const rom = kind === 'swivel' ? 80 : info.rom - 1.5; // swivel: twist about the spine
      for (const ax of axes) for (const sign of [1, -1]) {
        const moved = rotateAbout(A, pivot, ax, sign * rom);
        const hit = boolean(moved, B, 'intersection');
        expect(volume(hit), `${kind} ${sign * rom}° about ${ax.toArray().map((x) => x.toFixed(1))}`).toBeLessThan(0.05);
      }
    });
  }

  it('reports a section that is too thin instead of building a broken joint', () => {
    const res = buildFlexi(cylinder(1.6, 1.6, -20, 20, 24), [newCut('1', [0, 0, 0], [0, 0, 1])], fitFor(0.4));
    expect(res.reports[0].ok).toBe(false);
    expect(res.reports[0].warnings.length).toBeGreaterThan(0);
  });

  it('follows the nozzle: a 0.6 mm nozzle gets wider gaps', () => {
    expect(fitFor(0.6).clearance).toBeGreaterThan(fitFor(0.4).clearance);
    expect(fitFor(0.2).clearance).toBeLessThan(fitFor(0.4).clearance);
  });
});
