// Measures a reference vehicle model and writes a compact "shape" description that the game's own
// builder (src/vehicles/ShapeBuilder.ts) uses to model the vehicle from scratch.
// The reference is only measured: outline per station along the length, half-width at each height,
// what kind of surface is at each point (paint / glass / light / trim / chrome) and wheel placement.
// Usage: tsx scripts/extract-shape.ts <ref.glb> <id> <lengthMetres> [flip 0|1] [bike 0|1]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { getBounds } from '@gltf-transform/functions';
import fs from 'fs';

const [file, id, lenArg, flipArg = '0', bikeArg = '0'] = process.argv.slice(2);
const LENGTH = Number(lenArg), FLIP = flipArg === '1', BIKE = bikeArg === '1';
const NZ = BIKE ? 90 : 120;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(file);

type Cat = 'paint' | 'glass' | 'light' | 'dark' | 'chrome' | 'wheel';
const CATS: Cat[] = ['paint', 'glass', 'light', 'dark', 'chrome', 'wheel'];
function categorise(name: string, color: number[], hasTex: boolean): Cat {
  const n = name.toLowerCase();
  if (/wheel|tyre|tire|rim|calip|disc|rotor|hub|spoke|brake_?disk|disk_brake/.test(n)) return 'wheel';
  if (/glass|window|windscreen|kaca|lens|glas|tembus|visor|screen/.test(n)) return 'glass';
  if (/light|lamp|tail|head|led|indicator|signal/.test(n)) return 'light';
  if (/chrome|exhaust|metal|steel|silver/.test(n)) return 'chrome';
  if (/paint|primary|coloured|colored|_ext\b|mm_ext|body|carpaint/.test(n)) return 'paint';
  if (/grille|grill|carbon|black|trim|rubber|plastic|misc|chassis|base|badge|interior|seat|mesh|detail|engine|belt|plate/.test(n)) return 'dark';
  // unnamed: bright / saturated colours are body paint, dark ones trim
  const lum = 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];
  return lum < 0.12 && !hasTex ? 'dark' : 'paint';
}

// gather world-space surface points with categories
// density is in source units; set after a first pass measures the model's scale
const bb = getBounds(doc.getRoot().listScenes()[0]);
const srcLen = Math.max(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]);
const SAMPLE_DENSITY = 2500 * (LENGTH / srcLen) ** 2; // ~2500 samples per square metre of surface
interface V { x: number; y: number; z: number; c: number }
const verts: V[] = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    if (!pos) continue;
    const mat = p.getMaterial();
    const cat = categorise(mat?.getName() ?? '', mat?.getBaseColorFactor() ?? [1, 1, 1, 1], !!mat?.getBaseColorTexture());
    const c = CATS.indexOf(cat);
    // sample points across triangle surfaces (area weighted), not just vertices: large flat
    // panels have few vertices and would leave holes in the measurement grid
    const idxA = p.getIndices();
    const n = idxA ? idxA.getCount() : pos.getCount();
    const P = (i: number) => { const e = [0, 0, 0]; pos.getElement(i, e); return [m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12], m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13], m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14]]; };
    for (let t = 0; t + 2 < n; t += 3) {
      const ia = idxA ? idxA.getScalar(t) : t, ib = idxA ? idxA.getScalar(t + 1) : t + 1, ic = idxA ? idxA.getScalar(t + 2) : t + 2;
      const A = P(ia), Bv = P(ib), Cv = P(ic);
      verts.push({ x: A[0], y: A[1], z: A[2], c });
      const ux = Bv[0] - A[0], uy = Bv[1] - A[1], uz = Bv[2] - A[2], vx = Cv[0] - A[0], vy = Cv[1] - A[1], vz = Cv[2] - A[2];
      const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      const samples = Math.min(400, Math.floor(area * SAMPLE_DENSITY));
      for (let q = 0; q < samples; q++) {
        let r1 = Math.random(), r2 = Math.random();
        if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
        verts.push({ x: A[0] + ux * r1 + vx * r2, y: A[1] + uy * r1 + vy * r2, z: A[2] + uz * r1 + vz * r2, c });
      }
    }
  }
}
// orient: smallest axis = up (y); longest horizontal = length (z)
const ext = (k: 'x' | 'y' | 'z') => { let lo = Infinity, hi = -Infinity; for (const v of verts) { lo = Math.min(lo, v[k]); hi = Math.max(hi, v[k]); } return hi - lo; };
if (ext('x') > ext('z')) for (const v of verts) { const t = v.x; v.x = -v.z; v.z = t; }
if (FLIP) for (const v of verts) { v.x = -v.x; v.z = -v.z; }
// scale to real length, centre on x/z, ground at y = 0
let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
for (const v of verts) { minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z); }
const k = LENGTH / (maxZ - minZ), cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
for (const v of verts) { v.x = (v.x - cx) * k; v.y = (v.y - minY) * k; v.z = (v.z - cz) * k; }

