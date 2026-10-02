import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeWheel, type VehicleModel } from './ModelKit';
import { MAT, paint } from './Materials';
import { loft, ring, lerpK, type Sec, type Tag } from './Z350Builder';

/**
 * Tesler (the player's electric liftback), modelled for likeness of the reference photos: a smooth, grille-less nose
 * with a low black intake, slim swept headlamps lying on the fender tops, thin corner slits, a small badge on the
 * lip, a glass roof and a full width tail. Length 4.98 m, width 2.04 m with mirrors, height 1.43 m, wheelbase 2.88 m.
 * Every detail sits clear of its neighbours by a few millimetres so nothing z-fights.
 */
const L = 4.98, F = L / 2, R = -F;
const AX_F = 1.46, AX_R = -1.42, WR = 0.35, WX = 0.8, G = 0.14;
// keys run from the nose (+z) to the tail (-z)
const DECK: [number, number][] = [[F, 0.6], [2.46, 0.68], [2.3, 0.79], [2.0, 0.87], [1.6, 0.95], [1.2, 1.0], [0.9, 1.02], [0.5, 1.01], [0, 1.0], [-1.0, 1.0], [-1.8, 1.0], [-2.3, 0.99], [-2.42, 0.95], [R, 0.9]];
const HW: [number, number][] = [[F, 0.64], [2.46, 0.77], [2.35, 0.87], [2.1, 0.935], [1.7, 0.965], [1.0, 0.975], [0, 0.97], [-1.0, 0.975], [-1.8, 0.965], [-2.2, 0.935], [-2.42, 0.86], [R, 0.72]];
const ROOF: [number, number][] = [[1.0, 1.02], [0.75, 1.15], [0.45, 1.3], [0.15, 1.4], [-0.2, 1.43], [-0.7, 1.42], [-1.2, 1.36], [-1.6, 1.25], [-2.0, 1.12], [-2.28, 1.04]];

const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.4, roughness: 0.35 });

