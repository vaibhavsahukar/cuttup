import * as THREE from 'three';
import type { Player } from './Player';
import { clamp, damp } from '../core/math';

/** Chase cam (speed FOV, shake, lag), hood / cockpit cam, look-back, and cinematic crash orbit. */
export class CameraRig {
  mode: 'chase' | 'hood' = 'chase';
  shake = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yaw = 0;
  private init = false;
  private t = 0;

  constructor(public cam: THREE.PerspectiveCamera) {}

  reset() { this.init = false; this.shake = 0; }
  addShake(v: number) { this.shake = Math.min(1.5, this.shake + v); }

  update(dt: number, p: Player, lookback: boolean) {
    this.t += dt;
    const root = p.model.root;
    const q = root.quaternion;
    const phys = p.phys;
    const spd = Math.abs(phys.v);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const heading = Math.atan2(fwd.x, fwd.z);
    if (!this.init) { this.yaw = heading; }
    // slight lag of the camera yaw behind the car lets drifts read visually
    let dy = heading - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * (1 - Math.exp(-dt * (this.mode === 'hood' ? 30 : 5)));
    const cf = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const up = new THREE.Vector3(0, 1, 0);
    const bike = p.bike;
    const h = p.spec.dims.height;
    const targetFov = (this.mode === 'hood' ? 70 : 62) + clamp(spd / 80, 0, 1) ** 1.3 * 24;
    this.cam.fov = damp(this.cam.fov, targetFov, 3, dt);

    let desiredPos: THREE.Vector3, desiredLook: THREE.Vector3;
    if (lookback) {
      desiredPos = root.position.clone().addScaledVector(fwd, p.spec.dims.length * 0.5 + 0.5).addScaledVector(up, h + 0.6);
      desiredLook = root.position.clone().addScaledVector(fwd, -30).addScaledVector(up, 1);
      this.pos.copy(desiredPos); this.look.copy(desiredLook);
    } else if (this.mode === 'hood') {
      const off = bike ? new THREE.Vector3(0, 1.45, -0.1) : new THREE.Vector3(0, h * 0.82, p.spec.dims.length * 0.12);
      if (bike && p.model.bike) {
        // cockpit cam leans with the bike
        const lean = p.model.bike.lean.rotation.z;
        off.set(-Math.sin(lean) * 1.3, Math.cos(lean) * 1.3 + 0.15, 0.05);
      }
      desiredPos = off.applyQuaternion(q).add(root.position);
      desiredLook = desiredPos.clone().addScaledVector(fwd, 20).addScaledVector(up, -0.4);
      this.pos.copy(desiredPos);
      this.look.copy(desiredLook);
    } else {
      const dist = (bike ? 4.2 : 5.2 + p.spec.dims.length * 0.3) + clamp(spd / 80, 0, 1) * 1.6;
      const height = (bike ? 1.7 : 1.5 + h * 0.55);
      desiredPos = root.position.clone().addScaledVector(cf, -dist).addScaledVector(up, height);
      desiredLook = root.position.clone().addScaledVector(cf, 6).addScaledVector(up, bike ? 0.9 : h * 0.6);
      if (!this.init) { this.pos.copy(desiredPos); this.look.copy(desiredLook); }
      this.pos.lerp(desiredPos, 1 - Math.exp(-dt * 12));
      this.look.lerp(desiredLook, 1 - Math.exp(-dt * 16));
    }
    this.init = true;
    // shake: constant speed rumble + events
    const rumble = clamp((spd - 30) / 60, 0, 1) * 0.03 + p.phys.wobble * 0.05 + (p.phys.onGrass ? 0.06 : 0);
    const s = rumble + this.shake * 0.25;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const n = (a: number) => Math.sin(this.t * a) * Math.sin(this.t * a * 0.37 + 1.3);
    this.cam.position.copy(this.pos).add(new THREE.Vector3(n(41) * s, n(37) * s, n(29) * s * 0.5));
    this.cam.up.set(0, 1, 0);
    if (bike && this.mode === 'chase' && p.model.bike) {
      const lean = p.model.bike.lean.rotation.z * 0.3;
      this.cam.up.set(Math.sin(-lean) * Math.cos(this.yaw) * -1, Math.cos(lean), Math.sin(-lean) * Math.sin(this.yaw)).normalize();
      this.cam.up.set(0, 1, 0).addScaledVector(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), -Math.sin(lean)).normalize();
    }
    if (bike && this.mode === 'hood' && p.model.bike) {
      const lean = p.model.bike.lean.rotation.z;
      this.cam.up.set(0, 1, 0).addScaledVector(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), -Math.sin(lean)).normalize();
    }
    this.cam.lookAt(this.look);
    this.cam.updateProjectionMatrix();
  }

  /** orbiting dramatic crash cam */
  crash(dt: number, focus: THREE.Vector3, angle: number, t: number, ground: number, side: number) {
    this.t += dt;
    const phase = t < 1.2 ? 0 : 1;
    const r = phase === 0 ? 7 : 9 + t * 0.6;
    const a = angle + side * t * (phase === 0 ? 0.25 : 0.45);
    const hgt = phase === 0 ? 1.1 : 2.5 + t * 0.4;
    const desired = new THREE.Vector3(focus.x + Math.sin(a) * r, Math.max(ground + 0.6, focus.y + hgt), focus.z + Math.cos(a) * r);
    this.pos.lerp(desired, 1 - Math.exp(-dt * 4));
    const s = this.shake * 0.3;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    this.cam.position.copy(this.pos).add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0));
    this.cam.up.set(0, 1, 0);
    this.cam.fov = damp(this.cam.fov, 50, 2, dt);
    this.cam.lookAt(focus);
    this.cam.updateProjectionMatrix();
  }
  snapCrash(focus: THREE.Vector3, angle: number) {
    this.pos.set(focus.x + Math.sin(angle) * 6, focus.y + 1.2, focus.z + Math.cos(angle) * 6);
  }
}
