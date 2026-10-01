import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeWheel, type VehicleModel } from './ModelKit';
import { MAT, paint } from './Materials';
import { loft, ring, lerpK, type Tag, type Sec } from './Z350Builder';

/**
 * Corvette C8 (Z06), modelled for likeness from the front and rear photos: a low pointed beak, long slim blade
 * headlamps lying along the fenders, an angular lower mouth with corner intakes, a cab forward cabin with a black roof
 * centre, big angular scoops behind the doors, wide hips with mesh vents, boomerang tail lamps, a quad centre exhaust
 * and a raised wing. 4.63 m long, 2.1 m wide, 1.23 m tall, wheelbase 2.72 m.
 */
const F = 2.289, R = -2.158, L = F - R;
const AX_F = 1.435, AX_R = -1.28, WR_F = 0.335, WR_R = 0.35, WX = 0.9, CH = 0.15;

// keys run from the nose (+z) to the tail (-z). The profile is traced from the side photo and mapped to the real axle
// positions: a short low nose, a flat hood, a steeply raked screen, the roof peak just ahead of the middle, then one long
// slope down over the engine cover to a high tail.
const DECK: [number, number][] = [[F, 0.539], [2.137, 0.624], [1.961, 0.709], [1.786, 0.788], [1.669, 0.824], [1.435, 0.848], [1.172, 0.861], [0.996, 0.873], [0.733, 0.897], [0.265, 0.915], [-0.319, 0.952], [-0.436, 0.988], [-0.787, 0.994], [-1.288, 0.976], [-1.865, 0.952], [-1.981, 0.927], [-2.096, 0.855], [R, 0.703]];
const HW: [number, number][] = [[F, 0.7], [2.2, 0.82], [1.95, 0.93], [1.55, 0.98], [1.0, 0.97], [0.3, 0.96], [-0.5, 0.97], [-1.0, 1.0], [-1.5, 1.04], [-1.9, 1.045], [-2.1, 1.0], [R, 0.9]];
const ROOF: [number, number][] = [[1.172, 0.873], [1.084, 0.891], [0.996, 0.909], [0.909, 0.939], [0.821, 0.988], [0.733, 1.036], [0.646, 1.085], [0.558, 1.121], [0.47, 1.158], [0.382, 1.182], [0.295, 1.2], [0.207, 1.212], [0.119, 1.212], [0.031, 1.218], [-0.056, 1.212], [-0.144, 1.206], [-0.232, 1.194], [-0.319, 1.176], [-0.407, 1.158], [-0.495, 1.145], [-0.583, 1.127], [-0.67, 1.109], [-0.758, 1.097], [-0.846, 1.085], [-0.933, 1.061], [-1.021, 1.042], [-1.109, 1.024], [-1.197, 1.006], [-1.288, 0.988]];

