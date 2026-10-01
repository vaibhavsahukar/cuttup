import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeWheel, type VehicleModel } from './ModelKit';
import { MAT, paint } from './Materials';
import { loft, ring, lerpK, type Tag, type Sec } from './Z350Builder';

/**
 * Honda Civic Type R (FL5), modelled for likeness. The side profile is traced from the side photo (116 px per metre):
 * long low nose, steep raked screen, roof peak just behind the door line, a fastback hatch falling to a high tail with a
 * big wing; slim LED headlamps, honeycomb upper grille, wide hex lower intake and air curtains, C shaped tail lamps,
 * centre triple exhaust. 4.595 m long, 1.89 m wide, 1.44 m tall, wheelbase 2.74 m.
 */
const L = 4.595, F = L / 2, R = -F;
const AX_F = 1.47, AX_R = -1.27, WR = 0.335, WX = 0.8, G = 0.06;

// keys run from the nose (+z) to the tail (-z), traced from the side photo
const DECK: [number, number][] = [[F, 0.74], [2.17, 0.79], [1.99, 0.86], [1.65, 0.93], [1.3, 0.96], [0.95, 0.97], [0.6, 0.95], [0.1, 0.93], [-0.5, 0.93], [-1.2, 0.96], [-1.6, 1.0], [-1.9, 1.04], [-2.1, 1.0], [R, 0.92]];
const HW: [number, number][] = [[F, 0.82], [2.25, 0.88], [2.0, 0.92], [1.6, 0.94], [0.5, 0.935], [-0.5, 0.94], [-1.3, 0.95], [-1.9, 0.93], [-2.25, 0.88], [R, 0.84]];
const ROOF: [number, number][] = [[0.85, 0.97], [0.78, 1.1], [0.6, 1.21], [0.43, 1.3], [0.26, 1.39], [0.09, 1.42], [-0.26, 1.44], [-0.6, 1.43], [-0.95, 1.4], [-1.12, 1.38], [-1.29, 1.27], [-1.46, 1.21], [-1.64, 1.15], [-1.82, 1.08]];

