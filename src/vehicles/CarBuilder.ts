import * as THREE from 'three';
import { toCreasedNormals, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Kit, makeWheel, type VehicleModel } from './ModelKit';
import { MAT } from './Materials';
import { smoothstep } from '../core/math';

/**
 * Parametric car body. Side silhouette (x = length from the rear bumper, y = height)
 * is extruded across the width, then tapered (tumblehome, nose / tail plan-view rounding).
 */
export interface CarDef {
  L: number; W: number; H: number;
  wb: number; rOver: number; // wheelbase, rear overhang
  wr: number; ww: number; // wheel radius, wheel width
  wrR?: number; // rear wheel radius if different
  gc: number; // body bottom height
  beltF: number; beltR: number;
  noseH: number; tailH: number;
  hoodLen: number; deckLen: number;
  rearBase: number; roofR: number; roofF: number; wsBase: number; // cabin x positions
  cabinW: number; tumble: number; noseTaper: number; tailTaper: number;
  noseRound?: number; tailRound?: number;
  hoodCurve?: number; // bulge of hood line
  trackF?: number; trackR?: number;
  rimColor?: number; spokes?: number;
  /** extra decoration; x lateral (+ = left), y up, z forward from centre */
  extras?: (k: Kit, d: CarDef, zc: (x: number) => number) => void;
  lights?: 'slim' | 'round' | 'tall' | 'wide' | 'truck';
}

function bodyShape(d: CarDef) {
  const s = new THREE.Shape();
  const { L, gc } = d;
  const top: [number, number][] = [
    [0, gc + 0.12],
    [0.0, d.tailH - 0.14],
    [0.1, d.tailH],
    [Math.max(0.2, d.deckLen * 0.5), (d.tailH + d.beltR) / 2 + 0.01],
    [d.deckLen, d.beltR],
    [L - d.hoodLen, d.beltF],
    [L - d.hoodLen * 0.45, (d.beltF + d.noseH) / 2 + (d.hoodCurve ?? 0.02)],
    [L - 0.22, d.noseH + 0.04],
    [L, d.noseH - 0.12],
    [L - 0.02, gc + 0.16],
    [L - 0.1, gc],
  ];
  s.moveTo(top[0][0], top[0][1]);
  // traverse clockwise: go along bottom first (rear->front), then top back (front->rear)
  const xr = d.rOver, xf = d.rOver + d.wb;
  const arF = d.wr + 0.05, arR = (d.wrR ?? d.wr) + 0.05;
  const wrR = d.wrR ?? d.wr;
  s.lineTo(0.08, gc);
  s.lineTo(xr - arR, gc);
  s.lineTo(xr - arR, wrR);
  s.absarc(xr, wrR, arR, Math.PI, 0, true);
  s.lineTo(xr + arR, gc);
  s.lineTo(xf - arF, gc);
  s.lineTo(xf - arF, d.wr);
  s.absarc(xf, d.wr, arF, Math.PI, 0, true);
  s.lineTo(xf + arF, gc);
  for (let i = top.length - 1; i >= 1; i--) s.lineTo(top[i][0], top[i][1]);
  s.closePath();
  return s;
}

function cabinShape(d: CarDef) {
  const s = new THREE.Shape();
  s.moveTo(d.rearBase, d.beltR - 0.04);
  s.lineTo(d.wsBase, d.beltF - 0.04);
  s.quadraticCurveTo((d.wsBase + d.roofF) / 2 + 0.05, (d.beltF + d.H) / 2 + 0.04, d.roofF, d.H - 0.01);
  s.quadraticCurveTo((d.roofF + d.roofR) / 2, d.H + 0.03, d.roofR, d.H - 0.01);
  s.quadraticCurveTo((d.roofR + d.rearBase) / 2 - 0.02, (d.beltR + d.H) / 2 + 0.03, d.rearBase, d.beltR - 0.04);
  return s;
}

function extrude(shape: THREE.Shape, width: number, bevel: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // shape x (length) -> +z, extrusion -> x
  return g;
}

