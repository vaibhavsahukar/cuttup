import * as THREE from 'three';
import type { Player } from './Player';
import { clamp, damp } from '../core/math';

const tmpD = new THREE.Vector3();

/** Chase cam (speed FOV, shake, lag), hood / cockpit cam, look-back, and cinematic crash orbit. */
export class CameraRig {
  mode: 'chase' | 'hood' = 'chase';
  shake = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yaw = 0;
  private lookYaw = 0; // smoothed free look angle (+ = camera swings to the right)
  private init = false;
  private t = 0;

  constructor(public cam: THREE.PerspectiveCamera) {}

  reset() { this.init = false; this.shake = 0; }
  addShake(v: number) { this.shake = Math.min(1.5, this.shake + v); }

  /** `look`: free look angle in radians, + = right (side keys, right stick); `lookback` swings the view to the rear */
  update(dt: number, p: Player, lookback: boolean, look = 0) {
    this.t += dt;
    this.lookYaw = damp(this.lookYaw, look, 9, dt);
    const lk = this.lookYaw;
    if (p.model.bike?.rider) p.model.bike.rider.head.visible = this.mode !== 'hood' || lookback;
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
    const targetFov = (this.mode === 'hood' ? 70 : 60) + clamp(spd / 80, 0, 1) ** 1.3 * 12;
    this.cam.fov = damp(this.cam.fov, targetFov, 3, dt);

    let desiredPos: THREE.Vector3, desiredLook: THREE.Vector3;
    if (lookback) {
      desiredPos = root.position.clone().addScaledVector(fwd, p.spec.dims.length * 0.5 + 0.5).addScaledVector(up, h + 0.6);
      desiredLook = root.position.clone().addScaledVector(fwd, -30).addScaledVector(up, 1);
      this.pos.copy(desiredPos); this.look.copy(desiredLook);
    } else if (this.mode === 'hood') {
      const off = bike ? new THREE.Vector3(0, 1.42, 0.45) : new THREE.Vector3(0, h * 0.82, p.spec.dims.length * 0.12);
      if (bike && p.model.bike) {
        // cockpit cam (just in front of the helmet) leans with the bike
        off.set(0, 1.25, 0.35); // camera stays level; the bike leans, the view does not
      }
      desiredPos = off.applyQuaternion(q).add(root.position);
      // the head turns towards the look direction
      desiredLook = desiredPos.clone().addScaledVector(fwd.clone().applyAxisAngle(up, -lk), 20).addScaledVector(up, -0.4);
      this.pos.copy(desiredPos);
      this.look.copy(desiredLook);
    } else {
      const dist = (bike ? 3.1 : 3.6 + p.spec.dims.length * 0.22) + clamp(spd / 80, 0, 1) * 0.3; // close, barely pulls back with speed
      const height = (bike ? 1.35 : 1.1 + h * 0.45);
      // free look orbits the camera around the vehicle so the view turns to the right when lk > 0 (the camera swings
      // round to the vehicle's left), and the view settles on the vehicle itself
      const cfo = lk === 0 ? cf : cf.clone().applyAxisAngle(up, -lk);
      const focus = 6 * (1 - clamp(Math.abs(lk) / 0.6, 0, 1));
      desiredPos = root.position.clone().addScaledVector(cfo, -dist).addScaledVector(up, height);
      desiredLook = root.position.clone().addScaledVector(cf, focus).addScaledVector(up, bike ? 0.9 : h * 0.6);
      if (!this.init) { this.pos.copy(desiredPos); this.look.copy(desiredLook); }
      // Follow rigidly along the driving direction and smooth only sideways / up. Lagging along the direction of
      // travel turns any uneven frame time into the car lurching towards and away from the camera (a long frame
      // moves the car a metre or more while the camera only catches part of it up), which looks like the car
      // shaking forwards and backwards. Rigid means the car sits at the same distance in every frame.
      this.follow(this.pos, desiredPos, cf, 1 - Math.exp(-dt * 20));
      this.follow(this.look, desiredLook, cf, 1 - Math.exp(-dt * 16));
    }
    this.init = true;
    // Shake is small, slow and applied sideways / up in camera space. (A fast speed rumble in world axes made
    // the whole car look like it was juddering forwards and backwards at speed, so there is none.)
    // Off-road rumble grows with speed and is zero when stationary.
    const rumble = p.phys.wobble * 0.02 + (p.phys.onGrass ? clamp(spd / 45, 0, 1.4) * 0.07 : 0);
    const s = rumble + this.shake * 0.06;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const n = (a: number) => Math.sin(this.t * a) * Math.sin(this.t * a * 0.37 + 1.3);
    this.cam.position.copy(this.pos);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.look);
    this.cam.translateX(n(19) * s); this.cam.translateY(n(15) * s);
    this.cam.updateProjectionMatrix();
  }

  /** move `cur` to `target`: exactly along `fwd`, eased across the other axes */
  private follow(cur: THREE.Vector3, target: THREE.Vector3, fwd: THREE.Vector3, k: number) {
    const d = tmpD.copy(target).sub(cur);
    const along = d.dot(fwd);
    cur.addScaledVector(fwd, along);
    d.addScaledVector(fwd, -along);
    cur.addScaledVector(d, k);
  }

  /** orbiting dramatic crash cam */
  crash(dt: number, focus: THREE.Vector3, angle: number, t: number, ground: number, side: number) {
    this.t += dt;
    // the wreck tumbles and bounces; the camera follows a smoothed copy of it, not the raw body
    this.focus.lerp(focus, 1 - Math.exp(-dt * 5));
    const phase = t < 1.2 ? 0 : 1;
    const r = phase === 0 ? 7 : 9 + t * 0.6;
    const a = angle + side * t * (phase === 0 ? 0.25 : 0.45);
    const hgt = phase === 0 ? 1.1 : 2.5 + t * 0.4;
    const f = this.focus;
    const desired = new THREE.Vector3(f.x + Math.sin(a) * r, Math.max(ground + 0.6, f.y + hgt), f.z + Math.cos(a) * r);
    this.pos.lerp(desired, 1 - Math.exp(-dt * 2.5));
    // impact shake: one slow, quickly fading sway (no per-frame random noise)
    const s = this.shake * 0.12;
    this.shake = Math.max(0, this.shake - dt * 1.2);
    this.cam.position.copy(this.pos);
    this.cam.up.set(0, 1, 0);
    this.cam.fov = damp(this.cam.fov, 50, 2, dt);
    this.cam.lookAt(f);
    this.cam.translateX(Math.sin(this.t * 7) * s); this.cam.translateY(Math.sin(this.t * 5 + 1) * s * 0.7);
    this.cam.updateProjectionMatrix();
  }
  /** smoothed point the crash camera is looking at */
  focus = new THREE.Vector3();
  snapCrash(focus: THREE.Vector3, angle: number) {
    this.focus.copy(focus);
    this.pos.set(focus.x + Math.sin(angle) * 6, focus.y + 1.2, focus.z + Math.cos(angle) * 6);
  }
}
