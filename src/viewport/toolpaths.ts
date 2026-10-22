// GPU toolpath renderer: one instanced box per extrusion move, built in the vertex shader.
import * as THREE from 'three';
import { AUX_STRIDE, MOVE_STRIDE } from '../engine/gcode';
import { FEATURE_ORDER, type FeatureType, type SliceOutput } from '../engine/types';
import type { ColorScheme } from '../state/store';

export const FEATURE_COLORS: Record<FeatureType, string> = {
  inner_wall: '#2ECC71',
  outer_wall: '#FF6B35',
  overhang_wall: '#1E56A0',
  sparse_infill: '#B8332A',
  internal_solid_infill: '#9B51E0',
  top_surface: '#EB5757',
  bottom_surface: '#8E44AD',
  bridge: '#2D9CDB',
  gap_infill: '#FFFFFF',
  ironing: '#F2C94C',
  skirt: '#27AE60',
  brim: '#27AE60',
  support: '#219653',
  support_interface: '#0652DD',
  prime_tower: '#6FCF97',
  wave_overhang: '#00BFA5',
  travel: '#1976D2',
};

const RAMP = ['#1A237E', '#1E5BD6', '#00BCD4', '#4CAF50', '#FFEB3B', '#FF9800', '#F44336'].map((c) => new THREE.Color(c));
export const RAMP_CSS = 'linear-gradient(90deg,#1A237E,#1E5BD6,#00BCD4,#4CAF50,#FFEB3B,#FF9800,#F44336)';

function ramp(t: number, out: THREE.Color) {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  return out.copy(RAMP[i]).lerp(RAMP[i + 1], x - i);
}