function taper(g: THREE.BufferGeometry, d: CarDef, zOff: number) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const belt = (d.beltF + d.beltR) / 2;
  const nr = d.noseRound ?? 0.7, tr = d.tailRound ?? 0.5;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const zl = z; // 0..L along length (before centring)
    let s = 1 - d.tumble * smoothstep(belt - 0.05, d.H, y);
    const uf = smoothstep(d.L - nr, d.L, zl);
    s *= 1 - d.noseTaper * uf * uf;
    const ur = smoothstep(tr, 0, zl);
    s *= 1 - d.tailTaper * ur * ur;
    s *= 1 - 0.05 * smoothstep(d.gc + 0.2, d.gc, y);
    p.setXYZ(i, x * s, y, z + zOff);
  }
  return toCreasedNormals(g, Math.PI / 4);
}

/** half-width of the tapered body at profile length x and height y */
export function halfWidth(d: CarDef, x: number, y: number) {
  const belt = (d.beltF + d.beltR) / 2;
  const nr = d.noseRound ?? 0.7, tr = d.tailRound ?? 0.5;
  let s = 1 - d.tumble * smoothstep(belt - 0.05, d.H, y);
  const uf = smoothstep(d.L - nr, d.L, x); s *= 1 - d.noseTaper * uf * uf;
  const ur = smoothstep(tr, 0, x); s *= 1 - d.tailTaper * ur * ur;
  return (d.W / 2) * s;
}

