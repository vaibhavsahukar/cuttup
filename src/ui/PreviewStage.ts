import * as THREE from 'three';
import { getVehicle } from '../data/vehicles';
import { buildPlayerModel, buildViewerModel } from '../vehicles/Factory';
import type { VehicleModel } from '../vehicles/ModelKit';

/** Garage turntable used behind every menu screen. */
export class PreviewStage {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private table: THREE.Group;
  private models = new Map<string, VehicleModel>();
  private current?: VehicleModel;
  private t = 0;
  private dragX: number | null = null;
  private idle = 0; // seconds since the last drag; auto spin resumes after a pause
  offsetX = 0; // shift the car left/right to make room for panels

  constructor(pmrem: THREE.Texture) {
    const s = this.scene;
    // drag with the mouse (or a finger) to turn the car; ignore drags that start on menu controls
    addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest?.('button, input, select, a, .panel, .card')) return;
      this.dragX = e.clientX;
    });
    addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      this.table.rotation.y += (e.clientX - this.dragX) * 0.01;
      this.dragX = e.clientX;
      this.idle = 0;
    });
    addEventListener('pointerup', () => { this.dragX = null; });
    s.background = new THREE.Color(0x07080c);
    s.fog = new THREE.Fog(0x07080c, 14, 34);
    s.environment = pmrem;
    s.environmentIntensity = 0.7;
    s.add(new THREE.HemisphereLight(0x8899ff, 0x201015, 0.8));
    const key = new THREE.SpotLight(0xffffff, 260, 40, 0.5, 0.6, 1.5);
    key.position.set(4, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    s.add(key);
    const rim = new THREE.DirectionalLight(0xff3d6e, 0.9); rim.position.set(-6, 3, -6); s.add(rim);
    const rim2 = new THREE.DirectionalLight(0x2de2e6, 0.8); rim2.position.set(6, 2, -5); s.add(rim2);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x0d0e13, roughness: 0.75, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    this.table = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.7, 0.12, 64), new THREE.MeshStandardMaterial({ color: 0x1a1c24, metalness: 0.7, roughness: 0.3 }));
    disc.position.y = 0.06; disc.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.66, 0.025, 8, 96), new THREE.MeshBasicMaterial({ color: 0xff3d6e }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.12;
    this.table.add(disc, ring);
    s.add(this.table);
  }

  show(id: string) {
    const spec = getVehicle(id);
    const mk = `${id}:${spec.color}:${spec.paint?.a1 ?? ''}:${spec.paint?.a2 ?? ''}`;
    let m = this.models.get(mk);
    if (!m) {
      m = buildPlayerModel(spec, true);
      m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      m.root.position.y = 0.12;
      this.models.set(mk, m);
    }
    if (this.current) this.table.remove(this.current.root);
    this.table.add(m.root);
    this.current = m;
    for (const b of m.brake) b.material = (b.material as THREE.Material);
  }

  /** show any model of the catalog ('v:<vehicle>', 't:<traffic>', 'c:<cop>') */
  showModel(key: string) {
    // a vehicle shows in the colorway picked in the garage
    if (key.startsWith('v:')) { const sp = getVehicle(key.slice(2)); key = `${key}:${sp.color}:${sp.paint?.a1 ?? ''}:${sp.paint?.a2 ?? ''}`; }
    let m = this.models.get(key);
    if (!m) {
      m = buildViewerModel(key.split(':').slice(0, 2).join(':'), getVehicle);
      m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      m.root.position.y = 0.12;
      this.models.set(key, m);
    }
    if (this.current) this.table.remove(this.current.root);
    this.table.add(m.root);
    this.current = m;
  }

  update(dt: number, w: number, h: number) {
    this.t += dt;
    this.idle += dt;
    if (this.dragX === null && this.idle > 2.5) this.table.rotation.y += dt * 0.35;
    this.camera.aspect = w / h;
    const bike = this.current && this.current.bike;
    // longer vehicles (vans, trucks) stand further back
    const len = this.current?.length ?? 4.5;
    const dist = bike ? 7 : Math.max(11.5, len * 2.5 + 0.5);
    this.camera.position.set(Math.sin(0.5) * dist + this.offsetX, (bike ? 2.2 : 3.2) * (dist / 11.5 > 1 ? dist / 11.5 : 1), Math.cos(0.5) * dist);
    this.camera.lookAt(this.offsetX * 0.9, bike ? 0.8 : 0.7, 0);
    this.camera.updateProjectionMatrix();
  }
}