export function buildC8(color: number, shadows = true): VehicleModel {
  const out = new Map<Tag, number[]>();
  const push = (tag: Tag, a: ArrayLike<number>) => { let t = out.get(tag); if (!t) out.set(tag, (t = [])); for (let i = 0; i < a.length; i++) t.push(a[i]); };
  const addGeo = (tag: Tag, g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; push(tag, n.attributes.position.array as Float32Array); };
  const box = (tag: Tag, x: number, y: number, z: number, w: number, h: number, d: number) => addGeo(tag, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const disc = (tag: Tag, x: number, y: number, z: number, r: number, d = 0.04) => addGeo(tag, new THREE.CylinderGeometry(r, r, d, 24).rotateX(Math.PI / 2).translate(x, y, z));
  const flip = (g: THREE.BufferGeometry) => { if (g.index) { const a = g.index.array as any; for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; } } };
  /** a flat shape cut from an (x, y) outline on the front face, or the rear face when rear is set; x is for the +x side, mirrored by sx */
  const faceSlab = (tag: Tag, sx: number, pts: [number, number][], rear: boolean, depth = 0.03) => {
    const mx = rear ? -sx : sx;
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * mx, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
    if (mx < 0) flip(g);
    if (rear) g.rotateY(Math.PI).translate(0, 0, R + 0.012); else g.translate(0, 0, F - 0.026);
    addGeo(tag, g);
  };
  /** a flat shape on the side of the body: outline in (z, y), thin plate standing just proud of the flank at x0 */
  const sideSlab = (tag: Tag, sx: number, pts: [number, number][], x0: number, depth = 0.008) => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y))), { depth, bevelEnabled: false });
    g.rotateY(-Math.PI / 2).translate(x0 + depth, 0, 0);
    if (sx < 0) { g.scale(-1, 1, 1); flip(g); }
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

  // ---- cab forward greenhouse: raked screen, side glass, black roof centre, painted sail panels and engine cover behind ----
  const cab: Sec[] = [], M = 90;
  for (let q = 0; q < M; q++) {
    const z = ROOF[ROOF.length - 1][0] + (q / (M - 1)) * (ROOF[0][0] - ROOF[ROOF.length - 1][0]);
    const top = lerpK(ROOF, z), base = lerpK(DECK, z) - 0.01, hw = lerpK(HW, z);
    const bw = hw * 0.86, k = Math.min(1, Math.max(0, (top - base)) / 0.3);
    const rw = bw * (0.9 - 0.32 * k), winTop = base + (top - base) * 0.82, bwm = bw - (bw - rw) * 0.55;
    const sideT: Tag = z > -0.26 && z < 0.56 ? 'glass' : z > -0.58 && z <= -0.26 ? 'dark' : 'paint';
    const roofT: Tag = z > -0.3 && z < 0.55 ? 'carbon' : 'paint';
    const pts: [number, number, Tag][] = [[-bw, base, sideT], [-bwm, winTop, 'paint'], [-rw, top - 0.004, roofT], [0, top, roofT], [rw, top - 0.004, 'paint'], [bwm, winTop, sideT], [bw, base, 'dark']];
    if (z >= 0.56) for (const i of [1, 2, 3, 4]) pts[i][2] = 'glass';
    cab.push({ z, pts });
  }
  loft(cab, out, 'glass', 'paint');

  const hwAt = (z: number) => lerpK(HW, z);
  /** x of the body flank at height y (the section the lower body is lofted from), so side details sit on the surface */
  const flankX = (z: number, y: number) => {
    const hw = lerpK(HW, z), yTop = lerpK(DECK, z), belt = yTop - 0.17;
    let arch = CH;
    for (const [wz, r] of [[AX_F, WR_F], [AX_R, WR_R]]) { const dz = (z - wz) / (r * 1.2); if (Math.abs(dz) < 1) arch = Math.max(arch, r + Math.sqrt(1 - dz * dz) * r * 0.78); }
    const y3 = Math.min(arch, belt - 0.1), k3 = Math.min(1, (y3 - CH) / 0.3);
    const keys: [number, number][] = [[y3, hw * (0.9 + 0.08 * k3)], [y3 + (belt - y3) * 0.5, hw * 0.995], [belt, hw]];
    if (y <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (y <= keys[i][0]) { const u = (y - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]); return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * u; }
    return hw;
  };
  /** a thin dark line along a (z, y) polyline on the flank (door seams) */
  const sideLine = (tag: Tag, sx: number, pts: [number, number][], t = 0.008) => {
    for (let i = 1; i < pts.length; i++) {
      const [z0, y0] = pts[i - 1], [z1, y1] = pts[i], len = Math.hypot(z1 - z0, y1 - y0), zm = (z0 + z1) / 2, ym = (y0 + y1) / 2;
      const g = new THREE.BoxGeometry(0.006, t, len + 0.004); g.rotateX(-Math.atan2(y1 - y0, z1 - z0)); g.translate(sx * (flankX(zm, ym) + 0.002), ym, zm);
      addGeo(tag, g);
    }
  };
  for (const sx of [1, -1]) {
    // headlamp: a long slim blade lying along the fender, pointing forward and in; dark housing under it
    const blade: [number, number][] = [[0.9, 1.5], [0.95, 1.6], [0.9, 1.78], [0.78, 1.98], [0.62, 2.15], [0.5, 2.22], [0.55, 2.12], [0.68, 1.92], [0.82, 1.7]];
    const grow = (o: [number, number][], f: number): [number, number][] => { let cx = 0, cz = 0; for (const p of o) { cx += p[0]; cz += p[1]; } cx /= o.length; cz /= o.length; return o.map(([x, z]) => [cx + (x - cx) * f, cz + (z - cz) * f]); };
    onDeck('dark', sx, grow(blade, 1.14), 0.01);
    onDeck('head', sx, blade, 0.02);
    // angular lower mouth and corner intakes on the nose face, orange beak edge stays body colour
    faceSlab('dark', sx, [[0, 0.2], [0.46, 0.2], [0.56, 0.3], [0.4, 0.4], [0, 0.4]], false, 0.022);
    faceSlab('dark', sx, [[0.46, 0.22], [0.68, 0.24], [0.7, 0.45], [0.54, 0.46], [0.46, 0.34]], false, 0.022);
    for (const y of [0.3, 0.35, 0.4]) box('carbon', sx * 0.58, y, F + 0.006, 0.16, 0.01, 0.01);
    // side: the long swoopy black blade of the door scoop (pointed at the front end), door seams, sill, mirror
    sideSlab('carbon', sx, [[0.061, 0.806], [-0.056, 0.8], [-0.319, 0.764], [-0.553, 0.685], [-0.7, 0.552], [-0.682, 0.461], [-0.553, 0.418], [-0.542, 0.491], [-0.378, 0.612], [-0.173, 0.715]], flankX(-0.35, 0.62) + 0.002);
    sideLine('dark', sx, [[0.996, 0.867], [1.014, 0.612], [1.026, 0.236]]); // door front edge
    sideLine('dark', sx, [[-0.319, 0.939], [-0.343, 0.642], [-0.261, 0.418], [-0.115, 0.279]]); // door rear edge
    sideLine('dark', sx, [[-0.115, 0.279], [0.441, 0.248], [1.026, 0.236]]); // door bottom
    box('carbon', sx * (flankX(0, 0.22) - 0.03), 0.2, 0.0, 0.05, 0.06, 2.2); // side sill
    addGeo('paint', new THREE.SphereGeometry(1, 16, 10).scale(0.05, 0.065, 0.11).translate(sx * 0.99, 0.95, 0.68));
    box('carbon', sx * 0.9, 0.93, 0.7, 0.14, 0.035, 0.08);
    // rear: boomerang tail lamp pair, mesh vent below, outer side marker
    faceSlab('tail', sx, [[0.2, 0.86], [0.5, 0.87], [0.8, 0.85], [0.86, 0.76], [0.72, 0.77], [0.5, 0.8], [0.2, 0.79]], true, 0.03);
    
    faceSlab('dark', sx, [[0.36, 0.56], [0.82, 0.56], [0.84, 0.68], [0.36, 0.68]], true, 0.022); // fender vent
    for (const y of [0.6, 0.64]) box('carbon', sx * 0.6, y, R - 0.014, 0.44, 0.01, 0.006);
    // wing end plate
    box('carbon', sx * 0.9, 1.1, R + 0.25, 0.03, 0.12, 0.34);
    box('carbon', sx * 0.45, 1.03, R + 0.32, 0.05, 0.14, 0.12);
  }
  // nose details: splitter, crossed flags badge, hood creases (laid on the surface)
  box('carbon', 0, 0.17, F - 0.06, 1.3, 0.03, 0.12); // splitter
  box('chrome', 0, 0.64, F - 0.03, 0.08, 0.05, 0.012);
  // rear: plate recess, black lower valance with the quad centre exhaust, wing blade
  box('dark', 0, 0.6, R + 0.006, 0.5, 0.12, 0.02);
  box('dark', 0, 0.3, R + 0.006, 1.5, 0.22, 0.02);
  box('carbon', 0, 0.17, R + 0.0, 1.4, 0.04, 0.08);
  for (const x of [-0.27, -0.09, 0.09, 0.27]) disc('chrome', x, 0.28, R - 0.006, 0.065);
  box('carbon', 0, 1.12, R + 0.25, 1.8, 0.035, 0.32);

  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);
  const carbonM = new THREE.MeshStandardMaterial({ color: 0x151618, metalness: 0.4, roughness: 0.35 });
  const matFor = (t: string): THREE.Material => t === 'paint' ? paint(color) : t === 'glass' ? MAT.glass : t === 'head' ? MAT.head : t === 'tail' ? MAT.tailOff : t === 'chrome' ? MAT.chrome : t === 'carbon' ? carbonM : MAT.trim;
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
    s.position.set(sx * (sz > 0 ? 0.66 : 0.8), sz > 0 ? 0.5 : 0.62, sz * (F - 0.005));
    chassis.add(s);
    (sx > 0 ? sigL : sigR).push(s);
  }
  const wheels = [[AX_F, WR_F, 0.27], [AX_R, WR_R, 0.31]].flatMap(([z, r, w]) => [1, -1].map((sx) => makeWheel(root, sx * WX, r, z, r, w, z > 0, 0x1b1c1f, 5, false, false)));
  return { root, chassis, body: body!, wheels, brake, sigL, sigR, heads, length: L, width: 2.1, height: 1.22, color, lod: [] };
}
