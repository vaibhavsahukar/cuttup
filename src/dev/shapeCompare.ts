import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getShape, buildFromShape } from '../vehicles/ShapeBuilder';
import { buildPanelCar } from '../vehicles/PanelBuilder';
import { buildBike } from '../vehicles/BikeBuilder';

/** Dev-only (?shape=<id>[,<id>]&ref=1): our rebuilt vehicle, optionally beside its reference model. */
export async function shapeCompare(ids: string[], withRef: boolean, rot: number, color: number) {
  document.getElementById('loading')?.remove();
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setSize(innerWidth, innerHeight);
  document.body.style.margin = '0';
  document.body.appendChild(r.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8a97a8);
  scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(5, 10, 7); scene.add(sun);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x6a6f76 }));
  g.rotation.x = -Math.PI / 2; scene.add(g);
  let col = 0;
  for (const id of ids) {
    const sh = getShape(id)!;
    const ours = id === 'r6' || id === 'cbr650' ? buildBike(id, color) : new URLSearchParams(location.search).get('panel') === '1' ? buildPanelCar(sh, color, false) : buildFromShape(sh, color, false);
    ours.root.position.set((col % 4) * 6.5, 0, -Math.floor(col / 4) * 7.5);
    ours.root.rotation.y = rot;
    scene.add(ours.root);
    col++;
  }
  const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 500);
  const rows = Math.ceil(ids.length / 4), cols = Math.min(4, ids.length);
  const cx = ((cols - 1) * 6.5) / 2, cz = -((rows - 1) * 7.5) / 2;
  const dist = (ids.length === 1 ? 2 : 8) + Math.max(cols * 6.5, rows * 7.5) * 0.9;
  cam.position.set(cx + dist * 0.55, dist * 0.55, cz + dist * 0.75);
  cam.lookAt(cx, 0.4, withRef ? cz - 3 : cz);
  const loop = () => { r.render(scene, cam); requestAnimationFrame(loop); };
  loop();
  (window as any).__ready = true;
}
