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
export function barnGeo() {
  const roof = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
  return merge([
    part(box(12, 7, 20), 0x9b2a20, 0, 3.5, 0),
    part(roof, 0x3d3a38, 0, 8.4, 0, Math.PI / 2, 0, Math.PI, 7.3, 21, 3.6),
    part(box(4, 5, 0.3), 0xe8e2d6, 0, 2.5, 10.05),
    part(box(3.4, 4.4, 0.35), 0x7a2019, 0, 2.4, 10.1),
    part(cyl(2.6, 2.6, 16, 12), 0xb8b6ae, 9.5, 8, -4),
    part(new THREE.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x8e8c86, 9.5, 16, -4),
  ]);
}
export function houseGeo() {
  const roof = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
  return merge([
    part(box(9, 5, 8), 0xe6dccb, 0, 2.5, 0),
    part(roof, 0x4b3b33, 0, 6.2, 0, Math.PI / 2, 0, Math.PI, 5.6, 9.4, 2.6),
    part(box(1.2, 2.2, 0.2), 0x5a3a28, 0, 1.1, 4.05),
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
  return merge([
    part(cyl(0.2, 0.32, 3.6, 5), 0x4f3a28, 0, 1.8, 0),
    part(new THREE.IcosahedronGeometry(2.6, 0), 0x3f6b2a, 0, 5.2, 0),
    part(new THREE.IcosahedronGeometry(1.9, 0), 0x4a7a30, 1.2, 6.3, 0.6),
    part(new THREE.IcosahedronGeometry(1.8, 0), 0x3b6327, -1.1, 6, -0.7),
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