export function buildCar(d: CarDef, color: number, shadows = true, staticWheels = false): VehicleModel {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);
  const zOff = -d.L / 2;
  const zc = (x: number) => x + zOff; // profile x -> centred z

  const bodyGeo = taper(extrude(bodyShape(d), d.W, 0.06), d, zOff);
  const body = new THREE.Mesh(bodyGeo, new Kit(color).material('paint'));
  body.castShadow = shadows;
  body.name = 'paint';
  chassis.add(body);

  const cab = taper(extrude(cabinShape(d), d.W * d.cabinW, 0.08), d, zOff);

  const k = new Kit(color);
  k.add('glass', cab);
  // roof skin (paint) so the greenhouse reads as pillars + glass
  const roofLen = (d.roofF - d.roofR) * 0.92;
  const roofW = d.W * d.cabinW * (1 - d.tumble) * 0.98;
  k.box('paint', 0, d.H - 0.005, zc((d.roofF + d.roofR) / 2), roofW, 0.035, roofLen);
  // A-pillars/B-pillar hints in paint
  k.pair((sx) => {
    k.box('paint', sx * roofW * 0.5, (d.H + d.beltR) / 2, zc(d.rearBase + (d.roofR - d.rearBase) * 0.95 + (d.roofF - d.roofR) * 0.45), 0.04, d.H - d.beltR - 0.05, 0.08, [0, 0, 0]);
  });
  // under-body dark and side skirts
  k.box('misc', 0, d.gc + 0.05, 0, d.W * 0.9, 0.1, d.L * 0.8, [0, 0, 0], 0x0c0c0c);
  // mirrors
  const hwAt = (x: number, y: number) => halfWidth(d, x, y);
  k.pair((sx) => k.box('paint', sx * (hwAt(d.wsBase - 0.15, d.beltF) + 0.05), d.beltF + 0.07, zc(d.wsBase - 0.15), 0.14, 0.09, 0.16));
  // lights
  const style = d.lights ?? 'slim';
  const hw = style === 'wide' ? 0.5 : style === 'round' ? 0.3 : 0.38;
  const hh = style === 'tall' || style === 'truck' ? 0.2 : 0.09;
  k.pair((sx) => {
    const fw = hwAt(d.L - 0.12, d.noseH - 0.1);
    k.box('head', sx * (fw - hw / 2 - 0.02), d.noseH - 0.12, zc(d.L - 0.14), hw, hh, 0.2, [0.25, sx * 0.12, 0]);
    k.box(sx > 0 ? 'sigL' : 'sigR', sx * (fw - 0.05), d.noseH - 0.14, zc(d.L - 0.2), 0.08, 0.06, 0.12);
    const rw = hwAt(0.02, d.tailH - 0.13);
    const tw = style === 'truck' ? 0.18 : 0.45;
    k.box('tail', sx * (rw - tw / 2 - 0.02), d.tailH - 0.13, zc(0.0) - 0.01, tw, style === 'truck' ? 0.45 : 0.1, 0.06);
    k.box(sx > 0 ? 'sigL' : 'sigR', sx * (rw - 0.08), d.tailH - 0.26, zc(0.0) - 0.01, 0.12, 0.06, 0.05);
  });
  // grille + plate
  k.box('misc', 0, d.gc + 0.2, zc(d.L) - 0.02, hwAt(d.L, d.gc + 0.2) * 1.1, 0.18, 0.04, [0, 0, 0], 0x0a0a0a);
  k.box('misc', 0, d.tailH - 0.35, zc(0) - 0.03, 0.5, 0.12, 0.02, [0, 0, 0], 0xe8e8e0);
  d.extras?.(k, d, zc);
  const meshes = k.build(chassis, shadows);

  const wheels = [];
  const tf = (d.trackF ?? d.W - d.ww - 0.06) / 2, tr = (d.trackR ?? d.W - d.ww - 0.06) / 2;
  const rim = d.rimColor ?? 0x9aa0a6, spokes = d.spokes ?? 5;
  const wrR = d.wrR ?? d.wr;
  wheels.push(makeWheel(root, tf, d.wr, zc(d.rOver + d.wb), d.wr, d.ww, true, rim, spokes));
  wheels.push(makeWheel(root, -tf, d.wr, zc(d.rOver + d.wb), d.wr, d.ww, true, rim, spokes));
  wheels.push(makeWheel(root, tr, wrR, zc(d.rOver), wrR, d.ww * 1.05, false, rim, spokes));
  wheels.push(makeWheel(root, -tr, wrR, zc(d.rOver), wrR, d.ww * 1.05, false, rim, spokes));
  let wheelMesh: THREE.Mesh | undefined;
  if (staticWheels) {
    // traffic: merge the 4 wheels into one draw call (no spin)
    const geos = wheels.map((w) => {
      const m = w.spin.children[0] as THREE.Mesh;
      w.obj.updateMatrixWorld(true);
      const g2 = m.geometry.clone();
      g2.applyMatrix4(new THREE.Matrix4().makeRotationY(m.rotation.y));
      g2.applyMatrix4(new THREE.Matrix4().makeTranslation(w.obj.position.x, w.obj.position.y, w.obj.position.z));
      root.remove(w.obj);
      return g2;
    });
    wheelMesh = new THREE.Mesh(mergeGeometries(geos, false)!, (wheels[0].spin.children[0] as THREE.Mesh).material);
    wheelMesh.name = 'wheels';
    root.add(wheelMesh);
    wheels.length = 0;
  }

  const g = (b: string) => (meshes.get(b as never) ? [meshes.get(b as never)!] : []);
  return {
    root, chassis, body, wheels,
    brake: g('tail'), sigL: g('sigL'), sigR: g('sigR'), heads: g('head'),
    length: d.L, width: d.W, height: d.H, color,
    lod: [...g('misc'), ...g('glass'), ...g('sigL'), ...g('sigR'), ...g('chrome')],
    wheelMesh,
  };
}

// ---------------------------------------------------------------------------
// Player car definitions (proportions from real dimensions, stylised details)
// ---------------------------------------------------------------------------
const quadExhaust = (k: Kit, zc: (x: number) => number, y: number, spread: number, r = 0.045) => {
  for (const x of [-spread - 0.1, -spread, spread, spread + 0.1]) k.cyl('chrome', x, y, zc(0) - 0.02, r, 0.12, [Math.PI / 2, 0, 0]);
};