export function buildCivic(color: number, shadows = true): VehicleModel {
  const out = new Map<Tag, number[]>();
  const push = (tag: Tag, a: ArrayLike<number>) => { let t = out.get(tag); if (!t) out.set(tag, (t = [])); for (let i = 0; i < a.length; i++) t.push(a[i]); };
  const addGeo = (tag: Tag, g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; push(tag, n.attributes.position.array as Float32Array); };
  const box = (tag: Tag, x: number, y: number, z: number, w: number, h: number, d: number) => addGeo(tag, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const disc = (tag: Tag, x: number, y: number, z: number, r: number, d = 0.02) => addGeo(tag, new THREE.CylinderGeometry(r, r, d, 24).rotateX(Math.PI / 2).translate(x, y, z));
  /** a thin lamp cut from an (x, y) outline, lying on the front (rear = true: back) face; x is for the +x side, mirrored by sx */
  const faceSlab = (tag: Tag, sx: number, pts: [number, number][], rear: boolean, depth = 0.035) => {
    const mx = rear ? -sx : sx;
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * mx, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
    if (mx < 0 && g.index) { const a = g.index.array as any; for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; } }
    if (rear) g.rotateY(Math.PI).translate(0, 0, R + 0.015); else g.translate(0, 0, F - 0.03);
    addGeo(tag, g);
  };

  // ---- lower body with flared arches ----
  const N = 100, secs: Sec[] = [];
  for (let q = 0; q < N; q++) {
    const z = R + 0.01 + (q / (N - 1)) * (L - 0.02);
    const hw = lerpK(HW, z), yTop = lerpK(DECK, z);
    const endT = Math.min(F - z, z - R);
    const chin = 0.17 - 0.07 * Math.max(0, 1 - endT / 0.12);
    let arch = chin;
    for (const wz of [AX_F, AX_R]) { const dz = (z - wz) / (WR * 1.2); if (Math.abs(dz) < 1) arch = Math.max(arch, WR + Math.sqrt(1 - dz * dz) * WR * 0.78); }
    const belt = yTop - 0.17, inner = hw * 0.62;
    secs.push({ z, pts: ring([
      [0, chin, 'dark'], [inner, chin, 'dark'], [inner, arch, 'dark'], [hw, Math.min(arch, belt - 0.1), 'paint'], [hw, belt, 'paint'],
      [hw * 0.96, yTop - 0.05, 'paint'], [hw * 0.6, yTop - 0.012, 'paint'], [0, yTop, 'paint'],
    ]) });
  }
  loft(secs, out, 'paint', 'paint');

  // ---- greenhouse: raked screen, side glass, roof, fastback hatch glass ----
  const cab: Sec[] = [], M = 52;
  for (let q = 0; q < M; q++) {
    const z = ROOF[ROOF.length - 1][0] + (q / (M - 1)) * (ROOF[0][0] - ROOF[ROOF.length - 1][0]);
    const top = lerpK(ROOF, z), base = lerpK(DECK, z) - 0.01, hw = lerpK(HW, z);
    const bw = hw * 0.88, k = Math.min(1, (top - base) / 0.4);
    const rw = bw * (0.9 - 0.32 * k), winTop = base + (top - base) * 0.84, bwm = bw - (bw - rw) * 0.55;
    const pts: [number, number, Tag][] = [[-bw, base, 'glass'], [-bwm, winTop, 'paint'], [-rw, top - 0.004, 'paint'], [0, top, 'paint'], [rw, top - 0.004, 'paint'], [bwm, winTop, 'glass'], [bw, base, 'dark']];
    if (z > 0.5 || z < -1.15) for (const i of [1, 2, 3, 4]) pts[i][2] = 'glass';
    cab.push({ z, pts });
  }
  loft(cab, out, 'glass', 'glass');

  const hwAt = (z: number) => lerpK(HW, z);
  // ---- front: slim LED headlamps, honeycomb upper grille with the badge, wide lower intake, air curtains, lip ----
  for (const sx of [1, -1]) {
    // slim LED headlamp sweeping up to the fender corner, in a dark housing
    faceSlab('dark', sx, [[0.26, 0.6], [0.5, 0.63], [0.78, 0.68], [0.8, 0.75], [0.76, 0.77], [0.5, 0.74], [0.26, 0.69]], false, 0.022);
    faceSlab('head', sx, [[0.3, 0.64], [0.52, 0.665], [0.76, 0.7], [0.77, 0.74], [0.73, 0.75], [0.52, 0.725], [0.3, 0.69]], false, 0.034);
    // upper honeycomb grille, wide lower hex intake, vertical air curtain
    faceSlab('dark', sx, [[0, 0.5], [0.5, 0.53], [0.56, 0.6], [0.5, 0.64], [0, 0.64]], false, 0.022);
    faceSlab('dark', sx, [[0, 0.14], [0.5, 0.14], [0.68, 0.28], [0.58, 0.42], [0, 0.42]], false, 0.022);
    faceSlab('dark', sx, [[0.72, 0.46], [0.78, 0.46], [0.76, 0.2], [0.7, 0.2]], false, 0.022);
    box('carbon', sx * (hwAt(0.9) - 0.03), 0.2, 0.0, 0.05, 0.07, 1.9); // side sill, set into the body
    box('dark', sx * (hwAt(0.1) + 0.006), 0.69, 0.1, 0.004, 0.01, 1.1); // door shut line
    box('dark', sx * (hwAt(0.55) + 0.006), 0.86, 0.55, 0.004, 0.025, 0.14); // front door handle
    box('dark', sx * (hwAt(-0.4) + 0.006), 0.86, -0.4, 0.004, 0.025, 0.14); // rear door handle
    // mirror: black, on a stalk from the door
    addGeo('dark', new THREE.SphereGeometry(1, 16, 10).scale(0.045, 0.06, 0.1).translate(sx * 0.96, 1.0, 0.62));
    box('dark', sx * 0.9, 0.98, 0.68, 0.1, 0.035, 0.07);
    // tail lamp: C shaped wrap, slim, high on the rear corner, and a vertical bumper reflector
    faceSlab('tail', sx, [[0.8, 0.93], [0.56, 0.945], [0.36, 0.9], [0.4, 0.84], [0.62, 0.86], [0.78, 0.83]], true, 0.03);
    box('tail', sx * 0.78, 0.4, R + 0.004, 0.05, 0.14, 0.012);
    // triple centre exhaust tips come below
  }
  box('chrome', -0.2, 0.66, F + 0.012, 0.08, 0.07, 0.01); // H badge
  box('carbon', 0, 0.1, F - 0.03, 1.5, 0.03, 0.06); // splitter lip
  // bonnet crease lines
  for (const sx of [1, -1]) box('dark', sx * 0.38, lerpK(DECK, 1.4) + 0.004, 1.4, 0.01, 0.005, 1.1);
  // ---- rear: dark lower diffuser with the centre triple exhaust, plate recess, big wing ----
  box('dark', 0, 0.36, R + 0.006, 1.5, 0.3, 0.02); // diffuser panel
  box('carbon', 0, 0.17, R + 0.0, 1.5, 0.05, 0.1); // rear lip
  for (const x of [-0.16, 0, 0.16]) disc('chrome', x, 0.3, R - 0.005, 0.05, 0.04);
  box('dark', 0, 0.72, R + 0.006, 0.5, 0.11, 0.02); // plate recess
  for (const sx of [1, -1]) {
    box('carbon', sx * 0.5, 1.15, R + 0.38, 0.05, 0.2, 0.14); // wing uprights
    box('carbon', sx * 0.86, 1.25, R + 0.3, 0.03, 0.14, 0.38); // end plate
  }
  box('carbon', 0, 1.3, R + 0.3, 1.74, 0.04, 0.4); // wing blade

  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);
  const carbonM = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.4, roughness: 0.35 });
  const redM = new THREE.MeshStandardMaterial({ color: 0xd0141c, metalness: 0.3, roughness: 0.4 });
  const matFor = (t: string): THREE.Material => t === 'paint' ? paint(color) : t === 'glass' ? MAT.glass : t === 'head' ? MAT.head : t === 'tail' ? MAT.tailOff : t === 'chrome' ? MAT.chrome : t === 'carbon' ? carbonM : MAT.trim;
  void redM;
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
    s.position.set(sx * (sz > 0 ? 0.74 : 0.7), sz > 0 ? 0.5 : 0.72, sz * (F - 0.005));
    chassis.add(s);
    (sx > 0 ? sigL : sigR).push(s);
  }
  const wheels = [AX_F, AX_R].flatMap((z) => [1, -1].map((sx) => makeWheel(root, sx * WX, WR, z, WR, 0.235, z > 0, 0x1b1c1f, 10, false, false)));
  return { root, chassis, body: body!, wheels, brake, sigL, sigR, heads, length: L, width: 1.89, height: 1.44, color, lod: [] };
}
