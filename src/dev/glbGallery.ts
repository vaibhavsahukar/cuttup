import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLB, loadGlb } from '../vehicles/GlbLibrary';

/** Dev-only gallery (?glb=all|<id>,<id>): renders normalised imported models in a grid with a forward arrow. */
export async function glbGallery(which: string, rot: number) {
  document.getElementById('loading')?.remove();
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setSize(innerWidth, innerHeight);
  document.body.style.margin = '0';
  document.body.appendChild(r.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8899aa);
  scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(5, 10, 7); scene.add(sun);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x666666 }));
  g.rotation.x = -Math.PI / 2; scene.add(g);
  const ids = which === 'all' ? Object.keys(GLB) : which.split(',');
  const cols = Math.ceil(Math.sqrt(ids.length));
  let i = 0;
  for (const id of ids) {
    const m = (await loadGlb(id)).clone(true);
    const x = (i % cols) * 7 - (cols - 1) * 3.5, z = -Math.floor(i / cols) * 8;
    m.position.set(x, 0, z);
    m.rotation.y = rot;
    // arrow shows the model's forward (+z) direction
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.05, 0), 3.5, 0xff2020, 0.6, 0.4);
    m.add(arrow);
    scene.add(m);
    i++;
  }
  const rows = Math.ceil(ids.length / cols);
  const span = Math.max(cols * 7, rows * 8);
  const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 1000);
  cam.position.set(0, span * (ids.length < 3 ? 0.35 : 0.6), span * (ids.length < 3 ? 0.55 : 1.05));
  cam.lookAt(0, 0, -(rows - 1) * 4);
  const loop = () => { r.render(scene, cam); requestAnimationFrame(loop); };
  loop();
  (window as any).__ready = true;
}