export const CAR_DEFS: Record<string, CarDef> = {
  zr1: {
    L: 4.46, W: 1.93, H: 1.24, wb: 2.69, rOver: 0.78, wr: 0.34, wrR: 0.35, ww: 0.3, gc: 0.12,
    beltF: 0.82, beltR: 0.9, noseH: 0.62, tailH: 0.9, hoodLen: 1.75, deckLen: 0.55, hoodCurve: 0.0,
    rearBase: 0.62, roofR: 1.45, roofF: 2.3, wsBase: 2.95, cabinW: 0.74, tumble: 0.2, noseTaper: 0.32, tailTaper: 0.2,
    noseRound: 0.9, tailRound: 0.4, rimColor: 0xb8bcc2, spokes: 10, lights: 'wide',
    extras: (k, d, zc) => {
      // raised hood bulge with transparent window over the supercharger
      k.box('paint', 0, 0.86, zc(3.45), 0.78, 0.1, 1.05, [-0.07, 0, 0]);
      k.box('clearGlass', 0, 0.918, zc(3.45), 0.5, 0.02, 0.62, [-0.07, 0, 0]);
      k.box('engine', 0, 0.87, zc(3.45), 0.44, 0.06, 0.5, [-0.07, 0, 0]);
      k.cyl('chrome', 0, 0.9, zc(3.45), 0.03, 0.4, [-0.07, 0, Math.PI / 2]);
      // big carbon front splitter
      k.box('misc', 0, 0.13, zc(4.3), 1.45, 0.035, 0.3, [0, 0, 0], 0x161618);
      // wide rear fenders (ZR1 wider than base C6)
      k.pair((sx) => k.sphere('paint', sx * 0.84, 0.55, zc(0.8), 0.14, 0.3, 0.62));
      // rear spoiler (carbon, full width, raised lip)
      k.box('misc', 0, 0.99, zc(0.12), 1.58, 0.04, 0.2, [0.12, 0, 0], 0x161618);
      k.pair((sx) => k.box('misc', sx * 0.65, 0.95, zc(0.18), 0.04, 0.08, 0.14, [0, 0, 0], 0x161618));
      // C6 quad round taillights
      k.pair((sx) => { k.cyl('tail', sx * 0.52, 0.76, zc(0.02), 0.075, 0.03, [Math.PI / 2, 0, 0]); k.cyl('tail', sx * 0.72, 0.76, zc(0.04), 0.075, 0.03, [Math.PI / 2, 0, 0]); });
      quadExhaust(k, zc, 0.3, 0.12, 0.05);
      k.pair((sx) => k.box('misc', sx * 0.93, 0.44, zc(3.1), 0.04, 0.12, 0.45, [0, 0, 0], 0x0a0a0a)); // fender vents
    },
  },
  m4: {
    L: 4.67, W: 1.87, H: 1.38, wb: 2.81, rOver: 0.85, wr: 0.34, ww: 0.27, gc: 0.14,
    beltF: 0.88, beltR: 0.98, noseH: 0.72, tailH: 0.98, hoodLen: 1.5, deckLen: 0.62,
    rearBase: 0.7, roofR: 1.55, roofF: 2.55, wsBase: 3.1, cabinW: 0.8, tumble: 0.22, noseTaper: 0.2, tailTaper: 0.18,
    rimColor: 0x2a2c2f, spokes: 7, lights: 'slim',
    extras: (k, d, zc) => {
      // kidney grilles
      k.pair((sx) => k.box('misc', sx * 0.17, 0.62, zc(4.66), 0.26, 0.2, 0.04, [0, 0, 0], 0x080808));
      k.pair((sx) => k.box('chrome', sx * 0.17, 0.62, zc(4.65), 0.29, 0.23, 0.02));
      k.box('paint', 0, 0.9, zc(3.7), 0.5, 0.05, 0.9, [-0.05, 0, 0]); // power dome
      k.box('misc', 0, 0.2, zc(4.55), 1.5, 0.12, 0.25, [0, 0, 0], 0x111111);
      k.box('paint', 0, 1.0, zc(0.18), 1.3, 0.03, 0.14, [0.18, 0, 0]); // lip spoiler
      quadExhaust(k, zc, 0.3, 0.45);
    },
  },
  huracan: {
    L: 4.46, W: 1.93, H: 1.17, wb: 2.62, rOver: 0.92, wr: 0.34, wrR: 0.35, ww: 0.31, gc: 0.12,
    beltF: 0.7, beltR: 0.95, noseH: 0.52, tailH: 0.93, hoodLen: 1.2, deckLen: 1.1, hoodCurve: 0.03,
    rearBase: 1.1, roofR: 1.9, roofF: 2.55, wsBase: 3.35, cabinW: 0.7, tumble: 0.25, noseTaper: 0.38, tailTaper: 0.12,
    noseRound: 1.1, tailRound: 0.3, rimColor: 0x1f2022, spokes: 5, lights: 'slim',
    extras: (k, d, zc) => {
      // wedge engine cover louvres
      for (let i = 0; i < 5; i++) k.box('misc', 0, 1.0 - i * 0.012, zc(1.65 - i * 0.15), 0.9, 0.02, 0.04, [0.15, 0, 0], 0x050505);
      // side intakes (hexagonal feel)
      k.pair((sx) => k.box('misc', sx * 0.92, 0.55, zc(1.55), 0.08, 0.3, 0.55, [0, 0, 0.1], 0x050505));
      // front aggressive intakes
      k.pair((sx) => k.box('misc', sx * 0.6, 0.28, zc(4.4), 0.5, 0.16, 0.06, [0, 0, sx * -0.1], 0x050505));
      k.box('misc', 0, 0.13, zc(4.3), 1.4, 0.03, 0.25, [0, 0, 0], 0x0a0a0a);
      k.box('misc', 0, 0.35, zc(0.02), 1.6, 0.22, 0.05, [0, 0, 0], 0x080808); // rear mesh
      k.pair((sx) => k.cyl('chrome', sx * 0.3, 0.42, zc(0) - 0.02, 0.06, 0.1, [Math.PI / 2, 0, 0]));
      k.box('misc', 0, 0.97, zc(0.12), 1.5, 0.03, 0.12, [-0.12, 0, 0], 0x111111);
    },
  },
  civic: {
    L: 4.52, W: 1.8, H: 1.42, wb: 2.7, rOver: 0.85, wr: 0.32, ww: 0.23, gc: 0.15,
    beltF: 0.86, beltR: 0.98, noseH: 0.72, tailH: 0.96, hoodLen: 1.2, deckLen: 0.3,
    rearBase: 0.25, roofR: 1.35, roofF: 2.7, wsBase: 3.3, cabinW: 0.82, tumble: 0.22, noseTaper: 0.24, tailTaper: 0.18,
    rimColor: 0x2a2c2f, spokes: 5, lights: 'slim',
    extras: (k, d, zc) => {
      k.box('misc', 0, 0.55, zc(4.51), 1.2, 0.08, 0.04, [0, 0, 0], 0x080808); // chrome bar area
      k.box('chrome', 0, 0.66, zc(4.5), 0.9, 0.05, 0.03);
      k.box('misc', 0, 0.28, zc(4.49), 1.3, 0.2, 0.05, [0, 0, 0], 0x050505);
      k.box('tail', 0, 0.9, zc(0.2), 1.35, 0.06, 0.1, [0.5, 0, 0]); // C-shaped rear light bar
      k.box('paint', 0, 1.0, zc(0.18), 1.2, 0.03, 0.12, [0.1, 0, 0]);
      k.cyl('chrome', -0.45, 0.28, zc(0) - 0.02, 0.04, 0.1, [Math.PI / 2, 0, 0]);
    },
  },
  supra: {
    L: 4.38, W: 1.85, H: 1.29, wb: 2.47, rOver: 0.85, wr: 0.34, ww: 0.28, gc: 0.12,
    beltF: 0.78, beltR: 0.98, noseH: 0.6, tailH: 0.96, hoodLen: 1.65, deckLen: 0.35, hoodCurve: 0.06,
    rearBase: 0.4, roofR: 1.35, roofF: 2.05, wsBase: 2.72, cabinW: 0.72, tumble: 0.26, noseTaper: 0.3, tailTaper: 0.22,
    noseRound: 0.9, rimColor: 0x1e1f21, spokes: 10, lights: 'slim',
    extras: (k, d, zc) => {
      // double bubble roof
      k.pair((sx) => k.sphere('paint', sx * 0.22, 1.27, zc(1.8), 0.25, 0.04, 0.5));
      // ducktail
      k.box('paint', 0, 1.0, zc(0.12), 1.5, 0.05, 0.22, [-0.2, 0, 0]);
      k.box('misc', 0, 0.35, zc(4.37), 1.1, 0.25, 0.05, [0, 0, 0], 0x050505); // big central intake
      k.pair((sx) => k.box('misc', sx * 0.7, 0.3, zc(4.3), 0.25, 0.16, 0.05, [0, 0, 0], 0x050505));
      k.pair((sx) => k.box('misc', sx * 0.2, 0.83, zc(3.3), 0.14, 0.02, 0.3, [0, 0, 0], 0x050505)); // hood vents
      k.pair((sx) => k.cyl('chrome', sx * 0.35, 0.28, zc(0) - 0.02, 0.055, 0.1, [Math.PI / 2, 0, 0]));
    },
  },
  jeep: {
    L: 4.83, W: 1.94, H: 1.8, wb: 2.92, rOver: 1.0, wr: 0.4, ww: 0.27, gc: 0.28,
    beltF: 1.12, beltR: 1.2, noseH: 1.05, tailH: 1.2, hoodLen: 1.35, deckLen: 0.05,
    rearBase: 0.06, roofR: 0.25, roofF: 2.9, wsBase: 3.5, cabinW: 0.86, tumble: 0.12, noseTaper: 0.12, tailTaper: 0.1,
    noseRound: 0.4, tailRound: 0.3, rimColor: 0xa8adb2, spokes: 6, lights: 'tall',
    extras: (k, d, zc) => {
      for (let i = 0; i < 7; i++) k.box('misc', -0.39 + i * 0.13, 0.85, zc(4.84), 0.07, 0.28, 0.04, [0, 0, 0], 0x0c0c0c); // 7-slot grille
      k.box('chrome', 0, 0.85, zc(4.835), 0.95, 0.3, 0.02);
      k.pair((sx) => k.box('chrome', sx * 0.6, 1.83, zc(1.6), 0.05, 0.05, 2.2)); // roof rails
      k.pair((sx) => k.box('misc', sx * 0.94, 0.62, zc(1.0), 0.08, 0.28, 0.9, [0, 0, 0], 0x1a1a1a)); // cladding
      k.pair((sx) => k.box('misc', sx * 0.94, 0.62, zc(3.9), 0.08, 0.28, 0.8, [0, 0, 0], 0x1a1a1a));
      k.box('misc', 0, 0.35, zc(4.8), 1.6, 0.25, 0.1, [0, 0, 0], 0x1a1a1a);
    },
  },
  urus: {
    L: 5.11, W: 2.02, H: 1.64, wb: 3.0, rOver: 1.05, wr: 0.42, ww: 0.33, gc: 0.2,
    beltF: 0.98, beltR: 1.15, noseH: 0.84, tailH: 1.1, hoodLen: 1.6, deckLen: 0.22, hoodCurve: 0.04,
    rearBase: 0.3, roofR: 1.2, roofF: 2.85, wsBase: 3.5, cabinW: 0.76, tumble: 0.24, noseTaper: 0.28, tailTaper: 0.2,
    rimColor: 0x1c1d1f, spokes: 5, lights: 'slim',
    extras: (k, d, zc) => {
      k.box('misc', 0, 0.45, zc(5.08), 1.4, 0.32, 0.06, [0, 0, 0], 0x050505); // huge lower intake
      k.pair((sx) => k.box('misc', sx * 0.72, 0.32, zc(5.0), 0.3, 0.3, 0.06, [0, 0, sx * 0.3], 0x050505));
      k.pair((sx) => k.box('misc', sx * 0.98, 0.55, zc(1.05), 0.07, 0.3, 0.95, [0, 0, 0], 0x0a0a0a));
      k.pair((sx) => k.box('misc', sx * 0.98, 0.55, zc(4.05), 0.07, 0.3, 0.95, [0, 0, 0], 0x0a0a0a));
      k.box('paint', 0, 1.66, zc(0.35), 1.3, 0.04, 0.2, [0.2, 0, 0]); // roof spoiler
      k.box('tail', 0, 0.98, zc(0) - 0.01, 1.5, 0.05, 0.05);
      quadExhaust(k, zc, 0.35, 0.55, 0.055);
    },
  },
  rcf: {
    L: 4.71, W: 1.85, H: 1.39, wb: 2.73, rOver: 0.95, wr: 0.34, ww: 0.27, gc: 0.13,
    beltF: 0.86, beltR: 0.98, noseH: 0.7, tailH: 0.98, hoodLen: 1.6, deckLen: 0.6,
    rearBase: 0.72, roofR: 1.6, roofF: 2.55, wsBase: 3.15, cabinW: 0.8, tumble: 0.22, noseTaper: 0.22, tailTaper: 0.2,
    rimColor: 0x9ea3a8, spokes: 10, lights: 'slim',
    extras: (k, d, zc) => {
      // spindle grille (hourglass)
      k.box('misc', 0, 0.55, zc(4.7), 0.75, 0.45, 0.05, [0, 0, 0], 0x060606);
      k.pair((sx) => k.box('paint', sx * 0.36, 0.55, zc(4.715), 0.12, 0.3, 0.05, [0, 0, sx * 0.35]));
      k.box('paint', 0, 0.92, zc(3.8), 0.45, 0.06, 0.8, [-0.06, 0, 0]); // hood bulge
      k.pair((sx) => k.box('misc', sx * 0.85, 0.4, zc(4.6), 0.12, 0.2, 0.12, [0, 0, 0], 0x060606));
      k.box('paint', 0, 1.0, zc(0.15), 1.2, 0.04, 0.16, [0.2, 0, 0]);
      // stacked quad exhaust (RC F signature)
      k.pair((sx) => { k.cyl('chrome', sx * 0.55, 0.26, zc(0) - 0.02, 0.04, 0.1, [Math.PI / 2, 0, 0]); k.cyl('chrome', sx * 0.55, 0.36, zc(0) - 0.02, 0.04, 0.1, [Math.PI / 2, 0, 0]); });
    },
  },
  c63: {
    L: 4.75, W: 1.84, H: 1.43, wb: 2.84, rOver: 0.9, wr: 0.34, ww: 0.26, gc: 0.13,
    beltF: 0.88, beltR: 1.0, noseH: 0.72, tailH: 1.0, hoodLen: 1.55, deckLen: 0.55,
    rearBase: 0.62, roofR: 1.4, roofF: 2.6, wsBase: 3.2, cabinW: 0.8, tumble: 0.22, noseTaper: 0.22, tailTaper: 0.18,
    rimColor: 0x2a2c2f, spokes: 10, lights: 'slim',
    extras: (k, d, zc) => {
      // Panamericana grille
      k.box('misc', 0, 0.6, zc(4.74), 0.8, 0.3, 0.05, [0, 0, 0], 0x0a0a0a);
      for (let i = 0; i < 9; i++) k.box('chrome', -0.36 + i * 0.09, 0.6, zc(4.745), 0.02, 0.28, 0.03);
      k.cyl('chrome', 0, 0.62, zc(4.76), 0.09, 0.02, [Math.PI / 2, 0, 0]); // star badge
      k.pair((sx) => k.box('misc', sx * 0.1, 0.9, zc(3.6), 0.05, 0.02, 0.9, [-0.05, 0, 0], 0x333333)); // power domes
      k.box('paint', 0, 1.02, zc(0.12), 1.2, 0.03, 0.12, [0.15, 0, 0]);
      quadExhaust(k, zc, 0.28, 0.5);
    },
  },
};

