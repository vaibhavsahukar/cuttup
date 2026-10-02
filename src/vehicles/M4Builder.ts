import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeWheel, type VehicleModel } from './ModelKit';
import { MAT, paint } from './Materials';
import { loft, ring, lerpK, type Tag, type Sec } from './Z350Builder';

/**
 * BWM W4 coupe, modelled for likeness. The side profile is traced from the side photo (127.7 px per metre):
 * a long bonnet rising to a cowl, a raked screen, a carbon roof peaking over the doors and falling in a fastback to a
 * short boot with a small lip; big double kidney grilles, slim hockey stick headlamps, power bulge stripes on the bonnet,
 * slim wide tail lamps and the quad exhaust. 4.79 m long, 1.89 m wide, 1.39 m tall, wheelbase 2.88 m.
 */
const S = 0.94; // the whole car is drawn at this scale
const L = 4.794, F = L / 2, R = -F;
const AX_F = 1.6, AX_R = -1.28, WR_F = 0.355, WR_R = 0.365, WX = 0.8, CH = 0.17;

// keys run from the nose (+z) to the tail (-z), traced from the side photo
const DECK: [number, number][] = [[F, 0.62], [2.28, 0.77], [2.16, 0.82], [2.045, 0.87], [1.93, 0.905], [1.81, 0.93], [1.69, 0.95], [1.575, 0.965], [1.46, 0.98], [1.34, 0.985], [1.1, 1.0], [0.9, 1.01], [0.2, 1.0], [-0.8, 1.0], [-1.4, 1.03], [-1.95, 1.065], [-2.18, 1.065], [-2.3, 1.02], [R, 0.95]];
const HW: [number, number][] = [[F, 0.78], [2.34, 0.84], [2.18, 0.89], [1.95, 0.925], [1.6, 0.94], [0.6, 0.94], [-0.6, 0.945], [-1.4, 0.955], [-1.9, 0.945], [-2.18, 0.91], [-2.36, 0.85], [R, 0.77]];
const ROOF: [number, number][] = [[0.91, 1.02], [0.75, 1.09], [0.635, 1.155], [0.517, 1.21], [0.4, 1.266], [0.283, 1.317], [0.165, 1.354], [0.05, 1.37], [-0.19, 1.384], [-0.42, 1.384], [-0.657, 1.37], [-0.89, 1.354], [-1.01, 1.35], [-1.127, 1.317], [-1.245, 1.266], [-1.36, 1.236], [-1.48, 1.2], [-1.6, 1.155], [-1.72, 1.12], [-1.83, 1.082], [-1.95, 1.065]];

