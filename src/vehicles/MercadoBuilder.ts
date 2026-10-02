import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeWheel, type VehicleModel } from './ModelKit';
import { MAT, paint } from './Materials';
import { loft, ring, lerpK, type Sec, type Tag } from './Z350Builder';

/**
 * Mercado C65 S coupe, modelled for likeness of the reference photos: a long bonnet, cabin set well back under a short
 * fastback roof, an upright grille with vertical slats and a round badge, wide angular headlamps over big black corner
 * intakes, a black side skirt, wrap tail lamps, a thin boot lip and a diffuser with quad round tips.
 * Length 4.75 m, width 2.0 m with mirrors, height 1.4 m, wheelbase 2.84 m. Every detail sits clear of its neighbours by a
 * few millimetres so nothing z-fights.
 */
const L = 4.75, F = L / 2, R = -F;
const AX_F = 1.46, AX_R = -1.38, WR = 0.35, WX = 0.8, G = 0.13;
// keys run from the nose (+z) to the tail (-z)
const DECK: [number, number][] = [[F, 0.72], [2.33, 0.78], [2.1, 0.86], [1.7, 0.93], [1.2, 0.98], [0.8, 1.0], [0.3, 1.0], [-0.6, 1.0], [-1.3, 1.01], [-1.8, 1.03], [-2.15, 1.045], [-2.3, 1.04], [R, 0.99]];
const HW: [number, number][] = [[F, 0.66], [2.33, 0.8], [2.1, 0.9], [1.7, 0.94], [1.0, 0.945], [0, 0.94], [-1.0, 0.945], [-1.8, 0.93], [-2.2, 0.9], [-2.34, 0.84], [R, 0.74]];
const ROOF: [number, number][] = [[0.85, 1.0], [0.55, 1.17], [0.2, 1.32], [-0.2, 1.4], [-0.6, 1.4], [-1.0, 1.34], [-1.4, 1.2], [-1.75, 1.08], [-1.95, 1.03]];

const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.4, roughness: 0.35 });

