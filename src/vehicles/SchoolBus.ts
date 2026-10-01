import * as THREE from 'three';
import { Kit, makeWheel, type VehicleModel } from './ModelKit';
import { MAT } from './Materials';

/** A full size flat-front school bus. Length and width are what the traffic and the hit boxes use. */
export const BUS_DIMS = { length: 10.4, width: 2.45, height: 3.12 };

/** brighter than the generic vertex-coloured material: school bus yellow has to read as yellow */
const busPaint = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.08, roughness: 0.5, envMapIntensity: 0.6 });
const BLACK = 0x121212, GLASS = 0x0c141b, RED = 0xc8161a, AMBER = 0xf0a800, GREY = 0x6b6e72;

/**
 * Built from boxes in one vertex-coloured mesh (like the other traffic), so the instancer can draw it in one call
 * and tint the paint: `color` is the body colour (white for the instanced reference, then every bus is tinted yellow).
 * Origin on the ground at the centre, nose towards +z, the driver's side is +x (like the other models' left).
 */
export function buildSchoolBus(color: number, shadows = false): VehicleModel {
  const { length: L, width: W, height: H } = BUS_DIMS;
  const k = new Kit(color);
  const P = color; // paint
  const zF = L / 2, zB = -L / 2;
  const x2 = W / 2;
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: number) => k.box('misc', x, y, z, w, h, d, [0, 0, 0], c);

  // wheels: front axle behind the nose, the dual rear axle near the back
  const wzF = 3.55, wzR = -2.75, wr = 0.5;
  const arch = (z: number) => [z - 0.78, z + 0.78] as const;

  // ---- underbody and wheel wells ----
  box(0, 0.5, 0, W - 0.5, 0.18, L - 0.8, 0x1a1b1d);
  for (const z of [wzF, wzR]) for (const sx of [1, -1]) box(sx * (x2 - 0.42), 0.8, z, 0.7, 0.8, 1.6, 0x0b0b0c); // dark wheel wells

  // ---- lower body (skirt): full height between the wells, a lintel over each well ----
  const skirtY0 = 0.6, skirtY1 = 1.45;
  const spans: [number, number][] = [[zB, arch(wzR)[0]], [arch(wzR)[1], arch(wzF)[0]], [arch(wzF)[1], zF - 0.15]];
  for (const sx of [1, -1]) {
    for (const [a, b] of spans) box(sx * (x2 - 0.06), (skirtY0 + skirtY1) / 2, (a + b) / 2, 0.12, skirtY1 - skirtY0, b - a, P);
    for (const z of [wzF, wzR]) box(sx * (x2 - 0.06), 1.28, z, 0.12, 0.34, 1.6, P);
  }
  box(0, skirtY1 - 0.06, 0, W - 0.3, 0.1, L - 0.4, 0x1a1b1d); // the floor over the wheel wells
  // black rub rails along both sides, wrapping the corners
  for (const y of [0.78, 1.04, 1.42]) {
    for (const sx of [1, -1]) {
      for (const [a, b] of spans) {
        if (y < 1.1 && ((a < wzF && b > wzF) || (a < wzR && b > wzR))) continue;
        box(sx * (x2 + 0.005), y, (a + b) / 2, 0.025, 0.07, b - a - 0.05, BLACK);
      }
    }
    box(0, y, zB - 0.005, W - 0.05, 0.07, 0.025, BLACK);
  }

  // ---- window band ----
  const wy0 = 1.48, wy1 = 2.4;
  box(0, (wy0 + wy1) / 2, 0.15, W - 0.12, wy1 - wy0, L - 1.1, P);
  // side windows: 11 panes with yellow pillars between them, a darker frame row above
  const nWin = 11, zStart = zB + 0.7, zEnd = 3.55;
  const pitch = (zEnd - zStart) / nWin;
  for (let i = 0; i < nWin; i++) {
    const zc = zStart + pitch * (i + 0.5);
    for (const sx of [1, -1]) {
      box(sx * (x2 - 0.045), 1.98, zc, 0.03, 0.62, pitch - 0.16, GLASS);
      box(sx * (x2 - 0.04), 2.33, zc, 0.03, 0.1, pitch - 0.16, GLASS); // the top vent sash
    }
  }
  // the entrance door (passenger side, behind the front axle): glass door with a black frame
  box(-(x2 - 0.04), 1.55, 4.55, 0.035, 0.9, 0.78, BLACK);
  box(-(x2 - 0.03), 1.55, 4.55, 0.03, 0.8, 0.66, GLASS);
  box(-(x2 - 0.03), 0.97, 4.55, 0.03, 0.55, 0.66, GLASS);

  // ---- roof: stepped crown with hatches and an air intake bump ----
  box(0, 2.46, 0.15, W - 0.16, 0.1, L - 1.1, P);
  box(0, 2.58, 0.15, W - 0.5, 0.12, L - 1.3, P);
  box(0, 2.66, 0.15, W - 1.1, 0.08, L - 2.0, P);
  for (const z of [-3.0, 0.8]) box(0, 2.72, z, 0.7, 0.07, 0.7, 0xe9e9e4); // roof hatches
  box(0, 2.77, -4.0, 1.3, 0.1, 0.9, 0xd9d9d4); // the air conditioning pod at the back

  // ---- front: flat face, split windshield, destination band with the SCHOOL BUS lettering ----
  box(0, 1.5, zF - 0.1, W - 0.12, 1.05, 0.22, P); // face
  box(0, 1.48, zF + 0.015, W - 0.4, 0.98, 0.05, BLACK); // windshield frame
  box(-0.55, 1.62, zF + 0.04, 1.0, 0.7, 0.03, GLASS);
  box(0.55, 1.62, zF + 0.04, 1.0, 0.7, 0.03, GLASS);
  box(0, 1.62, zF + 0.045, 0.06, 0.74, 0.03, BLACK); // the centre divider
  box(0, 2.08, zF + 0.045, 1.9, 0.18, 0.03, GLASS); // the upper pane
  // the lettering band across the top of the face: black lettering on yellow, drawn with little blocks
  box(0, 2.3, zF + 0.03, W - 0.35, 0.3, 0.04, P);
  const glyphs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((i) => i !== 6); // "SCHOOL BUS" with the word gap
  const gx = (i: number) => -0.88 + i * 0.185 + (i > 6 ? 0.1 : 0);
  for (const i of glyphs) {
    box(gx(i), 2.3, zF + 0.055, 0.1, 0.17, 0.02, BLACK);
    box(gx(i), 2.3, zF + 0.062, 0.05, 0.07, 0.02, P); // a counter in the letter
  }
  // warning lamps: red inners and amber outers at the top corners (front and back)
  for (const sx of [1, -1]) {
    box(sx * 0.82, 2.38, zF + 0.04, 0.18, 0.13, 0.05, RED);
    box(sx * 1.04, 2.38, zF + 0.04, 0.18, 0.13, 0.05, AMBER);
    box(sx * 0.82, 2.38, zB - 0.04, 0.18, 0.13, 0.05, RED);
    box(sx * 1.04, 2.38, zB - 0.04, 0.18, 0.13, 0.05, AMBER);
  }
  // lower face: grille, bumper with hazard chevrons, tow hooks
  box(0, 0.98, zF + 0.01, 1.1, 0.4, 0.04, 0x2a2b2e);
  for (let i = 0; i < 6; i++) box(0, 0.84 + i * 0.056, zF + 0.035, 1.0, 0.018, 0.02, GREY);
  box(0, 0.62, zF + 0.1, W + 0.04, 0.3, 0.2, BLACK);
  for (let i = 0; i < 9; i++) box(-1.04 + i * 0.26, 0.6, zF + 0.205, 0.14, 0.12, 0.01, i % 2 ? 0xe8b600 : BLACK);
  // mirrors: the big crossview mirrors at the front corners on their arms
  for (const sx of [1, -1]) {
    box(sx * (x2 + 0.18), 2.0, zF - 0.45, 0.04, 0.04, 0.5, BLACK);
    box(sx * (x2 + 0.18), 1.62, zF - 0.28, 0.035, 0.6, 0.17, BLACK);
    box(sx * (x2 + 0.4), 2.02, zF - 0.5, 0.24, 0.38, 0.05, BLACK);
    box(sx * (x2 + 0.42), 1.6, zF - 0.55, 0.2, 0.3, 0.05, BLACK);
  }
  // the folding stop sign on the driver's side (an octagon seen edge-on from the front, face-on from the side)
  k.add('misc', new THREE.CylinderGeometry(0.3, 0.3, 0.025, 8), [x2 + 0.04, 1.95, 3.9], [0, 0, Math.PI / 2], [1, 1, 1], RED);
  box(x2 + 0.03, 1.95, 3.9, 0.025, 0.06, 0.36, 0xf4f4f0);

  // ---- rear: windows in the emergency door, bumper, lights ----
  box(0, 1.5, zB + 0.01, W - 0.12, 1.05, 0.04, P);
  box(0, 1.92, zB - 0.01, W - 0.5, 0.52, 0.03, BLACK);
  box(-0.5, 1.92, zB - 0.025, 0.85, 0.42, 0.02, GLASS);
  box(0.5, 1.92, zB - 0.025, 0.85, 0.42, 0.02, GLASS);
  box(0, 1.32, zB - 0.01, 0.9, 0.32, 0.03, BLACK); // the emergency door handle panel
  box(0, 0.62, zB - 0.1, W + 0.04, 0.3, 0.2, BLACK);
  box(0, 2.3, zB - 0.015, W - 0.35, 0.28, 0.03, P);
  for (const i of glyphs) box(gx(i), 2.3, zB - 0.04, 0.1, 0.17, 0.02, BLACK);
  // ---- chassis details seen from below and the side: fuel tank and exhaust ----
  box(-0.35, 0.62, -1.0, 0.7, 0.3, 1.3, 0x202124);
  box(x2 - 0.5, 0.58, -3.8, 0.12, 0.12, 1.2, 0x303236);

  // ---- lamps (their own meshes: the instancer lights them per car) ----
  for (const sx of [1, -1]) {
    k.box('head', sx * 0.85, 0.96, zF + 0.05, 0.3, 0.2, 0.05, [0, 0, 0], 0xffffff);
    k.box('tail', sx * 1.0, 1.0, zB - 0.02, 0.2, 0.28, 0.04, [0, 0, 0], 0xff2020);
    k.box('tail', sx * 1.0, 1.32, zB - 0.02, 0.2, 0.16, 0.04, [0, 0, 0], 0xff2020);
  }

  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);
  const parts = k.build(chassis, shadows);
  const body = parts.get('misc')!;
  body.name = 'paint';
  body.material = busPaint;
  const brake: THREE.Mesh[] = [], heads: THREE.Mesh[] = [];
  const t = parts.get('tail'); if (t) brake.push(t);
  const h = parts.get('head'); if (h) heads.push(h);
  // indicators on the four corners
  const sigL: THREE.Mesh[] = [], sigR: THREE.Mesh[] = [];
  const sg = new THREE.BoxGeometry(0.1, 0.06, 0.03);
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const s = new THREE.Mesh(sg, MAT.sigOff);
    s.position.set(sx * W * 0.4, H * 0.45, sz * (L / 2 - 0.04));
    chassis.add(s);
    (sx > 0 ? sigL : sigR).push(s);
  }
  // wheels: the dual rears are two wheels per side; yellow painted rims
  const rim = 0xe0a800;
  const wheels = [
    makeWheel(root, x2 - 0.2, wr, wzF, wr, 0.3, true, rim, 5, false, true),
    makeWheel(root, -(x2 - 0.2), wr, wzF, wr, 0.3, true, rim, 5, false, true),
    makeWheel(root, x2 - 0.2, wr, wzR, wr, 0.3, false, rim, 5, false, true),
    makeWheel(root, -(x2 - 0.2), wr, wzR, wr, 0.3, false, rim, 5, false, true),
    makeWheel(root, x2 - 0.55, wr, wzR, wr, 0.3, false, rim, 5, false, true),
    makeWheel(root, -(x2 - 0.55), wr, wzR, wr, 0.3, false, rim, 5, false, true),
  ];
  return { root, chassis, body, wheels, brake, sigL, sigR, heads, length: L, width: W, height: H, color, lod: [] };
}
