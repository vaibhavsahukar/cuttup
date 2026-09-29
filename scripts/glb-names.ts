// List node / mesh names and material names of a .glb (to locate wheels, glass, lights).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(process.argv[2]);
const r = doc.getRoot();
const names = r.listNodes().filter((n) => n.getMesh()).map((n) => n.getName());
console.log('NODES', names.length, names.slice(0, Number(process.argv[3] ?? 60)).join(' | '));
console.log('MATS', r.listMaterials().map((m) => m.getName()).join(' | '));