// wheels: clusters of wheel-category vertices by quadrant (cars) or front/rear (bikes)
const wheelV = verts.filter((v) => CATS[v.c] === 'wheel');
const wheels: { x: number; z: number; r: number; w: number }[] = [];
const groups = BIKE ? [[0, 1], [0, -1]] : [[1, 1], [-1, 1], [1, -1], [-1, -1]];
for (const [sx, sz] of groups) {
  const g = wheelV.filter((v) => (BIKE || Math.sign(v.x) === sx) && Math.sign(v.z) === sz);
  if (g.length < 20) continue;
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const v of g) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z); }
  const r = Math.max((z1 - z0) / 2, y1 / 2);
  wheels.push({ x: BIKE ? 0 : (x0 + x1) / 2, z: (z0 + z1) / 2, r, w: Math.min(x1 - x0, BIKE ? 0.2 : 0.4) });
}

// body (everything except wheels), measured per station as a top surface T(u) and underside B(u)
// across the width, u = x / halfWidth in [0,1] (mirrored, the body is treated as symmetric)
const body = verts.filter((v) => CATS[v.c] !== 'wheel');
const L = LENGTH, z0 = -L / 2, NU = BIKE ? 9 : 17;
const zi = (z: number) => Math.min(NZ - 1, Math.max(0, Math.floor(((z - z0) / L) * NZ)));
// half width per station, with mirror / spike rejection and smoothing
const hwRaw = new Float32Array(NZ);
for (const v of body) { const i = zi(v.z); if (v.y > 0.08) hwRaw[i] = Math.max(hwRaw[i], Math.abs(v.x)); }
const gauss = (sig: number, r: number) => { const k: number[] = []; for (let d = -r; d <= r; d++) k.push(Math.exp(-(d * d) / (2 * sig * sig))); return k; };
const med = (a: Float32Array, r: number) => { const o = new Float32Array(a); for (let i = 0; i < a.length; i++) { const nb: number[] = []; for (let d = -r; d <= r; d++) { const j = i + d; if (j >= 0 && j < a.length && a[j] > 0) nb.push(a[j]); } nb.sort((x, y) => x - y); o[i] = nb.length ? nb[Math.floor(nb.length / 2)] : 0; } return o; };
const sm = (a: Float32Array, sig: number) => { const k = gauss(sig, 4); const o = new Float32Array(a); for (let i = 0; i < a.length; i++) { let s = 0, n = 0; for (let d = -4; d <= 4; d++) { const j = i + d; if (j < 0 || j >= a.length) continue; s += a[j] * k[d + 4]; n += k[d + 4]; } o[i] = s / n; } return o; };
const HW = sm(med(hwRaw, 4), BIKE ? 1 : 1.5);
const T = new Float32Array(NZ * NU).fill(-1), B = new Float32Array(NZ * NU).fill(99);
for (const v of body) {
  const i = zi(v.z);
  if (HW[i] <= 0) continue;
  const k = Math.min(NU - 1, Math.round((Math.abs(v.x) / HW[i]) * (NU - 1)));
  T[i * NU + k] = Math.max(T[i * NU + k], v.y);
  B[i * NU + k] = Math.min(B[i * NU + k], v.y);
}
// fill empty cells from the nearest filled cell in the same station (toward the centre first)
for (let i = 0; i < NZ; i++) for (let k = 0; k < NU; k++) {
  if (T[i * NU + k] >= 0) continue;
  for (let d = 1; d < NU; d++) {
    for (const kk of [k - d, k + d]) if (kk >= 0 && kk < NU && T[i * NU + kk] >= 0) { T[i * NU + k] = T[i * NU + kk]; B[i * NU + k] = B[i * NU + kk]; d = NU; break; }
  }
  if (T[i * NU + k] < 0) { T[i * NU + k] = 0.3; B[i * NU + k] = 0.2; }
}
// spike rejection (aerials, spoiler struts) then 2D smoothing
const smooth2 = (A: Float32Array, sz: number, su: number) => {
  const kz = gauss(sz, 4), ku = gauss(su, 2); const o = new Float32Array(A);
  for (let i = 0; i < NZ; i++) for (let k = 0; k < NU; k++) {
    let s = 0, n = 0;
    for (let a = -4; a <= 4; a++) for (let b = -2; b <= 2; b++) {
      const ii = i + a; let kk = k + b; if (ii < 0 || ii >= NZ) continue; if (kk < 0) kk = -kk; if (kk >= NU) kk = 2 * (NU - 1) - kk;
      const w = kz[a + 4] * ku[b + 2]; s += A[ii * NU + kk] * w; n += w;
    }
    o[i * NU + k] = s / n;
  }
  A.set(o);
};
for (let k = 0; k < NU; k++) { const col = new Float32Array(NZ); for (let i = 0; i < NZ; i++) col[i] = T[i * NU + k]; const m = med(col, 2); for (let i = 0; i < NZ; i++) T[i * NU + k] = Math.min(T[i * NU + k], m[i] + 0.03); }
smooth2(T, BIKE ? 0.8 : 1.3, 0.8); smooth2(B, 1.5, 1);
for (let i = 0; i < NZ * NU; i++) if (B[i] > T[i] - 0.02) B[i] = T[i] - 0.02;

