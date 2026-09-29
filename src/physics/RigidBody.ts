import * as THREE from 'three';

/**
 * Minimal rigid body for crash tumbling: box collider vs. a height field (ground function),
 * impulse-based bounce + Coulomb friction at the lowest penetrating corners.
 */
export class RigidBody {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  quat = new THREE.Quaternion();
  angVel = new THREE.Vector3();
  invMass: number;
  invI: number;
  restitution = 0.25;
  friction = 0.7;
  sleeping = false;
  private corners: THREE.Vector3[];
  private tmp = new THREE.Vector3();
  private r = new THREE.Vector3();
  private vp = new THREE.Vector3();

  constructor(public obj: THREE.Object3D, public half: THREE.Vector3, mass: number, public centerOffset = new THREE.Vector3()) {
    this.invMass = 1 / mass;
    const I = (mass / 3) * (half.x * half.x + half.y * half.y + half.z * half.z);
    this.invI = 1 / I;
    this.corners = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) this.corners.push(new THREE.Vector3(x * half.x, y * half.y, z * half.z));
    // extra contact points on the faces for smoother rolling
    for (const [x, y, z] of [[0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, -1]]) this.corners.push(new THREE.Vector3(x * half.x, y * half.y, z * half.z));
    // initialise from object world transform (centre = object origin + offset)
    obj.updateMatrixWorld(true);
    obj.getWorldQuaternion(this.quat);
    obj.getWorldPosition(this.pos);
    this.pos.add(centerOffset.clone().applyQuaternion(this.quat));
  }

  applyImpulse(j: THREE.Vector3, at?: THREE.Vector3) {
    this.vel.addScaledVector(j, this.invMass);
    if (at) {
      this.r.copy(at).sub(this.pos);
      this.angVel.add(this.tmp.copy(this.r).cross(j).multiplyScalar(this.invI));
    }
    this.sleeping = false;
  }

  step(dt: number, ground: (p: THREE.Vector3) => number) {
    if (this.sleeping) return;
    this.vel.y -= 9.81 * dt;
    this.pos.addScaledVector(this.vel, dt);
    const w = this.angVel;
    const wl = w.length();
    if (wl > 1e-6) {
      const dq = new THREE.Quaternion().setFromAxisAngle(this.tmp.copy(w).divideScalar(wl), wl * dt);
      this.quat.premultiply(dq).normalize();
    }
    // air drag
    this.angVel.multiplyScalar(1 - 0.15 * dt);
    // ground contacts
    let maxPen = 0;
    let contacts = 0;
    for (const c of this.corners) {
      const p = this.tmp.copy(c).applyQuaternion(this.quat).add(this.pos);
      const g = ground(p);
      const pen = g - p.y;
      if (pen <= 0) continue;
      contacts++;
      maxPen = Math.max(maxPen, pen);
      this.r.copy(p).sub(this.pos);
      this.vp.copy(this.angVel).cross(this.r).add(this.vel);
      const vn = this.vp.y;
      if (vn < 0) {
        // normal impulse (n = up)
        const rxn = new THREE.Vector3(-this.r.z, 0, this.r.x); // r x (0,1,0)
        const denom = this.invMass + rxn.lengthSq() * this.invI;
        const jn = (-(1 + this.restitution) * vn) / denom / 1.5;
        const J = new THREE.Vector3(0, jn, 0);
        // friction
        const vt = new THREE.Vector3(this.vp.x, 0, this.vp.z);
        const vtl = vt.length();
        if (vtl > 1e-4) {
          const jt = Math.min(this.friction * jn, vtl / (this.invMass + this.invI * this.r.lengthSq()) / 1.5);
          J.addScaledVector(vt.divideScalar(vtl), -jt);
        }
        this.vel.addScaledVector(J, this.invMass);
        this.angVel.add(this.r.clone().cross(J).multiplyScalar(this.invI));
      }
    }
    if (maxPen > 0) this.pos.y += maxPen;
    if (contacts > 0) {
      // rolling resistance / scrape
      this.vel.x *= 1 - 0.6 * dt; this.vel.z *= 1 - 0.6 * dt;
      this.angVel.multiplyScalar(1 - 1.2 * dt);
      if (this.vel.lengthSq() < 0.05 && this.angVel.lengthSq() < 0.05) this.sleeping = true;
    }
  }

  /** write back to the object (object origin = centre - offset) */
  sync() {
    this.obj.quaternion.copy(this.quat);
    this.obj.position.copy(this.pos).sub(this.tmp.copy(this.centerOffset).applyQuaternion(this.quat));
  }
}
