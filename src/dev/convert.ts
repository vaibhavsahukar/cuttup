import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** Dev-only: load an FBX from /_fbx and export it as a GLB (base64) for the model pipeline. */
export async function convertFbx(name: string) {
  const obj = await new FBXLoader().setResourcePath('/_fbx/').loadAsync(`/_fbx/${name}`);
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    // FBX Phong -> Standard so the exporter writes PBR materials
    const conv = mats.map((x) => {
      const p = x as THREE.MeshPhongMaterial;
      return new THREE.MeshStandardMaterial({ name: p.name, color: p.color, map: p.map && (p.map.image as HTMLImageElement | undefined)?.width ? p.map : null, transparent: p.transparent, opacity: p.opacity, roughness: 0.5, metalness: 0.2 });
    });
    m.material = Array.isArray(m.material) ? conv : conv[0];
  });
  const glb = (await new GLTFExporter().parseAsync(obj, { binary: true })) as ArrayBuffer;
  let s = '';
  const u = new Uint8Array(glb);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
