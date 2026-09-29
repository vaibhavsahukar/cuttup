import { modelTest } from './dev/modelTest';
const _mt = new URLSearchParams(location.search).get('models');
if (_mt) { modelTest(_mt); throw 'model test'; }
import * as THREE from 'three';
import { RoadPath } from './world/RoadPath';
import { ChunkManager } from './world/ChunkManager';
import { Environment } from './world/Environment';
import { getMap, makeLayout } from './data/maps';

const params = new URLSearchParams(location.search);
const map = getMap(params.get('map') ?? 'city');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 5000);
const path = new RoadPath(map);
const layout = makeLayout(map.road);
const cm = new ChunkManager(path, map, layout, { chunksAhead: 10, propDensity: 1, shadows: true });
scene.add(cm.root);
const env = new Environment(scene, map, (params.get('tod') as any) ?? 'dusk', true, 1);
let s = Number(params.get('s') ?? 0);
const v = new THREE.Vector3(), t = new THREE.Vector3();
function frame() {
  s += 0.5;
  for (let i = 0; i < 12; i++) cm.update(s);
  const d = layout.laneCenter(Math.min(2, layout.lanes - 1));
  path.toWorld(s, d, 2.2, v);
  path.toWorld(s + 20, d, 1.2, t);
  cam.position.copy(v); cam.lookAt(t);
  env.update(cam.position, v);
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
frame();
(window as any).__ready = true;
