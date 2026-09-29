// Materials of a .glb with base colour, alpha mode and the triangle count using each (to find paint / glass).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const use = new Map<any, number>();
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); use.set(p.getMaterial(), (use.get(p.getMaterial()) ?? 0) + (i ? i.getCount() / 3 : 0)); }
const rows = doc.getRoot().listMaterials().map((m) => ({ n: m.getName(), c: m.getBaseColorFactor().map((x) => x.toFixed(2)).join(','), a: m.getAlphaMode(), tex: !!m.getBaseColorTexture(), t: Math.round(use.get(m) ?? 0) }));
rows.sort((a, b) => b.t - a.t);
for (const r of rows.slice(0, Number(process.argv[3] ?? 12))) console.log(r.t, '|', r.n, '|', r.c, '|', r.a, r.tex ? 'tex' : '');
