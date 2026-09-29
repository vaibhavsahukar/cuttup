import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeWheel, type VehicleModel } from './ModelKit';
import { MAT, paint } from './Materials';

/**
 * Sport bikes built from sharp, flat-sided parts. Each part is a side-profile outline
 * (z forward, y up) extruded to a width, which gives crisp fairing edges in the game's style.
 */
type Tag = 'paint' | 'a1' | 'a2' | 'dark' | 'metal' | 'chrome' | 'glass' | 'seat' | 'head' | 'tail';
type P = [number, number]; // (z, y)

interface Part { tag: Tag; pts: P[]; hw: number; x?: number; mirror?: boolean }
interface BikeDesign {
  wheelR: number; front: number; rear: number; // wheel radius and axle z positions
  rearR?: number; frontW?: number; rearW?: number; // rear wheel radius (default wheelR) and tyre widths
  rim?: number; spokes?: number; // rim colour and spoke count
  colors?: { a1?: number; a2?: number }; // accent paints (tags a1 / a2); they default to the body paint
  sigF?: P; // front indicator position
  dims?: [number, number, number]; // length, width, height reported to the game
  noMudguard?: boolean; // the design draws its own front fender
  tubes?: { tag: Tag; a: P; b: P; t: number; x: number; mirror?: boolean }[]; // frame tubes and pipes
  parts: Part[];
  fork: [P, P]; // bottom (axle) and top (clamp)
  bars: P; barW: number;
  heads: { z: number; y: number; x: number; w: number; h: number }[];
  tailLamp: P;
  exhaust?: { from: P; to: P; r: number; x: number };
  mirrors?: P;
}