const vert = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec2 aWH;
attribute vec4 aColor;
attribute float aIdx;
uniform float uMin;
uniform float uMax;
uniform float uTopStart;
varying vec3 vColor;
varying vec3 vNormal;
varying float vDim;
void main() {
  if (aIdx < uMin || aIdx > uMax || aColor.a < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 d = aEnd - aStart;
  float len = length(d.xy);
  vec3 fwd = len > 1e-6 ? vec3(d.xy / len, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 side = vec3(-fwd.y, fwd.x, 0.0);
  vec3 up = vec3(0.0, 0.0, 1.0);
  float ext = aWH.x * 0.5;
  float t = position.x;
  vec3 p = aStart + fwd * (-ext + t * (len + 2.0 * ext)) + vec3(0.0, 0.0, d.z * t)
         + side * (position.y * aWH.x) + up * (position.z * aWH.y);
  vec3 n = fwd * normal.x + side * normal.y + up * normal.z;
  vNormal = normalize(normalMatrix * n);
  vColor = aColor.rgb;
  vDim = 0.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const frag = /* glsl */ `
varying vec3 vColor;
varying vec3 vNormal;
void main() {
  vec3 L = normalize(vec3(0.35, 0.45, 0.82));
  vec3 L2 = normalize(vec3(-0.6, -0.3, 0.4));
  float diff = max(dot(normalize(vNormal), L), 0.0) * 0.7 + max(dot(normalize(vNormal), L2), 0.0) * 0.25;
  vec3 n = normalize(vNormal);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * 0.18;
  gl_FragColor = vec4(vColor * (0.34 + diff) + spec, 1.0);
  #include <colorspace_fragment>
}`;

const lineVert = /* glsl */ `
attribute float aIdx;
uniform float uMin;
uniform float uMax;
varying float vHide;
void main() {
  vHide = (aIdx < uMin || aIdx > uMax) ? 1.0 : 0.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const lineFrag = /* glsl */ `
uniform vec3 uColor;
varying float vHide;
void main() {
  if (vHide > 0.5) discard;
  gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
}`;

/** One extrusion bead: x ∈ [0,1] along the move, a rounded (stadium) cross-section y ∈ [-0.5,0.5], z ∈ [-1,0]
 *  with the top of the bead at move z. Round normals make consecutive beads shade as one continuous strand. */
function unitBead(segs = 12): THREE.BufferGeometry {
  const P: number[] = [], N: number[] = [], I: number[] = [];
  const ring: [number, number, number, number][] = []; // y, z, ny, nz
  for (let k = 0; k < segs; k++) {
    const t = (k / segs) * Math.PI * 2;
    ring.push([0.5 * Math.cos(t), -0.5 + 0.5 * Math.sin(t), Math.cos(t), Math.sin(t)]);
  }
  for (let k = 0; k < segs; k++) {
    const [y0, z0, ny0, nz0] = ring[k], [y1, z1, ny1, nz1] = ring[(k + 1) % segs];
    const o = P.length / 3;
    P.push(0, y0, z0, 1, y0, z0, 1, y1, z1, 0, y1, z1);
    N.push(0, ny0, nz0, 0, ny0, nz0, 0, ny1, nz1, 0, ny1, nz1);
    I.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  for (const [x, nx] of [[0, -1], [1, 1]] as const) { // end caps
    const c = P.length / 3;
    P.push(x, 0, -0.5); N.push(nx, 0, 0);
    for (const [y, z] of ring) { P.push(x, y, z); N.push(nx, 0, 0); }
    for (let k = 0; k < segs; k++) { const p = c + 1 + k, q = c + 1 + ((k + 1) % segs); if (nx > 0) I.push(c, p, q); else I.push(c, q, p); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setIndex(I);
  return g;
}

export class ToolpathView {
  group = new THREE.Group();
  private extrude: THREE.Mesh | null = null;
  private travel: THREE.LineSegments | null = null;
  private extrIdx: Uint32Array = new Uint32Array(0); // move index of each instance
  private colorAttr: THREE.InstancedBufferAttribute | null = null;
  private uniforms = { uMin: { value: 0 }, uMax: { value: 0 }, uTopStart: { value: 0 } };
  private lineUniforms = { uMin: { value: 0 }, uMax: { value: 0 }, uColor: { value: new THREE.Color('#4FA3FF') } };
  nozzle: THREE.Mesh;
  result: SliceOutput | null = null;

  constructor() {
    const cone = new THREE.ConeGeometry(1.2, 4, 24);
    cone.rotateX(-Math.PI / 2);
    cone.translate(0, 0, 2);
    this.nozzle = new THREE.Mesh(cone, new THREE.MeshStandardMaterial({ color: '#FF5C8D', emissive: '#732553', transparent: true, opacity: 0.85 }));
    this.nozzle.visible = false;
    this.group.add(this.nozzle);
  }

  dispose() {
    for (const o of [this.extrude, this.travel]) if (o) { this.group.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    this.extrude = null; this.travel = null;
  }

  setResult(r: SliceOutput | null) {
    this.dispose();
    this.result = r;
    if (!r) return;
    const m = r.moves, f = r.moveFeatures, S = MOVE_STRIDE;
    const count = f.length;
    const travelId = FEATURE_ORDER.indexOf('travel');
    let ne = 0, nt = 0;
    for (let i = 1; i < count; i++) (f[i] === travelId ? nt++ : ne++);
    const start = new Float32Array(ne * 3), end = new Float32Array(ne * 3), wh = new Float32Array(ne * 2), idx = new Float32Array(ne);
    const tPos = new Float32Array(nt * 6), tIdx = new Float32Array(nt * 2);
    this.extrIdx = new Uint32Array(ne);
    let e = 0, t = 0;
    for (let i = 1; i < count; i++) {
      const a = (i - 1) * S, b = i * S;
      if (f[i] === travelId) {
        tPos.set([m[a], m[a + 1], m[a + 2], m[b], m[b + 1], m[b + 2]], t * 6);
        tIdx[t * 2] = i; tIdx[t * 2 + 1] = i;
        t++;
      } else {
        start.set([m[a], m[a + 1], m[a + 2]], e * 3);
        end.set([m[b], m[b + 1], m[b + 2]], e * 3);
        wh[e * 2] = m[b + 3]; wh[e * 2 + 1] = m[b + 4];
        idx[e] = i; this.extrIdx[e] = i;
        e++;
      }
    }
    const base = unitBead();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('normal', base.getAttribute('normal'));
    g.setAttribute('aStart', new THREE.InstancedBufferAttribute(start, 3));
    g.setAttribute('aEnd', new THREE.InstancedBufferAttribute(end, 3));
    g.setAttribute('aWH', new THREE.InstancedBufferAttribute(wh, 2));
    g.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idx, 1));
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(ne * 4), 4);
    g.setAttribute('aColor', this.colorAttr);
    g.instanceCount = ne;
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms });
    this.extrude = new THREE.Mesh(g, mat);
    this.extrude.frustumCulled = false;
    this.group.add(this.extrude);

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    lg.setAttribute('aIdx', new THREE.BufferAttribute(tIdx, 1));
    this.travel = new THREE.LineSegments(lg, new THREE.ShaderMaterial({ vertexShader: lineVert, fragmentShader: lineFrag, uniforms: this.lineUniforms }));
    this.travel.frustumCulled = false;
    this.travel.visible = false;
    this.group.add(this.travel);
  }

  /** Recolour by scheme; returns legend range for continuous schemes. */
  colorize(scheme: ColorScheme, hidden: Set<string>, slotColors: string[] = []): { min: number; max: number; unit: string; log?: boolean } | null {
    const r = this.result;
    if (!r || !this.colorAttr) return null;
    const m = r.moves, f = r.moveFeatures, S = MOVE_STRIDE, aux = r.moveAux;
    const arr = this.colorAttr.array as Float32Array;
    const c = new THREE.Color();
    const feats = FEATURE_ORDER.map((k) => new THREE.Color(FEATURE_COLORS[k]));
    // layer time lookup
    let layerOf: Float32Array | null = null;
    if (scheme === 'layer_time' || scheme === 'layer_time_log') {
      layerOf = new Float32Array(f.length);
      for (const L of r.layers) for (let i = L.moveStart; i < L.moveEnd; i++) layerOf[i] = L.time;
    }
    const val = (i: number): number => {
      const b = i * S;
      switch (scheme) {
        case 'speed': return m[b + 5];
        case 'height': return m[b + 4];
        case 'width': return m[b + 3];
        case 'flow': return m[b + 5] * m[b + 3] * m[b + 4];
        case 'layer_time': return layerOf![i];
        case 'layer_time_log': return Math.log(Math.max(0.01, layerOf![i]));
        case 'fan': return aux ? aux[i * AUX_STRIDE] : 0;
        case 'temperature': return aux ? aux[i * AUX_STRIDE + 1] : 0;
        default: return 0;
      }
    };
    let min = Infinity, max = -Infinity;
    if (scheme !== 'feature' && scheme !== 'filament') {
      for (const i of this.extrIdx) { const v = val(i); if (v < min) min = v; if (v > max) max = v; }
    }
    const span = max - min || 1;
    const slots = slotColors.map((c) => new THREE.Color(c));
    for (let k = 0; k < this.extrIdx.length; k++) {
      const i = this.extrIdx[k];
      const feat = FEATURE_ORDER[f[i]];
      if (scheme === 'filament') c.copy(feat === 'prime_tower' ? feats[f[i]] : slots[Math.min(m[i * S + 7], slots.length - 1)] ?? feats[f[i]]);
      else if (scheme === 'feature') c.copy(feats[f[i]]);
      else ramp((val(i) - min) / span, c);
      arr[k * 4] = c.r; arr[k * 4 + 1] = c.g; arr[k * 4 + 2] = c.b;
      arr[k * 4 + 3] = hidden.has(feat) ? 0 : 1;
    }
    this.colorAttr.needsUpdate = true;
    if (scheme === 'feature' || scheme === 'filament') return null;
    const unit = { speed: 'mm/s', height: 'mm', width: 'mm', flow: 'mm³/s', layer_time: 's', layer_time_log: 's', fan: '%', temperature: '°C' }[scheme];
    // the log scale is coloured in log space but labelled in seconds
    if (scheme === 'layer_time_log') return { min: Math.exp(min), max: Math.exp(max), unit, log: true };
    return { min, max, unit };
  }

  setRange(lo: number, hi: number, cursor: number) {
    const r = this.result;
    if (!r || !r.layers.length) return;
    const L0 = r.layers[Math.max(0, Math.min(lo, r.layers.length - 1))];
    const L1 = r.layers[Math.max(0, Math.min(hi, r.layers.length - 1))];
    const maxIdx = cursor >= 0 ? Math.min(L1.moveEnd - 1, L1.moveStart + cursor) : L1.moveEnd - 1;
    this.uniforms.uMin.value = L0.moveStart; this.uniforms.uMax.value = maxIdx;
    this.lineUniforms.uMin.value = L0.moveStart; this.lineUniforms.uMax.value = maxIdx;
    if (cursor >= 0 && maxIdx >= 0) {
      const b = maxIdx * MOVE_STRIDE;
      this.nozzle.position.set(r.moves[b], r.moves[b + 1], r.moves[b + 2]);
      this.nozzle.visible = true;
    } else this.nozzle.visible = false;
  }

  showTravel(v: boolean) { if (this.travel) this.travel.visible = v; }
}
