import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAT, paint } from './Materials';

export type Bucket = 'paint' | 'glass' | 'clearGlass' | 'misc' | 'head' | 'tail' | 'sigL' | 'sigR' | 'chrome' | 'suit' | 'skin' | 'seat' | 'engine' | 'plate';

export interface WheelRef { obj: THREE.Object3D; spin: THREE.Object3D; front: boolean; left: boolean; radius: number }

export interface Rider {
  root: THREE.Group; torso: THREE.Object3D; head: THREE.Object3D;
  armL: THREE.Object3D; armR: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D;
}

export interface VehicleModel {
  root: THREE.Group; // origin on the ground at the vehicle centre, facing +z
  chassis: THREE.Group; // roll / pitch pivot
  body: THREE.Mesh; // paint mesh (deformable on crash)
  wheels: WheelRef[];
  brake: THREE.Mesh[];
  sigL: THREE.Mesh[];
  sigR: THREE.Mesh[];
  heads: THREE.Mesh[];
  length: number; width: number; height: number;
  color: number;
  bike?: { lean: THREE.Group; rider?: Rider; fork: THREE.Object3D };
  /** detail meshes hidden at distance (traffic LOD) */
  lod?: THREE.Object3D[];
  wheelMesh?: THREE.Mesh;
}

const miscMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.55 });
const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.28 });

/** Collects primitive parts into material buckets and merges them into few draw calls. */
export class Kit {
  parts = new Map<Bucket, THREE.BufferGeometry[]>();
  constructor(public color: number) {}

  add(bucket: Bucket, geo: THREE.BufferGeometry, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], scl: [number, number, number] = [1, 1, 1], vcolor = 0x222222) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scl));
    g.applyMatrix4(m);
    const c = new THREE.Color(vcolor);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.parts.has(bucket)) this.parts.set(bucket, []);
    this.parts.get(bucket)!.push(g);
    return this;
  }
  box(bucket: Bucket, x: number, y: number, z: number, w: number, h: number, d: number, rot: [number, number, number] = [0, 0, 0], vc?: number) {
    return this.add(bucket, new THREE.BoxGeometry(w, h, d), [x, y, z], rot, [1, 1, 1], vc);
  }
  cyl(bucket: Bucket, x: number, y: number, z: number, r: number, len: number, rot: [number, number, number] = [0, 0, Math.PI / 2], vc?: number, seg = 12, r2 = r) {
    return this.add(bucket, new THREE.CylinderGeometry(r, r2, len, seg), [x, y, z], rot, [1, 1, 1], vc);
  }
  sphere(bucket: Bucket, x: number, y: number, z: number, sx: number, sy: number, sz: number, vc?: number, rot: [number, number, number] = [0, 0, 0]) {
    return this.add(bucket, new THREE.SphereGeometry(1, 14, 10), [x, y, z], rot, [sx, sy, sz], vc);
  }
  /** mirrored pair across x */
  pair(fn: (sx: number) => void) { fn(1); fn(-1); }

  material(b: Bucket): THREE.Material {
    switch (b) {
      case 'paint': return paint(this.color);
      case 'glass': return MAT.glass;
      case 'clearGlass': return MAT.clearGlass;
      case 'head': return MAT.head;
      case 'tail': return MAT.tailOff;
      case 'sigL': case 'sigR': return MAT.sigOff;
      case 'chrome': return MAT.chrome;
      case 'suit': return MAT.suit;
      case 'skin': return MAT.skin;
      case 'seat': return MAT.seat;
      case 'engine': return MAT.engine;
      case 'plate': return MAT.plate;
      default: return miscMat;
    }
  }

  build(parent: THREE.Object3D, shadows = true) {
    const out = new Map<Bucket, THREE.Mesh>();
    for (const [b, list] of this.parts) {
      const g = mergeGeometries(list, false)!;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.material(b));
      mesh.castShadow = shadows && b !== 'glass' && b !== 'clearGlass';
      mesh.name = b;
      parent.add(mesh);
      out.set(b, mesh);
    }
    return out;
  }
}

