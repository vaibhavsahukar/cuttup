import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Imported vehicle models (processed by scripts/process-models.ts into /models/<id>.glb).
 * Each entry gives the real-world length (m) the model is scaled to, and orientation fixes.
 * Models are normalised so that: +z = forward, y = up, origin on the ground at the centre.
 */
export interface GlbEntry {
  /** extra material recolours by name (untextured parts that export white) */
  recolor?: [RegExp, number][];
  doubleSide?: boolean;
  length: number; flip?: boolean; turn?: number; tiltX?: number;
  /** repaint: materials whose name matches get this colour (texture removed so the colour shows) */
  paint?: { match: RegExp; color: number };
}
export const GLB: Record<string, GlbEntry> = {
  // drivable
  zr1: { length: 4.46, paint: { match: /Paint_Material/, color: 0x0b0b0d } }, m4: { length: 4.8, paint: { match: /mm_ext/, color: 0x1d4fb8 } }, huracan: { length: 4.46, paint: { match: /Paint1Mtl|Meshpart14Mtl/, color: 0x2fb52f } }, c63: { length: 4.75 },
  civic: { length: 4.6 }, tesla: { length: 4.69, paint: { match: /^primary/, color: 0xb3141c }, recolor: [[/^hub_rf\.0/, 0x1b1c1e], [/^hub_rf\.1/, 0x8a8f94]] }, cbr650: { length: 2.13, flip: true },
  // traffic
  t_sedan: { length: 4.6 }, t_pickup: { length: 5.9 }, t_hatch: { length: 4.46 }, t_lexus: { length: 5.1 },
  t_crv: { length: 4.7, flip: true }, t_boxtruck: { length: 7.4 }, t_van: { length: 5.0 }, t_tesla: { length: 4.69, paint: { match: /^primary/, color: 0x3a4a5c }, recolor: [[/^hub_rf\.0/, 0x1b1c1e], [/^hub_rf\.1/, 0x8a8f94]] }, t_civic: { length: 4.6 },
  // police
  cop_basic: { length: 5.0 }, cop_charger: { length: 5.1 },
};

const loader = new GLTFLoader();
const cache = new Map<string, THREE.Group>();

/** Load and normalise one model (cached). */
export async function loadGlb(id: string, base = './models/') {
  const hit = cache.get(id);
  if (hit) return hit;
  const e = GLB[id];
  // the web playtest build serves models under another extension (artifact hosting has no .glb type)
  const ext = (window as unknown as { __GLB_EXT?: string }).__GLB_EXT ?? '.glb';
  const gltf = await loader.loadAsync(`${base}${id}${ext}`);
  const inner = gltf.scene;
  const holder = new THREE.Group();
  holder.add(inner);
  if (e.tiltX) inner.rotation.x = e.tiltX;
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  // longest horizontal axis becomes the length (z)
  if (size.x > size.z) inner.rotation.y += Math.PI / 2;
  if (e.flip) inner.rotation.y += Math.PI;
  if (e.turn) inner.rotation.y += e.turn;
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  const s2 = box.getSize(new THREE.Vector3());
  const k = e.length / s2.z;
  inner.scale.multiplyScalar(k);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.x -= c.x; inner.position.z -= c.z; inner.position.y -= box.min.y;
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = false;
    if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const sm = mat as THREE.MeshStandardMaterial;
      if (sm.envMapIntensity !== undefined) sm.envMapIntensity = 0.8;
      // many exports mark solid parts as BLEND; only real glass stays transparent
      if (sm.transparent && !/glass|window|lens|kaca|tembus|clear|visor|windshield/i.test(sm.name)) { sm.transparent = false; sm.opacity = 1; sm.depthWrite = true; sm.alphaTest = 0; }
      if (e.paint && e.paint.match.test(sm.name)) { sm.map = null; sm.color.setHex(e.paint.color); sm.metalness = 0.5; sm.roughness = 0.35; }
      for (const [re, col] of e.recolor ?? []) if (re.test(sm.name)) { sm.map = null; sm.color.setHex(col); }
      if (e.doubleSide) sm.side = THREE.DoubleSide;
      sm.needsUpdate = true;
    }
  });
  cache.set(id, holder);
  return holder;
}

/** Preload a list of models, reporting progress (0..1). */
export async function preloadGlbs(ids: string[], onProgress?: (p: number) => void) {
  let done = 0;
  await Promise.all(ids.map(async (id) => { await loadGlb(id); onProgress?.(++done / ids.length); }));
}

/** Synchronous access once preloaded; returns a clone (geometry/materials shared). */
export function glbClone(id: string) {
  const g = cache.get(id);
  if (!g) throw new Error(`model ${id} not loaded`);
  return g.clone(true);
}
export function glbSize(id: string) {
  const g = cache.get(id)!;
  return new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
}
