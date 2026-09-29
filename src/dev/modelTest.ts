import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { VEHICLES } from '../data/vehicles';
import { buildPlayerModel, buildTrafficModel, TRAFFIC_TYPES } from '../vehicles/Factory';

export function modelTest(which: string) {
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setSize(innerWidth, innerHeight);
  r.shadowMap.enabled = true;
  document.body.style.margin = '0';
  document.body.appendChild(r.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8899aa);
  scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(5, 10, 7); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x555555 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 500);
  const list = which === 'traffic' ? TRAFFIC_TYPES.map((t, i) => buildTrafficModel(t, [0x9a1b1b, 0x1c3f86, 0xe6e6e6, 0x2b5d34, 0x8c9096, 0xe0e0e0][i])) :
    VEHICLES.filter((v) => which === 'all' || v.id === which || (which === 'bikes' ? v.kind === 'bike' : which === 'cars' ? v.kind === 'car' : false)).map((v) => buildPlayerModel(v));
  const cols = Math.ceil(Math.sqrt(list.length));
  list.forEach((m, i) => {
    m.root.position.set((i % cols) * 6 - (cols - 1) * 3, 0, -Math.floor(i / cols) * 7);
    m.root.rotation.y = Number(new URLSearchParams(location.search).get('rot') ?? 2.4);
    scene.add(m.root);
  });
  const rows = Math.ceil(list.length / cols);
  const span = Math.max(cols * 6, rows * 7);
  cam.position.set(0, span * 0.55, span * 1.1);
  cam.lookAt(0, 0, -(rows - 1) * 3.5);
  const loop = () => { r.render(scene, cam); requestAnimationFrame(loop); };
  loop();
}
