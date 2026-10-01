import * as THREE from 'three';

/** Pooled particle systems: sparks (additive points), debris & glass (instanced chunks). */
interface P { pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; rot: THREE.Euler; spin: THREE.Vector3; scale: number; color: THREE.Color }

interface SP { pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; s0: number; s1: number; color: THREE.Color; alpha: number; rise: number; drag: number }

/** soft round sprites with their own size and opacity (smoke, flames, tyre smoke) */
class SoftPoints {
  items: SP[] = [];
  readonly pts: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private mat: THREE.ShaderMaterial;
  constructor(private max: number, additive: boolean) {
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 700 } },
      vertexShader: 'attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uScale; varying vec3 vC; varying float vA; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(aSize * uScale / max(0.5, -mv.z), 0.0, 380.0); gl_Position = projectionMatrix * mv; vC = aColor; vA = aAlpha; }',
      fragmentShader: 'varying vec3 vC; varying float vA; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC, a); }',
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
    });
    this.pts = new THREE.Points(this.geo, this.mat);
    this.pts.frustumCulled = false;
  }
  add(p: SP) { if (this.items.length >= this.max) this.items.shift(); this.items.push(p); }
  update(dt: number) {
    this.mat.uniforms.uScale.value = 700 * (typeof innerHeight === 'number' ? innerHeight / 720 : 1);
    let n = 0;
    for (const p of this.items) {
      p.life -= dt;
      p.vel.y += p.rise * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const f = Math.max(0, p.life / p.max), u = 1 - f;
      this.pos.set([p.pos.x, p.pos.y, p.pos.z], n * 3);
      this.col.set([p.color.r, p.color.g, p.color.b], n * 3);
      this.size[n] = p.s0 + (p.s1 - p.s0) * u;
      this.alpha[n] = p.alpha * f * Math.min(1, u * 8);
      n++;
    }
    this.items = this.items.filter((p) => p.life > 0);
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha']) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** dark tyre marks on the road, a ring buffer of flat quads */
class SkidMarks {
  readonly mesh: THREE.InstancedMesh;
  private i = 0; private n = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(); private yAxis = new THREE.Vector3(0, 1, 0);
  constructor(private max = 700) {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }
  add(pos: THREE.Vector3, yaw: number, len: number, width: number) {
    this.q.setFromAxisAngle(this.yAxis, yaw);
    this.s.set(width, 1, len);
    this.m.compose(pos, this.q, this.s);
    this.mesh.setMatrixAt(this.i, this.m);
    this.i = (this.i + 1) % this.max;
    this.n = Math.min(this.max, this.n + 1);
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.i = 0; this.n = 0; this.mesh.count = 0; }
}

export class Particles {
  private flames = new SoftPoints(500, true);
  private smokes = new SoftPoints(900, false);
  readonly skids = new SkidMarks();
  root = new THREE.Group();
  private sparks: P[] = [];
  private chunks: P[] = [];
  private sparkGeo: THREE.BufferGeometry;
  private sparkPts: THREE.Points;
  private chunkMesh: THREE.InstancedMesh;
  private SMAX = 600;
  private CMAX = 400;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  groundY: (p: THREE.Vector3) => number = () => 0;

  constructor() {
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.SMAX * 3), 3));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.SMAX * 3), 3));
    const sm = new THREE.PointsMaterial({ size: 0.18, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.sparkPts = new THREE.Points(this.sparkGeo, sm);
    this.sparkPts.frustumCulled = false;
    const cm = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.4 });
    this.chunkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cm, this.CMAX);
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.count = 0;
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.setColorAt(0, new THREE.Color());
    this.root.add(this.sparkPts, this.chunkMesh, this.smokes.pts, this.flames.pts, this.skids.mesh);
  }

  /** soft grey smoke: tyre smoke when drifting, wreck smoke */
  smoke(pos: THREE.Vector3, vel: THREE.Vector3, n: number, size = 1.2, alpha = 0.35, grow = 3.2, shade = 0.78) {
    for (let i = 0; i < n; i++) {
      const life = 0.8 + Math.random() * 0.9;
      const g = shade * (0.85 + Math.random() * 0.25);
      this.smokes.add({ pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.15, (Math.random() - 0.5) * 0.3)), vel: vel.clone().multiplyScalar(0.35).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2)), life, max: life, s0: size * 0.5, s1: size * grow, color: new THREE.Color(g, g, g), alpha, rise: 0.4, drag: 1.2 });
    }
  }
  /** burning wreck: a few flames and dark smoke every call */
  fire(pos: THREE.Vector3, n = 2) {
    for (let i = 0; i < n; i++) {
      const life = 0.5 + Math.random() * 0.5;
      this.flames.add({ pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 0.4, (Math.random() - 0.5) * 2.4)), vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.5), life, max: life, s0: 0.9, s1: 0.3, color: new THREE.Color(1, 0.45 + Math.random() * 0.25, 0.1), alpha: 0.9, rise: 2, drag: 0.8 });
    }
    this.smoke(pos.clone().add(new THREE.Vector3(0, 0.8, 0)), new THREE.Vector3(0, 0, 0), 1, 2.2, 0.5, 4, 0.12);
  }
  /** a fireball: expanding flames, a pall of black smoke, sparks and burning chunks */
  explode(pos: THREE.Vector3, power = 1) {
    for (let i = 0; i < 80 * power; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 11);
      const life = 0.5 + Math.random() * 0.9;
      this.flames.add({ pos: pos.clone(), vel: dir, life, max: life, s0: 2, s1: 5 + Math.random() * 3, color: new THREE.Color(1, 0.3 + Math.random() * 0.35, 0.06), alpha: 0.7, rise: 2.5, drag: 1.6 });
    }
    for (let i = 0; i < 50 * power; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 7);
      const life = 2 + Math.random() * 2.5;
      this.smokes.add({ pos: pos.clone(), vel: dir, life, max: life, s0: 2.5, s1: 9 + Math.random() * 6, color: new THREE.Color(0.07, 0.07, 0.07), alpha: 0.75, rise: 1.6, drag: 0.7 });
    }
    this.spark(pos, new THREE.Vector3(), Math.round(120 * power), 22);
    this.debris(pos, new THREE.Vector3(), Math.round(30 * power), 0x222222, false, 0.3);
  }

  spark(pos: THREE.Vector3, baseVel: THREE.Vector3, n: number, spread = 6) {
    for (let i = 0; i < n; i++) {
      if (this.sparks.length >= this.SMAX) this.sparks.shift();
      const v = baseVel.clone().multiplyScalar(0.4 + Math.random() * 0.5).add(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * spread * 0.7, (Math.random() - 0.5) * spread));
      const life = 0.3 + Math.random() * 0.6;
      this.sparks.push({ pos: pos.clone(), vel: v, life, max: life, rot: new THREE.Euler(), spin: new THREE.Vector3(), scale: 1, color: new THREE.Color(1, 0.7 + Math.random() * 0.3, 0.3) });
    }
  }

  debris(pos: THREE.Vector3, baseVel: THREE.Vector3, n: number, color: number, glass = false, size = 0.15) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      if (this.chunks.length >= this.CMAX) this.chunks.shift();
      const v = baseVel.clone().multiplyScalar(0.3 + Math.random() * 0.6).add(new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 7, (Math.random() - 0.5) * 8));
      const life = 3 + Math.random() * 4;
      this.chunks.push({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.6, (Math.random() - 0.5) * 0.8)),
        vel: v, life, max: life, rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20),
        scale: size * (0.4 + Math.random()) * (glass ? 0.5 : 1), color: glass ? new THREE.Color(0.75, 0.88, 0.95) : c,
      });
    }
  }

  update(dt: number) {
    this.flames.update(dt); this.smokes.update(dt);
    const pa = this.sparkGeo.attributes.position as THREE.BufferAttribute;
    const ca = this.sparkGeo.attributes.color as THREE.BufferAttribute;
    let n = 0;
    for (const p of this.sparks) {
      p.life -= dt;
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const g = this.groundY(p.pos);
      if (p.pos.y < g) { p.pos.y = g; p.vel.y *= -0.3; p.vel.x *= 0.7; p.vel.z *= 0.7; }
      const f = Math.max(0, p.life / p.max);
      pa.setXYZ(n, p.pos.x, p.pos.y, p.pos.z);
      ca.setXYZ(n, p.color.r * f, p.color.g * f * f, p.color.b * f * f * f);
      n++;
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);
    this.sparkGeo.setDrawRange(0, n);
    pa.needsUpdate = true; ca.needsUpdate = true;

    let k = 0;
    for (const p of this.chunks) {
      p.life -= dt;
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const g = this.groundY(p.pos) + p.scale * 0.3;
      if (p.pos.y < g) {
        p.pos.y = g;
        p.vel.y = Math.abs(p.vel.y) * 0.25;
        p.vel.x *= 0.6; p.vel.z *= 0.6;
        p.spin.multiplyScalar(0.6);
      }
      p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
      const sc = p.scale * Math.min(1, p.life / 0.5);
      this.q.setFromEuler(p.rot);
      this.m4.compose(p.pos, this.q, this.s.set(sc, sc * 0.35, sc * 0.8));
      this.chunkMesh.setMatrixAt(k, this.m4);
      this.chunkMesh.setColorAt(k, p.color);
      k++;
    }
    this.chunks = this.chunks.filter((p) => p.life > 0);
    this.chunkMesh.count = k;
    this.chunkMesh.instanceMatrix.needsUpdate = true;
    if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;
  }

  clear() { this.sparks = []; this.chunks = []; this.chunkMesh.count = 0; this.sparkGeo.setDrawRange(0, 0); }
}
