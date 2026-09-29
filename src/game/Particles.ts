import * as THREE from 'three';

/** Pooled particle systems: sparks (additive points), debris & glass (instanced chunks). */
interface P { pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; rot: THREE.Euler; spin: THREE.Vector3; scale: number; color: THREE.Color }

export class Particles {
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
    this.root.add(this.sparkPts, this.chunkMesh);
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
