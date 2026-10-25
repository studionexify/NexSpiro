// Renders a plugin's thick-thread preview: one instanced bead per move at the real line width and layer
// height (the same bead shader as the sliced toolpath view), plus hot teardrop drips where the
// overhang check says plastic would run off. See src/plugins/threads.ts.
import * as THREE from 'three';
import { BEAD_FRAG, BEAD_VERT, unitBead } from './toolpaths';
import type { ThreadData } from '../plugins/threads';

const DRIP_SIDES = 8;

/** A hanging teardrop (neck, then a round bulb) of length len and bulb radius r, top at z = 0, pointing down. Returns [z (down is negative), radius] pairs. */
function dropProfile(len: number, r: number): [number, number][] {
  const bulb = Math.min(len * 0.6, r * 2.1);
  return [[0, r * 0.95], [-len * 0.18, r * 0.6], [-(len - bulb) * 0.6, r * 0.4], [-(len - bulb), r * 0.42], [-(len - bulb * 0.7), r * 0.85], [-(len - bulb * 0.3), r * 1.05], [-(len - bulb * 0.06), r * 0.62], [-len, 0]];
}

/** All the drips as one merged mesh, coloured from the filament towards hot orange at the tip. */
function buildDrips(d: Float32Array, rgb: Float32Array): THREE.BufferGeometry {
  const n = d.length / 5;
  const P: number[] = [], C: number[] = [], I: number[] = [];
  for (let k = 0; k < n; k++) {
    const x = d[k * 5], y = d[k * 5 + 1], z = d[k * 5 + 2], len = d[k * 5 + 3], r = d[k * 5 + 4];
    const prof = dropProfile(len, r);
    const base = P.length / 3;
    prof.forEach(([dz, rad], j) => {
      const hot = 0.2 + 0.8 * (j / (prof.length - 1));
      for (let s = 0; s < DRIP_SIDES; s++) {
        const a = (s / DRIP_SIDES) * Math.PI * 2;
        P.push(x + Math.cos(a) * rad, y + Math.sin(a) * rad, z + dz);
        C.push(rgb[k * 3] + (1 - rgb[k * 3]) * hot * 0.25, rgb[k * 3 + 1] + (0.55 - rgb[k * 3 + 1]) * hot * 0.5, rgb[k * 3 + 2] + (0.18 - rgb[k * 3 + 2]) * hot * 0.6);
      }
    });
    for (let j = 0; j < prof.length - 1; j++) for (let s = 0; s < DRIP_SIDES; s++) {
      const a = base + j * DRIP_SIDES + s, b = base + j * DRIP_SIDES + ((s + 1) % DRIP_SIDES), c = a + DRIP_SIDES, e = b + DRIP_SIDES;
      I.push(a, c, b, b, c, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

export class ThreadMesh {
  readonly group = new THREE.Group();
  private beads: THREE.Mesh | null = null;
  private drips: THREE.Mesh | null = null;
  private uniforms = { uMin: { value: -1 }, uMax: { value: 1e9 }, uTopStart: { value: 0 } };

  dispose() {
    for (const o of [this.beads, this.drips]) if (o) { this.group.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    this.beads = null; this.drips = null;
  }

  set(t: ThreadData | null) {
    this.dispose();
    if (!t || !t.wh.length) return;
    const n = t.wh.length / 2;
    const base = unitBead();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('normal', base.getAttribute('normal'));
    g.setAttribute('aStart', new THREE.InstancedBufferAttribute(t.start, 3));
    g.setAttribute('aEnd', new THREE.InstancedBufferAttribute(t.end, 3));
    g.setAttribute('aWH', new THREE.InstancedBufferAttribute(t.wh, 2));
    g.setAttribute('aIdx', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    const rgba = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { rgba[i * 4] = t.color[i * 3]; rgba[i * 4 + 1] = t.color[i * 3 + 1]; rgba[i * 4 + 2] = t.color[i * 3 + 2]; rgba[i * 4 + 3] = 1; }
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(rgba, 4));
    g.instanceCount = n;
    this.beads = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: BEAD_VERT, fragmentShader: BEAD_FRAG, uniforms: this.uniforms }));
    this.beads.frustumCulled = false;
    this.beads.renderOrder = 4;
    this.group.add(this.beads);
    if (t.drips.length) {
      this.drips = new THREE.Mesh(buildDrips(t.drips, t.dripColor), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0, emissive: new THREE.Color('#ff5a14'), emissiveIntensity: 0.28 }));
      this.drips.frustumCulled = false;
      this.drips.renderOrder = 4;
      this.group.add(this.drips);
    }
  }
}
