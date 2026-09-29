import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeWheel, type VehicleModel } from './ModelKit';
import { MAT, paint, paintLite } from './Materials';
import type { Shape } from './ShapeBuilder';

/**
 * Panel-built vehicles. Each car is assembled from separate, sharp-edged parts whose sizes come
 * from measurements of the reference model (src/data/shapes/<id>.json):
 *  - lower body: crisp cross-section (vertical flank, shoulder crease, bonnet/boot surface that
 *    follows the measured centre-line profile) with wheel-arch cut-outs,
 *  - cabin: a separate tapered greenhouse (windscreen, side windows, rear glass; painted roof),
 *  - bumpers, grille and lamps as flat panels on the body faces.
 */
type Tag = 'paint' | 'glass' | 'dark' | 'head' | 'tail' | 'chrome' | 'carbon';
interface Section { z: number; pts: [number, number, Tag][] } // pts go around the section (x, y); tag = material of the segment to the next point

const smooth = (a: number[], r: number) => a.map((_, i) => { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const j = i + d; if (j < 0 || j >= a.length) continue; const w = r + 1 - Math.abs(d); s += a[j] * w; n += w; } return s / n; });

/** loft consecutive sections (same point count) into per-tag triangle lists */
function loft(sections: Section[], out: Map<Tag, number[]>, capStart: Tag | null, capEnd: Tag | null) {
  const n = sections[0].pts.length;
  const push = (tag: Tag, ...v: number[]) => { let a = out.get(tag); if (!a) out.set(tag, (a = [])); a.push(...v); };
  for (let s = 0; s < sections.length - 1; s++) {
    const A = sections[s], B = sections[s + 1];
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const tag = A.pts[k][2];
      const a0 = [A.pts[k][0], A.pts[k][1], A.z], a1 = [A.pts[k2][0], A.pts[k2][1], A.z];
      const b0 = [B.pts[k][0], B.pts[k][1], B.z], b1 = [B.pts[k2][0], B.pts[k2][1], B.z];
      push(tag, ...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
    }
  }
  const cap = (S: Section, tag: Tag | null, flip: boolean) => {
    if (!tag) return;
    let cx = 0, cy = 0; for (const p of S.pts) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const t = S.pts[k][2] === 'glass' ? 'glass' : tag;
      if (flip) push(t, cx, cy, S.z, S.pts[k2][0], S.pts[k2][1], S.z, S.pts[k][0], S.pts[k][1], S.z);
      else push(t, cx, cy, S.z, S.pts[k][0], S.pts[k][1], S.z, S.pts[k2][0], S.pts[k2][1], S.z);
    }
  };
  cap(sections[0], capStart, false);
  cap(sections[sections.length - 1], capEnd, true);
}

