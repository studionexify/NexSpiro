import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { builtinPattern, newPlacement } from '../../src/plugins/patternex';
import { createPatternexState, defaultActions, savePatternexState, toPatternexConfig, toWorldPlacements, type ObjPlacement } from '../../src/plugins/patternex/ui/state';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const pat = builtinPattern('checker');
const place = (o: Partial<ObjPlacement> = {}): ObjPlacement => ({ ...newPlacement('a', pat, 'o1:0', [0, 10, 5], [0, 1, 0]), object_id: 'o1', ...o });

describe('Patternex UI state', () => {
  it('follows the object: local placement → plate coordinates with rotation, translation and scale', () => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(100, 50, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(2, 1, 1));
    const [w] = toWorldPlacements([place()], [{ id: 'o1', matrix: m.elements }]);
    // local (0,10,5) → scale (0,10,5) → rotate 90° about Z (-10,0,5) → +(100,50,0)
    expect(w.position_xyz.map((v) => +v.toFixed(6))).toEqual([90, 50, 5]);
    // the +Y face normal turns to -X
    expect(w.projection_axis.map((v) => +v.toFixed(6))).toEqual([-1, 0, 0]);
    expect(w.object).toBe(0);
  });

  it('non-uniform scale keeps normals perpendicular to the surface', () => {
    const m = new THREE.Matrix4().makeScale(4, 1, 1);
    const [w] = toWorldPlacements([place({ projection_axis: [Math.SQRT1_2, Math.SQRT1_2, 0] })], [{ id: 'o1', matrix: m.elements }]);
    // a 45° face stretched 4× in X leans towards Y: normal ∝ (1/4, 1, 0)
    expect(w.projection_axis[1] / w.projection_axis[0]).toBeCloseTo(4, 6);
  });

  it('hidden placements and missing objects are left out; config only carries what is used', () => {
    const s = createPatternexState(null);
    s.patterns.push(pat, builtinPattern('dots'));
    s.placements.push(place(), place({ id: 'b', visible: false }), place({ id: 'c', object_id: 'gone' }));
    s.actions.push(...defaultActions('a', pat, 3), ...defaultActions('b', pat, 3));
    const c = toPatternexConfig(s, [{ id: 'o1', matrix: new THREE.Matrix4().elements }])!;
    expect(c.placements.map((p) => p.id)).toEqual(['a']);
    expect(c.patterns.map((p) => p.id)).toEqual([pat.id]);
    expect(c.actions.every((a) => a.region_ref.placement_id === 'a')).toBe(true);
    expect(toPatternexConfig(createPatternexState(null), [])).toBeUndefined();
  });

  it('default actions: the first colour stays base, others take slots 2, 3…; one colour goes on slot 2', () => {
    expect(defaultActions('a', pat, 3).map((a) => [a.region_ref.color_group, a.material.slot_index])).toEqual([['#000000', 1]]);
    expect(defaultActions('a', builtinPattern('dots'), 3).map((a) => a.material.slot_index)).toEqual([1]);
    expect(defaultActions('a', pat, 1)).toEqual([]);
  });

  it('persists and restores (without the armed pattern)', () => {
    const store = mem();
    const s = createPatternexState(store);
    s.patterns.push(pat); s.placements.push(place()); s.armed = pat.id; s.singleColour = 'band';
    savePatternexState(s, store);
    const r = createPatternexState(store);
    expect(r.placements.length).toBe(1);
    expect(r.singleColour).toBe('band');
    expect(r.armed).toBeNull();
  });
});

describe('Patternex in project files', () => {
  it('round-trips placements, patterns and actions; drops placements on missing objects', async () => {
    const { projectData, restoreProject } = await import('../../src/plugins/patternex/ui/state');
    const s = createPatternexState(null);
    s.patterns.push(pat, builtinPattern('hex'));
    s.placements.push(place(), place({ id: 'z', object_id: 'gone' }));
    s.actions.push(...defaultActions('a', pat, 3), ...defaultActions('z', pat, 3));
    s.singleColour = 'band'; s.transitionVolume = [30, null];
    const d = JSON.parse(JSON.stringify(projectData(s)));
    expect(d.patterns.map((p: { id: string }) => p.id)).toEqual([pat.id]); // only used patterns are saved
    const r = createPatternexState(null);
    r.placements.push(place({ id: 'old' }));
    restoreProject(r, d, ['o1']);
    expect(r.placements.map((p) => p.id)).toEqual(['a']);
    expect(r.actions.every((a) => a.region_ref.placement_id === 'a')).toBe(true);
    expect(r.singleColour).toBe('band');
    expect(r.transitionVolume).toEqual([30, null]);
    expect(projectData(createPatternexState(null))).toBeUndefined();
    restoreProject(r, undefined, ['o1']); // a project without Patternex clears placements
    expect(r.placements).toEqual([]);
  });
});
