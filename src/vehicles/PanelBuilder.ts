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
type Tag = 'paint' | 'glass' | 'dark' | 'head' | 'tail';
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
      [-bw, base, 'glass'], [-(bw + (rw - bw) * 0.86), winTop, 'paint'], [-rw, top - 0.005, 'paint'], [0, top, 'paint'],
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
  // front: lower grille / splitter, headlamps high on the outer corners
  box('dark', 0, ground + 0.13, L / 2 - 0.03, noseW * 1.2, 0.16, 0.06);
  box('dark', 0, ground + 0.02, L / 2 - 0.08, noseW * 1.5, 0.04, 0.18);
  const lampH = 0.07 + 0.05 * (1 - Math.min(1, H / 1.9));
  for (const sx of [1, -1]) {
    box('head', sx * noseW * 0.62, noseH - 0.1, L / 2 - 0.01, noseW * 0.5, lampH, 0.04);
    box('tail', sx * tailW * 0.66, tailH - 0.1, -L / 2 + 0.005, tailW * 0.6, 0.1, 0.05);
  }
  box('dark', 0, ground + 0.1, -L / 2 + 0.03, tailW * 1.6, 0.14, 0.06);
  // side mirrors at the front of the cabin
  if (cabSecs.length) {
    const i = c0 + 2;
    for (const sx of [1, -1]) box('paint', sx * (hw[i] * 0.9 + 0.04), shoulder[i] + 0.1, zAt(i) + 0.05, 0.14, 0.09, 0.2);
  }

  // ---- meshes ----
  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);
  const matFor = (tag: Tag): THREE.Material => tag === 'paint' ? (lite ? paintLite(color) : paint(color)) : tag === 'glass' ? (lite ? MAT.glassLite : MAT.glass) : tag === 'head' ? MAT.head : tag === 'tail' ? MAT.tailOff : MAT.trim;
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
