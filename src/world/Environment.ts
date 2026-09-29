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

  /** current clock (hours 0..24); advances when `cycle` is true */
  hour = 12;
  cycle = false;
  /** hours of game clock per real second (1 in-game hour per real minute) */
  rate = 1 / 60;
  /** 0 = full day .. 1 = full night */
  nightFactor = 0;
  private keys: { h: number; sky: THREE.Color; hor: THREE.Color; fog: THREE.Color; sun: THREE.Color; sunI: number; amb: number }[];
  private backMats: { m: THREE.MeshBasicMaterial; base: THREE.Color }[] = [];

  constructor(public scene: THREE.Scene, public map: MapSpec, hour: number, cycle: boolean, shadows: boolean, drawScale: number) {
    const C = (c: number) => new THREE.Color(c);
    const dayFog = map.id === 'city' ? C(0xa9b4c2) : C(map.fog);
    const daySky = map.id === 'city' ? C(0x5c8fd6) : C(map.sky);
    const dayHor = map.id === 'city' ? C(0xcad8e6) : C(map.skyHorizon);
    const night = { sky: C(0x03040a), hor: C(0x1a1d2e), fog: C(map.id === 'forest' ? 0x14181a : 0x0d0f18), sun: C(0x8ea0d0), sunI: 0.25, amb: 0.3 };
    const dawn = { sky: C(0x3a4a78), hor: C(0xf2a060), fog: C(0x8a7c80).lerp(dayFog, 0.3), sun: C(0xffb07a), sunI: 1.2, amb: 0.55 };
    const day = { sky: daySky, hor: dayHor, fog: dayFog, sun: C(0xfff3dc), sunI: map.id === 'forest' ? 1.6 : 2.3, amb: map.id === 'forest' ? 0.8 : 0.8 };
    const dusk = { sky: C(0x2a2f4a), hor: C(0xf08a4b), fog: C(0x6b5a66), sun: C(0xffb27a), sunI: 1.4, amb: 0.55 };
    this.keys = [
      { h: 0, ...night }, { h: 5, ...night }, { h: 6.5, ...dawn }, { h: 9, ...day },
      { h: 16.5, ...day }, { h: 18.8, ...dusk }, { h: 20.5, ...night }, { h: 24, ...night },
    ];
    const fogC = C(map.fog), skyTop = C(map.sky), horizon = C(map.skyHorizon);
    const tod: TimeOfDay = hour >= 20 || hour < 5.5 ? 'night' : hour > 17.5 || hour < 7.5 ? 'dusk' : 'day';
    this.night = tod === 'night';
    const sunC = C(map.sunColor), sunI = map.sunIntensity, amb = map.ambient;
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
    this.backdrop.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial; if (m && m.color && !this.backMats.find((x) => x.m === m)) this.backMats.push({ m, base: m.color.clone() }); });
    this.hour = hour;
    this.cycle = cycle;
    this.applyHour();
  }

  /** advance the natural clock (only when cycling) */
  tick(dt: number) {
    if (!this.cycle) return;
    this.hour = (this.hour + dt * this.rate) % 24;
    this.applyHour();
  }

  /** interpolate sky, fog, sun and ambient for the current hour */
  applyHour() {
    const h = this.hour;
    let i = 0;
    while (i < this.keys.length - 2 && this.keys[i + 1].h <= h) i++;
    const a = this.keys[i], b = this.keys[i + 1];
    const t = (h - a.h) / Math.max(1e-3, b.h - a.h);
    const u = this.skyMat.uniforms;
    (u.top.value as THREE.Color).copy(a.sky).lerp(b.sky, t);
    (u.horizon.value as THREE.Color).copy(a.hor).lerp(b.hor, t);
    (u.fogC.value as THREE.Color).copy(a.fog).lerp(b.fog, t);
    this.fog.color.copy(u.fogC.value);
    (this.scene.background as THREE.Color).copy(u.fogC.value);
    this.sun.color.copy(a.sun).lerp(b.sun, t);
    this.sun.intensity = a.sunI + (b.sunI - a.sunI) * t;
    this.hemi.intensity = (a.amb + (b.amb - a.amb) * t) * 1.6;
    this.hemi.color.copy(u.top.value).lerp(new THREE.Color(1, 1, 1), 0.5);
    // sun path: rises in the east (+x), sets in the west; moonlight from high up at night
    const el = Math.sin(((h - 6) / 12) * Math.PI);
    const az = ((h - 6) / 12) * Math.PI;
    const dir = el > 0.05 ? new THREE.Vector3(Math.cos(az), Math.max(0.12, el), 0.35) : new THREE.Vector3(-0.3, 0.8, 0.4);
    this.sun.userData.dir = dir.normalize();
    // night factor from sun intensity curve
    this.nightFactor = Math.min(1, Math.max(0, (1.3 - this.sun.intensity) / 1.05));
    this.night = this.nightFactor > 0.6;
    const bright = 1 - this.nightFactor * 0.85;
    for (const bm of this.backMats) bm.m.color.copy(bm.base).multiplyScalar(bright).lerp(this.fog.color, 0.2);
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
