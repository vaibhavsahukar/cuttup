import * as THREE from 'three';

/** Shared materials for vehicle models (one instance each; paint is per colour). */
const paintCache = new Map<number, THREE.MeshStandardMaterial>();
export function paint(color: number) {
  let m = paintCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.28, envMapIntensity: 1.2 });
    paintCache.set(color, m);
  }
  return m;
}

export const MAT = {
  glass: new THREE.MeshStandardMaterial({ color: 0x0d1418, metalness: 0.4, roughness: 0.05, transparent: true, opacity: 0.88, envMapIntensity: 1.6 }),
  clearGlass: new THREE.MeshStandardMaterial({ color: 0x9fb4c0, metalness: 0.2, roughness: 0.02, transparent: true, opacity: 0.35 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x121314, metalness: 0.1, roughness: 0.75 }),
  carbon: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.4, roughness: 0.35 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd9dde0, metalness: 1, roughness: 0.15 }),
  rim: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.3 }),
  darkRim: new THREE.MeshStandardMaterial({ color: 0x2a2c2f, metalness: 0.8, roughness: 0.35 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0, roughness: 0.92 }),
  engine: new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.8, roughness: 0.4 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 1.2 }),
  tailOff: new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff1010, emissiveIntensity: 0.35, roughness: 0.3 }),
  tailOn: new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 3.2 }),
  sigOff: new THREE.MeshStandardMaterial({ color: 0x6a4205, emissive: 0xff9a00, emissiveIntensity: 0.1 }),
  sigOn: new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xffa000, emissiveIntensity: 3.5 }),
  suit: new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.7 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.8 }),
  seat: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xf2f2ea, roughness: 0.6 }),
};
