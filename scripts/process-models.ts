// Normalises source .glb files to a uniform in-game detail level:
// merges parts by material, simplifies to a triangle budget, and resizes textures.
// Usage: tsx scripts/process-models.ts <srcDir> <outDir>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, simplify, prune, textureCompress, resample, getBounds, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

/** triangle budget and texture size per model id; prefix decides the class */
const budget = (id: string) => (id.startsWith('t_') ? { tris: 12000, tex: 512 } : id.startsWith('cop_') ? { tris: 25000, tex: 512 } : { tris: 80000, tex: 1024 });

const [src, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
await MeshoptSimplifier.ready;
const count = (doc: any) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION')!.getCount()) / 3; } return Math.round(t); };

for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.glb'))) {
  const id = path.basename(f, '.glb');
  const b = budget(id);
  const doc = await io.read(path.join(src, f));
  const before = count(doc);
  // traffic: texture/normal seams block clean simplification, so drop them (colours come from materials,
  // normals are rebuilt at load) and let welding merge the seams before simplifying
  if (id.startsWith('t_') && before > b.tris * 3) {
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      for (const sem of p.listSemantics()) if (sem !== 'POSITION') p.setAttribute(sem, null);
    }
    for (const mat of doc.getRoot().listMaterials()) { mat.setBaseColorTexture(null); mat.setNormalTexture(null); mat.setMetallicRoughnessTexture(null); mat.setOcclusionTexture(null); mat.setEmissiveTexture(null); }
  }
  await doc.transform(dedup(), flatten(), join({ keepNamed: false }), weld(), resample());
  // simplify in passes until under budget (error bound relaxes a little each pass)
  for (let pass = 0; pass < 7 && count(doc) > b.tris * 1.1; pass++) {
    const ratio = Math.max(0.02, b.tris / count(doc));
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: Math.min(0.08, 0.004 * Math.pow(2, pass)), lockBorder: false }));
  }
  // fallback for stubborn meshes (attribute seams block edge collapse): sloppy simplification per primitive
  if (count(doc) > b.tris * 1.2 && !id.startsWith('t_')) {
    const ratio = b.tris / count(doc);
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const idx = p.getIndices(); const pos = p.getAttribute('POSITION');
      if (!idx || !pos) continue;
      const src = new Uint32Array(idx.getArray()!);
      const target = Math.max(3, Math.floor((src.length * ratio) / 3) * 3);
      const [res] = MeshoptSimplifier.simplifySloppy(src, pos.getArray() as Float32Array, pos.getElementSize(), null, target, 0.05);
      idx.setArray(new Uint32Array(res));
      compactPrimitive(p); // drop vertices no longer referenced
    }
  }
  await doc.transform(prune(), textureCompress({ encoder: sharp, resize: [b.tex, b.tex], targetFormat: 'webp', quality: 80 }));
  // bake a centred, ground-level origin later at runtime; record bounds here
  const bb = getBounds(doc.getRoot().listScenes()[0]);
  const file = path.join(out, `${id}.glb`);
  await io.write(file, doc);
  console.log(id.padEnd(12), before, '->', count(doc), 'tris |', (fs.statSync(file).size / 1e6).toFixed(1), 'MB | size', bb.max.map((v, i) => (v - bb.min[i]).toFixed(3)).join(' x '));
}