export function buildPanelCar(sh: Shape, color: number, lite: boolean, shadows = true): VehicleModel {
  const { nz, nu, length: L } = sh;
  const z0 = -L / 2;
  const zAt = (i: number) => z0 + ((i + 0.5) / nz) * L;
  // ---- measurements -> design lines ----
  const hw = smooth(sh.hw, 3);
  const centre = smooth(Array.from({ length: nz }, (_, i) => sh.t[i * nu]), 2); // centre-line top profile
  const edge = smooth(Array.from({ length: nz }, (_, i) => sh.t[i * nu + nu - 1]), 3); // top at the outer edge
  const H = Math.max(...centre);
  // shoulder (belt) line: the outer-edge height, clamped into a sensible band
  const shoulder = edge.map((e) => Math.min(Math.max(e, H * 0.5), H * 0.78));
  // cabin: where the centre line rises clearly above the shoulder
  const cab: number[] = [];
  for (let i = 0; i < nz; i++) if (centre[i] > shoulder[i] + 0.14) cab.push(i);
  const c0 = cab.length ? cab[0] : Math.floor(nz * 0.35), c1 = cab.length ? cab[cab.length - 1] : Math.floor(nz * 0.75);
  // roof half-width: outermost point still near the roof height
  const roofHalf = Array.from({ length: nz }, (_, i) => {
    let u = 0.2;
    for (let k = 0; k < nu; k++) if (sh.t[i * nu + k] > centre[i] - 0.07) u = k / (nu - 1);
    return Math.max(0.25, Math.min(0.85, u)) * hw[i];
  });
  const roofHalfS = smooth(roofHalf, 4);
  const ground = 0.12;
  const wheels = sh.wheels.filter((w) => w.x >= 0 || sh.bike);

  // ---- lower body sections ----
  const out = new Map<Tag, number[]>();
  const N = 56;
  const secs: Section[] = [];
  for (let q = 0; q < N; q++) {
    const t = q / (N - 1);
    const z = z0 + 0.02 + t * (L - 0.04);
    const i = Math.min(nz - 1, Math.max(0, Math.round(((z - z0) / L) * nz - 0.5)));
    const w = hw[i] * 0.985;
    const sh_ = shoulder[i];
    // bonnet / boot surface height at the centre: measured profile, but never above the shoulder inside the cabin
    const deck = i >= c0 && i <= c1 ? sh_ + 0.01 : Math.max(centre[i] * 0.98, sh_ - 0.02);
    // ends: round the nose/tail in plan and height
    const endT = Math.min(t, 1 - t) * L; // distance from nearest end (m)
    const endK = Math.min(1, endT / 0.35);
    const wx = w * (0.82 + 0.18 * Math.sqrt(endK));
    // wheel arch at this z?
    let arch = ground;
    for (const wh of wheels) { const dz = (z - wh.z) / (wh.r * 1.15); if (Math.abs(dz) < 1) arch = Math.max(arch, wh.r + Math.sqrt(1 - dz * dz) * wh.r * 1.08); }
    const inner = wx * 0.62;
    const pts: [number, number, Tag][] = [
      [0, ground, 'dark'], [inner, ground, 'dark'], [inner, arch, 'dark'], [wx, Math.min(arch, sh_ - 0.12), 'paint'],
      [wx, sh_ - 0.06, 'paint'], [wx * 0.975, sh_, 'paint'], [wx * 0.55, deck * 0.97 + sh_ * 0.03, 'paint'], [0, deck, 'paint'],
    ];
    // mirror for the other side (walk back down the left side)
    const full: [number, number, Tag][] = [];
    for (let p = 0; p < pts.length; p++) full.push([-pts[p][0], pts[p][1], pts[p][2]]);
    for (let p = pts.length - 2; p >= 1; p--) full.push([pts[p][0], pts[p][1], pts[p - 1][2]]);
    // walk: right side from centre-bottom up to centre-top, then left side down; close
    secs.push({ z, pts: full });
  }
  loft(secs, out, 'paint', 'paint');

  // ---- cabin (greenhouse) ----
  const cabSecs: Section[] = [];
  const roofTag: Tag = sh.id === 'zr1' ? 'carbon' : 'paint'; // ZR1 carbon roof panel
  const zc0 = zAt(c0), zc1 = zAt(c1);
  const M = 30;
  for (let q = 0; q < M; q++) {
    const t = q / (M - 1);
    const z = zc0 + t * (zc1 - zc0);
    const i = Math.min(nz - 1, Math.max(0, Math.round(((z - z0) / L) * nz - 0.5)));
    const base = shoulder[i];
    const top = Math.max(base + 0.02, centre[i]);
    const bw = hw[i] * 0.9, rw = Math.min(bw * 0.92, roofHalfS[i]);
    // side window band sits between the belt and the roof edge; the roof skin is paint
    const winTop = base + (top - base) * 0.86;
    const pts: [number, number, Tag][] = [
      [-bw, base, 'glass'], [-(bw + (rw - bw) * 0.86), winTop, 'paint'], [-rw, top - 0.005, roofTag], [0, top, roofTag],
      [rw, top - 0.005, 'paint'], [bw + (rw - bw) * 0.86, winTop, 'glass'], [bw, base, 'dark'],
    ];
    cabSecs.push({ z, pts });
  }
  // windscreen / rear glass: the steep ends of the cabin get glass on the top faces
  const steepIdx = new Set<number>();
  for (let q = 1; q < M - 1; q++) { const dz = cabSecs[q + 1].z - cabSecs[q - 1].z; const dy = cabSecs[q + 1].pts[3][1] - cabSecs[q - 1].pts[3][1]; if (Math.abs(dy / dz) > 0.35) steepIdx.add(q); }
  if (cabSecs.length) {
    for (let q = 0; q < M; q++) if (steepIdx.has(q) || steepIdx.has(q - 1)) for (const k of [1, 2, 3, 4]) cabSecs[q].pts[k][2] = 'glass';
    loft(cabSecs, out, 'glass', 'glass');
  }

  // ---- bumpers, grille, lamps ----
  const box = (tag: Tag, x: number, y: number, z: number, w: number, h: number, d: number) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
    const p = g.attributes.position.array as Float32Array;
    let a = out.get(tag); if (!a) out.set(tag, (a = []));
    for (let k = 0; k < p.length; k++) a.push(p[k]);
  };
  const noseI = nz - 2, tailI = 1;
  const noseW = hw[noseI] * 0.82 * (0.82 + 0.18 * Math.sqrt(0.02 / 0.35)), tailW = hw[tailI] * 0.82;
  const noseH = Math.max(0.35, Math.min(centre[noseI], shoulder[noseI])), tailH = Math.max(0.4, Math.min(centre[tailI], shoulder[tailI]));
  /** a flat plate: top polygon (convex, x y z points) extruded t metres downward */
  const plate = (tag: Tag, top: [number, number, number][], t: number) => {
    let a = out.get(tag); if (!a) out.set(tag, (a = []));
    const n = top.length, bot = top.map(([x, y, z]) => [x, y - t, z]);
    // faces are emitted in both windings so the point order doesn't matter
    const tri = (p: number[], q: number[], r: number[]) => a!.push(...p, ...q, ...r, ...p, ...r, ...q);
    for (let k = 1; k < n - 1; k++) { tri(top[0], top[k + 1], top[k]); tri(bot[0], bot[k], bot[k + 1]); }
    for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; tri(top[k], top[k2], bot[k]); tri(bot[k], top[k2], bot[k2]); }
  };
  const idx = (z: number) => Math.min(nz - 1, Math.max(0, Math.round(((z - z0) / L) * nz - 0.5)));
  const design = DESIGNS[sh.id];
  if (design) {
    design({
      L, ground, noseW, tailW, noseH, tailH, cabFront: zc1, cabRear: zc0, box, plate,
      hwAt: (z) => hw[idx(z)] * 0.985, shAt: (z) => shoulder[idx(z)],
      deckAt: (z) => { const i = idx(z); return i >= c0 && i <= c1 ? shoulder[i] + 0.01 : Math.max(centre[i] * 0.98, shoulder[i] - 0.02); },
      topAt: (z) => centre[idx(z)],
    });
  } else {
  // front: lower grille / splitter, headlamps high on the outer corners
  box('dark', 0, ground + 0.13, L / 2 - 0.03, noseW * 1.2, 0.16, 0.06);
  box('dark', 0, ground + 0.02, L / 2 - 0.08, noseW * 1.5, 0.04, 0.18);
  const lampH = 0.07 + 0.05 * (1 - Math.min(1, H / 1.9));
  for (const sx of [1, -1]) {
    box('head', sx * noseW * 0.62, noseH - 0.1, L / 2 - 0.01, noseW * 0.5, lampH, 0.04);
    box('tail', sx * tailW * 0.66, tailH - 0.1, -L / 2 + 0.005, tailW * 0.6, 0.1, 0.05);
  }
  box('dark', 0, ground + 0.1, -L / 2 + 0.03, tailW * 1.6, 0.14, 0.06);
  }
  // side mirrors at the front of the cabin
  if (cabSecs.length) {
    const i = c0 + 2;
    for (const sx of [1, -1]) box('paint', sx * (hw[i] * 0.9 + 0.04), shoulder[i] + 0.1, zAt(i) + 0.05, 0.14, 0.09, 0.2);
  }

  // ---- meshes ----
  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);
  const matFor = (tag: Tag): THREE.Material => tag === 'paint' ? (lite ? paintLite(color) : paint(color)) : tag === 'glass' ? (lite ? MAT.glassLite : MAT.glass) : tag === 'head' ? MAT.head : tag === 'tail' ? MAT.tailOff : tag === 'chrome' ? MAT.chrome : tag === 'carbon' ? MAT.carbon : MAT.trim;
  let body: THREE.Mesh | undefined;
  const brake: THREE.Mesh[] = [], heads: THREE.Mesh[] = [];
  for (const [tag, arr] of out) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g = toCreasedNormals(g, Math.PI / 5); // sharp panel edges, smooth along the length
    const m = new THREE.Mesh(g, matFor(tag));
    m.name = tag;
    m.castShadow = shadows && tag !== 'glass';
    chassis.add(m);
    if (tag === 'paint') body = m;
    if (tag === 'tail') brake.push(m);
    if (tag === 'head') heads.push(m);
  }
  // indicators
  const sigL: THREE.Mesh[] = [], sigR: THREE.Mesh[] = [];
  const sg = new THREE.BoxGeometry(0.07, 0.04, 0.03);
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const s = new THREE.Mesh(sg, MAT.sigOff);
    s.position.set(sx * (sz > 0 ? noseW : tailW) * 0.95, (sz > 0 ? noseH : tailH) - 0.2, sz * (L / 2 - 0.01));
    chassis.add(s);
    (sx > 0 ? sigL : sigR).push(s);
  }
  const wheelRefs = sh.wheels.map((w) => makeWheel(root, w.x, w.r, w.z, w.r, Math.max(0.2, w.w), w.z > 0, 0x9aa0a6, 5, false, lite));
  return {
    root, chassis, body: body!, wheels: wheelRefs, brake, sigL, sigR, heads,
    length: L, width: sh.width, height: H, color, lod: [],
  };
}

