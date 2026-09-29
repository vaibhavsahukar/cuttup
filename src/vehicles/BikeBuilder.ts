import * as THREE from 'three';
import { Kit, makeWheel, type VehicleModel, type Rider } from './ModelKit';
import { MAT, paint } from './Materials';

export interface BikeDef {
  wb: number; wr: number;
  accent: number; accent2: number;
  style: 'sport' | 'supermoto';
  nose: number; // how pointy / long the front fairing is
  tail: number; // tail height
  exhaust: 'side' | 'under' | 'high';
  rimColor: number;
}

export const BIKE_DEFS: Record<string, BikeDef> = {
  r6: { wb: 1.38, wr: 0.31, accent: 0xf2f2f2, accent2: 0x0a0a0a, style: 'sport', nose: 1.1, tail: 1.02, exhaust: 'side', rimColor: 0x1446c8 },
  zx6r: { wb: 1.4, wr: 0.31, accent: 0x39c43a, accent2: 0x2a2a2a, style: 'sport', nose: 1.0, tail: 0.98, exhaust: 'side', rimColor: 0x1e1e1e },
  cbr600: { wb: 1.37, wr: 0.31, accent: 0xf2f2f2, accent2: 0x0c0c0c, style: 'sport', nose: 0.95, tail: 1.0, exhaust: 'under', rimColor: 0x1e1e1e },
  smc: { wb: 1.48, wr: 0.31, accent: 0x1a1a1a, accent2: 0xf2f2f2, style: 'supermoto', nose: 0.6, tail: 0.98, exhaust: 'high', rimColor: 0x1c1c1c },
};

function limb(mat: THREE.Material, len: number, r: number) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat);
  m.position.y = -len / 2;
  m.castShadow = true;
  g.add(m);
  return g;
}

export function buildRider(helmetColor: number, upright: boolean): Rider {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  const tm = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 8), MAT.suit);
  tm.position.y = 0.3;
  tm.castShadow = true;
  torso.add(tm);
  const hump = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.3), paint(helmetColor));
  hump.position.set(0, 0.35, -0.12);
  torso.add(hump);
  const head = new THREE.Group();
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), paint(helmetColor));
  helmet.scale.set(1, 1, 1.15);
  helmet.castShadow = true;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 12, 8, -0.9, 1.8, 1.0, 0.7), MAT.glass);
  head.add(helmet, visor);
  head.position.y = 0.72;
  torso.add(head);
  const armL = limb(MAT.suit, 0.5, 0.06), armR = limb(MAT.suit, 0.5, 0.06);
  armL.position.set(0.2, 0.55, 0.02); armR.position.set(-0.2, 0.55, 0.02);
  torso.add(armL, armR);
  const legL = limb(MAT.suit, 0.72, 0.075), legR = limb(MAT.suit, 0.72, 0.075);
  legL.position.set(0.14, 0.0, 0); legR.position.set(-0.14, 0.0, 0);
  root.add(torso, legL, legR);
  // riding pose
  torso.rotation.x = upright ? 0.3 : 0.95;
  armL.rotation.x = armR.rotation.x = upright ? -1.1 : -1.35;
  armL.rotation.z = 0.25; armR.rotation.z = -0.25;
  legL.rotation.x = legR.rotation.x = upright ? -1.3 : -1.7;
  legL.rotation.z = 0.25; legR.rotation.z = -0.25;
  // bend knees by adding shins
  for (const [leg, sx] of [[legL, 1], [legR, -1]] as const) {
    const shin = limb(MAT.suit, 0.45, 0.07);
    shin.position.y = -0.62;
    shin.rotation.x = upright ? 1.9 : 2.3;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.26), MAT.trim);
    boot.position.set(0, -0.5, 0.06);
    shin.add(boot);
    leg.add(shin);
    void sx;
  }
  return { root, torso, head, armL, armR, legL, legR };
}

