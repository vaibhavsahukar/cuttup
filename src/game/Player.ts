import * as THREE from 'three';
import type { VehicleSpec } from '../data/vehicles';
import { VehiclePhysics, type Controls } from '../physics/VehiclePhysics';
import { buildPlayerModel } from '../vehicles/Factory';
import type { VehicleModel } from '../vehicles/ModelKit';
import type { RoadPath, Frame } from '../world/RoadPath';
import { MAT } from '../vehicles/Materials';
import { clamp, damp } from '../core/math';

const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 };
const eul = new THREE.Euler(0, 0, 0, 'YXZ');
const X = new THREE.Vector3(1, 0, 0);

/** The player's vehicle: physics state + procedural model + visual suspension. */
export class Player {
  phys: VehiclePhysics;
  model: VehicleModel;
  headlight?: THREE.SpotLight;
  roll = 0; pitch = 0;
  worldVel = new THREE.Vector3();
  private lastPos = new THREE.Vector3();
  collW: number; collL: number;
  topSpeed = 0;

  constructor(public spec: VehicleSpec, public path: RoadPath, night: boolean, shadows: boolean) {
    this.phys = new VehiclePhysics(spec);
    this.model = buildPlayerModel(spec, shadows);
    this.collW = spec.kind === 'bike' ? 0.62 : spec.dims.width * 0.96;
    this.collL = spec.kind === 'bike' ? spec.dims.length * 0.95 : spec.dims.length * 0.97;
    if (night) {
      const h = new THREE.SpotLight(0xfff2dd, night ? 500 : 250, 120, 0.42, 0.5, 2);
      h.position.set(0, 0.8, spec.dims.length / 2);
      h.target.position.set(0, 0, spec.dims.length / 2 + 30);
      h.castShadow = false;
      this.model.root.add(h, h.target);
      this.headlight = h;
    }
  }

  get bike() { return this.spec.kind === 'bike'; }

  step(dt: number, c: Controls) {
    const f = this.path.frame(this.phys.s, fr);
    this.phys.step(dt, c, f.k, f.grade);
  }

  /** update model transform & visual details */
  sync(dt: number) {
    const p = this.phys;
    this.path.frame(p.s, fr);
    const pos = this.path.toWorld(p.s, p.d, 0, this.model.root.position, fr);
    // analytic world velocity from the body-frame state (robust to teleports / resets)
    const phi = fr.heading + p.psi;
    const fx = Math.sin(phi), fz = Math.cos(phi); // forward
    const lx = Math.cos(phi), lz = -Math.sin(phi); // left
    this.worldVel.set(fx * p.v + lx * p.vl, fr.grade * p.v, fz * p.v + lz * p.vl);
    this.lastPos.copy(pos);
    eul.set(-Math.atan(fr.grade) * Math.cos(p.psi), fr.heading + p.psi, 0);
    this.model.root.quaternion.setFromEuler(eul);
    const sp = this.spec;
    if (this.bike && this.model.bike) {
      this.model.bike.lean.rotation.z = -p.lean; // lean into the turn (+ lean = left)
      // wheelie / stoppie pivots around the rear or front contact patch
      const piv = p.wheelie >= 0 ? -sp.wheelbase / 2 : sp.wheelbase / 2;
      const c = new THREE.Vector3(0, 0, piv);
      const ch = this.model.chassis;
      ch.rotation.x = -p.wheelie;
      ch.position.copy(c).sub(c.clone().applyAxisAngle(X, -p.wheelie));
      // high speed wobble shows in the bars / rider
      ch.rotation.y = Math.sin(performance.now() * 0.03) * 0.012 * p.wobble;
      // rider hangs off a little into corners
      const r = this.model.bike.rider;
      r.root.position.x = damp(r.root.position.x, p.lean * 0.12, 6, dt);
      r.torso.rotation.z = damp(r.torso.rotation.z, -p.lean * 0.3, 6, dt);
      this.model.wheels[0].spin.rotation.x = p.frontRot;
      this.model.wheels[1].spin.rotation.x = p.rearRot;
    } else {
      this.roll = damp(this.roll, clamp(p.ay / 9.81, -1.3, 1.3) * sp.rollFactor, 7, dt);
      this.pitch = damp(this.pitch, clamp(p.ax / 9.81, -1.3, 1.3) * sp.pitchFactor, 7, dt);
      this.model.chassis.rotation.set(-this.pitch, 0, this.roll);
      this.model.chassis.position.y = Math.abs(this.roll) * 0.2;
      for (const w of this.model.wheels) {
        w.spin.rotation.x = w.front ? p.frontRot : p.rearRot;
        if (w.front) w.obj.rotation.y = p.steerAngle * 1.1;
      }
    }
    const braking = p.brake > 0.1 || (p.v < 0.3 && p.throttle === 0);
    for (const b of this.model.brake) b.material = braking ? MAT.tailOn : MAT.tailOff;
    this.topSpeed = Math.max(this.topSpeed, p.v);
  }
}