export function buildMercado(color: number, shadows = true): VehicleModel {
  const out = new Map<Tag, number[]>();
  const push = (tag: Tag, a: ArrayLike<number>) => { let t = out.get(tag); if (!t) out.set(tag, (t = [])); for (let i = 0; i < a.length; i++) t.push(a[i]); };
  const addGeo = (tag: Tag, g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; push(tag, n.attributes.position.array as Float32Array); };
  const box = (tag: Tag, x: number, y: number, z: number, w: number, h: number, d: number) => addGeo(tag, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const ball = (tag: Tag, x: number, y: number, z: number, rx: number, ry: number, rz: number) => addGeo(tag, new THREE.SphereGeometry(1, 18, 12).scale(rx, ry, rz).translate(x, y, z));
  /** a round pipe / disc along z */
  const pipe = (tag: Tag, x: number, y: number, z: number, r: number, len: number) => addGeo(tag, new THREE.CylinderGeometry(r, r, len, 20).rotateX(Math.PI / 2).translate(x, y, z));

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

  // ---- greenhouse: windscreen, frameless side glass, short coupe roof, fastback rear glass ----
  const cab: Sec[] = [];
  const M = 50;
  for (let q = 0; q < M; q++) {
    const z = ROOF[ROOF.length - 1][0] + (q / (M - 1)) * (ROOF[0][0] - ROOF[ROOF.length - 1][0]);
    const top = lerpK(ROOF, z), base = lerpK(DECK, z) - 0.01, hw = lerpK(HW, z);
    const bw = hw * 0.9, k = Math.min(1, (top - base) / 0.4);
    const rw = bw * (0.88 - 0.3 * k), winTop = base + (top - base) * 0.8, bwm = bw - (bw - rw) * 0.55;
    const pts: [number, number, Tag][] = [[-bw, base, 'glass'], [-bwm, winTop, 'glass'], [-rw, top - 0.004, 'paint'], [0, top, 'paint'], [rw, top - 0.004, 'paint'], [bwm, winTop, 'glass'], [bw, base, 'dark']];
    const screen = z > 0.3, hatch = z < -1.15;
    if (screen || hatch) for (const i of [2, 3, 4]) pts[i][2] = 'glass';
    cab.push({ z, pts });
  }
  loft(cab, out, 'glass', 'glass');

  // ---- front: upright slatted grille with a round badge, wide angular headlamps, big black corner intakes ----
  box('dark', 0, 0.5, F - 0.006, 0.78, 0.3, 0.03); // grille opening
  for (let k = -7; k <= 7; k++) box('chrome', k * 0.05, 0.5, F + 0.012, 0.014, 0.26, 0.012); // vertical slats
  box('chrome', 0, 0.665, F + 0.006, 0.84, 0.022, 0.03); // upper chrome edge
  pipe('chrome', 0, 0.5, F + 0.026, 0.07, 0.012); // round badge
  box('dark', 0, 0.28, F - 0.006, 0.6, 0.09, 0.03); // low centre intake
  box('chrome', 0, 0.345, F + 0.002, 0.6, 0.02, 0.024); // bar over it
  for (const sx of [1, -1]) {
    // dark housing a hair under the lamp, then the lamp: wide, angular, swept back to the fender
    lampOn('dark', sx, 2.37, 1.98, (z) => lerpK([[2.37, 0.4], [2.2, 0.43], [1.98, 0.6]], z), (z) => lerpK([[2.37, 0.9], [2.2, 0.93], [1.98, 0.86]], z), 0.012);
    lampOn('head', sx, 2.35, 2.0, (z) => lerpK([[2.35, 0.44], [2.2, 0.47], [2.0, 0.63]], z), (z) => lerpK([[2.35, 0.87], [2.2, 0.9], [2.0, 0.83]], z), 0.02);
    box('dark', sx * 0.56, 0.36, F - 0.006, 0.3, 0.18, 0.03); // big corner intake
    for (const dy of [-0.05, 0.0, 0.05]) box('carbon', sx * 0.56, 0.36 + dy, F + 0.002, 0.26, 0.012, 0.02); // its horizontal slats
    box('dark', sx * (lerpK(HW, 1.1) + 0.006), 0.62, 1.1, 0.012, 0.1, 0.34); // fender vent behind the front wheel
    box('dark', sx * (lerpK(HW, 0.1) + 0.006), 0.78, 0.1, 0.008, 0.014, 1.5); // door shut line
    box('dark', sx * (lerpK(HW, -0.1) + 0.006), 0.9, -0.1, 0.012, 0.03, 0.2); // flush handle
    box('dark', sx * (lerpK(HW, 0) + 0.006), 0.2, 0.0, 0.012, 0.075, 2.0); // black side skirt
    ball('paint', sx * 1.0, 1.02, 0.78, 0.065, 0.075, 0.12); // mirror
    box('paint', sx * 0.9, 1.0, 0.8, 0.18, 0.05, 0.09); // stalk joining it to the door
  }

  // ---- rear: wrap tail lamps, thin boot lip, diffuser with quad round tips ----
  for (const sx of [1, -1]) {
    box('tail', sx * 0.6, 0.9, R + 0.004, 0.54, 0.075, 0.03); // tail lamp
    box('tail', sx * 0.66, 0.46, R + 0.004, 0.2, 0.025, 0.03); // red reflector slit on the bumper
    for (const x of [0.4, 0.62]) pipe('chrome', sx * x, 0.25, R - 0.04, 0.05, 0.12); // exhaust tips
  }
  box('dark', 0, 0.9, R + 0.002, 0.64, 0.03, 0.03); // black strip between the lamps
  box('dark', 0, 0.26, R - 0.006, 1.46, 0.17, 0.04); // diffuser
  box('paint', 0, 1.06, -2.3, 1.5, 0.03, 0.12); // boot lip

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
    s.position.set(sx * (sz > 0 ? 0.88 : 0.88), sz > 0 ? 0.5 : 0.72, sz * (F - 0.004));
    chassis.add(s);
    (sx > 0 ? sigL : sigR).push(s);
  }
  const wheels = [[AX_F, 0.235], [AX_R, 0.26]].flatMap(([z, w]) => [1, -1].map((sx) => makeWheel(root, sx * WX, WR, z, WR, w, z > 0, 0x1b1c1e, 10, false, false)));
  return { root, chassis, body: body!, wheels, brake, sigL, sigR, heads, length: L, width: 2.0, height: 1.4, color, lod: [] };
}