// wheel fallback: when the reference has no separate wheel parts (or they measured wrong), find the
// wheels where the underside touches the ground, then carve wheel arches out of the body
const wheelsOk = wheels.length === (BIKE ? 2 : 4) && wheels.every((w) => w.r > 0.2 && w.r < (BIKE ? 0.45 : 0.55));
if (!wheelsOk) {
  wheels.length = 0;
  const edge = (i: number) => B[i * NU + (BIKE ? 0 : NU - 2)];
  const runs: { a: number; b: number }[] = [];
  let st = -1;
  for (let i = 0; i <= NZ; i++) { const low = i < NZ && edge(i) < (BIKE ? 0.1 : 0.14); if (low && st < 0) st = i; if (!low && st >= 0) { runs.push({ a: st, b: i - 1 }); st = -1; } }
  const zc = (r: { a: number; b: number }) => z0 + (((r.a + r.b) / 2 + 0.5) / NZ) * L;
  const pick = (front: boolean) => runs.filter((r) => (zc(r) > 0) === front).sort((x, y) => (y.b - y.a) - (x.b - x.a))[0];
  for (const front of [true, false]) {
    const r = pick(front);
    const z = r ? zc(r) : (front ? 1 : -1) * (L / 2 - (BIKE ? 0.32 : L * 0.2));
    const rad = BIKE ? 0.3 : Math.min(0.45, Math.max(0.3, r ? ((r.b - r.a + 1) / NZ) * L * 0.62 : 0.34));
    if (BIKE) wheels.push({ x: 0, z, r: rad, w: 0.16 });
    else { const x = (HW[zi(z)] || 0.85) * 0.83; wheels.push({ x, z, r: rad, w: 0.26 }, { x: -x, z, r: rad, w: 0.26 }); }
  }
  // carve arches so the procedural wheels show
  if (!BIKE) for (const w of wheels) for (let i = 0; i < NZ; i++) {
    const z = z0 + ((i + 0.5) / NZ) * L, dz = (z - w.z) / (w.r * 1.12);
    if (Math.abs(dz) >= 1) continue;
    const arch = w.r * 2.05 * Math.sqrt(1 - dz * dz);
    for (let k = 0; k < NU; k++) B[i * NU + k] = Math.min(Math.max(B[i * NU + k], arch), T[i * NU + k] - 0.05);
  }
}
// surface category at each top point: nearest reference vertex (spatial hash)
const cell = 0.04;
const hash = new Map<string, V[]>();
for (const v of body) { const kk = `${Math.floor(Math.abs(v.x) / cell)},${Math.floor(v.y / cell)},${Math.floor(v.z / cell)}`; let a = hash.get(kk); if (!a) hash.set(kk, (a = [])); a.push(v); }
const nearest = (x: number, y: number, z: number) => {
  let best = -1, bd = Infinity;
  for (let r = 1; r <= 4 && best < 0; r++) {
    const bx = Math.floor(x / cell), by = Math.floor(y / cell), bz = Math.floor(z / cell);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
      const list = hash.get(`${bx + a},${by + b},${bz + c}`);
      if (!list) continue;
      for (const v of list) { const d = (Math.abs(v.x) - x) ** 2 + (v.y - y) ** 2 + (v.z - z) ** 2; if (d < bd) { bd = d; best = v.c; } }
    }
  }
  return best < 0 ? 0 : best;
};
const C = new Uint8Array(NZ * NU);
for (let i = 0; i < NZ; i++) { const z = z0 + ((i + 0.5) / NZ) * L; for (let k = 0; k < NU; k++) C[i * NU + k] = nearest((k / (NU - 1)) * HW[i], T[i * NU + k], z); }
// clean ragged edges: 3x3 majority filter on the category grid
{ const o = new Uint8Array(C); for (let i = 0; i < NZ; i++) for (let k = 0; k < NU; k++) { const cnt = new Array(CATS.length).fill(0); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ii = i + a, kk = k + b; if (ii < 0 || ii >= NZ || kk < 0 || kk >= NU) continue; cnt[C[ii * NU + kk]] += a === 0 && b === 0 ? 1.5 : 1; } o[i * NU + k] = cnt.indexOf(Math.max(...cnt)); } C.set(o); }
// lamp lenses are usually glass: glass low down at the nose or tail is a light
const HMAXB = Math.max(...T);
for (let i = 0; i < NZ; i++) { const z = z0 + ((i + 0.5) / NZ) * L; const nearEnd = Math.abs(z) > L / 2 - (BIKE ? 0.35 : 0.85); for (let k = 0; k < NU; k++) if (nearEnd && CATS[C[i * NU + k]] === 'glass' && T[i * NU + k] < HMAXB * 0.72) C[i * NU + k] = CATS.indexOf('light'); }
// glass only exists above the beltline (anything lower is mis-named body material); lamps are handled below
{ const Hm = Math.max(...T); for (let i = 0; i < NZ; i++) { const z = z0 + ((i + 0.5) / NZ) * L; const nearEnd = Math.abs(z) > L / 2 - (BIKE ? 0.35 : 0.85); for (let k = 0; k < NU; k++) if (CATS[C[i * NU + k]] === 'glass' && T[i * NU + k] < Hm * (BIKE ? 0.4 : 0.55) && !nearEnd) C[i * NU + k] = CATS.indexOf('paint'); } }
// lamps only exist at the nose and tail; 'light' elsewhere is mis-named body material
for (let i = 0; i < NZ; i++) { const z = z0 + ((i + 0.5) / NZ) * L; if (Math.abs(z) < L / 2 - (BIKE ? 0.3 : 0.42)) for (let k = 0; k < NU; k++) if (CATS[C[i * NU + k]] === 'light') C[i * NU + k] = CATS.indexOf('paint'); }
// material fallbacks for references that are one big material
{
  const frac = (c: Cat) => C.filter((x) => CATS[x] === c).length / C.length;
  // body colour: if hardly anything is 'paint', the dominant non-glass surface is the body
  if (frac('paint') < 0.15) { const cnt = CATS.map((c) => (c === 'glass' || c === 'light' ? 0 : C.filter((x) => CATS[x] === c).length)); const dom = cnt.indexOf(Math.max(...cnt)); for (let i = 0; i < C.length; i++) if (C[i] === dom) C[i] = CATS.indexOf('paint'); }
  // windows: steep surfaces above the beltline (windscreen, side and rear glass)
  if (!BIKE && frac('glass') < 0.03) {
    const H = Math.max(...T), belt = H * 0.6;
    for (let i = 1; i < NZ - 1; i++) for (let k = 0; k < NU; k++) {
      const y = T[i * NU + k]; if (y < belt || y > H * 0.9) continue;
      const dz = Math.abs(T[(i + 1) * NU + k] - T[(i - 1) * NU + k]) / (2 * L / NZ);
      const du = k > 0 && k < NU - 1 ? Math.abs(T[i * NU + k + 1] - T[i * NU + k - 1]) / (2 * (HW[i] || 1) / (NU - 1)) : 0;
      if (dz > 0.6 || du > 1.1) C[i * NU + k] = CATS.indexOf('glass');
    }
  }
  // lamps: outer part of the nose and tail at lamp height
  if (frac('light') < 0.004) {
    const H = Math.max(...T);
    for (const i of [0, 1, 2, NZ - 3, NZ - 2, NZ - 1]) for (let k = Math.floor(NU * 0.55); k < NU - 1; k++) {
      const y = T[i * NU + k]; if (y > H * (BIKE ? 0.45 : 0.4) && y < H * (BIKE ? 0.9 : 0.75)) C[i * NU + k] = CATS.indexOf('light');
    }
  }
}
// side wall category (between top edge and underside at the outer edge), sampled at mid height
const SC = new Uint8Array(NZ);
for (let i = 0; i < NZ; i++) { const z = z0 + ((i + 0.5) / NZ) * L; SC[i] = nearest(HW[i], (T[i * NU + NU - 1] + B[i * NU + NU - 1]) / 2, z); if (CATS[SC[i]] === 'glass' || CATS[SC[i]] === 'dark') SC[i] = CATS.indexOf('paint'); }
// Designed surface layout (cars): instead of copying the reference's messy material map, lay out
// clean regions from the measured shape. Only the cabin's length range is taken from the reference glass.
if (!BIKE) {
  const id_ = (c: Cat) => CATS.indexOf(c);
  const zAt = (i: number) => z0 + ((i + 0.5) / NZ) * L;
  // cabin extent: where reference glass exists along the length (robust percentiles), else a default
  const gz: number[] = [];
  for (let i = 0; i < NZ; i++) for (let k = 0; k < NU; k++) if (CATS[C[i * NU + k]] === 'glass') gz.push(i);
  gz.sort((a, b) => a - b);
  let c0 = gz.length > 20 ? gz[Math.floor(gz.length * 0.03)] : Math.floor(NZ * 0.3);
  let c1 = gz.length > 20 ? gz[Math.floor(gz.length * 0.97)] : Math.floor(NZ * 0.75);
  const Hmax = Math.max(...T);
  for (let i = 0; i < NZ; i++) {
    const z = zAt(i);
    const edgeY = T[i * NU + NU - 1];
    const belt = Math.max(edgeY, Hmax * 0.55) + 0.04; // shoulder line
    const Hst = Math.max(...Array.from({ length: NU }, (_, k) => T[i * NU + k]));
    const slope = i > 0 && i < NZ - 1 ? Math.abs(T[(i + 1) * NU] - T[(i - 1) * NU]) / (2 * L / NZ) : 0;
    const inCabin = i >= c0 && i <= c1;
    for (let k = 0; k < NU; k++) {
      const y = T[i * NU + k], u = k / (NU - 1);
      let c = id_('paint');
      if (inCabin && y > belt) {
        const roof = y > Hst - 0.045 && u < 0.72 && slope < 0.3;
        c = roof ? id_('paint') : id_('glass');
      }
      C[i * NU + k] = c;
    }
    SC[i] = id_('paint');
  }
  // lamps: clean shapes on the upper outer corners of the nose and tail faces
  const nEnd = Math.max(3, Math.round((0.22 / L) * NZ));
  for (const front of [true, false]) {
    for (let q = 0; q < nEnd; q++) {
      const i = front ? NZ - 1 - q : q;
      const hNose = T[i * NU + Math.floor(NU * 0.7)];
      for (let k = Math.floor(NU * 0.52); k < NU - 1; k++) {
        const y = T[i * NU + k];
        if (y > hNose * 0.62 && y < hNose * 1.02 + 0.02) C[i * NU + k] = id_('light');
      }
      // grille / lower intake and bumper lip in dark trim
      for (let k = 0; k < NU; k++) { const y = T[i * NU + k]; if ((front && k < NU * 0.45 && y < hNose * 0.6 && y > 0.12) || y < 0.2) C[i * NU + k] = id_('dark'); }
    }
  }
  // sill / lower body edge in dark trim along the whole length
  for (let i = 0; i < NZ; i++) for (let k = 0; k < NU; k++) if (T[i * NU + k] < 0.18) C[i * NU + k] = CATS.indexOf('dark');
  void c0; void c1;
}
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const out = {
  id, length: L, bike: BIKE, nz: NZ, nu: NU,
  width: r3(Math.max(...HW) * 2), height: r3(Math.max(...T)),
  hw: Array.from(HW, r3), t: Array.from(T, r3), b: Array.from(B, r3), cat: Array.from(C), side: Array.from(SC), cats: CATS,
  wheels: wheels.map((w) => ({ x: r3(w.x), z: r3(w.z), r: r3(w.r), w: r3(w.w) })),
};
fs.mkdirSync('src/data/shapes', { recursive: true });
fs.writeFileSync(`src/data/shapes/${id}.json`, JSON.stringify(out));
const count = (c: Cat) => out.cat.filter((x) => CATS[x] === c).length;
console.log(id, 'size', out.length, 'x', out.width, 'x', out.height, '| wheels', out.wheels.length, JSON.stringify(out.wheels), '| paint', count('paint'), 'glass', count('glass'), 'light', count('light'), 'dark', count('dark'), 'chrome', count('chrome'));