const DESIGNS: Record<string, BikeDesign> = {
  // Honda CBR650R: short half fairing with a pointed nose, big tank, compact upswept tail,
  // exposed engine, short under-belly exhaust.
  cbr650: {
    wheelR: 0.3, front: 0.72, rear: -0.7,
    parts: [
      { tag: 'paint', hw: 0.19, pts: [[1.0, 0.8], [0.9, 0.66], [0.62, 0.5], [0.42, 0.52], [0.36, 0.78], [0.5, 0.95], [0.78, 0.97], [0.95, 0.9]] },
      { tag: 'paint', hw: 0.18, pts: [[0.38, 0.74], [0.44, 0.98], [0.2, 1.04], [-0.06, 0.99], [-0.12, 0.8]] },
      { tag: 'seat', hw: 0.14, pts: [[-0.06, 0.93], [-0.1, 0.84], [-0.52, 0.86], [-0.56, 0.92], [-0.3, 0.94]] },
      { tag: 'paint', hw: 0.12, pts: [[-0.12, 0.84], [-0.52, 0.87], [-0.86, 1.0], [-0.92, 0.97], [-0.66, 0.76], [-0.22, 0.7]] },
      { tag: 'dark', hw: 0.16, pts: [[0.36, 0.66], [0.3, 0.28], [-0.08, 0.26], [-0.26, 0.46], [-0.12, 0.74]] },
      { tag: 'metal', hw: 0.2, pts: [[0.46, 0.96], [0.52, 0.86], [-0.2, 0.58], [-0.26, 0.7]] },
      { tag: 'glass', hw: 0.1, pts: [[0.76, 0.97], [0.62, 1.1], [0.67, 1.12], [0.92, 0.91]] },
      { tag: 'dark', hw: 0.12, pts: [[-0.12, 0.46], [-0.2, 0.36], [-0.7, 0.28], [-0.7, 0.34]] }, // swingarm
      { tag: 'dark', hw: 0.07, pts: [[-0.66, 0.76], [-0.9, 0.62], [-0.94, 0.66], [-0.72, 0.8]] }, // hugger / plate hanger
    ],
    fork: [[0.72, 0.3], [0.5, 0.96]], bars: [0.46, 0.98], barW: 0.62,
    heads: [{ z: 0.985, y: 0.76, x: 0.055, w: 0.07, h: 0.035 }],
    tailLamp: [-0.9, 0.96],
    exhaust: { from: [0.05, 0.3], to: [-0.3, 0.34], r: 0.07, x: -0.08 },
    mirrors: [0.72, 1.0],
  },
  // Yamaha R6: full race fairing to the belly, sharp beak with a central ram-air intake,
  // tall bubble screen, knife-edge tail set high, under-engine exhaust.
  r6: {
    wheelR: 0.3, front: 0.72, rear: -0.68,
    parts: [
      { tag: 'paint', hw: 0.2, pts: [[1.04, 0.78], [0.92, 0.62], [0.72, 0.42], [0.2, 0.3], [0.05, 0.36], [0.2, 0.62], [0.38, 0.8], [0.52, 0.96], [0.8, 0.98], [0.98, 0.88]] },
      { tag: 'paint', hw: 0.17, pts: [[0.4, 0.8], [0.44, 1.0], [0.2, 1.05], [-0.08, 0.98], [-0.1, 0.8]] },
      { tag: 'seat', hw: 0.12, pts: [[-0.08, 0.93], [-0.1, 0.85], [-0.46, 0.9], [-0.5, 0.95], [-0.28, 0.95]] },
      { tag: 'paint', hw: 0.11, pts: [[-0.1, 0.84], [-0.5, 0.9], [-0.96, 1.08], [-1.0, 1.04], [-0.7, 0.8], [-0.2, 0.72]] },
      { tag: 'dark', hw: 0.14, pts: [[0.22, 0.62], [0.2, 0.34], [-0.1, 0.3], [-0.26, 0.48], [-0.1, 0.74]] },
      { tag: 'metal', hw: 0.19, pts: [[0.48, 0.97], [0.52, 0.88], [-0.18, 0.62], [-0.24, 0.72]] },
      { tag: 'glass', hw: 0.12, pts: [[0.8, 0.98], [0.6, 1.14], [0.66, 1.16], [0.98, 0.89]] },
      { tag: 'dark', hw: 0.12, pts: [[-0.12, 0.48], [-0.2, 0.38], [-0.68, 0.28], [-0.68, 0.34]] },
      { tag: 'dark', hw: 0.06, pts: [[-0.7, 0.8], [-0.94, 0.66], [-0.98, 0.7], [-0.76, 0.84]] },
    ],
    fork: [[0.72, 0.3], [0.52, 0.97]], bars: [0.47, 0.97], barW: 0.6,
    heads: [{ z: 1.0, y: 0.74, x: 0.085, w: 0.08, h: 0.03 }],
    tailLamp: [-0.97, 1.05],
    exhaust: { from: [0.0, 0.26], to: [-0.32, 0.3], r: 0.06, x: 0.05 },
    mirrors: [0.76, 1.0],
  },
  // Kawasaki ZX-6R (traced from the side photo, 710 px per metre): sharp full fairing with a tall screen, high
  // tank, stepped seat and an upswept tail, big black muffler on the right, belly pan under the engine.
  zx6r: {
    wheelR: 0.3, rearR: 0.312, front: 0.72, rear: -0.68, frontW: 0.12, rearW: 0.18, spokes: 7, rim: 0x25272a,
    colors: { a1: 0x62c51c },
    dims: [2.03, 0.72, 1.11], noMudguard: true,
    parts: [
      { tag: 'dark', hw: 0.15, pts: [[0.35, 0.8], [0.47, 0.92], [0.63, 0.87], [0.76, 0.8], [0.77, 0.71], [0.63, 0.61], [0.49, 0.51], [0.35, 0.43]] },
      { tag: 'paint', hw: 0.2, pts: [[0.4, 0.7], [0.49, 0.71], [0.59, 0.72], [0.65, 0.68], [0.7, 0.65], [0.69, 0.63], [0.61, 0.56], [0.49, 0.49], [0.43, 0.37], [0.42, 0.26], [0.39, 0.16], [0.25, 0.14], [0.07, 0.15], [-0.07, 0.16], [-0.19, 0.2], [-0.22, 0.26], [-0.07, 0.3], [0.07, 0.36], [0.21, 0.39], [0.33, 0.43], [0.33, 0.51], [0.36, 0.61]] },
      { tag: 'paint', hw: 0.2, pts: [[0.47, 1.02], [0.56, 0.99], [0.64, 0.95], [0.7, 0.92], [0.76, 0.86], [0.82, 0.78], [0.89, 0.71], [0.83, 0.69], [0.69, 0.63], [0.63, 0.65], [0.62, 0.74], [0.66, 0.81], [0.6, 0.87], [0.52, 0.94], [0.48, 0.99]] },
      { tag: 'dark', hw: 0.16, pts: [[0.35, 0.67], [0.21, 0.65], [0.07, 0.68], [-0.07, 0.7], [-0.22, 0.68], [-0.27, 0.63], [-0.23, 0.49], [-0.22, 0.29], [-0.07, 0.29], [0.01, 0.36], [0.21, 0.39], [0.33, 0.42]] },
      { tag: 'metal', hw: 0.17, pts: [[-0.09, 0.51], [0.04, 0.54], [0.18, 0.51], [0.22, 0.43], [0.19, 0.32], [0.07, 0.29], [-0.07, 0.3], [-0.12, 0.4]] },
      { tag: 'paint', hw: 0.17, pts: [[-0.22, 0.82], [-0.17, 0.83], [-0.14, 0.89], [-0.1, 0.92], [-0.07, 0.95], [-0.03, 0.97], [0.0, 0.98], [0.04, 0.98], [0.11, 0.98], [0.18, 0.96], [0.25, 0.94], [0.32, 0.91], [0.36, 0.88], [0.37, 0.85], [0.35, 0.8], [0.26, 0.73], [0.17, 0.68], [0.05, 0.65], [-0.07, 0.65], [-0.14, 0.65], [-0.19, 0.69], [-0.22, 0.74]] },
      { tag: 'seat', hw: 0.13, pts: [[-0.53, 0.89], [-0.5, 0.89], [-0.43, 0.86], [-0.33, 0.84], [-0.22, 0.82], [-0.16, 0.8], [-0.22, 0.78], [-0.36, 0.8], [-0.47, 0.83], [-0.53, 0.85]] },
      { tag: 'dark', hw: 0.1, pts: [[-0.88, 1.04], [-0.81, 1.03], [-0.69, 1.02], [-0.6, 1.0], [-0.56, 0.97], [-0.53, 0.89], [-0.56, 0.92], [-0.64, 0.97], [-0.74, 0.98], [-0.83, 1.0], [-0.87, 1.02]] },
      { tag: 'paint', hw: 0.12, pts: [[-0.83, 1.01], [-0.71, 0.98], [-0.6, 0.94], [-0.53, 0.89], [-0.53, 0.85], [-0.45, 0.82], [-0.33, 0.79], [-0.22, 0.74], [-0.33, 0.73], [-0.44, 0.75], [-0.51, 0.78], [-0.6, 0.84], [-0.69, 0.9], [-0.78, 0.95], [-0.82, 0.98]] },
      { tag: 'a1', hw: 0.178, pts: [[-0.19, 0.73], [-0.07, 0.77], [0.15, 0.78], [0.26, 0.73], [0.18, 0.71], [-0.07, 0.74]] },
      { tag: 'a1', hw: 0.125, pts: [[-0.78, 0.96], [-0.69, 0.94], [-0.6, 0.88], [-0.53, 0.83], [-0.55, 0.82], [-0.64, 0.86], [-0.74, 0.91]] },
      { tag: 'a1', hw: 0.205, pts: [[0.41, 0.65], [0.59, 0.69], [0.64, 0.67], [0.47, 0.61], [0.41, 0.62]] },
      { tag: 'a1', hw: 0.205, pts: [[-0.16, 0.25], [0.01, 0.3], [0.21, 0.35], [0.35, 0.35], [0.36, 0.3], [0.21, 0.29], [0.04, 0.23], [-0.14, 0.2]] },
      { tag: 'dark', hw: 0.07, x: -0.15, pts: [[-0.8, 0.64], [-0.75, 0.64], [-0.45, 0.46], [-0.32, 0.35], [-0.33, 0.3], [-0.4, 0.28], [-0.64, 0.35], [-0.89, 0.5]] },
      { tag: 'metal', hw: 0.075, x: -0.15, pts: [[-0.81, 0.65], [-0.78, 0.63], [-0.86, 0.5], [-0.89, 0.51]] },
      { tag: 'dark', hw: 0.09, pts: [[-0.2, 0.37], [-0.22, 0.29], [-0.67, 0.28], [-0.68, 0.33], [-0.47, 0.37]] },
      { tag: 'dark', hw: 0.05, pts: [[-0.99, 0.85], [-0.83, 0.87], [-0.76, 0.87], [-0.72, 0.85], [-0.81, 0.83], [-0.89, 0.82], [-0.93, 0.76], [-0.96, 0.73], [-1.0, 0.67], [-1.03, 0.65], [-1.0, 0.72], [-0.97, 0.8]] },
      { tag: 'dark', hw: 0.1, pts: [[-0.58, 0.56], [-0.41, 0.72], [-0.39, 0.71], [-0.56, 0.55]] },
      { tag: 'glass', hw: 0.12, pts: [[0.47, 1.02], [0.6, 1.1], [0.65, 1.08], [0.74, 0.99], [0.78, 0.91], [0.83, 0.83], [0.76, 0.86], [0.7, 0.92], [0.64, 0.95], [0.56, 0.99]] },
      { tag: 'paint', hw: 0.09, pts: [[0.59, 0.59], [0.7, 0.61], [0.83, 0.58], [0.94, 0.53], [0.91, 0.52], [0.78, 0.54], [0.69, 0.54], [0.61, 0.52]] },
    ],
    fork: [[0.72, 0.3], [0.56, 0.68]], bars: [0.4, 0.85], barW: 0.6,
    heads: [{ z: 0.845, y: 0.75, x: 0.075, w: 0.09, h: 0.05 }],
    sigF: [0.77, 0.79],
    tailLamp: [-0.82, 0.97],
    mirrors: [0.7, 0.97],
  },
};