// ---------------------------------------------------------------------------
// Generic traffic models
// ---------------------------------------------------------------------------
export const TRAFFIC_DEFS: Record<string, CarDef> = {
  sedan: {
    L: 4.8, W: 1.83, H: 1.46, wb: 2.8, rOver: 1.0, wr: 0.33, ww: 0.23, gc: 0.16,
    beltF: 0.9, beltR: 1.0, noseH: 0.76, tailH: 1.0, hoodLen: 1.35, deckLen: 0.75,
    rearBase: 0.85, roofR: 1.7, roofF: 2.8, wsBase: 3.4, cabinW: 0.84, tumble: 0.2, noseTaper: 0.18, tailTaper: 0.15, lights: 'slim',
  },
  hatch: {
    L: 4.1, W: 1.77, H: 1.48, wb: 2.6, rOver: 0.7, wr: 0.31, ww: 0.21, gc: 0.15,
    beltF: 0.9, beltR: 1.0, noseH: 0.74, tailH: 1.0, hoodLen: 1.0, deckLen: 0.1,
    rearBase: 0.12, roofR: 0.45, roofF: 2.3, wsBase: 2.95, cabinW: 0.86, tumble: 0.18, noseTaper: 0.2, tailTaper: 0.14, lights: 'round',
  },
  suv: {
    L: 4.7, W: 1.9, H: 1.72, wb: 2.8, rOver: 0.95, wr: 0.37, ww: 0.24, gc: 0.25,
    beltF: 1.05, beltR: 1.12, noseH: 0.98, tailH: 1.12, hoodLen: 1.2, deckLen: 0.08,
    rearBase: 0.1, roofR: 0.35, roofF: 2.85, wsBase: 3.45, cabinW: 0.86, tumble: 0.14, noseTaper: 0.14, tailTaper: 0.1, lights: 'tall',
    extras: (k, d, zc) => k.pair((sx) => k.box('misc', sx * 0.62, 1.74, zc(2), 0.05, 0.05, 2, [0, 0, 0], 0x222222)),
  },
  pickup: {
    L: 5.8, W: 2.0, H: 1.9, wb: 3.6, rOver: 1.2, wr: 0.4, ww: 0.27, gc: 0.35,
    beltF: 1.2, beltR: 1.25, noseH: 1.15, tailH: 1.25, hoodLen: 1.55, deckLen: 2.2,
    rearBase: 2.25, roofR: 2.35, roofF: 3.55, wsBase: 4.1, cabinW: 0.86, tumble: 0.08, noseTaper: 0.06, tailTaper: 0.04,
    noseRound: 0.3, tailRound: 0.2, lights: 'truck',
    extras: (k, d, zc) => {
      k.box('misc', 0, 1.2, zc(1.1), 1.7, 0.05, 2.0, [0, 0, 0], 0x1c1c1c); // bed floor (dark)
      k.box('chrome', 0, 0.95, zc(5.79), 1.2, 0.35, 0.04);
    },
  },
  van: {
    L: 5.3, W: 2.0, H: 2.35, wb: 3.3, rOver: 0.95, wr: 0.36, ww: 0.24, gc: 0.28,
    beltF: 1.15, beltR: 1.3, noseH: 1.0, tailH: 2.2, hoodLen: 0.7, deckLen: 0.05,
    rearBase: 3.4, roofR: 3.9, roofF: 4.45, wsBase: 4.6, cabinW: 0.92, tumble: 0.03, noseTaper: 0.14, tailTaper: 0.05,
    noseRound: 0.5, tailRound: 0.2, lights: 'truck',
    extras: (k, d, zc) => {
      // box body behind the cab
      k.box('paint', 0, 1.3 + 0.52, zc(1.8), d.W - 0.02, 1.05, 3.5);
      k.pair((sx) => k.box('glass', sx * (d.W / 2), 1.75, zc(3.2), 0.02, 0.4, 0.6));
    },
  },
  boxtruck: {
    L: 7.4, W: 2.4, H: 3.4, wb: 4.4, rOver: 1.6, wr: 0.48, ww: 0.3, gc: 0.4,
    beltF: 1.5, beltR: 1.4, noseH: 1.35, tailH: 1.4, hoodLen: 0.8, deckLen: 5.1,
    rearBase: 5.2, roofR: 5.3, roofF: 6.3, wsBase: 6.8, cabinW: 0.92, tumble: 0.05, noseTaper: 0.1, tailTaper: 0.02,
    noseRound: 0.5, tailRound: 0.1, lights: 'truck', H2: 0,
    extras: (k, d, zc) => {
      k.box('misc', 0, 2.15, zc(2.55), 2.44, 2.5, 5.1, [0, 0, 0], 0xe9e9e4); // cargo box
      k.box('misc', 0, 0.75, zc(2.55), 2.0, 0.3, 5.0, [0, 0, 0], 0x1a1a1a);
      k.pair((sx) => k.box('tail', sx * 1.05, 0.95, zc(0) - 0.02, 0.15, 0.3, 0.04));
    },
  } as CarDef & { H2: number },
};

export function glassHint() { return MAT.glass; }