export function buildBike(id: string, color: number, shadows = true): VehicleModel {
  const d = BIKE_DEFS[id];
  const root = new THREE.Group();
  const lean = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(lean);
  lean.add(chassis);
  const k = new Kit(color);
  const zr = -d.wb / 2, zf = d.wb / 2;
  const sport = d.style === 'sport';

  // engine block + frame
  k.box('engine', 0, 0.45, 0.05, 0.34, 0.36, 0.46, [0.15, 0, 0]);
  k.pair((sx) => k.box('misc', sx * 0.15, 0.72, 0.05, 0.05, 0.1, 0.7, [0.35, 0, 0], sport ? 0x3a3c40 : 0xff6a00));
  // swingarm
  k.pair((sx) => k.box('misc', sx * 0.12, 0.38, zr * 0.55, 0.04, 0.08, Math.abs(zr) * 0.95, [-0.12, 0, 0], 0x55585c));
  // fork (raked)
  const rake = sport ? 0.42 : 0.47;
  const forkLen = sport ? 0.78 : 0.95;
  k.pair((sx) => k.cyl('chrome', sx * 0.09, d.wr + Math.cos(rake) * forkLen / 2, zf - Math.sin(rake) * forkLen / 2, 0.026, forkLen, [-rake, 0, 0], undefined, 8));
  const topY = d.wr + Math.cos(rake) * forkLen, topZ = zf - Math.sin(rake) * forkLen;
  // front mudguard
  k.box('paint', 0, d.wr + 0.08, zf + 0.02, 0.12, 0.03, 0.4, [0.25, 0, 0]);

  if (sport) {
    // front fairing / nose
    k.sphere('paint', 0, 0.9, topZ + 0.08, 0.22, 0.2, 0.36 * d.nose, undefined, [-0.35, 0, 0]);
    k.box('clearGlass', 0, 1.06, topZ - 0.02, 0.26, 0.02, 0.3, [-0.75, 0, 0]);
    k.pair((sx) => k.sphere('paint', sx * 0.1, 0.68, 0.22, 0.14, 0.26, 0.5, undefined, [0.2, 0, 0]));
    k.pair((sx) => k.box('misc', sx * 0.2, 0.62, 0.3, 0.02, 0.18, 0.4, [0.2, 0, 0], d.accent)); // accent panels
    k.box('misc', 0, 0.28, 0.12, 0.3, 0.1, 0.5, [0, 0, 0], d.accent2); // belly pan
    // headlights
    k.pair((sx) => k.box('head', sx * 0.08, 0.86, topZ + 0.4 * d.nose, 0.07, 0.03, 0.08, [0, sx * 0.3, 0]));
    // tank
    k.sphere('paint', 0, 0.94, -0.02, 0.19, 0.13, 0.28);
    k.box('misc', 0, 0.99, 0.05, 0.12, 0.03, 0.12, [0, 0, 0], d.accent);
    // seat + tail
    k.box('seat', 0, 0.9, -0.32, 0.22, 0.06, 0.34, [0.1, 0, 0]);
    k.sphere('paint', 0, 0.95 * d.tail, -0.6, 0.14, 0.1, 0.36, undefined, [-0.25, 0, 0]);
    k.box('misc', 0, 1.0 * d.tail, -0.78, 0.16, 0.02, 0.2, [-0.25, 0, 0], d.accent);
    k.box('tail', 0, 0.96 * d.tail, -0.9, 0.12, 0.04, 0.03);
    // clip-ons
    k.pair((sx) => k.cyl('misc', sx * 0.2, topY - 0.02, topZ + 0.02, 0.02, 0.2, [0, 0, Math.PI / 2 + sx * 0.2], 0x222222));
  } else {
    // supermoto: tall, skinny, flat long seat, number plate, minimal bodywork
    k.box('plate', 0, topY - 0.1, topZ + 0.1, 0.26, 0.24, 0.02, [-0.4, 0, 0]);
    k.box('head', 0, topY - 0.1, topZ + 0.13, 0.08, 0.06, 0.03, [-0.4, 0, 0]);
    k.pair((sx) => k.box('paint', sx * 0.15, 0.85, 0.22, 0.03, 0.28, 0.48, [0.3, 0, 0])); // radiator shrouds
    k.pair((sx) => k.box('misc', sx * 0.16, 0.86, 0.26, 0.02, 0.12, 0.28, [0.3, 0, 0], d.accent2));
    k.box('paint', 0, 0.97, 0.05, 0.22, 0.12, 0.3);
    k.box('seat', 0, 1.0, -0.3, 0.2, 0.07, 0.8, [0.05, 0, 0]);
    k.box('paint', 0, 0.98, -0.78, 0.2, 0.04, 0.4, [-0.15, 0, 0]); // rear fender
    k.pair((sx) => k.box('misc', sx * 0.13, 0.82, -0.55, 0.02, 0.18, 0.5, [0.15, 0, 0], d.accent));
    k.box('tail', 0, 0.94, -0.98, 0.08, 0.03, 0.02);
    k.cyl('misc', 0, topY + 0.08, topZ, 0.018, 0.78, [0, 0, Math.PI / 2], 0x333333); // wide bars
  }
  // exhaust
  if (d.exhaust === 'side') k.cyl('chrome', -0.19, 0.42, -0.25, 0.06, 0.4, [Math.PI / 2 + 0.15, 0, 0], undefined, 10);
  else if (d.exhaust === 'under') k.box('chrome', 0, 0.22, -0.05, 0.22, 0.12, 0.4);
  else k.cyl('chrome', -0.17, 0.8, -0.5, 0.05, 0.5, [Math.PI / 2 - 0.35, 0, 0], undefined, 10);
  k.pair((sx) => k.box(sx > 0 ? 'sigL' : 'sigR', sx * 0.12, 0.9, -0.85, 0.06, 0.03, 0.04));
  k.pair((sx) => k.box(sx > 0 ? 'sigL' : 'sigR', sx * 0.14, 0.8, topZ + 0.2, 0.05, 0.03, 0.04));

  const meshes = k.build(chassis, shadows);
  const rim = d.rimColor;
  const fork = new THREE.Group();
  chassis.add(fork);
  const wheels = [
    makeWheel(chassis, 0, d.wr, zf, d.wr, 0.13, true, rim, 3, true),
    makeWheel(chassis, 0, d.wr, zr, d.wr, 0.18, false, rim, sport ? 3 : 36, true),
  ];
  wheels[0].left = true;

  // riderless for now (buildRider kept for later use)
  const rider = undefined;

  const g = (b: string) => (meshes.get(b as never) ? [meshes.get(b as never)!] : []);
  return {
    root, chassis, body: meshes.get('paint')!, wheels,
    brake: g('tail'), sigL: g('sigL'), sigR: g('sigR'), heads: g('head'),
    length: d.wb + 0.66, width: 0.72, height: 1.15, color,
    bike: { lean, rider, fork },
  };
}