export function buildM4(color: number, shadows = true): VehicleModel {
  const out = new Map<Tag, number[]>();
  const push = (tag: Tag, a: ArrayLike<number>) => { let t = out.get(tag); if (!t) out.set(tag, (t = [])); for (let i = 0; i < a.length; i++) t.push(a[i]); };
  const addGeo = (tag: Tag, g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; push(tag, n.attributes.position.array as Float32Array); };
  const box = (tag: Tag, x: number, y: number, z: number, w: number, h: number, d: number) => addGeo(tag, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const disc = (tag: Tag, x: number, y: number, z: number, r: number, d = 0.04) => addGeo(tag, new THREE.CylinderGeometry(r, r, d, 24).rotateX(Math.PI / 2).translate(x, y, z));
  /** a flat shape cut from an (x, y) outline on the front face, or the rear face when rear is set; x is for the +x side, mirrored by sx */
  const faceSlab = (tag: Tag, sx: number, pts: [number, number][], rear: boolean, depth = 0.03) => {
    const mx = rear ? -sx : sx;
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * mx, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
    if (mx < 0 && g.index) { const a = g.index.array as any; for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; } }
    if (rear) g.rotateY(Math.PI).translate(0, 0, R + 0.012); else g.translate(0, 0, F - 0.026);
    addGeo(tag, g);
  };
  /** a patch lying on the bonnet / deck: an (x, z) outline laid on the surface so it follows the curve and does not stick out */
  const onDeck = (tag: Tag, sx: number, outline: [number, number][], lift = 0.016) => {
    const surf = (x: number, z: number) => { const hw = lerpK(HW, z), t = Math.min(1, Math.max(0, (x / hw - 0.6) / 0.355)); return lerpK(DECK, z) - 0.008 - 0.042 * t * t + lift; };
    const pts: [number, number][] = [];
    for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; for (let k = 0; k < 8; k++) pts.push([a[0] + (b[0] - a[0]) * k / 8, a[1] + (b[1] - a[1]) * k / 8]); }
    let cx = 0, cz = 0; for (const o of outline) { cx += o[0]; cz += o[1]; } cx /= outline.length; cz /= outline.length;
    const rg = (f: number) => pts.map(([x, z]) => { const px = cx + (x - cx) * f, pz = cz + (z - cz) * f; return [sx * px, surf(px, pz), pz] as [number, number, number]; });
    const rs = [rg(1), rg(0.66), rg(0.33)], c: [number, number, number] = [sx * cx, surf(cx, cz), cz], tri: number[] = [], n = pts.length;
    for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) { const a = rs[r][i], b = rs[r][(i + 1) % n], d = rs[r + 1][i], e = rs[r + 1][(i + 1) % n]; tri.push(...a, ...d, ...b, ...b, ...d, ...e, ...a, ...b, ...d, ...b, ...e, ...d); }
    for (let i = 0; i < n; i++) { const a = rs[2][i], b = rs[2][(i + 1) % n]; tri.push(...c, ...a, ...b, ...c, ...b, ...a); }
    push(tag, tri);
  };

  // ---- lower body with arches ----
  const N = 110, secs: Sec[] = [];
  for (let q = 0; q < N; q++) {
    const z = R + 0.01 + (q / (N - 1)) * (L - 0.02);
    const hw = lerpK(HW, z), yTop = lerpK(DECK, z);
    let arch = CH;
    for (const [wz, r] of [[AX_F, WR_F], [AX_R, WR_R]]) { const dz = (z - wz) / (r * 1.2); if (Math.abs(dz) < 1) arch = Math.max(arch, r + Math.sqrt(1 - dz * dz) * r * 0.78); }
    const belt = yTop - 0.17, inner = hw * 0.62, y3 = Math.min(arch, belt - 0.1), k3 = Math.min(1, (y3 - CH) / 0.3);
    secs.push({ z, pts: ring([
      [0, CH, 'dark'], [inner, CH, 'dark'], [inner, arch, 'dark'], [hw * (0.9 + 0.08 * k3), y3, 'paint'], [hw * 0.995, y3 + (belt - y3) * 0.5, 'paint'], [hw, belt, 'paint'],
      [hw * 0.985, yTop - 0.1, 'paint'], [hw * 0.94, yTop - 0.045, 'paint'], [hw * 0.78, yTop - 0.016, 'paint'], [hw * 0.4, yTop - 0.004, 'paint'], [0, yTop, 'paint'],
    ]) });
  }
  loft(secs, out, 'paint', 'paint');

  // ---- greenhouse with a carbon roof ----
  const cab: Sec[] = [], M = 60;
  for (let q = 0; q < M; q++) {
    const z = ROOF[ROOF.length - 1][0] + (q / (M - 1)) * (ROOF[0][0] - ROOF[ROOF.length - 1][0]);
    const top = lerpK(ROOF, z), base = lerpK(DECK, z) - 0.01, hw = lerpK(HW, z);
    const bw = hw * 0.88, k = Math.min(1, (top - base) / 0.38);
    const rw = bw * (0.9 - 0.32 * k), winTop = base + (top - base) * 0.84, bwm = bw - (bw - rw) * 0.55;
    const pts: [number, number, Tag][] = [[-bw, base, 'glass'], [-bwm, winTop, 'paint'], [-rw, top - 0.004, 'carbon'], [0, top, 'carbon'], [rw, top - 0.004, 'carbon'], [bwm, winTop, 'glass'], [bw, base, 'dark']];
    if (z > 0.35 || z < -1.1) for (const i of [1, 2, 3, 4]) pts[i][2] = 'glass';
    else if (z > 0.05 || z < -0.95) for (const i of [2, 3, 4]) pts[i][2] = 'carbon';
    cab.push({ z, pts });
  }
  loft(cab, out, 'glass', 'glass');

  const hwAt = (z: number) => lerpK(HW, z);
  // ---- front: double kidney grille, slim hockey stick headlamps, corner intakes, bonnet bulges ----
  for (const sx of [1, -1]) {
    // kidney: tall trapezoid, wider at the top, dark surround and opening with horizontal bars
    faceSlab('carbon', sx, [[0.015, 0.325], [0.255, 0.335], [0.3, 0.635], [0.015, 0.635]], false, 0.022);
    faceSlab('dark', sx, [[0.035, 0.35], [0.24, 0.355], [0.275, 0.615], [0.035, 0.615]], false, 0.036);
    for (const y of [0.42, 0.485, 0.55]) box('carbon', sx * 0.15, y, F + 0.012, 0.19, 0.016, 0.01);
    // slim headlamp sweeping up and out from the kidney: dark housing, white lens, amber DRL along the top and a hook down at the inner end
    faceSlab('dark', sx, [[0.33, 0.585], [0.38, 0.67], [0.6, 0.675], [0.78, 0.725], [0.805, 0.7], [0.76, 0.595], [0.52, 0.575]], false, 0.02);
    faceSlab('head', sx, [[0.355, 0.605], [0.395, 0.655], [0.6, 0.66], [0.765, 0.705], [0.785, 0.685], [0.74, 0.607], [0.52, 0.592]], false, 0.03);
    faceSlab('amber', sx, [[0.42, 0.642], [0.6, 0.646], [0.75, 0.69], [0.76, 0.678], [0.6, 0.633], [0.44, 0.63]], false, 0.036);
    faceSlab('amber', sx, [[0.37, 0.64], [0.405, 0.64], [0.4, 0.595], [0.368, 0.6]], false, 0.036);
    // wide lower intake with a divider, and the tall angled corner intakes
    faceSlab('dark', sx, [[0.0, 0.2], [0.56, 0.2], [0.56, 0.31], [0.0, 0.31]], false, 0.022);
    box('carbon', sx * 0.28, 0.255, F + 0.01, 0.56, 0.014, 0.01);
    faceSlab('dark', sx, [[0.6, 0.2], [0.76, 0.2], [0.76, 0.5], [0.68, 0.48], [0.6, 0.34]], false, 0.022);
    box('carbon', sx * 0.76, 0.36, F - 0.04, 0.04, 0.3, 0.05); // corner fin
    // bonnet power bulge stripes laid on the surface, behind the lamps towards the cowl
    onDeck('carbon', sx, [[0.1, 1.0], [0.32, 1.0], [0.36, 1.75], [0.14, 1.8]]);
    // gill behind the front wheel
    faceSide('dark', sx, 1.05, 0.62, 0.06, 0.26);
    // side skirt, door seam and handle, mirror
    box('carbon', sx * (hwAt(0) * 0.9 - 0.022), 0.21, 0.0, 0.05, 0.07, 2.0);
    box('dark', sx * (hwAt(0.2) + 0.006), 0.7, 0.2, 0.004, 0.01, 1.3);
    box('dark', sx * (hwAt(-0.3) + 0.006), 0.9, -0.3, 0.004, 0.026, 0.16);
    addGeo('carbon', new THREE.SphereGeometry(1, 16, 10).scale(0.05, 0.065, 0.1).translate(sx * 0.98, 1.05, 0.72));
    box('carbon', sx * 0.92, 1.03, 0.76, 0.1, 0.035, 0.07);
    // rear: slim wide L shaped tail lamp, outer reflector
    faceSlab('tail', sx, [[0.4, 0.99], [0.74, 0.99], [0.76, 0.91], [0.72, 0.78], [0.66, 0.8], [0.68, 0.89], [0.4, 0.91]], true, 0.03);
    // quad exhaust: two round tips each side
    disc('chrome', sx * 0.3, 0.28, R - 0.006, 0.055); disc('chrome', sx * 0.5, 0.28, R - 0.006, 0.055);
  }
  box('chrome', 0, 0.595, F + 0.01, 0.08, 0.05, 0.012); // roundel on the bonnet front
  box('carbon', 0, 0.19, F - 0.05, 1.56, 0.03, 0.1); // splitter lip
  // ---- rear: carbon diffuser, plate recess, boot lip and a wing ----
  box('dark', 0, 0.34, R + 0.006, 1.46, 0.26, 0.02);
  box('carbon', 0, 0.2, R + 0.0, 1.4, 0.04, 0.08);
  box('dark', 0, 0.68, R + 0.006, 0.52, 0.12, 0.02); // plate recess
  box('carbon', 0, lerpK(DECK, -2.2) + 0.016, -2.2, 1.55, 0.03, 0.18); // boot lip
  for (const sx of [1, -1]) {
    box('carbon', sx * 0.5, 1.1, R + 0.3, 0.05, 0.14, 0.12); // upright
    box('carbon', sx * 0.8, 1.2, R + 0.3, 0.03, 0.12, 0.32); // end plate
  }
  box('carbon', 0, 1.2, R + 0.3, 1.6, 0.035, 0.32); // wing blade

  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);
  chassis.scale.setScalar(S);
  const carbonM = new THREE.MeshStandardMaterial({ color: 0x151618, metalness: 0.4, roughness: 0.35 });
  const amberM = new THREE.MeshStandardMaterial({ color: 0xffc23a, emissive: 0xffa000, emissiveIntensity: 1.2 });
  const matFor = (t: string): THREE.Material => t === 'amber' ? amberM : t === 'paint' ? paint(color) : t === 'glass' ? MAT.glass : t === 'head' ? MAT.head : t === 'tail' ? MAT.tailOff : t === 'chrome' ? MAT.chrome : t === 'carbon' ? carbonM : MAT.trim;
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
    s.position.set(sx * (sz > 0 ? 0.7 : 0.66), sz > 0 ? 0.5 : 0.72, sz * (F - 0.005));
    chassis.add(s);
    (sx > 0 ? sigL : sigR).push(s);
  }
  const wheels = [[AX_F, WR_F, 0.255], [AX_R, WR_R, 0.295]].flatMap(([z, r, w]) => [1, -1].map((sx) => makeWheel(root, sx * WX * S, r * S, z * S, r * S, w * S, z > 0, 0x1b1c1f, 10, false, false)));
  return { root, chassis, body: body!, wheels, brake, sigL, sigR, heads, length: L * S, width: 1.89 * S, height: 1.39 * S, color, lod: [] };

  /** a thin flat vent on the side of the body (x thickness 0.004), centred at z with the given width and height */
  function faceSide(tag: Tag, sx: number, z: number, y: number, w: number, h: number) {
    box(tag, sx * (lerpK(HW, z) + 0.005), y, z, 0.004, h, w);
  }
}
