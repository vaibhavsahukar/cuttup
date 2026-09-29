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
  bike?: { lean: THREE.Group; rider: Rider; fork: THREE.Object3D };
  /** detail meshes hidden at distance (traffic LOD) */
  lod?: THREE.Object3D[];
  wheelMesh?: THREE.Mesh;
}

const miscMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.55 });
const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.5 });

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

/** Wheel: tyre + rim + spokes merged into one vertex-coloured mesh; spin child rotates around x. */
const wheelCache = new Map<string, THREE.BufferGeometry>();
export function wheelGeo(r: number, w: number, rimColor = 0x9aa0a6, spokes = 5, bike = false) {
  const key = `${r.toFixed(3)}_${w.toFixed(3)}_${rimColor}_${spokes}_${bike}`;
  const hit = wheelCache.get(key);
  if (hit) return hit;
  const k = new Kit(0);
  const rot: [number, number, number] = [0, 0, Math.PI / 2];
  if (bike) k.add('misc', new THREE.TorusGeometry(r - w * 0.35, w * 0.5, 8, 24), [0, 0, 0], [0, Math.PI / 2, 0], [1, 1, 1], 0x141414);
  else k.cyl('misc', 0, 0, 0, r, w, rot, 0x141414, 22);
  const rr = bike ? r - w * 0.9 : r * 0.68;
  k.cyl('misc', 0, 0, 0, rr, w * 0.6 + (bike ? 0 : 0.02), rot, bike ? rimColor : 0x2b2b2b, 18);
  if (!bike) k.cyl('misc', (w * 0.31 + 0.012), 0, 0, rr * 0.96, 0.02, rot, rimColor, 18);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    k.box('misc', bike ? 0 : w * 0.32 + 0.02, Math.sin(a) * rr * 0.5, Math.cos(a) * rr * 0.5, bike ? 0.03 : 0.03, rr * 0.95, bike ? 0.035 : 0.07, [a, 0, 0], rimColor);
  }
  k.cyl('misc', bike ? 0 : w * 0.33 + 0.03, 0, 0, rr * 0.2, 0.05, rot, rimColor, 10);
  const g = mergeGeometries(k.parts.get('misc')!, false)!;
  wheelCache.set(key, g);
  return g;
}

export function makeWheel(parent: THREE.Object3D, x: number, y: number, z: number, r: number, w: number, front: boolean, rimColor: number, spokes: number, bike = false): WheelRef {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const spin = new THREE.Mesh(wheelGeo(r, w, rimColor, spokes, bike), wheelMat);
  spin.castShadow = true;
  if (!bike && x < 0) spin.rotation.y = Math.PI; // rim face outward on the right side
  const spinHolder = new THREE.Group();
  spinHolder.add(spin);
  pivot.add(spinHolder);
  parent.add(pivot);
  return { obj: pivot, spin: spinHolder, front, left: x > 0, radius: r };
}