/** what a hand-made design gets: body measurements along z plus the part tools */
interface DesignCtx {
  L: number; ground: number; noseW: number; tailW: number; noseH: number; tailH: number; cabFront: number; cabRear: number;
  hwAt(z: number): number; shAt(z: number): number; deckAt(z: number): number; topAt(z: number): number;
  box(tag: Tag, x: number, y: number, z: number, w: number, h: number, d: number): void;
  plate(tag: Tag, top: [number, number, number][], t: number): void;
}

/** signature details per car (these replace the generic lamps and grille) */
const DESIGNS: Record<string, (c: DesignCtx) => void> = {
  // Corvette C7 ZR1: swept slit headlamps, full-width mouth, raised hood with carbon vent,
  // side scoops behind the doors, angular twin tail lamps, quad centre exhausts, big high wing.
  zr1(c) {
    const { L, ground, box, plate } = c;
    const F = L / 2, R = -L / 2;
    // a point resting on the body top at (x, z)
    const onTop = (x: number, z: number, lift = 0.012): [number, number, number] => {
      const f = Math.min(1, Math.abs(x) / c.hwAt(z));
      return [x, c.deckAt(z) + (c.shAt(z) - c.deckAt(z)) * f * f + lift, z];
    };
    const wR = c.deckAt(R + 0.2) + 0.08; // rear deck height under the wing
    for (const sx of [1, -1]) {
      // headlamp: a thin wedge swept back along the fender
      const w1 = c.hwAt(F - 0.1), w2 = c.hwAt(F - 0.5);
      const p = [onTop(sx * w1 * 0.9, F - 0.08), onTop(sx * w1 * 0.55, F - 0.14), onTop(sx * w2 * 0.74, F - 0.46), onTop(sx * w2 * 0.96, F - 0.54)];
      plate('head', sx > 0 ? p : [p[3], p[2], p[1], p[0]], 0.03);
      // brake ducts either side of the mouth
      box('dark', sx * c.noseW * 0.8, ground + 0.2, F - 0.03, c.noseW * 0.3, 0.17, 0.06);
      // fender vent behind the front wheel, big scoop behind the door, side skirt
      const zf = F - 1.3;
      box('dark', sx * (c.hwAt(zf) + 0.004), c.shAt(zf) - 0.2, zf, 0.02, 0.13, 0.24);
      const zs = -0.45;
      box('dark', sx * (c.hwAt(zs) + 0.004), c.shAt(zs) - 0.17, zs, 0.02, 0.2, 0.5);
      box('carbon', sx * (c.hwAt(0) - 0.02), ground + 0.06, 0, 0.06, 0.08, L * 0.42);
      // tail lamps: two angular blocks per side in a dark band
      box('tail', sx * c.tailW * 0.36, c.tailH - 0.07, R + 0.004, c.tailW * 0.36, 0.08, 0.05);
      box('tail', sx * c.tailW * 0.82, c.tailH - 0.07, R + 0.004, c.tailW * 0.36, 0.08, 0.05);
      // wing uprights and end plates
      box('carbon', sx * c.tailW * 0.6, wR + 0.16, R + 0.2, 0.05, 0.32, 0.14);
      box('carbon', sx * c.tailW * 0.98, wR + 0.36, R + 0.16, 0.02, 0.12, 0.3);
    }
    // full-width mouth, splitter
    box('dark', 0, ground + 0.16, F - 0.02, c.noseW * 1.1, 0.22, 0.06);
    box('carbon', 0, ground + 0.02, F - 0.1, c.noseW * 1.95, 0.035, 0.26);
    // raised hood centre with the carbon vent window
    const zh = F - 0.85;
    box('paint', 0, c.deckAt(zh) + 0.015, zh, c.hwAt(zh) * 0.85, 0.06, 0.9);
    box('carbon', 0, c.deckAt(zh) + 0.05, zh + 0.12, c.hwAt(zh) * 0.62, 0.012, 0.42);
    // rear: dark lamp band, diffuser, quad centre exhausts, wing
    box('dark', 0, c.tailH - 0.07, R + 0.012, c.tailW * 2.15, 0.13, 0.04);
    box('carbon', 0, ground + 0.08, R + 0.05, c.tailW * 1.7, 0.14, 0.12);
    for (const x of [-0.21, -0.07, 0.07, 0.21]) box('chrome', x, ground + 0.15, R - 0.01, 0.09, 0.09, 0.08);
    box('carbon', 0, wR + 0.34, R + 0.16, c.tailW * 1.96, 0.03, 0.28);
  },
};
