import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeWheel, type VehicleModel } from './ModelKit';
import { MAT, paint } from './Materials';
import { loft, ring, lerpK, blueMat, type Tag, type Sec } from './Z350Builder';

/**
 * Corvette C6 (Z06), modelled for likeness: very long low nose, crowned fenders, a cabin set well back under a sweeping
 * fastback roof, short tail with the four round lamps and quad tips. 4.46 m long, 1.93 m wide, 1.25 m tall, wheelbase 2.69 m.
 */
const L = 4.46, F = L / 2, R = -F;
const AX_F = 1.3, AX_R = -1.39, WR_F = 0.327, WR_R = 0.345, WX = 0.82, G = 0.05;

const DECK: [number, number][] = [[F, 0.56], [2.15, 0.64], [2.0, 0.7], [1.6, 0.78], [1.0, 0.88], [0.5, 0.95], [0, 0.96], [-0.8, 0.97], [-1.4, 0.98], [-1.8, 0.99], [-2.05, 0.96], [R, 0.88]];
const HW: [number, number][] = [[F, 0.84], [2.15, 0.88], [1.9, 0.93], [1.5, 0.965], [0.9, 0.955], [0.2, 0.94], [-0.5, 0.945], [-1.1, 0.965], [-1.6, 0.965], [-2.0, 0.93], [-2.15, 0.86], [R, 0.76]];
const ROOF: [number, number][] = [[0.5, 0.95], [0.3, 1.08], [0.1, 1.2], [-0.1, 1.25], [-0.4, 1.25], [-0.8, 1.2], [-1.2, 1.09], [-1.65, 1.0]];