export function buildTesler(color: number, shadows = true): VehicleModel {
  const out = new Map<Tag, number[]>();
  const push = (tag: Tag, a: ArrayLike<number>) => { let t = out.get(tag); if (!t) out.set(tag, (t = [])); for (let i = 0; i < a.length; i++) t.push(a[i]); };
  const addGeo = (tag: Tag, g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; push(tag, n.attributes.position.array as Float32Array); };
  const box = (tag: Tag, x: number, y: number, z: number, w: number, h: number, d: number) => addGeo(tag, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const ball = (tag: Tag, x: number, y: number, z: number, rx: number, ry: number, rz: number) => addGeo(tag, new THREE.SphereGeometry(1, 18, 12).scale(rx, ry, rz).translate(x, y, z));

  /** a patch lying on the body surface: spans xin..xout (functions of z) from z0 to z1, following the deck so nothing sticks out */
  const lampOn = (tag: Tag, sx: number, z0: number, z1: number, xin: (z: number) => number, xout: (z: number) => number, lift = 0.02) => {
    const surf = (x: number, z: number) => { const hw = lerpK(HW, z), t = Math.min(1, Math.max(0, (x / hw - 0.6) / 0.355)); return lerpK(DECK, z) - 0.008 - 0.05 * t * t + lift; };
    const n = 16, rows: [number, number, number][][] = [];
    for (let i = 0; i <= n; i++) {
      const z = z0 + (z1 - z0) * (i / n), a = xin(z), b = xout(z);
      rows.push([0, 1, 2, 3, 4].map((k) => { const x = a + (b - a) * (k / 4); return [sx * x, surf(x, z) + (k === 0 || k === 4 ? -0.012 : 0), z] as [number, number, number]; }));
    }
    const tri: number[] = [];
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
      const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
      tri.push(...a, ...c, ...b, ...b, ...c, ...d, ...a, ...b, ...c, ...b, ...d, ...c);
    }
    push(tag, tri);
  };

  // ---- lower body: sections nose to tail, with real wheel arches ----
  const N = 110, secs: Sec[] = [];
  for (let q = 0; q < N; q++) {
    const z = R + 0.01 + (q / (N - 1)) * (L - 0.02);
    const hw = lerpK(HW, z), yTop = lerpK(DECK, z);
    const endT = Math.min(F - z, z - R);
    const chin = G + 0.14 * Math.max(0, 1 - endT / 0.34);
    let arch = chin;
    for (const wz of [AX_F, AX_R]) { const dz = (z - wz) / (WR * 1.2); if (Math.abs(dz) < 1) arch = Math.max(arch, WR + Math.sqrt(1 - dz * dz) * WR * 0.85); }
    const belt = yTop - 0.17, inner = hw * 0.62;
    secs.push({ z, pts: ring([
      [0, chin, 'dark'], [inner, chin, 'dark'], [inner, arch, 'dark'], [hw, Math.min(arch, belt - 0.1), 'paint'], [hw, belt, 'paint'],
      [hw * 0.96, yTop - 0.05, 'paint'], [hw * 0.62, yTop - 0.008, 'paint'], [0, yTop, 'paint'],
    ]) });
  }
  loft(secs, out, 'paint', 'paint');

  // ---- greenhouse: windscreen, side glass, full glass roof, hatch glass ----
  const cab: Sec[] = [];
  const M = 50;
  for (let q = 0; q < M; q++) {
    const z = ROOF[ROOF.length - 1][0] + (q / (M - 1)) * (ROOF[0][0] - ROOF[ROOF.length - 1][0]);
    const top = lerpK(ROOF, z), base = lerpK(DECK, z) - 0.01, hw = lerpK(HW, z);
    const bw = hw * 0.9, k = Math.min(1, (top - base) / 0.4);
    const rw = bw * (0.9 - 0.3 * k), winTop = base + (top - base) * 0.8, bwm = bw - (bw - rw) * 0.55;
    const pts: [number, number, Tag][] = [[-bw, base, 'glass'], [-bwm, winTop, 'paint'], [-rw, top - 0.004, 'glass'], [0, top, 'glass'], [rw, top - 0.004, 'glass'], [bwm, winTop, 'glass'], [bw, base, 'dark']];
    cab.push({ z, pts });
  }
  loft(cab, out, 'glass', 'glass');

  // ---- front: slim swept headlamps, low black intake, corner slits, badge ----
  for (const sx of [1, -1]) {
    // dark housing a hair under the lamp, then the lamp: a thin crescent swept back along the fender
    lampOn('dark', sx, 2.47, 2.08, (z) => lerpK([[2.47, 0.63], [2.28, 0.61], [2.08, 0.7]], z), (z) => lerpK([[2.47, 0.89], [2.3, 0.91], [2.08, 0.85]], z), 0.012);
    lampOn('head', sx, 2.45, 2.11, (z) => lerpK([[2.45, 0.66], [2.28, 0.64], [2.11, 0.73]], z), (z) => lerpK([[2.45, 0.86], [2.3, 0.88], [2.11, 0.82]], z), 0.02);
    box('dark', sx * 0.64, 0.45, F - 0.006, 0.2, 0.03, 0.03); // thin corner slit
    box('dark', sx * (lerpK(HW, 0.1) + 0.012), 0.72, 0.1, 0.008, 0.014, 1.5); // door shut line
    box('dark', sx * (lerpK(HW, 0.3) + 0.011), 0.86, 0.3, 0.012, 0.03, 0.2); // flush handle
    ball('paint', sx * 1.0, 1.0, 0.82, 0.06, 0.07, 0.12); // mirror
    box('paint', sx * 0.9, 0.98, 0.84, 0.18, 0.05, 0.09); // stalk joining it to the door
  }
  box('dark', 0, 0.33, F - 0.006, 1.04, 0.14, 0.03); // wide low intake
  box('chrome', 0, 0.56, F - 0.004, 0.1, 0.035, 0.012); // badge on the lip

  // ---- rear: full width tail lamps either side of a black strip, thin spoiler lip, black valance ----
  for (const sx of [1, -1]) {
    box('tail', sx * 0.56, 0.8, R + 0.004, 0.5, 0.075, 0.03); // wrap tail lamp on the tailgate
    box('tail', sx * 0.72, 0.4, R - 0.006, 0.18, 0.04, 0.03); // lower reflector
  }
  box('dark', 0, 0.8, R + 0.002, 0.62, 0.03, 0.03); // black strip between the lamps
  box('dark', 0, 0.3, R - 0.006, 1.4, 0.2, 0.04); // valance
  box('paint', 0, 0.995, -2.3, 1.5, 0.03, 0.14); // boot lip

  // ---- meshes ----
  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);
  const matFor = (t: Tag): THREE.Material => t === 'paint' ? paint(color) : t === 'glass' ? MAT.glass : t === 'head' ? MAT.head : t === 'tail' ? MAT.tailOff : t === 'chrome' ? MAT.chrome : t === 'carbon' ? carbonMat : MAT.trim;
  let body: THREE.Mesh | undefined;
  const brake: THREE.Mesh[] = [], heads: THREE.Mesh[] = [];
  for (const [tag, arr] of out) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g = toCreasedNormals(g, Math.PI / 3.2);
    const m = new THREE.Mesh(g, matFor(tag));
    m.name = tag; m.castShadow = shadows && tag !== 'glass';
    chassis.add(m);
    if (tag === 'paint') body = m;
    if (tag === 'tail') brake.push(m);
    if (tag === 'head') heads.push(m);
  }
  const sigL: THREE.Mesh[] = [], sigR: THREE.Mesh[] = [];
  const sg = new THREE.BoxGeometry(0.08, 0.035, 0.03);
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const s = new THREE.Mesh(sg, MAT.sigOff);
    s.position.set(sx * (sz > 0 ? 0.52 : 0.62), sz > 0 ? 0.47 : 0.66, sz * (F - 0.004));
    chassis.add(s);
    (sx > 0 ? sigL : sigR).push(s);
  }
  const wheels = [[AX_F, 0.235], [AX_R, 0.255]].flatMap(([z, w]) => [1, -1].map((sx) => makeWheel(root, sx * WX, WR, z, WR, w, z > 0, 0x2f3236, 5, false, false)));
  return { root, chassis, body: body!, wheels, brake, sigL, sigR, heads, length: L, width: 2.04, height: 1.43, color, lod: [] };
}
