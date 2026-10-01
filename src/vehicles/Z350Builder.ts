import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeWheel, type VehicleModel } from './ModelKit';
import { MAT, paint } from './Materials';

/**
 * Nissan 350Z, modelled for likeness rather than the game's flat panel style: smooth lofted body sections with real
 * arches and tumblehome, a separate glass greenhouse, teardrop headlamps and wrap tail lamps cut from plan shapes.
 * Measurements follow the reference photos (length 4.31 m, width 1.82 m, height 1.32 m, wheelbase 2.65 m).
 */
type Tag = 'paint' | 'glass' | 'dark' | 'head' | 'tail' | 'chrome' | 'blue' | 'carbon';
const blueMat = new THREE.MeshStandardMaterial({ color: 0x1f4fbf, metalness: 0.4, roughness: 0.4, envMapIntensity: 0.6 });
const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.4, roughness: 0.35 });

const L = 4.31, F = L / 2, R = -F;
const AX_F = 1.33, AX_R = -1.32, WR_F = 0.33, WR_R = 0.335, WX = 0.77, G = 0.14;

const lerpK = (k: [number, number][], z: number) => {
  for (let j = 1; j < k.length; j++) if (z >= k[j][0]) { const u = (z - k[j - 1][0]) / (k[j][0] - k[j - 1][0]); return k[j - 1][1] + (k[j][1] - k[j - 1][1]) * u; }
  return k[k.length - 1][1];
};
// keys run from the nose (+z) to the tail (-z)
const DECK: [number, number][] = [[F, 0.6], [2.08, 0.7], [1.92, 0.78], [1.6, 0.84], [1.2, 0.89], [0.8, 0.94], [0.55, 0.97], [0, 0.97], [-0.8, 0.97], [-1.3, 0.98], [-1.75, 1.0], [-1.95, 0.99], [-2.08, 0.94], [R, 0.84]];
const HW: [number, number][] = [[F, 0.7], [2.1, 0.8], [1.9, 0.875], [1.45, 0.91], [1.0, 0.895], [0.3, 0.88], [-0.4, 0.885], [-1.0, 0.91], [-1.5, 0.915], [-1.95, 0.89], [-2.1, 0.82], [R, 0.72]];
const ROOF: [number, number][] = [[0.64, 0.97], [0.45, 1.1], [0.25, 1.24], [0.05, 1.31], [-0.15, 1.32], [-0.55, 1.3], [-0.95, 1.2], [-1.25, 1.1], [-1.55, 1.0]];

type Sec = { z: number; pts: [number, number, Tag][] };
function loft(secs: Sec[], out: Map<Tag, number[]>, capA: Tag | null, capB: Tag | null) {
  const n = secs[0].pts.length;
  const push = (tag: Tag, ...v: number[]) => { let a = out.get(tag); if (!a) out.set(tag, (a = [])); a.push(...v); };
  for (let s = 0; s < secs.length - 1; s++) for (let k = 0; k < n; k++) {
    const A = secs[s], B = secs[s + 1], k2 = (k + 1) % n, tag = A.pts[k][2];
    push(tag, A.pts[k][0], A.pts[k][1], A.z, B.pts[k][0], B.pts[k][1], B.z, A.pts[k2][0], A.pts[k2][1], A.z,
      A.pts[k2][0], A.pts[k2][1], A.z, B.pts[k][0], B.pts[k][1], B.z, B.pts[k2][0], B.pts[k2][1], B.z);
  }
  const cap = (S: Sec, tag: Tag | null, flip: boolean) => {
    if (!tag) return;
    let cx = 0, cy = 0; for (const p of S.pts) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n, t = S.pts[k][2] === 'glass' ? 'glass' : tag;
      if (flip) push(t, cx, cy, S.z, S.pts[k2][0], S.pts[k2][1], S.z, S.pts[k][0], S.pts[k][1], S.z);
      else push(t, cx, cy, S.z, S.pts[k][0], S.pts[k][1], S.z, S.pts[k2][0], S.pts[k2][1], S.z);
    }
  };
  cap(secs[0], capA, false); cap(secs[secs.length - 1], capB, true);
}
/** walk a half section (centre bottom to centre top) round both sides */
const ring = (half: [number, number, Tag][]): [number, number, Tag][] => {
  const full: [number, number, Tag][] = half.map(([x, y, t]) => [-x, y, t]);
  for (let p = half.length - 2; p >= 1; p--) full.push([half[p][0], half[p][1], half[p - 1][2]]);
  return full;
};

