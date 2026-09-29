// Stats for .glb files: triangles, meshes, materials, textures, bounding box (after node transforms).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); const c = i ? i.getCount() : p.getAttribute('POSITION')!.getCount(); tris += c / 3; }
  const b = getBounds(root.listScenes()[0]);
  const size = b.max.map((v, i) => (v - b.min[i]).toFixed(2));
  let texPx = 0; for (const t of root.listTextures()) { const s = t.getSize(); if (s) texPx = Math.max(texPx, s[0]); }
  console.log(f.split('/').pop(), '| tris', Math.round(tris), '| meshes', root.listMeshes().length, '| mats', root.listMaterials().length, '| textures', root.listTextures().length, 'max', texPx + 'px', '| size xyz', size.join(' x '));
}