/** Wheel geometry with two groups: 0 = rubber, 1 = metal. Spin child rotates around x. */
const wheelCache = new Map<string, THREE.BufferGeometry>();
const rubberMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.88 });
function tyreGeo(r: number, w: number, bead: number) {
  // lathe profile (x = radius, y = along axle) with rounded shoulders
  const pts: THREE.Vector2[] = [];
  const sh = Math.min(0.045, w * 0.2);
  pts.push(new THREE.Vector2(bead, -w / 2 + 0.01));
  pts.push(new THREE.Vector2(r - sh * 1.4, -w / 2));
  for (let i = 0; i <= 5; i++) { const t = (i / 5) * Math.PI / 2; pts.push(new THREE.Vector2(r - sh + sh * Math.sin(t), -w / 2 + sh - sh * Math.cos(t))); }
  for (let i = 0; i <= 5; i++) { const t = (i / 5) * Math.PI / 2; pts.push(new THREE.Vector2(r - sh + sh * Math.cos(t), w / 2 - sh + sh * Math.sin(t))); }
  pts.push(new THREE.Vector2(r - sh * 1.4, w / 2));
  pts.push(new THREE.Vector2(bead, w / 2 - 0.01));
  const g = new THREE.LatheGeometry(pts, 40);
  g.rotateZ(Math.PI / 2); // axle along x
  return g;
}
export function wheelGeo(r: number, w: number, rimColor = 0x9aa0a6, spokes = 5, bike = false) {
  const key = `${r.toFixed(3)}_${w.toFixed(3)}_${rimColor}_${spokes}_${bike}`;
  const hit = wheelCache.get(key);
  if (hit) return hit;
  const rub = new Kit(0), met = new Kit(0);
  const rot: [number, number, number] = [0, 0, Math.PI / 2];
  const rr = bike ? r - w * 0.9 : r * 0.7;
  if (bike) {
    rub.add('misc', new THREE.TorusGeometry(r - w * 0.35, w * 0.5, 10, 32), [0, 0, 0], [0, Math.PI / 2, 0], [1, 1, 1], 0x141414);
    met.cyl('misc', 0, 0, 0, rr, 0.05, rot, rimColor, 24);
    met.cyl('misc', 0, 0, 0, rr * 0.55, 0.012, rot, 0x6a6d70, 24); // brake disc
  } else {
    rub.add('misc', tyreGeo(r, w, rr * 0.98), [0, 0, 0], [0, 0, 0], [1, 1, 1], 0x151515);
    // rim barrel, recessed face, brake disc + caliper behind the spokes
    met.add('misc', new THREE.CylinderGeometry(rr, rr, w * 0.92, 28, 1, true), [0, 0, 0], rot, [1, 1, 1], 0x3a3c3f);
    met.cyl('misc', -w * 0.3, 0, 0, rr * 0.9, 0.02, rot, 0x1a1b1d, 28); // dark inner back plate
    met.cyl('misc', -w * 0.05, 0, 0, rr * 0.78, 0.028, rot, 0x7c8084, 32); // brake disc
    met.box('misc', w * 0.1, rr * 0.55, -rr * 0.25, 0.07, rr * 0.35, rr * 0.45, [0.4, 0, 0], 0xb3121b);
    met.add('misc', new THREE.TorusGeometry(rr * 0.96, 0.018, 6, 40), [w * 0.31, 0, 0], [0, Math.PI / 2, 0], [1, 1, 1], rimColor); // outer lip ring
  }
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    if (bike) met.box('misc', 0, Math.sin(a) * rr * 0.5, Math.cos(a) * rr * 0.5, 0.03, rr * 0.95, 0.035, [a, 0, 0], rimColor);
    else {
      // tapered twin-spoke look: two thin blades per spoke, dished toward the hub
      for (const off of [-0.09, 0.09]) met.box('misc', w * 0.28, Math.sin(a + off) * rr * 0.52, Math.cos(a + off) * rr * 0.52, 0.04, rr * 0.9, 0.035, [a + off, 0, 0], rimColor);
    }
  }
  met.cyl('misc', bike ? 0 : w * 0.3, 0, 0, rr * 0.22, 0.06, rot, rimColor, 16);
  if (!bike) for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; met.cyl('misc', w * 0.34, Math.sin(a) * rr * 0.12, Math.cos(a) * rr * 0.12, 0.012, 0.03, rot, 0xd0d0d0, 6); }
  const g1 = mergeGeometries(rub.parts.get('misc')!, false)!;
  const g2 = mergeGeometries(met.parts.get('misc')!, false)!;
  for (const g of [g1, g2]) { if (g.attributes.uv) g.deleteAttribute('uv'); }
  const g = mergeGeometries([g1, g2], true)!;
  wheelCache.set(key, g);
  return g;
}

export function makeWheel(parent: THREE.Object3D, x: number, y: number, z: number, r: number, w: number, front: boolean, rimColor: number, spokes: number, bike = false): WheelRef {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const spin = new THREE.Mesh(wheelGeo(r, w, rimColor, spokes, bike), [rubberMat, wheelMat]);
  spin.castShadow = true;
  if (!bike && x < 0) spin.rotation.y = Math.PI; // rim face outward on the right side
  const spinHolder = new THREE.Group();
  spinHolder.add(spin);
  pivot.add(spinHolder);
  parent.add(pivot);
  return { obj: pivot, spin: spinHolder, front, left: x > 0, radius: r };
}