export function buildZ350(color: number, shadows = true): VehicleModel {
  const out = new Map<Tag, number[]>();
  const push = (tag: Tag, a: ArrayLike<number>) => { let t = out.get(tag); if (!t) out.set(tag, (t = [])); for (let i = 0; i < a.length; i++) t.push(a[i]); };
  const addGeo = (tag: Tag, g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; push(tag, n.attributes.position.array as Float32Array); };
  const box = (tag: Tag, x: number, y: number, z: number, w: number, h: number, d: number) => addGeo(tag, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const ball = (tag: Tag, x: number, y: number, z: number, rx: number, ry: number, rz: number) => addGeo(tag, new THREE.SphereGeometry(1, 18, 12).scale(rx, ry, rz).translate(x, y, z));
  /** a plan-view (x, z) outline lifted into a slab from y0 to y1 */
  const slab = (tag: Tag, plan: [number, number][], y0: number, y1: number, sx = 1) => {
    const sh = new THREE.Shape(plan.map(([x, z]) => new THREE.Vector2(x * sx, z)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
    g.rotateX(Math.PI / 2); // shape (x, z) -> plane, extrusion down
    g.translate(0, y1, 0);
    if (sx < 0) { const idx = g.index; if (idx) { const a = idx.array as Uint32Array | Uint16Array; for (let i = 0; i < a.length; i += 3) { const t = a[i]; (a as any)[i] = a[i + 1]; (a as any)[i + 1] = t; } } }
    addGeo(tag, g);
  };

  /** a lamp lying on the body surface: spans xin..xout (functions of z) from z0 to z1, following the deck so nothing sticks out */
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
  // ---- lower body: 90 sections nose to tail, with real wheel arches ----
  const N = 90, secs: Sec[] = [];
  for (let q = 0; q < N; q++) {
    const z = R + 0.01 + (q / (N - 1)) * (L - 0.02);
    const hw = lerpK(HW, z), yTop = lerpK(DECK, z);
    const endT = Math.min(F - z, z - R); // distance from the nearest end
    const chin = G + 0.16 * Math.max(0, 1 - endT / 0.32);
    let arch = chin;
    for (const [wz, r] of [[AX_F, WR_F], [AX_R, WR_R]]) { const dz = (z - wz) / (r * 1.18); if (Math.abs(dz) < 1) arch = Math.max(arch, r + Math.sqrt(1 - dz * dz) * r * 0.82); }
    const belt = yTop - 0.15, inner = hw * 0.62;
    secs.push({ z, pts: ring([
      [0, chin, 'dark'], [inner, chin, 'dark'], [inner, arch, 'dark'], [hw, Math.min(arch, belt - 0.1), 'paint'], [hw, belt, 'paint'],
      [hw * 0.955, yTop - 0.05, 'paint'], [hw * 0.6, yTop - 0.008, 'paint'], [0, yTop, 'paint'],
    ]) });
  }
  loft(secs, out, 'paint', 'paint');

  // ---- greenhouse: windscreen, side glass, roof, hatch glass ----
  const cab: Sec[] = [];
  const M = 44;
  for (let q = 0; q < M; q++) {
    const z = ROOF[ROOF.length - 1][0] + (q / (M - 1)) * (ROOF[0][0] - ROOF[ROOF.length - 1][0]);
    const top = lerpK(ROOF, z), base = lerpK(DECK, z) - 0.01, hw = lerpK(HW, z);
    const bw = hw * 0.9, k = Math.min(1, (top - base) / 0.34);
    const rw = bw * (0.93 - 0.3 * k), winTop = base + (top - base) * 0.82, bwm = bw - (bw - rw) * 0.55;
    const pts: [number, number, Tag][] = [[-bw, base, 'glass'], [-bwm, winTop, 'paint'], [-rw, top - 0.004, 'paint'], [0, top, 'paint'], [rw, top - 0.004, 'paint'], [bwm, winTop, 'glass'], [bw, base, 'dark']];
    const screen = z > 0.2, hatch = z < -0.6;
    if (screen || hatch) for (const i of [1, 2, 3, 4]) pts[i][2] = 'glass';
    cab.push({ z, pts });
  }
  loft(cab, out, 'glass', 'glass');

  // ---- front: teardrop headlamps, nose badge, mesh grille, side intakes ----
  for (const sx of [1, -1]) {
    lampOn('head', sx, 2.1, 1.5, () => 0.46, (z) => lerpK([[2.12, 0.8], [2.0, 0.87], [1.8, 0.87], [1.6, 0.74], [1.5, 0.56]], z));
    box('dark', sx * 0.72, 0.36, F - 0.02, 0.1, 0.17, 0.05); // side intake slot
    box('dark', sx * 0.4, 0.34, F - 0.02, 0.3, 0.14, 0.05); // lower fog / duct
    box('dark', sx * (lerpK(HW, 1.2) + 0.004), 0.58, 1.18, 0.012, 0.13, 0.06); // fender gill
    box('chrome', sx * (lerpK(HW, 1.2) + 0.008), 0.62, 1.18, 0.008, 0.07, 0.015);
    box('dark', sx * (lerpK(HW, 0.1) + 0.004), 0.7, 0.1, 0.01, 0.014, 1.25); // door shut line
    box('dark', sx * (lerpK(HW, 0.0) + 0.004), 0.93, -0.62, 0.014, 0.055, 0.16); // door handle recess
    box('blue', sx * (lerpK(HW, 0) - 0.012), 0.2, 0.0, 0.04, 0.05, 1.5); // blue side skirt
    ball('paint', sx * 0.95, 1.02, 0.5, 0.06, 0.07, 0.13); // mirror
    box('paint', sx * 0.84, 0.99, 0.55, 0.2, 0.05, 0.1); // stalk joining it to the door
  }
  box('dark', 0, 0.38, F - 0.05, 1.0, 0.16, 0.05); // mesh grille
  box('blue', 0, 0.27, F - 0.06, 1.3, 0.03, 0.1); // front lip
  box('chrome', 0, 0.57, F - 0.075, 0.12, 0.075, 0.02); // badge
  box('dark', -0.12, 0.47, F - 0.04, 0.36, 0.1, 0.03); // plate recess

  // ---- rear: wrap tail lamps, ducktail, plate recess, bumper, twin tips ----
  for (const sx of [1, -1]) {
    lampOn('tail', sx, -2.15, -1.64, (z) => lerpK([[-1.6, 0.8], [-1.64, 0.78], [-1.9, 0.62], [-2.15, 0.5]], z), (z) => lerpK([[-1.6, 0.8], [-1.64, 0.82], [-1.9, 0.9], [-2.15, 0.82]], z));
    box('tail', sx * 0.7, 0.4, R + 0.01, 0.2, 0.05, 0.05); // lower reflector
    box('chrome', sx * 0.22, 0.26, R - 0.02, 0.1, 0.1, 0.12);
    box('dark', sx * 0.44, 0.3, R + 0.02, 0.1, 0.1, 0.04);
  }
  box('dark', 0, 0.92, R + 0.07, 0.48, 0.016, 0.04); // light strip
  box('dark', 0, 0.58, R + 0.02, 1.2, 0.12, 0.04); // plate recess
  box('dark', 0, 0.3, R + 0.02, 1.35, 0.16, 0.06); // diffuser band
  box('blue', 0, 0.27, R + 0.05, 1.3, 0.03, 0.1); // rear lip
  box('paint', 0, 1.0, -1.87, 1.5, 0.045, 0.2); // ducktail

  // ---- meshes ----
  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);
  const matFor = (t: Tag): THREE.Material => t === 'paint' ? paint(color) : t === 'glass' ? MAT.glass : t === 'head' ? MAT.head : t === 'tail' ? MAT.tailOff : t === 'chrome' ? MAT.chrome : t === 'blue' ? blueMat : t === 'carbon' ? carbonMat : MAT.trim;
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
    s.position.set(sx * (sz > 0 ? 0.78 : 0.62), sz > 0 ? 0.52 : 0.7, sz * (F - 0.005));
    chassis.add(s);
    (sx > 0 ? sigL : sigR).push(s);
  }
  const wheels = [[AX_F, WR_F, 0.225], [AX_R, WR_R, 0.245]].flatMap(([z, r, w]) => [1, -1].map((sx) => makeWheel(root, sx * WX, r, z, r, w, z > 0, 0xb8bcc2, 5, false, false)));
  return { root, chassis, body: body!, wheels, brake, sigL, sigR, heads, length: L, width: 1.82, height: 1.32, color, lod: [] };
}
