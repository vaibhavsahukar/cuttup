import * as THREE from 'three';
import { makeWheel, type VehicleModel } from './ModelKit';
import { MAT } from './Materials';

/**
 * Builds a vehicle from a measured shape (src/data/shapes/<id>.json, produced by
 * scripts/extract-shape.ts from a reference model). The body is lofted through cross-sections
 * along the length; each surface point carries its kind (paint, glass, light, trim, chrome),
 * which decides its material. Wheels are the game's own procedural wheels at measured positions.
 */
export interface Shape {
  id: string; length: number; bike: boolean; nz: number; nu: number; width: number; height: number;
  hw: number[]; t: number[]; b: number[]; cat: number[]; side: number[]; cats: string[];
  wheels: { x: number; z: number; r: number; w: number }[];
}

const shapes = import.meta.glob('../data/shapes/*.json', { eager: true, import: 'default' }) as Record<string, Shape>;
export function getShape(id: string): Shape | undefined {
  return shapes[`../data/shapes/${id}.json`];
}

type Kind = 'paint' | 'glass' | 'head' | 'tail' | 'dark' | 'chrome';

/** body materials: colour comes from vertex colours (paint / glass / trim), so one material serves every car */
let bodyFull: THREE.MeshPhysicalMaterial | undefined, bodyLite: THREE.MeshStandardMaterial | undefined;
function bodyMaterial(lite: boolean) {
  if (lite) return (bodyLite ??= new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.38, envMapIntensity: 0.9 }));
  return (bodyFull ??= new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 0.9 }));
}

export function buildFromShape(sh: Shape, color: number, lite: boolean, shadows = true): VehicleModel {
  const { nz, nu, length: L } = sh;
  const z0 = -L / 2;
  // ring: top surface from the right edge (-x) across to the left edge (+x), then underside back
  const topIdx: [number, number][] = [];
  for (let k = nu - 1; k >= 0; k--) topIdx.push([k, -1]);
  for (let k = 1; k < nu; k++) topIdx.push([k, 1]);
  const ringN = topIdx.length * 2;
  const pos: number[] = [];
  const kinds: Kind[] = [];
  const kindOf = (c: number, z: number): Kind => {
    const k = sh.cats[c];
    if (k === 'light') return z > 0 ? 'head' : 'tail';
    if (k === 'wheel') return 'dark';
    return k as Kind;
  };
  for (let i = 0; i < nz; i++) {
    const z = z0 + ((i + 0.5) / nz) * L;
    const hw = sh.hw[i];
    for (const [k, sx] of topIdx) { pos.push(sx * (k / (nu - 1)) * hw, sh.t[i * nu + k], z); kinds.push(kindOf(k === nu - 1 ? sh.side[i] : sh.cat[i * nu + k], z)); }
    for (let q = topIdx.length - 1; q >= 0; q--) { const [k, sx] = topIdx[q]; pos.push(sx * (k / (nu - 1)) * hw * 0.97, sh.b[i * nu + k], z); kinds.push(k === nu - 1 ? kindOf(sh.side[i], z) : 'dark'); }
  }
  const idx: number[] = [];
  for (let i = 0; i < nz - 1; i++) for (let k = 0; k < ringN; k++) {
    const a = i * ringN + k, bb = i * ringN + ((k + 1) % ringN), c = a + ringN, d = bb + ringN;
    idx.push(a, c, bb, bb, c, d);
  }
  const capC = (i: number) => { const base = pos.length / 3; let x = 0, y = 0, z = 0; for (let k = 0; k < ringN; k++) { x += pos[(i * ringN + k) * 3]; y += pos[(i * ringN + k) * 3 + 1]; z += pos[(i * ringN + k) * 3 + 2]; } pos.push(x / ringN, y / ringN, z / ringN); kinds.push(kinds[i * ringN + nu - 1]); return base; };
  const c0 = capC(0), c1 = capC(nz - 1);
  for (let k = 0; k < ringN; k++) {
    idx.push(c0, k, (k + 1) % ringN);
    const o = (nz - 1) * ringN;
    idx.push(c1, o + ((k + 1) % ringN), o + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // body: one smooth mesh, surface kinds as vertex colours (soft borders between paint and glass);
  // lamps are separate meshes so brake lights / headlights can glow
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  let lean: THREE.Group | undefined;
  if (sh.bike) { lean = new THREE.Group(); root.add(lean); lean.add(chassis); } else root.add(chassis);
  const paintC = new THREE.Color(color);
  const kindColor: Record<Kind, THREE.Color> = {
    paint: paintC, glass: new THREE.Color(0x0b0f13), head: new THREE.Color(0xdfe6ea), tail: new THREE.Color(0x5a0808),
    dark: new THREE.Color(0x141517), chrome: new THREE.Color(0xb8bec4),
  };
  const colors = new Float32Array((pos.length / 3) * 3);
  for (let v = 0; v < pos.length / 3; v++) { const c = kindColor[kinds[v]]; colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const body = new THREE.Mesh(g, bodyMaterial(lite));
  body.name = 'paint';
  body.castShadow = shadows;
  chassis.add(body);
  // lamp overlays: triangles whose corners are all lamp surface, nudged outward slightly
  const P = g.attributes.position as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute;
  const brake: THREE.Mesh[] = [], heads: THREE.Mesh[] = [];
  for (const kind of ['head', 'tail'] as const) {
    const p: number[] = [], n: number[] = [];
    for (let f = 0; f < idx.length; f += 3) {
      const vs = [idx[f], idx[f + 1], idx[f + 2]];
      if (!vs.every((v) => kinds[v] === kind)) continue;
      for (const v of vs) { p.push(P.getX(v) + N.getX(v) * 0.004, P.getY(v) + N.getY(v) * 0.004, P.getZ(v) + N.getZ(v) * 0.004); n.push(N.getX(v), N.getY(v), N.getZ(v)); }
    }
    if (!p.length) continue;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    lg.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    const m = new THREE.Mesh(lg, kind === 'head' ? MAT.head : MAT.tailOff);
    m.name = kind;
    chassis.add(m);
    (kind === 'head' ? heads : brake).push(m);
  }
  // indicators: small amber lamps at the corners
  const sigL: THREE.Mesh[] = [], sigR: THREE.Mesh[] = [];
  const sg = new THREE.BoxGeometry(sh.bike ? 0.05 : 0.08, 0.04, 0.03);
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const i = sz > 0 ? nz - 3 : 2;
    const y = (sh.t[i * nu + nu - 1] + sh.b[i * nu + nu - 1]) / 2 + 0.05;
    const w = sh.hw[i] * 0.8;
    const s = new THREE.Mesh(sg, MAT.sigOff);
    s.position.set(sx * Math.max(0.08, w), y, sz * (L / 2 - 0.05));
    chassis.add(s);
    (sx > 0 ? sigL : sigR).push(s);
  }
  // wheels
  const wheels = sh.wheels.map((w) => {
    const ref = makeWheel(sh.bike ? chassis : root, w.x, w.r, w.z, w.r, Math.max(0.12, w.w), w.z > 0, 0x9aa0a6, sh.bike ? 3 : 5, sh.bike, lite);
    if (sh.bike) ref.left = true;
    return ref;
  });
  if (sh.bike) wheels.sort((a, b) => (b.front ? 1 : 0) - (a.front ? 1 : 0)); // [front, rear]
  return {
    root, chassis, body, wheels, brake, sigL, sigR, heads,
    length: L, width: sh.width, height: sh.height, color,
    bike: sh.bike ? { lean: lean!, fork: new THREE.Group() } : undefined,
    lod: [],
  };
}
