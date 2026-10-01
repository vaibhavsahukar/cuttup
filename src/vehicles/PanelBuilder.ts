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
type Tag = 'paint' | 'glass' | 'dark' | 'head' | 'tail' | 'chrome' | 'carbon' | 'roofglass' | 'white' | 'blue';
const blueMat = new THREE.MeshStandardMaterial({ color: 0x1f4fbf, metalness: 0.4, roughness: 0.4, envMapIntensity: 0.6 });
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, metalness: 0.2, roughness: 0.5, envMapIntensity: 0.5 });
interface Section { z: number; pts: [number, number, Tag][] } // pts go around the section (x, y); tag = material of the segment to the next point

let roofGlass: THREE.MeshStandardMaterial | undefined;
let liteBody: THREE.MeshStandardMaterial | undefined;

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

export function buildPanelCar(sh: Shape, color: number, lite: boolean, shadows = true, livery?: 'police', player = false): VehicleModel {
  const { nz, nu, length: L } = sh;
  const z0 = -L / 2;
  const zAt = (i: number) => z0 + ((i + 0.5) / nz) * L;
  // ---- measurements -> design lines ----
  const hw = smooth(smooth(sh.hw, 5), 5);
  const centre = smooth(Array.from({ length: nz }, (_, i) => sh.t[i * nu]), 2); // centre-line top profile
  const edge = smooth(Array.from({ length: nz }, (_, i) => sh.t[i * nu + nu - 1]), 3); // top at the outer edge
  // hand-drawn side profiles (rear -> front) where the reference measurement is unreliable
  // the player's version of a car can have its own profile (traffic keeps the original)
  const prof = (player ? PROFILES[sh.id + '_player'] : undefined) ?? PROFILES[sh.id];
  if (prof) {
    const lerpK = (k: [number, number][], t: number) => { for (let j = 1; j < k.length; j++) if (t <= k[j][0]) { const u = (t - k[j - 1][0]) / (k[j][0] - k[j - 1][0]); return k[j - 1][1] + (k[j][1] - k[j - 1][1]) * u; } return k[k.length - 1][1]; };
    for (let i = 0; i < nz; i++) { const t = (i + 0.5) / nz; centre[i] = lerpK(prof.centre, t); edge[i] = lerpK(prof.belt, t); }
  }
  const H = Math.max(...centre);
  // shoulder (belt) line: the outer-edge height, clamped into a sensible band
  const shoulder = smooth(smooth(edge.map((e) => Math.min(Math.max(e, H * 0.5), H * (prof?.beltMax ?? 0.78))), 8), 8);
  // cabin: where the centre line rises clearly above the shoulder
  const cab: number[] = [];
  for (let i = 0; i < nz; i++) if (centre[i] > shoulder[i] + 0.14) cab.push(i);
  // trucks: only the frontmost run is the cabin (the bed / cargo box behind it is solid body)
  if (sh.id === 't_pickup' || sh.id === 't_boxtruck' || sh.id === 't_van') {
    let k = cab.length - 1;
    while (k > 0 && cab[k - 1] === cab[k] - 1) k--;
    cab.splice(0, k);
  }
  const c0 = cab.length ? cab[0] : Math.floor(nz * 0.35), c1 = cab.length ? cab[cab.length - 1] : Math.floor(nz * 0.75);
  // box truck: the cargo box is a flat-topped, straight-sided block
  if (sh.id === 't_boxtruck') {
    const top = Math.max(...centre.slice(0, c0)) * 0.97;
    for (let i = 0; i < c0 - 1; i++) { centre[i] = top; shoulder[i] = top - 0.03; }
  }
  // roof half-width: outermost point still near the roof height
  const roofHalf = Array.from({ length: nz }, (_, i) => {
    let u = 0.2;
    for (let k = 0; k < nu; k++) if (sh.t[i * nu + k] > centre[i] - 0.07) u = k / (nu - 1);
    return Math.max(0.25, Math.min(0.85, u)) * hw[i];
  });
  const roofHalfS = prof ? hw.map((w) => w * (prof.roof ?? 0.68)) : smooth(roofHalf, 4);
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
  const roofTag: Tag = ROOF[sh.id] ?? 'paint'; // carbon roofs, Tesla glass roof
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
    // one continuous windscreen / rear window: fill short gaps between steep sections
    const st = [...steepIdx].sort((a, b) => a - b);
    for (let k = 1; k < st.length; k++) if (st[k] - st[k - 1] <= 4) for (let q = st[k - 1]; q < st[k]; q++) steepIdx.add(q);
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
    // orient so the top face points up
    const ax = top[1][0] - top[0][0], az = top[1][2] - top[0][2], bx = top[2][0] - top[0][0], bz = top[2][2] - top[0][2];
    if (az * bx - ax * bz < 0) { top.reverse(); bot.reverse(); }
    const tri = (p: number[], q: number[], r: number[]) => a!.push(...p, ...q, ...r);
    for (let k = 1; k < n - 1; k++) { tri(top[0], top[k], top[k + 1]); tri(bot[0], bot[k + 1], bot[k]); }
    for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; tri(top[k], bot[k], top[k2]); tri(bot[k], bot[k2], top[k2]); }
  };
  /** a rounded blob (ellipsoid) with radii rx, ry, rz */
  const ball = (tag: Tag, x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    const g = new THREE.SphereGeometry(1, 16, 12).scale(rx, ry, rz).translate(x, y, z).toNonIndexed();
    const p = g.attributes.position.array as Float32Array;
    let a = out.get(tag); if (!a) out.set(tag, (a = []));
    for (let k = 0; k < p.length; k++) a.push(p[k]);
  };
  const idx = (z: number) => Math.min(nz - 1, Math.max(0, Math.round(((z - z0) / L) * nz - 0.5)));
  const idxHw = (z: number) => hw[idx(z)] * 0.985;
  const deckH = (z: number) => { const i = idx(z); return i >= c0 && i <= c1 ? shoulder[i] + 0.01 : Math.max(centre[i] * 0.98, shoulder[i] - 0.02); };
  const design = DESIGNS[sh.id];
  if (design) {
    const ctx: DesignCtx = {
      L, ground, noseW, tailW, noseH, tailH, cabFront: zc1, cabRear: zc0, box, plate, ball,
      hwAt: (z) => hw[idx(z)] * 0.985, shAt: (z) => shoulder[idx(z)],
      deckAt: (z) => { const i = idx(z); return i >= c0 && i <= c1 ? shoulder[i] + 0.01 : Math.max(centre[i] * 0.98, shoulder[i] - 0.02); },
      topAt: (z) => centre[idx(z)],
      onTop: (x, z, lift = 0.035) => {
        const f = Math.min(1, Math.abs(x) / ctx.hwAt(z));
        return [x, ctx.deckAt(z) + (ctx.shAt(z) - ctx.deckAt(z)) * f * f + lift, z];
      },
      lamp: (sx, zf, zb, inF, outF, inB, outB, t = 0.06) => {
        const wf = ctx.hwAt(zf), wb = ctx.hwAt(zb);
        plate('head', [ctx.onTop(sx * wf * outF, zf), ctx.onTop(sx * wf * inF, zf - 0.04), ctx.onTop(sx * wb * inB, zb), ctx.onTop(sx * wb * outB, zb - 0.04)], t);
      },
    };
    design(ctx);
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
  // police livery: white door panels (two doors a side) between the wheel arches, plus a white boot / bonnet stripe
  if (livery === 'police') {
    const wf = Math.max(...wheels.map((w) => w.z)), wr = Math.min(...wheels.map((w) => w.z));
    const zStart = wr + 0.62, zEnd = wf - 0.62, len = (zEnd - zStart) / 2 - 0.04;
    for (const sx of [1, -1]) for (let k = 0; k < 2; k++) {
      const zc = zStart + len / 2 + k * (len + 0.08);
      const x = idxHw(zc) + 0.006;
      const yTop = shoulder[idx(zc)] - 0.1, yBot = ground + 0.36;
      if (yTop - yBot > 0.15) box('white', sx * x, (yTop + yBot) / 2, zc, 0.02, yTop - yBot, len);
    }
    box('white', 0, deckH(-L / 2 + 0.55) + 0.006, -L / 2 + 0.55, hw[idx(-L / 2 + 0.55)] * 0.9, 0.012, 0.5);
  }
  // side mirrors at the front of the cabin
  if (cabSecs.length) {
    const i = c0 + 2;
    for (const sx of [1, -1]) box('paint', sx * (hw[i] * 0.9 + 0.04), shoulder[i] + 0.1, zAt(i) + 0.05, 0.14, 0.09, 0.2);
  }

  // ---- meshes ----
  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);
  const matFor = (tag: Tag): THREE.Material => tag === 'paint' ? (lite ? paintLite(color) : paint(color)) : tag === 'glass' ? (lite ? MAT.glassLite : MAT.glass) : tag === 'head' ? MAT.head : tag === 'tail' ? MAT.tailOff : tag === 'white' ? whiteMat : tag === 'blue' ? blueMat : tag === 'chrome' ? MAT.chrome : tag === 'carbon' ? MAT.carbon : tag === 'roofglass' ? (roofGlass ??= new THREE.MeshStandardMaterial({ color: 0x10161c, metalness: 0.1, roughness: 0.45, envMapIntensity: 0.35 })) : MAT.trim;
  let body: THREE.Mesh | undefined;
  const brake: THREE.Mesh[] = [], heads: THREE.Mesh[] = [];
  if (lite) {
    // traffic / cops: everything but the lamps in one vertex-coloured mesh, so the instancer can
    // draw it in one call and tint the paint per car (dark parts barely change under the tint)
    const TONE: Partial<Record<Tag, number>> = { blue: 0x1f4fbf, white: 0xf2f2f0, glass: 0x0b1620, roofglass: 0x10161c, dark: 0x121314, carbon: 0x1a1b1d, chrome: 0xb8bcc0 };
    const pos: number[] = [], cols: number[] = [], cc = new THREE.Color();
    for (const [tag, arr] of out) {
      if (tag === 'head' || tag === 'tail') continue;
      cc.setHex(tag === 'paint' ? color : TONE[tag]!);
      pos.push(...arr);
      for (let k = 0; k < arr.length; k += 3) cols.push(cc.r, cc.g, cc.b);
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g = toCreasedNormals(g, Math.PI / 5);
    const cg = new THREE.Float32BufferAttribute(cols, 3);
    g.setAttribute('color', cg);
    body = new THREE.Mesh(g, (liteBody ??= new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.55, envMapIntensity: 0.55 })));
    body.name = 'paint';
    chassis.add(body);
  }
  for (const [tag, arr] of out) {
    if (lite && tag !== 'head' && tag !== 'tail') continue;
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
  // police roof light bar: a dark base with a red lens and a blue lens that the pursuit code flashes
  let lightBar: { red: THREE.Mesh[]; blue: THREE.Mesh[] } | undefined;
  if (livery === 'police' && cabSecs.length) {
    const zm = (zc0 + zc1) / 2, ym = Math.max(...cabSecs.map((s) => s.pts[3][1]));
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.3), MAT.trim);
    bar.position.set(0, ym + 0.02, zm);
    chassis.add(bar);
    const lens = (x: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.26), MAT.policeOff); m.position.set(x, ym + 0.1, zm); chassis.add(m); return m; };
    lightBar = { red: [lens(0.26)], blue: [lens(-0.26)] };
  }
  // Traffic and police cars are seen mostly from behind or ahead, where a tyre tucked inside the body line vanishes
  // behind the bumper apron. Their tyres are set a little wider and stand proud of the body so both axles read.
  const wheelRefs = sh.wheels.map((w) => makeWheel(root, w.x + (lite ? Math.sign(w.x) * 0.09 : 0), w.r, w.z, w.r, Math.max(0.2, w.w) + (lite ? 0.06 : 0), w.z > 0, 0x9aa0a6, 5, false, lite));
  return {
    root, chassis, body: body!, wheels: wheelRefs, brake, sigL, sigR, heads,
    length: L, width: sh.width, height: H, color, lod: [], lightBar,
  };
}

