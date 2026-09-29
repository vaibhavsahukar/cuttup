import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Give a geometry a flat vertex colour and a transform; returns non-indexed-safe geometry. */
export function part(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  g.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
export const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts, false)!;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);

export function streetLightGeo() {
  // double-arm median light, 11 m tall; arms along local X (lateral)
  return merge([
    part(cyl(0.12, 0.18, 11), 0x55585c, 0, 5.5, 0),
    part(box(6, 0.15, 0.15), 0x55585c, 0, 11, 0),
    part(box(0.9, 0.2, 0.45), 0x303235, 2.9, 10.85, 0),
    part(box(0.9, 0.2, 0.45), 0x303235, -2.9, 10.85, 0),
  ]);
}
export function lampHeadGeo() {
  return merge([part(box(0.8, 0.06, 0.38), 0xffffff, 2.9, 10.72, 0), part(box(0.8, 0.06, 0.38), 0xffffff, -2.9, 10.72, 0)]);
}
export function overpassGeo(span: number) {
  // deck spans local X, road runs along local Z
  const parts = [
    part(box(span, 1.4, 11), 0x8d8c88, 0, 7.6, 0),
    part(box(span, 1.1, 0.3), 0x9d9c98, 0, 8.85, 5.4),
    part(box(span, 1.1, 0.3), 0x9d9c98, 0, 8.85, -5.4),
    part(box(span, 0.25, 11.6), 0x6b6a67, 0, 6.8, 0),
  ];
  for (const x of [0, span / 2 - 1.2, -span / 2 + 1.2]) {
    parts.push(part(box(1.4, 7, 1.4), 0x85847f, x, 3.5, -3));
    parts.push(part(box(1.4, 7, 1.4), 0x85847f, x, 3.5, 3));
    parts.push(part(box(1.8, 0.8, 9), 0x85847f, x, 6.6, 0));
  }
  return merge(parts);
}
/** prism (gable roof): ridge along local Z, width w across X, rise h, length l */
const prism = (w: number, h: number, l: number) => {
  const sh = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(sh, { depth: l, bevelEnabled: false }).translate(0, 0, -l / 2);
};
export function barnGeo() {
  // red barn: gambrel roof, white trim and door braces, hay loft door, cupola, two silos
  const red = 0x9b2a20, trim = 0xf0ebe0, roof = 0x4a4a4c;
  const parts = [
    part(box(12, 6, 20), red, 0, 3, 0),
    // gambrel roof: steep lower slopes, shallow upper slopes
    part(box(0.5, 4.2, 20.6), roof, 5.2, 8, 0, 0, 0, -0.42),
    part(box(0.5, 4.2, 20.6), roof, -5.2, 8, 0, 0, 0, 0.42),
    part(box(0.5, 3.4, 20.6), roof, 2.2, 10.3, 0, 0, 0, -1.0),
    part(box(0.5, 3.4, 20.6), roof, -2.2, 10.3, 0, 0, 0, 1.0),
    part(prism(11.6, 4.4, 0.4), red, 0, 6, 10.05),
    part(prism(11.6, 4.4, 0.4), red, 0, 6, -10.05),
    // front: big double door with white X braces, loft door, trim
    part(box(4.6, 4.6, 0.3), trim, 0, 2.3, 10.2),
    part(box(4.2, 4.2, 0.35), 0x7a2019, 0, 2.2, 10.22),
    part(box(0.25, 5.6, 0.2), trim, 0, 2.2, 10.42, 0, 0, 0.72),
    part(box(0.25, 5.6, 0.2), trim, 0, 2.2, 10.42, 0, 0, -0.72),
    part(box(2.2, 2, 0.3), trim, 0, 7.4, 10.2),
    part(box(1.9, 1.7, 0.35), 0x2a1a16, 0, 7.4, 10.22),
    // corner trim and side windows
    part(box(0.3, 6.1, 0.3), trim, 6, 3, 10), part(box(0.3, 6.1, 0.3), trim, -6, 3, 10),
    part(box(0.3, 6.1, 0.3), trim, 6, 3, -10), part(box(0.3, 6.1, 0.3), trim, -6, 3, -10),
    part(box(20.4, 0.3, 0.3), trim, 6.02, 0.15, 0, 0, Math.PI / 2, 0),
    // cupola on the ridge
    part(box(1.6, 1.4, 1.6), trim, 0, 12.6, 0),
    part(prism(2.2, 0.9, 2.2), 0x3a3a3c, 0, 13.3, 0),
  ];
  for (const z of [-6, -1.5, 3]) parts.push(part(box(0.2, 1.4, 1.1), 0x2a2f36, 6.02, 3.4, z), part(box(0.2, 1.4, 1.1), 0x2a2f36, -6.02, 3.4, z));
  // silos
  for (const [x, z] of [[9.2, -5], [9.2, -0.4]] as const) {
    parts.push(part(cyl(2.2, 2.2, 15, 12), 0xc9c8c0, x, 7.5, z), part(new THREE.SphereGeometry(2.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x8e8c86, x, 15, z));
    for (const y of [3, 6, 9, 12]) parts.push(part(cyl(2.25, 2.25, 0.18, 12), 0x8e8c86, x, y, z));
  }
  return merge(parts);
}
export function houseGeo() {
  // farmhouse: two-storey body, gable roof, chimney, porch with posts, shuttered windows
  const wall = 0xeee6d4, roof = 0x5b3f34, trim = 0xfaf6ee, shutter = 0x3e6a4a, glass = 0x2a3440;
  const parts = [
    part(box(9, 5.6, 8), wall, 0, 2.8, 0),
    part(box(4.5, 3.6, 10), wall, -6, 1.8, 0.4),
    part(prism(10.2, 3.6, 8.6), roof, 0, 5.6, 0, 0, 0, 0),
    part(prism(5.6, 2.2, 10.6), roof, -6, 3.6, 0.4),
    part(box(0.9, 2.8, 0.9), 0x8a4a3a, 2.6, 8.4, -1),
    part(box(1.1, 0.2, 1.1), 0x6a3a2c, 2.6, 9.9, -1),
    // porch
    part(box(9, 0.3, 2.4), 0x8a8578, 0, 0.2, 5.2),
    part(box(9.4, 0.25, 2.8), roof, 0, 3.2, 5.2),
    part(box(1.3, 2.2, 0.25), 0x5a3a28, 0, 1.3, 4.05),
  ];
  for (const x of [-4.2, -1.4, 1.4, 4.2]) parts.push(part(box(0.22, 3, 0.22), trim, x, 1.7, 6.4));
  for (const x of [-3, 3]) for (const y of [1.9, 4.4]) {
    parts.push(part(box(1.3, 1.3, 0.12), trim, x, y, 4.02), part(box(1.0, 1.0, 0.16), glass, x, y, 4.04));
    parts.push(part(box(0.35, 1.3, 0.14), shutter, x - 0.95, y, 4.06), part(box(0.35, 1.3, 0.14), shutter, x + 0.95, y, 4.06));
  }
  return merge(parts);
}
export function windmillGeo() {
  // farm wind pump: lattice tower, multi-blade wheel, tail vane, water tank
  const steel = 0x8d9295, parts: THREE.BufferGeometry[] = [];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) parts.push(part(box(0.1, 13.4, 0.1), steel, sx * 0.9, 6.5, sz * 0.9, sz * -0.06, 0, sx * 0.06));
  for (const y of [2, 5, 8, 11]) {
    const k = 1 - y / 26;
    parts.push(part(box(2 * k * 1.9, 0.07, 0.07), steel, 0, y, 0.9 * k * 1.9 / 1.9 * 1), part(box(2 * k * 1.9, 0.07, 0.07), steel, 0, y, -0.9 * k));
  }
  parts.push(part(box(0.5, 0.5, 1.4), 0x55595c, 0, 13.6, 0));
  parts.push(part(cyl(2.6, 2.6, 0.1, 16), 0xb8bcc0, 0, 13.6, 1.2, Math.PI / 2, 0, 0));
  for (let i = 0; i < 12; i++) parts.push(part(box(0.5, 2.5, 0.05), 0xc9cdd0, 0, 13.6, 1.3, 0, 0, (i / 12) * Math.PI * 2));
  parts.push(part(box(0.1, 1.2, 3), 0x9b2a20, 0, 13.9, -2.2));
  parts.push(part(cyl(1.7, 1.7, 2.2, 14), 0x7a7d80, 4, 1.1, 0), part(cyl(1.75, 1.75, 0.2, 14), 0x55595c, 4, 2.3, 0));
  return merge(parts);
}
export function fenceGeo() {
  // 16 m of post-and-rail fence along local Z (origin at the start)
  const wood = 0x8a7256, rail = 0xa38c69, parts: THREE.BufferGeometry[] = [];
  for (let z = 0; z <= 16.01; z += 2.667) parts.push(part(box(0.16, 1.25, 0.16), wood, 0, 0.62, z));
  for (const y of [0.45, 0.85, 1.15]) parts.push(part(box(0.06, 0.12, 16), rail, 0.1, y, 8));
  return merge(parts);
}
export function delineatorGeo() {
  return merge([part(box(0.12, 1.1, 0.12), 0xf0f0ec, 0, 0.55, 0), part(box(0.13, 0.22, 0.13), 0xd12b25, 0, 0.9, 0.01)]);
}
export function bushGeo() {
  return merge([
    part(new THREE.IcosahedronGeometry(0.8, 0), 0x3d6a2c, 0, 0.55, 0, 0, 0.3, 0, 1.2, 0.85, 1),
    part(new THREE.IcosahedronGeometry(0.6, 0), 0x487a32, 0.7, 0.4, 0.2),
    part(new THREE.IcosahedronGeometry(0.55, 0), 0x35602a, -0.65, 0.4, -0.15),
  ]);
}
export function powerPoleGeo() {
  return merge([
    part(cyl(0.14, 0.2, 12, 6), 0x5a4632, 0, 6, 0),
    part(box(3.2, 0.18, 0.18), 0x5a4632, 0, 11.4, 0),
    part(cyl(0.07, 0.07, 0.3, 5), 0xcfd6d8, -1.4, 11.6, 0),
    part(cyl(0.07, 0.07, 0.3, 5), 0xcfd6d8, 0, 11.6, 0),
    part(cyl(0.07, 0.07, 0.3, 5), 0xcfd6d8, 1.4, 11.6, 0),
  ]);
}
export function coniferGeo() {
  return merge([
    part(cyl(0.18, 0.28, 3, 5), 0x4a3526, 0, 1.5, 0),
    part(new THREE.ConeGeometry(2.4, 5, 7), 0x1f3d22, 0, 4.8, 0),
    part(new THREE.ConeGeometry(1.9, 4.2, 7), 0x244727, 0, 7.4, 0),
    part(new THREE.ConeGeometry(1.3, 3.4, 7), 0x2a522c, 0, 9.8, 0),
  ]);
}
export function broadleafGeo() {
  // fuller canopy: forked trunk and layered faceted crowns, darker underneath, lighter on top
  return merge([
    part(cyl(0.2, 0.36, 3.4, 6), 0x4f3a28, 0, 1.7, 0),
    part(cyl(0.12, 0.2, 2.2, 5), 0x4f3a28, 0.6, 3.9, 0.1, 0, 0, -0.5),
    part(cyl(0.12, 0.2, 2.0, 5), 0x4f3a28, -0.6, 3.8, -0.1, 0, 0, 0.55),
    part(new THREE.IcosahedronGeometry(2.7, 1), 0x2f5a25, 0, 5.4, 0, 0, 0, 0, 1, 0.8, 1),
    part(new THREE.IcosahedronGeometry(2.0, 1), 0x3f6b2a, 1.9, 6.2, 0.7),
    part(new THREE.IcosahedronGeometry(1.9, 1), 0x396429, -1.9, 6.0, -0.8),
    part(new THREE.IcosahedronGeometry(1.8, 1), 0x4c7c33, 0.2, 7.5, 0.1),
    part(new THREE.IcosahedronGeometry(1.3, 0), 0x558a3a, -0.4, 8.5, 0.5),
  ]);
}
export function rockGeo() {
  return merge([part(new THREE.DodecahedronGeometry(1, 0), 0x77756f, 0, 0.3, 0, 0.3, 0.2, 0.1, 1.4, 0.8, 1.1)]);
}
export function hayBaleGeo() {
  return merge([part(cyl(0.8, 0.8, 1.3, 10), 0xc9aa5a, 0, 0.8, 0, 0, 0, Math.PI / 2)]);
}
export function signGeo() {
  return merge([
    part(cyl(0.08, 0.08, 6, 5), 0x6d7074, -3, 3, 0),
    part(cyl(0.08, 0.08, 6, 5), 0x6d7074, 3, 3, 0),
    part(box(7.5, 2.6, 0.12), 0x1d6b3a, 0, 6.4, 0),
    part(box(7.1, 0.12, 0.13), 0xf0f0f0, 0, 5.4, 0.01),
  ]);
}
