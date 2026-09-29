import * as THREE from 'three';
import type { MapSpec } from '../data/maps';
import { mulberry32 } from '../core/math';

export type TimeOfDay = 'day' | 'dusk' | 'night';

/** Sky dome, fog, sun/hemi lights and distant backdrop (mountains / skyline silhouettes). */
export class Environment {
  root = new THREE.Group();
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  backdrop = new THREE.Group();
  fog: THREE.Fog;
  night = false;
  private skyMat: THREE.ShaderMaterial;

  constructor(public scene: THREE.Scene, public map: MapSpec, tod: TimeOfDay, shadows: boolean, drawScale: number) {
    let skyTop = new THREE.Color(map.sky), horizon = new THREE.Color(map.skyHorizon), fogC = new THREE.Color(map.fog);
    let sunI = map.sunIntensity, amb = map.ambient;
    let sunC = new THREE.Color(map.sunColor);
    if (tod === 'night') {
      this.night = true;
      skyTop = new THREE.Color(0x03040a); horizon = new THREE.Color(0x1a1d2e); fogC = new THREE.Color(0x0d0f18);
      sunI = 0.25; amb = 0.28; sunC = new THREE.Color(0x8ea0d0);
    }
    this.fog = new THREE.Fog(fogC, map.fogNear * drawScale, map.fogFar * drawScale);
    scene.fog = this.fog;
    scene.background = fogC.clone();

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: skyTop }, horizon: { value: horizon }, fogC: { value: fogC } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 fogC; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = mix(horizon, top, smoothstep(0.0, 0.45, h)); c = mix(fogC, c, smoothstep(-0.02, 0.12, h)); gl_FragColor = vec4(c,1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.root.add(this.sky);

    this.hemi = new THREE.HemisphereLight(skyTop.clone().lerp(new THREE.Color(1, 1, 1), 0.5), new THREE.Color(map.hemiGround), amb * 1.6);
    this.root.add(this.hemi);
    this.sun = new THREE.DirectionalLight(sunC, sunI);
    const dir = map.id === 'city' ? new THREE.Vector3(-0.6, 0.35, 0.7) : map.id === 'country' ? new THREE.Vector3(0.4, 0.9, 0.3) : new THREE.Vector3(0.3, 0.8, -0.4);
    this.sun.userData.dir = dir.normalize();
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(2048, 2048);
      const c = this.sun.shadow.camera;
      c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 1; c.far = 400;
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.05;
    }
    this.root.add(this.sun, this.sun.target);
    this.buildBackdrop(fogC, tod);
    this.root.add(this.backdrop);
    scene.add(this.root);
  }

  private buildBackdrop(fogC: THREE.Color, tod: TimeOfDay) {
    const r = mulberry32(this.map.seed + 100);
    if (this.map.id === 'country') {
      // distant mountains, drawn without fog but pre-tinted towards haze
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6f86a0).lerp(fogC, 0.35), fog: false });
      const snow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8eef4).lerp(fogC, 0.3), fog: false });
      for (let i = 0; i < 38; i++) {
        const a = (i / 38) * Math.PI * 2 + r() * 0.1;
        const h = 180 + r() * 380, w = 350 + r() * 500;
        const m = new THREE.Mesh(new THREE.ConeGeometry(w, h, 5 + Math.floor(r() * 3)), mat);
        const dist = 2300 + r() * 400;
        m.position.set(Math.sin(a) * dist, h / 2 - 60, Math.cos(a) * dist);
        m.rotation.y = r() * 3;
        this.backdrop.add(m);
        if (h > 380) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(w * 0.28, h * 0.28, 5), snow);
          c.position.set(m.position.x, h - 60 - h * 0.14 + 1, m.position.z);
          c.rotation.y = m.rotation.y;
          this.backdrop.add(c);
        }
      }
    } else if (this.map.id === 'city') {
      const night = tod === 'night';
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(night ? 0x0b0d16 : 0x3a3446).lerp(fogC, 0.25), fog: false });
      const lit = new THREE.MeshBasicMaterial({ color: night ? 0xffd27a : 0x8a6c64, fog: false });
      for (let i = 0; i < 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        const h = 120 + r() * 420, w = 50 + r() * 90;
        const dist = 2000 + r() * 500;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
        m.position.set(Math.sin(a) * dist, h / 2 - 40, Math.cos(a) * dist);
        m.lookAt(0, m.position.y, 0);
        this.backdrop.add(m);
        if (night && r() < 0.6) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, 4, 1), lit);
          b.position.copy(m.position).multiplyScalar(0.97);
          b.position.y = h - 40 - 10;
          b.lookAt(0, b.position.y, 0);
          this.backdrop.add(b);
        }
      }
    } else {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3d4a44).lerp(fogC, 0.55), fog: false });
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2;
        const h = 150 + r() * 200, w = 400 + r() * 400;
        const m = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6), mat);
        const dist = 2400;
        m.position.set(Math.sin(a) * dist, h / 2 - 80, Math.cos(a) * dist);
        this.backdrop.add(m);
      }
    }
    for (const c of this.backdrop.children) c.renderOrder = -5;
  }

  /** Keep sky, backdrop and shadow frustum centred on the camera / player. */
  update(camPos: THREE.Vector3, focus: THREE.Vector3) {
    this.sky.position.copy(camPos);
    this.backdrop.position.set(camPos.x, focus.y, camPos.z);
    const d = this.sun.userData.dir as THREE.Vector3;
    this.sun.position.copy(focus).addScaledVector(d, 150);
    this.sun.target.position.copy(focus);
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
  }
}