export function buildC6(color: number, shadows = true): VehicleModel {
  const out = new Map<Tag, number[]>();
  const push = (tag: Tag, a: ArrayLike<number>) => { let t = out.get(tag); if (!t) out.set(tag, (t = [])); for (let i = 0; i < a.length; i++) t.push(a[i]); };
  const addGeo = (tag: Tag, g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; push(tag, n.attributes.position.array as Float32Array); };
  const box = (tag: Tag, x: number, y: number, z: number, w: number, h: number, d: number) => addGeo(tag, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const ball = (tag: Tag, x: number, y: number, z: number, rx: number, ry: number, rz: number) => addGeo(tag, new THREE.SphereGeometry(1, 18, 12).scale(rx, ry, rz).translate(x, y, z));
  /** a flat round lamp lying on the rear face */
  const disc = (tag: Tag, x: number, y: number, z: number, r: number) => addGeo(tag, new THREE.CylinderGeometry(r, r, 0.04, 28).rotateX(Math.PI / 2).translate(x, y, z));
  const lampOn = (tag: Tag, sx: number, z0: number, z1: number, xin: (z: number) => number, xout: (z: number) => number, lift = 0.02) => {
    const surf = (x: number, z: number) => { const hw = lerpK(HW, z), t = Math.min(1, Math.max(0, (x / hw - 0.6) / 0.355)); return lerpK(DECK, z) - 0.008 - 0.042 * t * t + lift; };
    const n = 16, rows: [number, number, number][][] = [];
    for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * (i / n), a = xin(z), b = xout(z); rows.push([0, 1, 2, 3, 4].map((k) => { const x = a + (b - a) * (k / 4); return [sx * x, surf(x, z) + (k === 0 || k === 4 ? -0.01 : 0), z] as [number, number, number]; })); }
    const tri: number[] = [];
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
      const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
      tri.push(...a, ...c, ...b, ...b, ...c, ...d, ...a, ...b, ...c, ...b, ...d, ...c);
    }
    push(tag, tri);
  };

  /** a lamp set into the nose face: an (x, y) outline pushed through the nose between z0 and z1 */
  const faceLamp = (tag: Tag, sx: number, pts: [number, number][], z0: number, z1: number) => {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * sx, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 });
    g.translate(0, 0, z0);
    if (sx < 0 && g.index) { const a = g.index.array as any; for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; } }
    addGeo(tag, g);
  };
  /** a lamp lying flat on the body: an outline given as (x, z) points, laid on the surface so it follows the curve and does not stick out */
  const lampShape = (tag: Tag, sx: number, outline: [number, number][], lift = 0.03) => {
    const surf = (x: number, z: number) => { const hw = lerpK(HW, z), t = Math.min(1, Math.max(0, (x / hw - 0.6) / 0.355)); return lerpK(DECK, z) - 0.008 - 0.042 * t * t + lift; };
    const ptsB: [number, number][] = [];
    for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; for (let k = 0; k < 8; k++) ptsB.push([a[0] + (b[0] - a[0]) * k / 8, a[1] + (b[1] - a[1]) * k / 8]); }
    let cx = 0, cz = 0; for (const o of outline) { cx += o[0]; cz += o[1]; } cx /= outline.length; cz /= outline.length;
    const ring = (f: number) => ptsB.map(([x, z]) => { const px = cx + (x - cx) * f, pz = cz + (z - cz) * f; return [sx * px, surf(px, pz), pz] as [number, number, number]; });
    const rs = [ring(1), ring(0.66), ring(0.33)], c: [number, number, number] = [sx * cx, surf(cx, cz), cz], tri: number[] = [];
    const n = ptsB.length;
    for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) { const a = rs[r][i], b = rs[r][(i + 1) % n], d = rs[r + 1][i], e = rs[r + 1][(i + 1) % n]; tri.push(...a, ...d, ...b, ...b, ...d, ...e, ...a, ...b, ...d, ...b, ...e, ...d); }
    for (let i = 0; i < n; i++) { const a = rs[2][i], b = rs[2][(i + 1) % n]; tri.push(...c, ...a, ...b, ...c, ...b, ...a); }
    push(tag, tri);
  };
  // lower body with arches
  const N = 96, secs: Sec[] = [];
  for (let q = 0; q < N; q++) {
    const z = R + 0.01 + (q / (N - 1)) * (L - 0.02);
    const hw = lerpK(HW, z), yTop = lerpK(DECK, z);
    const endT = Math.min(F - z, z - R);
    const chin = G + 0.05 * Math.max(0, 1 - endT / 0.15);
    let arch = chin;
    for (const [wz, r] of [[AX_F, WR_F], [AX_R, WR_R]]) { const dz = (z - wz) / (r * 1.18); if (Math.abs(dz) < 1) arch = Math.max(arch, r + Math.sqrt(1 - dz * dz) * r * 0.8); }
    const belt = yTop - 0.15, inner = hw * 0.62, crown = 0;
    secs.push({ z, pts: ring([
      [0, chin, 'dark'], [inner, chin, 'dark'], [inner, arch, 'dark'], [hw, Math.min(arch, belt - 0.1), 'paint'], [hw, belt, 'paint'],
      [hw * 0.955, yTop - 0.05, 'paint'], [hw * 0.6, yTop - 0.008 - crown * 0.4, 'paint'], [0, yTop - 0.02 - crown, 'paint'],
    ]) });
  }
  loft(secs, out, 'paint', 'paint');

  // greenhouse
  const cab: Sec[] = [], M = 46;
  for (let q = 0; q < M; q++) {
    const z = ROOF[ROOF.length - 1][0] + (q / (M - 1)) * (ROOF[0][0] - ROOF[ROOF.length - 1][0]);
    const top = lerpK(ROOF, z), base = lerpK(DECK, z) - 0.01, hw = lerpK(HW, z);
    const bw = hw * 0.86, k = Math.min(1, (top - base) / 0.3);
    const rw = bw * (0.9 - 0.3 * k), winTop = base + (top - base) * 0.8, bwm = bw - (bw - rw) * 0.55;
    const pts: [number, number, Tag][] = [[-bw, base, 'glass'], [-bwm, winTop, 'paint'], [-rw, top - 0.004, 'paint'], [0, top, 'paint'], [rw, top - 0.004, 'paint'], [bwm, winTop, 'glass'], [bw, base, 'dark']];
    if (z > 0.05 || z < -0.9) for (const i of [1, 2, 3, 4]) pts[i][2] = 'glass';
    cab.push({ z, pts });
  }
  loft(cab, out, 'glass', 'glass');

  const hwAt = (z: number) => lerpK(HW, z);
  for (const sx of [1, -1]) {
    // exposed teardrop headlamps lying along the front fenders
    // C6 lamps: flush teardrop units on the front corners of the nose, wide at the nose and tapering back and inwards
    lampShape('head', sx, [[0.882, F - 0.643], [0.896, F - 0.522], [0.891, F - 0.297], [0.86, F - 0.19], [0.68, F - 0.14], [0.478, F - 0.185], [0.539, F - 0.373], [0.68, F - 0.545], [0.786, F - 0.613]]); // fin shaped lamp lying on the fender top at the nose corner, pointed inner tip towards the nose, from the mockups
    box('dark', sx * 0.5, 0.16, F, 0.2, 0.1, 0.04); // fog lamp
    box('amber', sx * (hwAt(1.9) + 0.014), 0.52, 1.9, 0.012, 0.05, 0.16); // side marker
    // side cove behind the front wheel with its gill, rear fender duct, door line, shoulder trim
    box('dark', sx * (hwAt(0.85) + 0.014), 0.7, 0.85, 0.012, 0.15, 0.34);
    box('chrome', sx * (hwAt(0.85) + 0.018), 0.66, 0.85, 0.008, 0.015, 0.3);
    box('dark', sx * (hwAt(-1.1) + 0.014), 0.7, -1.1, 0.012, 0.14, 0.2);
    box('dark', sx * (hwAt(-0.3) + 0.014), 0.7, -0.3, 0.01, 0.014, 1.0);
    box('carbon', sx * (hwAt(-0.2) - 0.012), 0.2, -0.2, 0.05, 0.05, 1.7); // side sill
    ball('paint', sx * 0.98, 1.0, 0.42, 0.06, 0.07, 0.12); // mirror
    box('paint', sx * 0.86, 0.97, 0.47, 0.22, 0.05, 0.1); // stalk
    // four round tail lamps, quad tips
    disc('tail', sx * 0.76, 0.84, R - 0.005, 0.11);
    disc('tail', sx * 0.5, 0.84, R - 0.005, 0.105);
    box('chrome', sx * 0.3, 0.2, R - 0.04, 0.11, 0.11, 0.12);
    box('chrome', sx * 0.5, 0.2, R - 0.04, 0.11, 0.11, 0.12);
  }
  box('dark', 0, 0.38, F - 0.12, 0.8, 0.1, 0.05); // lower mesh grille, set into the rounded bumper
  box('carbon', 0, 0.3, F - 0.2, 1.0, 0.03, 0.12); // small splitter
  box('chrome', 0, 0.56, F - 0.02, 0.12, 0.06, 0.02); // crossed flags badge
  box('dark', 0.0, 0.88, 1.3, 0.34, 0.012, 0.2); // bonnet vent
  box('dark', 0, 0.55, R - 0.01, 0.65, 0.14, 0.04); // number plate recess
  box('carbon', 0, 0.28, R + 0.0, 1.7, 0.2, 0.12); // diffuser
  box('paint', 0, 0.99, -1.95, 1.4, 0.04, 0.2); // tail lip

  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);
  const amber = new THREE.MeshStandardMaterial({ color: 0xff9a1a, emissive: 0x884400, emissiveIntensity: 0.6 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.4, roughness: 0.35 });
  const matFor = (t: string): THREE.Material => t === 'paint' ? paint(color) : t === 'glass' ? MAT.glass : t === 'head' ? MAT.head : t === 'tail' ? MAT.tailOff : t === 'chrome' ? MAT.chrome : t === 'blue' ? blueMat : t === 'carbon' ? carbon : t === 'amber' ? amber : MAT.trim;
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
  const sg = new THREE.BoxGeometry(0.07, 0.04, 0.03);
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const s = new THREE.Mesh(sg, MAT.sigOff);
    s.position.set(sx * (sz > 0 ? 0.62 : 0.66), sz > 0 ? 0.48 : 0.66, sz * (F - 0.005));
    chassis.add(s);
    (sx > 0 ? sigL : sigR).push(s);
  }
  const wheels = [[AX_F, WR_F, 0.27], [AX_R, WR_R, 0.31]].flatMap(([z, r, w]) => [1, -1].map((sx) => makeWheel(root, sx * WX, r, z, r, w, z > 0, 0xb8bcc2, 5, false, false)));
  return { root, chassis, body: body!, wheels, brake, sigL, sigR, heads, length: L, width: 1.93, height: 1.25, color, lod: [] };
}