export function buildBike(id: string, color: number, shadows = true): VehicleModel {
  const d = DESIGNS[id] ?? DESIGNS.cbr650;
  const out = new Map<Tag, THREE.BufferGeometry[]>();
  const add = (tag: Tag, g: THREE.BufferGeometry) => { let a = out.get(tag); if (!a) out.set(tag, (a = [])); a.push(g.index ? g.toNonIndexed() : g); };
  const side = (p: Part) => {
    const s = new THREE.Shape(p.pts.map(([z, y]) => new THREE.Vector2(z, y)));
    for (const sx of p.mirror ? [1, -1] : [1]) {
      const g = new THREE.ExtrudeGeometry(s, { depth: p.hw * 2, bevelEnabled: false });
      g.rotateY(-Math.PI / 2).translate(p.hw + sx * (p.x ?? 0), 0, 0);
      g.deleteAttribute('uv'); g.deleteAttribute('normal');
      add(p.tag, g);
    }
  };
  const box = (tag: Tag, x: number, y: number, z: number, w: number, h: number, dd: number, rotX = 0) => {
    const g = new THREE.BoxGeometry(w, h, dd); g.rotateX(rotX); g.translate(x, y, z);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    add(tag, g);
  };
  /** a bar between two side-profile points */
  const bar = (tag: Tag, a: P, b: P, x: number, t: number) => {
    const dz = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dz, dy);
    box(tag, x, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2, t, t, len, -Math.atan2(dy, dz));
  };
  for (const p of d.parts) side(p);
  for (const t of d.tubes ?? []) for (const sx of t.mirror ? [1, -1] : [1]) bar(t.tag, t.a, t.b, sx * t.x, t.t);
  for (const sx of [1, -1]) {
    bar('chrome', d.fork[0], d.fork[1], sx * 0.09, 0.05);
    bar('dark', [d.bars[0], d.bars[1]], [d.bars[0] - 0.06, d.bars[1] + 0.01], sx * d.barW * 0.4, 0.035);
    for (const h of d.heads) box('head', sx * h.x, h.y, h.z, h.w, h.h, 0.03);
    if (d.mirrors) box('dark', sx * 0.24, d.mirrors[1], d.mirrors[0], 0.1, 0.05, 0.03);
  }
  box('dark', 0, d.bars[1] + 0.005, d.bars[0], d.barW, 0.03, 0.03); // top clamp / bars
  box('chrome', 0, d.wheelR, d.front, 0.22, 0.06, 0.06); // front axle
  if (d.exhaust) bar('chrome', d.exhaust.from, d.exhaust.to, d.exhaust.x, d.exhaust.r * 2);
  box('tail', 0, d.tailLamp[1], d.tailLamp[0], 0.12, 0.04, 0.03);
  // front mudguard
  if (!d.noMudguard) box('paint', 0, d.wheelR * 2 + 0.03, d.front + 0.02, 0.12, 0.02, 0.3, 0.2);

  const root = new THREE.Group(), lean = new THREE.Group(), chassis = new THREE.Group();
  root.add(lean); lean.add(chassis);
  const mat = (t: Tag): THREE.Material => t === 'paint' ? paint(color) : t === 'a1' ? paint(d.colors?.a1 ?? color) : t === 'a2' ? paint(d.colors?.a2 ?? color) : t === 'glass' ? MAT.clearGlass : t === 'head' ? MAT.head : t === 'tail' ? MAT.tailOff
    : t === 'chrome' ? MAT.chrome : t === 'metal' ? MAT.engine : t === 'seat' ? MAT.seat : MAT.trim;
  let body: THREE.Mesh | undefined;
  const brake: THREE.Mesh[] = [], heads: THREE.Mesh[] = [];
  for (const [tag, gs] of out) {
    let g = new THREE.BufferGeometry();
    const pos: number[] = [];
    for (const x of gs) pos.push(...(x.attributes.position.array as Float32Array));
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g = toCreasedNormals(g, Math.PI / 5);
    const m = new THREE.Mesh(g, mat(tag));
    m.name = tag;
    m.castShadow = shadows && tag !== 'glass';
    chassis.add(m);
    if (tag === 'paint') body = m;
    if (tag === 'tail') brake.push(m);
    if (tag === 'head') heads.push(m);
  }
  const sigL: THREE.Mesh[] = [], sigR: THREE.Mesh[] = [];
  const sg = new THREE.BoxGeometry(0.05, 0.03, 0.03);
  for (const sx of [1, -1]) for (const [z, y] of [d.sigF ?? [0.9, 0.84], [d.tailLamp[0] + 0.1, d.tailLamp[1] - 0.08]]) {
    const s = new THREE.Mesh(sg, MAT.sigOff);
    s.position.set(sx * 0.13, y, z);
    chassis.add(s);
    (sx > 0 ? sigL : sigR).push(s);
  }
  const wheels = [d.front, d.rear].map((z) => {
    const r = z > 0 ? d.wheelR : d.rearR ?? d.wheelR;
    const w = makeWheel(chassis, 0, r, z, r, z > 0 ? d.frontW ?? 0.12 : d.rearW ?? 0.18, z > 0, d.rim ?? 0x2a2c2f, d.spokes ?? 3, true, false);
    w.left = true;
    return w;
  });
  return {
    root, chassis, body: body!, wheels, brake, sigL, sigR, heads,
    length: d.dims?.[0] ?? 2.1, width: d.dims?.[1] ?? 0.7, height: d.dims?.[2] ?? 1.16, color, lod: [],
    bike: { lean, fork: new THREE.Group() },
  };
}