/** side profiles, t = 0 at the tail to 1 at the nose: centre-line top and belt (shoulder) line */
const PROFILES: Record<string, { centre: [number, number][]; belt: [number, number][]; roof?: number; beltMax?: number }> = {
  // cargo van: tall flat-roofed box with solid sides, a short cab with side windows at the front, short bonnet.
  // The belt line rides at the roof in the cargo area (no windows), then drops to the window line in the cab.
  t_van: {
    centre: [[0, 0.95], [0.015, 1.9], [0.03, 2.03], [0.7, 2.05], [0.76, 2.0], [0.84, 1.18], [0.9, 1.08], [0.96, 0.96], [1, 0.72]],
    belt: [[0, 1.0], [0.03, 1.9], [0.6, 1.92], [0.68, 1.15], [0.85, 1.1], [0.96, 0.95], [1, 0.72]],
    roof: 0.9,
    beltMax: 0.97,
  },
  // Model 3: short high boot, long fastback glass, tall rounded roof, short sloping nose
  tesla: {
    centre: [[0, 0.74], [0.03, 0.98], [0.1, 1.01], [0.18, 1.04], [0.3, 1.3], [0.42, 1.43], [0.54, 1.43], [0.64, 1.28], [0.73, 1.0], [0.84, 0.92], [0.95, 0.8], [1, 0.64]],
    belt: [[0, 0.86], [0.15, 0.98], [0.5, 0.97], [0.75, 0.9], [1, 0.76]],
  },
  // the player's Model 3: same car with a lower boot deck and roofline, so it does not tower over the chase camera
  tesla_player: {
    centre: [[0, 0.58], [0.03, 0.76], [0.1, 0.79], [0.18, 0.83], [0.3, 1.1], [0.42, 1.3], [0.54, 1.3], [0.64, 1.17], [0.73, 0.94], [0.84, 0.9], [0.95, 0.78], [1, 0.64]],
    belt: [[0, 0.68], [0.15, 0.78], [0.35, 0.9], [0.5, 0.94], [0.75, 0.9], [1, 0.76]],
  },
  // C63 S coupe (W205): long bonnet, upright grille nose, cabin set back with a short coupe roof, high short boot
  c63: {
    centre: [[0, 0.78], [0.03, 0.98], [0.1, 1.0], [0.2, 1.04], [0.28, 1.22], [0.36, 1.36], [0.48, 1.4], [0.58, 1.36], [0.66, 1.15], [0.72, 1.0], [0.8, 0.98], [0.9, 0.94], [0.97, 0.86], [1, 0.7]],
    belt: [[0, 0.8], [0.1, 1.0], [0.3, 1.0], [0.5, 0.98], [0.75, 0.97], [1, 0.82]],
    roof: 0.7,
  },
  // Corvette C8: cab forward mid-engine wedge, long raked screen, roof peak just ahead of the axle line, high haunches
  // running back into a short, raised engine deck, low pointed nose
  c8: {
    centre: [[0, 0.88], [0.02, 1.0], [0.08, 1.04], [0.2, 1.08], [0.3, 1.14], [0.36, 1.2], [0.42, 1.225], [0.52, 1.225], [0.58, 1.2], [0.66, 1.02], [0.72, 0.93], [0.8, 0.9], [0.9, 0.78], [0.97, 0.64], [1, 0.52]],
    belt: [[0, 0.88], [0.1, 1.0], [0.3, 1.02], [0.5, 0.98], [0.7, 0.9], [0.9, 0.74], [1, 0.52]],
    roof: 0.7,
    beltMax: 0.84,
  },
  // 911 GT3 RS (992): short low nose, steep screen, tall rounded roof, fastback falling to a high engine cover
  gt3rs: {
    centre: [[0, 0.82], [0.03, 0.98], [0.1, 1.04], [0.2, 1.12], [0.3, 1.22], [0.4, 1.3], [0.5, 1.32], [0.58, 1.3], [0.66, 1.08], [0.72, 0.96], [0.78, 0.9], [0.88, 0.78], [0.96, 0.66], [1, 0.55]],
    belt: [[0, 0.82], [0.1, 0.98], [0.3, 1.0], [0.5, 0.97], [0.72, 0.92], [0.9, 0.78], [1, 0.55]],
    roof: 0.72,
    beltMax: 0.8,
  },
  // Urus: tall coupe SUV, long raked screen, roof peak mid body falling to a short high tail, big bluff nose
  urus: {
    centre: [[0, 1.18], [0.02, 1.38], [0.08, 1.45], [0.2, 1.55], [0.3, 1.62], [0.4, 1.64], [0.52, 1.64], [0.6, 1.58], [0.68, 1.32], [0.74, 1.2], [0.82, 1.17], [0.92, 1.12], [0.98, 1.05], [1, 0.92]],
    belt: [[0, 1.2], [0.1, 1.3], [0.3, 1.3], [0.5, 1.26], [0.7, 1.2], [0.9, 1.1], [1, 0.95]],
    roof: 0.66,
    beltMax: 0.82,
  },
  // Civic Type R (FL5): fastback hatch, roof peak mid body, steep short tail, low nose
  civic: {
    centre: [[0, 0.78], [0.02, 1.0], [0.08, 1.06], [0.18, 1.2], [0.3, 1.36], [0.4, 1.41], [0.55, 1.41], [0.63, 1.34], [0.7, 1.12], [0.76, 1.02], [0.86, 0.97], [0.95, 0.9], [1, 0.76]],
    belt: [[0, 0.8], [0.1, 1.0], [0.3, 1.0], [0.5, 0.98], [0.75, 0.97], [0.9, 0.9], [1, 0.76]],
    roof: 0.74,
  },
  // Model S (player Tesla): long sloping liftback, shallow glass roof, low smooth nose
  models: {
    centre: [[0, 0.8], [0.03, 1.0], [0.08, 1.1], [0.2, 1.28], [0.32, 1.4], [0.45, 1.43], [0.58, 1.4], [0.68, 1.18], [0.74, 1.0], [0.82, 0.93], [0.92, 0.84], [0.97, 0.74], [1, 0.62]],
    belt: [[0, 0.82], [0.1, 1.0], [0.3, 1.0], [0.5, 0.97], [0.75, 0.93], [0.9, 0.85], [1, 0.65]],
    roof: 0.72,
  },
  // 350Z: short bonnet, steep screen, small greenhouse, round hatch falling to a ducktail
  z350: {
    centre: [[0, 0.82], [0.03, 1.0], [0.09, 1.04], [0.2, 1.12], [0.3, 1.27], [0.4, 1.32], [0.5, 1.32], [0.6, 1.25], [0.7, 1.02], [0.78, 0.96], [0.88, 0.9], [0.96, 0.8], [1, 0.68]],
    belt: [[0, 0.84], [0.1, 0.98], [0.3, 0.98], [0.5, 0.96], [0.75, 0.93], [1, 0.7]],
    roof: 0.72,
  },
  // Huracán: very low wedge, flat engine deck, cabin well forward of the rear axle, long raked screen, low beak
  huracan: {
    centre: [[0, 0.86], [0.05, 0.96], [0.3, 1.0], [0.4, 1.07], [0.47, 1.13], [0.56, 1.11], [0.7, 0.86], [0.8, 0.75], [0.93, 0.64], [1, 0.5]],
    belt: [[0, 0.84], [0.3, 0.88], [0.55, 0.82], [0.75, 0.72], [1, 0.56]],
  },
};

const ROOF: Record<string, Tag> = { zr1: 'carbon', c8: 'carbon', m4: 'carbon', tesla: 'roofglass', models: 'roofglass' };

/** what a hand-made design gets: body measurements along z plus the part tools */
interface DesignCtx {
  L: number; ground: number; noseW: number; tailW: number; noseH: number; tailH: number; cabFront: number; cabRear: number;
  hwAt(z: number): number; shAt(z: number): number; deckAt(z: number): number; topAt(z: number): number;
  box(tag: Tag, x: number, y: number, z: number, w: number, h: number, d: number): void;
  plate(tag: Tag, top: [number, number, number][], t: number): void;
  /** a rounded blob with radii rx, ry, rz */
  ball(tag: Tag, x: number, y: number, z: number, rx: number, ry: number, rz: number): void;
  /** a point resting on the body top at (x, z) */
  onTop(x: number, z: number, lift?: number): [number, number, number];
  /** a headlamp plate on the fender top between zf (front) and zb (back); in/out are fractions of the half width */
  lamp(sx: number, zf: number, zb: number, inF: number, outF: number, inB: number, outB: number, t?: number): void;
}

/** signature details per car (these replace the generic lamps and grille) */
const DESIGNS: Record<string, (c: DesignCtx) => void> = {
  // Corvette C7 ZR1: swept slit headlamps, full-width mouth, raised hood with carbon vent,
  // side scoops behind the doors, angular twin tail lamps, quad centre exhausts, big high wing.
  zr1(c) {
    const { L, ground, box, plate } = c;
    const F = L / 2, R = -L / 2;
    const onTop = c.onTop;
    const wR = c.deckAt(R + 0.2) + 0.08; // rear deck height under the wing
    for (const sx of [1, -1]) {
      // headlamp: a thin wedge swept back along the fender
      const w1 = c.hwAt(F - 0.1), w2 = c.hwAt(F - 0.5);
      const p = [onTop(sx * w1 * 0.9, F - 0.08), onTop(sx * w1 * 0.55, F - 0.14), onTop(sx * w2 * 0.74, F - 0.46), onTop(sx * w2 * 0.96, F - 0.54)];
      plate('head', p, 0.06);
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
  // BMW M4 (G82): tall vertical kidney grilles, angular headlamps, big corner intakes,
  // carbon roof, boot lip, L-shaped tail lamps, quad exhausts in two pairs.
  m4(c) {
    const { L, ground, box } = c;
    const F = L / 2, R = -L / 2;
    for (const sx of [1, -1]) {
      box('chrome', sx * 0.17, c.noseH - 0.2, F + 0.005, 0.3, 0.44, 0.05); // kidney surround
      box('dark', sx * 0.17, c.noseH - 0.2, F + 0.02, 0.24, 0.38, 0.05);
      c.lamp(sx, F - 0.06, F - 0.38, 0.42, 0.9, 0.7, 0.97);
      box('dark', sx * c.noseW * 0.78, ground + 0.16, F - 0.02, c.noseW * 0.34, 0.2, 0.06);
      box('tail', sx * c.tailW * 0.7, c.tailH - 0.08, R + 0.004, c.tailW * 0.5, 0.09, 0.05);
      box('tail', sx * c.tailW * 0.9, c.tailH - 0.15, R + 0.004, c.tailW * 0.14, 0.12, 0.05);
      for (const dx of [0.33, 0.45]) box('chrome', sx * c.tailW * dx * 2.1 / 2, ground + 0.14, R - 0.01, 0.1, 0.1, 0.08);
      box('carbon', sx * (c.hwAt(0) - 0.02), ground + 0.06, 0, 0.06, 0.08, L * 0.4);
      const zf = F - 1.15;
      box('dark', sx * (c.hwAt(zf) + 0.004), c.shAt(zf) - 0.2, zf, 0.02, 0.1, 0.2); // fender gill
    }
    box('carbon', 0, ground + 0.03, F - 0.08, c.noseW * 1.8, 0.035, 0.2);
    box('carbon', 0, c.deckAt(R + 0.12) + 0.02, R + 0.12, c.tailW * 1.8, 0.03, 0.12); // boot lip
    box('carbon', 0, ground + 0.08, R + 0.05, c.tailW * 1.4, 0.12, 0.12);
    const zh = F - 0.75;
    for (const sx of [1, -1]) box('paint', sx * c.hwAt(zh) * 0.3, c.deckAt(zh) + 0.015, zh, 0.12, 0.03, 0.8); // bonnet power bulges
  },
  // Corvette C8: boomerang LED headlamps, wide mouth with big corner intakes, long side scoop ahead of the rear
  // wheel with a black blade above it, slim twin tail pods, quad centre exhausts in a black diffuser, raised blade wing.
  c8(c) {
    const { L, ground, box, plate } = c;
    const F = L / 2, R = -L / 2;
    const onTop = c.onTop;
    const wR = c.deckAt(R + 0.3) - 0.02;
    for (const sx of [1, -1]) {
      // headlamp: a thin blade sweeping back from the nose corner
      const w1 = c.hwAt(F - 0.15), w2 = c.hwAt(F - 0.75);
      plate('head', [onTop(sx * w1 * 0.93, F - 0.12), onTop(sx * w1 * 0.7, F - 0.24), onTop(sx * w2 * 0.82, F - 0.86), onTop(sx * w2 * 0.97, F - 0.8)], 0.05);
      // big angled corner intakes
      box('dark', sx * c.noseW * 0.7, ground + 0.2, F - 0.03, c.noseW * 0.52, 0.2, 0.06);
      // side scoop with its black blade, side sill
      const zs = -0.38;
      box('dark', sx * (c.hwAt(zs) + 0.004), c.shAt(zs) - 0.25, zs, 0.02, 0.3, 0.72);
      box('carbon', sx * (c.hwAt(zs) + 0.008), c.shAt(zs) - 0.08, zs + 0.12, 0.02, 0.06, 0.7);
      box('carbon', sx * (c.hwAt(0.2) - 0.02), ground + 0.06, 0.2, 0.06, 0.08, L * 0.4);
      // fender vent behind the front wheel
      const zf = F - 1.55;
      box('dark', sx * (c.hwAt(zf) + 0.004), c.shAt(zf) - 0.12, zf, 0.02, 0.09, 0.3);
      // tail pods
      box('tail', sx * c.tailW * 0.46, c.tailH - 0.1, R + 0.004, c.tailW * 0.44, 0.06, 0.05);
      box('tail', sx * c.tailW * 0.78, c.tailH - 0.18, R + 0.004, c.tailW * 0.3, 0.1, 0.05);
      // rear grille vents above the diffuser, wing uprights
      box('dark', sx * c.tailW * 0.72, ground + 0.3, R + 0.01, c.tailW * 0.5, 0.09, 0.05);
      box('carbon', sx * c.tailW * 0.6, wR + 0.06, R + 0.3, 0.04, 0.12, 0.12);
      box('carbon', sx * c.tailW * 0.9, wR + 0.16, R + 0.3, 0.02, 0.08, 0.3);
    }
    // nose: full-width lower mouth and splitter, small bonnet vent
    box('dark', 0, ground + 0.15, F - 0.03, c.noseW * 0.95, 0.2, 0.06);
    box('carbon', 0, ground + 0.02, F - 0.1, c.noseW * 1.95, 0.035, 0.26);
    box('dark', 0, c.deckAt(F - 0.9) + 0.012, F - 0.9, c.hwAt(F - 0.9) * 0.5, 0.01, 0.3);
    // rear: dark lamp bar, diffuser with four centre exhausts, blade wing
    box('dark', 0, c.tailH - 0.1, R + 0.012, c.tailW * 1.5, 0.06, 0.04);
    box('carbon', 0, ground + 0.12, R + 0.05, c.tailW * 1.7, 0.2, 0.12);
    for (const x of [-0.27, -0.09, 0.09, 0.27]) box('chrome', x, ground + 0.2, R - 0.01, 0.1, 0.1, 0.08);
    box('carbon', 0, wR + 0.12, R + 0.3, c.tailW * 1.8, 0.03, 0.3);
  },
  // Porsche 911 GT3 RS (992): round headlamps on raised fender peaks, carbon centre bonnet with vents, wide lower mouth,
  // black rear quarter intakes, full width light bar, twin centre tips, big diffuser, tall swan neck wing with end plates.
  gt3rs(c) {
    const { L, ground, box } = c;
    const F = L / 2, R = -L / 2;
    const wR = c.deckAt(R + 0.35) + 0.28; // wing height: above the engine cover, near roof level
    for (const sx of [1, -1]) {
      // round headlamps on the fender humps
      const zl = F - 0.32, xl = sx * c.hwAt(zl) * 0.7;
      const [lx, ly, lz] = c.onTop(xl, zl, 0.02);
      c.ball('head', lx, ly, lz, 0.125, 0.125, 0.13); // round domed lamp, no cover
      // fender top vents, front intakes either side of the mouth
      const zv = F - 1.05, [vx, vy, vz] = c.onTop(sx * c.hwAt(zv) * 0.62, zv, 0.012);
      box('dark', vx, vy, vz, 0.28, 0.01, 0.2);
      box('dark', sx * c.noseW * 0.78, ground + 0.2, F - 0.03, c.noseW * 0.34, 0.2, 0.06);
      // rear quarter intake behind the door, side blade, door stripe, side skirts
      const zs = -0.62;
      box('dark', sx * (c.hwAt(zs) + 0.004), c.shAt(zs) - 0.2, zs, 0.02, 0.26, 0.42);
      box('carbon', sx * (c.hwAt(0.1) + 0.004), ground + 0.4, 0.1, 0.02, 0.025, 1.0);
      box('carbon', sx * (c.hwAt(0.1) - 0.02), ground + 0.07, 0.1, 0.07, 0.1, L * 0.36);
      // tail: slim outer lamp, small lower lamp
      box('tail', sx * c.tailW * 0.8, c.tailH - 0.14, R + 0.004, c.tailW * 0.34, 0.06, 0.05);
      box('tail', sx * c.tailW * 0.62, ground + 0.3, R + 0.004, c.tailW * 0.2, 0.05, 0.05);
      // swan neck wing: tall uprights from the engine cover, big end plates
      box('carbon', sx * c.tailW * 0.45, wR - 0.17, R + 0.4, 0.05, 0.34, 0.18);
      box('carbon', sx * c.tailW * 0.98, wR + 0.02, R + 0.38, 0.03, 0.14, 0.4);
    }
    // nose: wide lower mouth, splitter, carbon bonnet centre with a vent
    box('dark', 0, ground + 0.16, F - 0.03, c.noseW * 0.95, 0.2, 0.06);
    box('carbon', 0, ground + 0.02, F - 0.1, c.noseW * 1.9, 0.035, 0.28);
    const zh = F - 0.95;
    box('carbon', 0, c.deckAt(zh) + 0.012, zh, c.hwAt(zh) * 0.9, 0.012, 0.9);
    box('dark', 0, c.deckAt(zh + 0.4) + 0.02, zh + 0.4, c.hwAt(zh) * 0.45, 0.012, 0.18);
    // rear: light bar across the engine cover lip, dark lower band, diffuser, twin tips, wing blade and ducktail
    box('tail', 0, c.tailH - 0.12, R + 0.004, c.tailW * 1.3, 0.035, 0.05);
    box('dark', 0, ground + 0.34, R + 0.01, c.tailW * 1.9, 0.26, 0.04);
    box('carbon', 0, ground + 0.12, R + 0.05, c.tailW * 1.8, 0.2, 0.12);
    for (const x of [-0.14, 0.14]) box('chrome', x, ground + 0.25, R - 0.01, 0.1, 0.1, 0.08);
    box('carbon', 0, c.deckAt(R + 0.2) + 0.02, R + 0.2, c.tailW * 1.7, 0.03, 0.16);
    box('carbon', 0, wR + 0.06, R + 0.38, c.tailW * 1.96, 0.035, 0.38);
  },
  // Lamborghini Urus: slim hex LED headlamps, huge black mouth with horizontal bars and angled corner intakes, raised
  // bonnet ridge, black rear spoiler, full width tail lamp strips over a script vent band, big diffuser, quad tips.
  urus(c) {
    const { L, ground, box } = c;
    const F = L / 2, R = -L / 2;
    for (const sx of [1, -1]) {
      c.lamp(sx, F - 0.12, F - 0.62, 0.42, 0.96, 0.62, 0.99, 0.045);
      // angled corner intakes, side skirts, fender vent
      box('dark', sx * c.noseW * 0.74, c.noseH - 0.32, F - 0.03, c.noseW * 0.5, 0.4, 0.06);
      box('carbon', sx * (c.hwAt(0) - 0.02), ground + 0.1, -0.1, 0.07, 0.1, L * 0.4);
      const zf = F - 1.4;
      box('dark', sx * (c.hwAt(zf) + 0.004), c.shAt(zf) - 0.2, zf, 0.02, 0.12, 0.34);
      // tail: slim lamp strips, outer lamps, side exhausts
      box('tail', sx * c.tailW * 0.62, c.tailH - 0.1, R + 0.004, c.tailW * 0.6, 0.045, 0.05);
      box('tail', sx * c.tailW * 0.9, c.tailH - 0.3, R + 0.004, c.tailW * 0.14, 0.05, 0.05);
      box('chrome', sx * c.tailW * 0.62, ground + 0.2, R - 0.01, 0.14, 0.1, 0.08);
      box('chrome', sx * c.tailW * 0.8, ground + 0.2, R - 0.01, 0.14, 0.1, 0.08);
    }
    // nose: black mouth with bars, splitter, badge, raised bonnet ridge
    box('dark', 0, c.noseH - 0.3, F - 0.02, c.noseW * 1.05, 0.38, 0.06);
    for (const dy of [-0.08, 0.02, 0.12]) box('carbon', 0, c.noseH - 0.3 + dy, F + 0.01, c.noseW * 0.95, 0.025, 0.04);
    box('chrome', 0, c.noseH - 0.05, F + 0.005, 0.07, 0.06, 0.02);
    box('carbon', 0, ground + 0.03, F - 0.1, c.noseW * 1.9, 0.035, 0.28);
    const zh = F - 1.0;
    box('paint', 0, c.deckAt(zh) + 0.015, zh, c.hwAt(zh) * 0.55, 0.05, 1.2);
    // rear: roof spoiler lip, black script band, lower diffuser
    box('carbon', 0, c.topAt(R + 0.25) + 0.015, R + 0.25, c.tailW * 1.4, 0.03, 0.26);
    box('dark', 0, c.tailH - 0.1, R + 0.012, c.tailW * 1.4, 0.07, 0.04);
    box('dark', 0, ground + 0.3, R + 0.02, c.tailW * 1.9, 0.5, 0.06);
    box('carbon', 0, ground + 0.12, R + 0.05, c.tailW * 1.8, 0.2, 0.12);
  },
  // Tesla Model S: slim swept lamps, smooth grille-less nose with a small T badge and a low slatted intake, glass roof,
  // slim wraparound tail lamps either side of a black strip, thin boot spoiler, wide black lower valance.
  models(c) {
    const { L, ground, box } = c;
    const F = L / 2, R = -L / 2;
    for (const sx of [1, -1]) {
      const [lx, ly, lz] = c.onTop(sx * c.hwAt(F - 0.3) * 0.68, F - 0.3, 0.02);
      box('dark', lx, ly - 0.005, lz - 0.01, 0.42, 0.08, 0.26);
      box('head', lx, ly + 0.01, lz + 0.01, 0.36, 0.05, 0.2);
      box('dark', sx * c.noseW * 0.66, c.noseH - 0.08, F - 0.015, c.noseW * 0.46, 0.12, 0.05); box('head', sx * c.noseW * 0.66, c.noseH - 0.08, F + 0.005, c.noseW * 0.4, 0.07, 0.04); // lamp wrapping onto the front face
      box('dark', sx * c.noseW * 0.7, ground + 0.17, F - 0.02, c.noseW * 0.38, 0.12, 0.06); // fog intake
      box('tail', sx * c.tailW * 0.74, c.tailH - 0.1, R + 0.004, c.tailW * 0.46, 0.07, 0.05);
      box('carbon', sx * (c.hwAt(0) - 0.02), ground + 0.06, 0, 0.04, 0.05, L * 0.4);
    }
    box('dark', 0, ground + 0.15, F - 0.02, c.noseW * 0.95, 0.1, 0.06); // lower intake
    box('chrome', 0, c.noseH - 0.1, F + 0.005, 0.1, 0.04, 0.02); // T badge
    box('dark', 0, c.tailH - 0.1, R + 0.008, c.tailW * 1.9, 0.03, 0.04); // black strip between the lamps
    box('dark', 0, ground + 0.12, R + 0.04, c.tailW * 1.9, 0.2, 0.1); // black valance
    box('paint', 0, c.deckAt(R + 0.12) + 0.014, R + 0.12, c.tailW * 1.8, 0.025, 0.12); // boot spoiler
  },
  // Nissan 350Z: big swept teardrop headlamps, mesh lower grille, side intake, blue skirts and lip, big triangular tail
  // lamps with a dark centre strip, ducktail lip, twin tips.
  z350(c) {
    const { L, ground, box } = c;
    const F = L / 2, R = -L / 2;
    for (const sx of [1, -1]) {
      { const [lx, ly, lz] = c.onTop(sx * c.hwAt(F - 0.3) * 0.72, F - 0.3, 0.02); box('dark', lx, ly - 0.005, lz - 0.01, 0.4, 0.1, 0.34); box('head', lx, ly + 0.01, lz + 0.01, 0.34, 0.06, 0.28); }
      box('dark', sx * c.noseW * 0.66, c.noseH - 0.1, F - 0.015, c.noseW * 0.5, 0.15, 0.05); box('head', sx * c.noseW * 0.66, c.noseH - 0.1, F + 0.005, c.noseW * 0.44, 0.09, 0.04);
      box('dark', sx * c.noseW * 0.86, ground + 0.2, F - 0.02, c.noseW * 0.2, 0.18, 0.06); // vertical side intakes
      const zf = F - 1.2;
      box('dark', sx * (c.hwAt(zf) + 0.004), c.shAt(zf) - 0.2, zf, 0.02, 0.1, 0.14); // fender vent
      box('blue', sx * (c.hwAt(0) - 0.01), ground + 0.08, 0.0, 0.05, 0.1, L * 0.42); // blue side skirts
      box('tail', sx * c.tailW * 0.7, c.tailH - 0.1, R + 0.004, c.tailW * 0.5, 0.12, 0.05);
      box('chrome', sx * 0.2, ground + 0.15, R - 0.01, 0.1, 0.1, 0.08);
    }
    box('dark', 0, ground + 0.16, F - 0.02, c.noseW * 0.8, 0.14, 0.06); // mesh lower grille
    box('blue', 0, ground + 0.03, F - 0.06, c.noseW * 1.7, 0.03, 0.14); // blue front lip
    box('chrome', 0, c.noseH - 0.12, F + 0.005, 0.1, 0.07, 0.02); // badge
    box('dark', 0, c.tailH - 0.1, R + 0.008, c.tailW * 1.9, 0.03, 0.04); // strip between the tail lamps
    box('paint', 0, c.deckAt(R + 0.14) + 0.02, R + 0.14, c.tailW * 1.8, 0.04, 0.14); // ducktail
    box('blue', 0, ground + 0.07, R + 0.05, c.tailW * 1.7, 0.05, 0.12); // blue rear lip
    box('dark', 0, ground + 0.13, R + 0.04, c.tailW * 1.5, 0.12, 0.1);
  },
  // Lamborghini Huracán: slim Y headlamps, wide three-part mouth, hexagon side intakes,
  // louvred engine cover, Y tail lamps, twin exhausts in the diffuser.
  huracan(c) {
    const { L, ground, box } = c;
    const F = L / 2, R = -L / 2;
    for (const sx of [1, -1]) {
      c.lamp(sx, F - 0.12, F - 0.55, 0.45, 0.92, 0.82, 0.98, 0.05);
      box('dark', sx * c.noseW * 0.72, ground + 0.13, F - 0.02, c.noseW * 0.5, 0.14, 0.06);
      const zs = -0.55;
      box('dark', sx * (c.hwAt(zs) + 0.004), c.shAt(zs) - 0.14, zs, 0.02, 0.2, 0.55); // side intake
      box('dark', sx * (c.hwAt(zs) + 0.006), c.shAt(zs) - 0.02, zs + 0.2, 0.02, 0.06, 0.3);
      box('tail', sx * c.tailW * 0.6, c.tailH - 0.05, R + 0.004, c.tailW * 0.8, 0.045, 0.05);
      box('tail', sx * c.tailW * 0.9, c.tailH - 0.11, R + 0.004, c.tailW * 0.2, 0.08, 0.05);
      box('chrome', sx * 0.2, ground + 0.16, R - 0.01, 0.11, 0.09, 0.08);
      box('carbon', sx * (c.hwAt(0) - 0.02), ground + 0.05, 0, 0.06, 0.07, L * 0.4);
    }
    box('dark', 0, ground + 0.12, F - 0.02, c.noseW * 0.5, 0.1, 0.06);
    box('carbon', 0, ground + 0.02, F - 0.1, c.noseW * 1.9, 0.03, 0.22);
    box('dark', 0, c.tailH - 0.2, R + 0.01, c.tailW * 2.1, 0.22, 0.04); // rear mesh
    box('carbon', 0, ground + 0.07, R + 0.05, c.tailW * 1.8, 0.12, 0.12);
    // engine cover louvres behind the cabin
    const ze = c.cabRear - 0.25;
    for (let k = 0; k < 4; k++) box('dark', 0, c.deckAt(ze - k * 0.12) + 0.012, ze - k * 0.12, c.hwAt(ze) * 0.8, 0.012, 0.05);
  },
  // Mercedes-AMG C63 (W205): Panamericana grille with vertical chrome slats, wide headlamps,
  // big lower intakes, boot lip, quad round exhausts.
  c63(c) {
    const { L, ground, box } = c;
    const F = L / 2, R = -L / 2;
    // Panamericana grille: dark, vertical chrome bars, big star, sitting upright in the nose
    const gy = c.noseH - 0.2;
    box('dark', 0, gy, F + 0.01, 0.78, 0.28, 0.05);
    for (let k = -7; k <= 7; k++) box('chrome', k * 0.05, gy, F + 0.03, 0.014, 0.26, 0.03);
    box('chrome', 0, gy, F + 0.045, 0.17, 0.17, 0.02); // star badge
    box('chrome', 0, gy + 0.17, F + 0.02, 0.86, 0.03, 0.04); // upper chrome edge
    for (const sx of [1, -1]) {
      { const [lx, ly, lz] = c.onTop(sx * c.hwAt(F - 0.3) * 0.7, F - 0.3, 0.02); box('dark', lx, ly - 0.005, lz - 0.01, 0.42, 0.09, 0.26); box('head', lx, ly + 0.01, lz + 0.01, 0.36, 0.05, 0.2); } // swept lamp
      box('dark', sx * c.noseW * 0.7, c.noseH - 0.1, F - 0.015, c.noseW * 0.46, 0.13, 0.05); box('head', sx * c.noseW * 0.7, c.noseH - 0.1, F + 0.005, c.noseW * 0.4, 0.07, 0.04); // lamp on the front face
      box('dark', sx * c.noseW * 0.74, ground + 0.17, F - 0.02, c.noseW * 0.42, 0.22, 0.06); // big corner intakes
      box('tail', sx * c.tailW * 0.74, c.tailH - 0.06, R + 0.004, c.tailW * 0.5, 0.09, 0.05);
      for (const dx of [0.6, 0.82]) box('chrome', sx * c.tailW * dx, ground + 0.15, R - 0.01, 0.1, 0.1, 0.09); // quad exhausts
      box('carbon', sx * (c.hwAt(0) - 0.02), ground + 0.06, 0, 0.05, 0.08, L * 0.4);
      const zf = F - 1.25;
      box('dark', sx * (c.hwAt(zf) + 0.004), c.shAt(zf) - 0.2, zf, 0.02, 0.09, 0.26); // fender gill
    }
    box('dark', 0, ground + 0.16, F - 0.02, c.noseW * 0.7, 0.14, 0.06); // lower intake
    box('chrome', 0, ground + 0.24, F + 0.005, c.noseW * 0.7, 0.025, 0.03); // A-wing bar
    box('carbon', 0, ground + 0.03, F - 0.09, c.noseW * 1.8, 0.03, 0.2); // splitter
    box('paint', 0, c.deckAt(R + 0.16) + 0.02, R + 0.16, c.tailW * 1.7, 0.04, 0.14); // boot lip spoiler
    box('carbon', 0, ground + 0.09, R + 0.05, c.tailW * 1.3, 0.13, 0.12); // diffuser
    box('dark', 0, c.tailH - 0.06, R + 0.012, c.tailW * 1.8, 0.05, 0.04); // lamp bar between the tail lamps
  },
  // Delivery van: dark grille and bumper up front, tall vertical tail lamps, rear door seam and a sliding door line
  t_van(c) {
    const { L, ground, box } = c;
    const F = L / 2, R = -L / 2;
    box('dark', 0, c.noseH - 0.22, F + 0.01, c.noseW * 0.9, 0.24, 0.05); // grille
    box('dark', 0, ground + 0.14, F - 0.03, c.noseW * 1.5, 0.2, 0.1); // front bumper
    for (const sx of [1, -1]) {
      c.lamp(sx, F - 0.04, F - 0.3, 0.55, 0.94, 0.8, 0.98);
      box('tail', sx * c.tailW * 0.93, 1.0, R + 0.004, 0.13, 0.5, 0.05); // tall tail lamps
      const zs = 0.3;
      box('dark', sx * (c.hwAt(zs) + 0.004), 1.05, zs, 0.02, 1.35, 0.03); // sliding door seam
    }
    box('dark', 0, ground + 0.16, R + 0.03, c.tailW * 1.9, 0.2, 0.1); // rear bumper
    box('dark', 0, 1.15, R + 0.008, 0.03, 1.5, 0.03); // rear door seam
    box('carbon', 0, 1.78, R + 0.006, c.tailW * 1.7, 0.03, 0.03); // rear door top seam
  },
  // Honda Civic Type R (FL5): tall rear wing, triple centre exhaust, bonnet scoop,
  // honeycomb grille and big corner intakes, red accents.
  civic(c) {
    const { L, ground, box } = c;
    const F = L / 2, R = -L / 2;
    const wR = c.deckAt(R + 0.25) + 0.05;
    for (const sx of [1, -1]) {
      { const [lx, ly, lz] = c.onTop(sx * c.hwAt(F - 0.3) * 0.7, F - 0.3, 0.02); box('dark', lx, ly - 0.005, lz - 0.01, 0.46, 0.1, 0.27); box('head', lx, ly + 0.01, lz + 0.01, 0.38, 0.06, 0.22); } // slim swept lamp in a dark surround
      box('dark', sx * c.noseW * 0.66, c.noseH - 0.1, F - 0.015, c.noseW * 0.5, 0.15, 0.05); box('head', sx * c.noseW * 0.66, c.noseH - 0.1, F + 0.005, c.noseW * 0.44, 0.09, 0.04); // lamp wrapping onto the front face
      box('dark', sx * c.noseW * 0.76, ground + 0.16, F - 0.02, c.noseW * 0.38, 0.2, 0.06);
      box('tail', sx * c.tailW * 0.72, c.tailH - 0.06, R + 0.004, c.tailW * 0.55, 0.08, 0.05);
      box('carbon', sx * c.tailW * 0.55, wR + 0.12, R + 0.25, 0.04, 0.24, 0.12); // wing uprights
      box('carbon', sx * (c.hwAt(0) - 0.02), ground + 0.06, 0, 0.06, 0.08, L * 0.4);
      box('tail', sx * (c.hwAt(0) + 0.01), ground + 0.1, 0.4, 0.01, 0.015, 0.6); // red skirt stripe
    }
    box('dark', 0, c.noseH - 0.2, F + 0.005, c.noseW * 0.8, 0.18, 0.05); // honeycomb grille
    box('chrome', 0, c.noseH - 0.2, F + 0.03, 0.1, 0.07, 0.02); // badge
    box('dark', 0, ground + 0.17, F - 0.02, c.noseW * 1.25, 0.2, 0.06); // wide lower intake
    box('tail', 0, ground + 0.03, F - 0.06, c.noseW * 1.7, 0.02, 0.1); // red lip line
    box('carbon', 0, wR + 0.25, R + 0.22, c.tailW * 1.95, 0.03, 0.26);
    box('carbon', 0, ground + 0.1, R + 0.05, c.tailW * 1.3, 0.14, 0.12);
    for (const [x, r] of [[-0.12, 0.08], [0, 0.06], [0.12, 0.08]]) box('chrome', x, ground + 0.16, R - 0.01, r, r, 0.08);
    const zh = F - 0.55;
    box('dark', 0, c.deckAt(zh) + 0.03, zh, 0.32, 0.05, 0.25); // bonnet scoop
  },
  // Tesla Model 3: smooth grille-less nose, slim teardrop headlamps, small lower intake,
  // glass roof, wraparound tail lamps, no exhaust.
  tesla(c) {
    const { L, ground, box } = c;
    const F = L / 2, R = -L / 2;
    for (const sx of [1, -1]) {
      c.lamp(sx, F - 0.1, F - 0.4, 0.5, 0.9, 0.78, 0.97, 0.05);
      box('tail', sx * c.tailW * 0.72, c.tailH - 0.05, R + 0.004, c.tailW * 0.52, 0.09, 0.05);
      box('dark', sx * (c.hwAt(0) - 0.02), ground + 0.06, 0, 0.04, 0.06, L * 0.4);
    }
    box('dark', 0, ground + 0.12, F - 0.02, c.noseW * 0.9, 0.08, 0.06);
    box('chrome', 0, c.noseH - 0.12, F + 0.005, 0.1, 0.05, 0.02); // badge
    box('dark', 0, ground + 0.08, R + 0.04, c.tailW * 1.6, 0.1, 0.08);
    box('paint', 0, c.deckAt(R + 0.1) + 0.012, R + 0.1, c.tailW * 1.6, 0.02, 0.08); // lip
  },
};
