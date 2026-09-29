import * as THREE from 'three';
import { RigidBody } from '../physics/RigidBody';
import type { Player } from './Player';
import type { Traffic, TrafficCar } from '../traffic/Traffic';
import type { Particles } from './Particles';
import { projectToRoad, type RoadPath } from '../world/RoadPath';
import type { VehicleModel } from '../vehicles/ModelKit';
import { paint, MAT } from '../vehicles/Materials';
import { clamp } from '../core/math';

export type CrashKind = 'car' | 'headon' | 'barrier' | 'tree' | 'lowside' | 'highside' | 'looped' | 'endo' | 'tipover';

interface Wreck { body: RigidBody; s: number; d: number; L: number; W: number; car?: TrafficCar }

/**
 * Cinematic crash: slow motion, camera orbit, rigid-body tumbling for the player and struck cars,
 * deformation, detached parts, debris / glass / sparks, rider ejection for bikes, traffic pile-ups.
 */
export class CrashScene {
  active = false;
  t = 0; // scene time (game time)
  real = 0; // real time since crash
  timeScale = 1;
  wrecks: Wreck[] = [];
  parts: RigidBody[] = [];
  riderBody?: RigidBody;
  rider?: VehicleModel['bike'];
  focus = new THREE.Vector3();
  camAngle = 0;
  camSide = 1;
  impactSpeed = 0;
  kind: CrashKind = 'car';
  flash = 0;
  private pileups = 0;

  /** lateral limits (barriers) that wrecks bounce off; null = open road edges */
  bounds: { min: number; max: number } | null = null;

  constructor(public scene: THREE.Scene, public path: RoadPath, public particles: Particles, public ground: (p: THREE.Vector3) => number) {
  }

  start(player: Player, kind: CrashKind, impactSpeed: number, hit: TrafficCar | null, traffic: Traffic, contact: THREE.Vector3) {
    this.active = true;
    this.t = 0; this.real = 0;
    this.kind = kind;
    this.impactSpeed = impactSpeed;
    this.camAngle = Math.random() * Math.PI * 2;
    this.camSide = Math.random() < 0.5 ? -1 : 1;
    this.flash = 1;
    const sev = clamp(impactSpeed / 30, 0.2, 1.6);
    const m = player.model;
    const spec = player.spec;

    // a bike's lean and wheelie / stoppie pitch live on child groups: bake them into the root so the
    // wreck starts from the pose it was in and can carry on tumbling (a loop-out flips all the way over)
    if (spec.kind === 'bike' && m.bike) {
      m.root.updateMatrixWorld(true);
      const bp = new THREE.Vector3(), bq = new THREE.Quaternion(), bs = new THREE.Vector3();
      m.chassis.matrixWorld.decompose(bp, bq, bs);
      m.bike.lean.rotation.set(0, 0, 0); m.chassis.position.set(0, 0, 0); m.chassis.rotation.set(0, 0, 0);
      m.root.position.copy(bp); m.root.quaternion.copy(bq);
      m.root.updateMatrixWorld(true);
    }

    // ---------- player body ----------
    const half = new THREE.Vector3(spec.dims.width / 2, spec.dims.height / 2 * 0.8, spec.dims.length / 2);
    const pb = new RigidBody(m.root, half, spec.massKg, new THREE.Vector3(0, half.y + 0.05, 0));
    pb.vel.copy(player.worldVel);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(pb.quat);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(pb.quat);
    if (hit) {
      // momentum exchange with the traffic car
      const hv = new THREE.Vector3().copy(this.carWorldVel(hit));
      const mT = hit.type === 'boxtruck' ? 7000 : hit.type === 'van' || hit.type === 'pickup' ? 2500 : 1500;
      const mP = spec.massKg;
      const vCom = pb.vel.clone().multiplyScalar(mP).addScaledVector(hv, mT).divideScalar(mP + mT);
      const pAfter = vCom.clone().lerp(pb.vel, 0.25);
      const tAfter = vCom.clone().lerp(hv, 0.3);
      pb.vel.copy(pAfter);
      const lat = contact.clone().sub(pb.pos).dot(side);
      pb.angVel.set(0, -lat * sev * 2.2 + (Math.random() - 0.5) * 2 * sev, 0);
      // struck car becomes a wreck
      const w = this.wreckCar(hit, traffic);
      w.body.vel.copy(tAfter).add(new THREE.Vector3(0, 1.5 * sev, 0));
      w.body.angVel.set((Math.random() - 0.5) * 2 * sev, (Math.random() - 0.5) * 3 * sev, (Math.random() - 0.5) * 2.5 * sev);
      this.deform(w.car!.model.body, contact, sev);
    } else {
      pb.vel.multiplyScalar(0.8);
      pb.angVel.set(0, (Math.random() - 0.5) * 3 * sev, 0);
    }
    // rider falls: how the bike goes down depends on how it fell
    if (!hit && (kind === 'lowside' || kind === 'highside' || kind === 'looped' || kind === 'endo' || kind === 'tipover')) {
      const lean = Math.sign(player.phys.lean) || 1;
      pb.vel.copy(player.worldVel).multiplyScalar(kind === 'tipover' ? 0.3 : 0.9);
      pb.angVel.set(0, 0, 0);
      if (kind === 'lowside') { pb.angVel.addScaledVector(fwd, lean * 3.2); pb.angVel.y = lean * 1.2; pb.vel.y += 0.6; }
      else if (kind === 'highside') { pb.angVel.addScaledVector(fwd, -lean * 5); pb.vel.y += 3.5 + sev * 2; pb.vel.addScaledVector(side, -lean * 2.5); }
      else if (kind === 'looped') { pb.angVel.addScaledVector(side, -Math.max(6, player.phys.pitchRate * 1.8)); pb.vel.y += 3.2; pb.vel.multiplyScalar(0.75); }
      else if (kind === 'endo') { pb.angVel.addScaledVector(side, Math.max(3.5, -player.phys.pitchRate * 1.3)); pb.vel.y += 2.5; }
      else { pb.angVel.addScaledVector(fwd, lean * 1.5); }
      pb.restitution = 0.25;
      this.wrecks.push({ body: pb, s: player.phys.s, d: player.phys.d, L: spec.dims.length, W: spec.dims.width });
      this.ejectRider(m, player, kind === 'tipover' ? 0.3 : sev);
      const bv0 = pb.vel.clone().multiplyScalar(0.6);
      this.particles.spark(contact, bv0, kind === 'tipover' ? 12 : Math.round(80 * sev + 30), 9);
      this.particles.debris(contact, bv0, Math.round(20 * sev + 6), spec.color, false, 0.2);
      this.focus.copy(pb.pos);
      return;
    }
    // tumble / roll scales with speed; tall vehicles and bikes roll easier
    const rollK = spec.kind === 'bike' ? 1.6 : spec.cgHeight > 0.6 ? 1.3 : 0.9;
    const big = impactSpeed > 18;
    pb.vel.y += (big ? 3 + Math.random() * 4 : 1) * sev * rollK;
    pb.angVel.addScaledVector(fwd, (Math.random() < 0.5 ? -1 : 1) * (big ? 2.5 + Math.random() * 3 : 0.8) * sev * rollK);
    pb.angVel.addScaledVector(side, (Math.random() - 0.5) * 2 * sev);
    pb.restitution = 0.3;
    this.wrecks.push({ body: pb, s: player.phys.s, d: player.phys.d, L: spec.dims.length, W: spec.dims.width });

    // ---------- deformation & detached parts ----------
    if (spec.kind === 'car') {
      this.deform(m.body, contact, sev);
      const pc = spec.color;
      if (sev > 0.35) this.detachPanel(m, 'hood', pc, pb.vel, sev);
      if (sev > 0.6) this.detachPanel(m, 'door', pc, pb.vel, sev);
      if (sev > 0.5) this.detachWheel(m, pb.vel, sev);
      if (sev > 0.9) this.detachWheel(m, pb.vel, sev);
      if (sev > 0.8) this.detachPanel(m, 'bumper', pc, pb.vel, sev);
    } else if (m.bike?.rider) {
      this.ejectRider(m, player, sev);
      if (sev > 0.4) this.detachWheel(m, pb.vel, sev);
    }

    // ---------- particles ----------
    const bv = pb.vel.clone().multiplyScalar(0.6);
    this.particles.spark(contact, bv, Math.round(80 * sev + 30), 9);
    this.particles.debris(contact, bv, Math.round(30 * sev + 10), spec.color, false, 0.22);
    this.particles.debris(contact, bv, Math.round(40 * sev + 10), 0x111111, false, 0.12);
    this.particles.debris(contact.clone().add(new THREE.Vector3(0, 0.8, 0)), bv, Math.round(60 * sev + 15), 0xffffff, true, 0.1);
    if (hit) this.particles.debris(contact, bv, Math.round(25 * sev), hit.model.color, false, 0.2);
    this.focus.copy(pb.pos);
  }

  private ejectRider(m: VehicleModel, player: Player, sev: number) {
    if (!m.bike?.rider) return;
    const r = m.bike.rider;
    r.root.updateMatrixWorld(true);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
    r.root.getWorldPosition(wp); r.root.getWorldQuaternion(wq);
    this.scene.add(r.root);
    r.root.position.copy(wp); r.root.quaternion.copy(wq);
    const rb = new RigidBody(r.root, new THREE.Vector3(0.25, 0.45, 0.25), 80, new THREE.Vector3(0, 0.35, 0));
    rb.vel.copy(player.worldVel).multiplyScalar(0.85).add(new THREE.Vector3(0, 4 + sev * 5, 0));
    rb.angVel.set((Math.random() - 0.5) * 8 * sev, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8 * sev);
    rb.restitution = 0.35; rb.friction = 0.5;
    this.riderBody = rb;
    this.rider = m.bike;
  }

  private carWorldVel(c: TrafficCar) {
    const f = this.path.frame(c.s);
    return new THREE.Vector3(Math.sin(f.heading), 0, Math.cos(f.heading)).multiplyScalar(c.v * c.dir);
  }

  private wreckCar(c: TrafficCar, traffic: Traffic): Wreck {
    traffic.materialize(c); // instanced traffic becomes a real object that can tumble and dent
    c.wrecked = true;
    c.braking = true;
    for (const b of c.model.brake) b.material = MAT.tailOn;
    const half = new THREE.Vector3(c.W / 2, 0.7, c.L / 2);
    const mass = c.type === 'boxtruck' ? 7000 : c.type === 'van' || c.type === 'pickup' ? 2500 : 1500;
    const body = new RigidBody(c.model.root, half, mass, new THREE.Vector3(0, 0.75, 0));
    body.vel.copy(this.carWorldVel(c));
    const w: Wreck = { body, s: c.s, d: c.d, L: c.L, W: c.W, car: c };
    this.wrecks.push(w);
    traffic.obstacles.push(w);
    return w;
  }

  /** push vertices near the contact point inward (local space) */
  private deform(mesh: THREE.Mesh, worldPoint: THREE.Vector3, sev: number) {
    if (!mesh.userData.deformed) { mesh.geometry = mesh.geometry.clone(); mesh.userData.deformed = true; }
    const g = mesh.geometry;
    const p = g.attributes.position as THREE.BufferAttribute;
    mesh.updateMatrixWorld(true);
    const local = mesh.worldToLocal(worldPoint.clone());
    local.y = Math.max(local.y, 0.5);
    const radius = 0.9 + sev * 0.6;
    const depth = 0.12 + sev * 0.28;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const dist = v.distanceTo(local);
      if (dist > radius) continue;
      const f = (1 - dist / radius) ** 2 * depth;
      const dir = new THREE.Vector3(-v.x * 0.5, -0.4, -v.z * 0.15).normalize();
      v.addScaledVector(dir, f);
      v.x += (Math.random() - 0.5) * f * 0.3;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
  }

  private detachPanel(m: VehicleModel, which: 'hood' | 'door' | 'bumper', color: number, baseVel: THREE.Vector3, sev: number) {
    const L = m.length, W = m.width;
    const geo = which === 'hood' ? new THREE.BoxGeometry(W * 0.75, 0.04, L * 0.28) : which === 'door' ? new THREE.BoxGeometry(0.05, 0.55, 1.1) : new THREE.BoxGeometry(W * 0.9, 0.3, 0.15);
    const mesh = new THREE.Mesh(geo, paint(color));
    mesh.castShadow = true;
    const local = which === 'hood' ? new THREE.Vector3(0, m.height * 0.65, L * 0.3) : which === 'door' ? new THREE.Vector3((Math.random() < 0.5 ? 1 : -1) * W * 0.5, 0.65, 0.2) : new THREE.Vector3(0, 0.35, L / 2);
    m.root.updateMatrixWorld(true);
    const wp = local.applyMatrix4(m.root.matrixWorld);
    mesh.position.copy(wp);
    m.root.getWorldQuaternion(mesh.quaternion);
    this.scene.add(mesh);
    const b = new RigidBody(mesh, new THREE.Vector3(...(which === 'hood' ? [W * 0.37, 0.03, L * 0.14] : which === 'door' ? [0.03, 0.27, 0.55] : [W * 0.45, 0.15, 0.08]) as [number, number, number]), 25);
    b.vel.copy(baseVel).multiplyScalar(0.8).add(new THREE.Vector3((Math.random() - 0.5) * 6, 5 + Math.random() * 6 * sev, (Math.random() - 0.5) * 6));
    b.angVel.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
    b.restitution = 0.35;
    this.parts.push(b);
  }

  private detachWheel(m: VehicleModel, baseVel: THREE.Vector3, sev: number) {
    const w = m.wheels.find((x) => x.obj.parent && !x.obj.userData.detached);
    if (!w) return;
    w.obj.userData.detached = true;
    w.obj.updateMatrixWorld(true);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
    w.obj.getWorldPosition(wp); w.obj.getWorldQuaternion(wq);
    this.scene.add(w.obj);
    w.obj.position.copy(wp); w.obj.quaternion.copy(wq);
    const b = new RigidBody(w.obj, new THREE.Vector3(0.14, w.radius, w.radius), 22);
    b.vel.copy(baseVel).add(new THREE.Vector3((Math.random() - 0.5) * 8, 3 + Math.random() * 4 * sev, (Math.random() - 0.5) * 4));
    b.angVel.set(15 + Math.random() * 10, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
    b.restitution = 0.5; b.friction = 0.3;
    this.parts.push(b);
  }

  update(dt: number, traffic: Traffic) {
    this.t += dt;
    const sub = 4;
    for (let i = 0; i < sub; i++) {
      for (const w of this.wrecks) w.body.step(dt / sub, this.ground);
      for (const p of this.parts) p.step(dt / sub, this.ground);
      this.riderBody?.step(dt / sub, this.ground);
    }
    for (const w of this.wrecks) {
      const pr = projectToRoad(this.path, w.body.pos, w.s);
      w.s = pr.s; w.d = pr.d;
      this.barrier(w.body, pr.s, pr.d, Math.max(w.W, 1) / 2);
      w.body.sync();
      // sparks while scraping along the tarmac
      if (w.body.vel.lengthSq() > 25 && w.body.pos.y - this.ground(w.body.pos) < 0.9 && Math.random() < 0.5) this.particles.spark(w.body.pos.clone().setY(this.ground(w.body.pos) + 0.05), w.body.vel, 3, 3);
    }
    for (const p of this.parts) { const pr = projectToRoad(this.path, p.pos, this.wrecks[0]?.s ?? 0); this.barrier(p, pr.s, pr.d, 0.3); p.sync(); }
    if (this.riderBody && this.rider) {
      const pr = projectToRoad(this.path, this.riderBody.pos, this.wrecks[0]?.s ?? 0);
      this.barrier(this.riderBody, pr.s, pr.d, 0.3);
      this.riderBody.sync();
      // flailing limbs, calming down as the body slows
      const e = Math.min(1, this.riderBody.angVel.length() / 6 + this.riderBody.vel.length() / 15);
      const tt = this.t * 9;
      const r = this.rider.rider!;
      r.armL.rotation.set(Math.sin(tt) * 1.5 * e - 1.5, 0, 0.6 + Math.sin(tt * 1.3) * e);
      r.armR.rotation.set(Math.cos(tt * 1.1) * 1.5 * e - 1.5, 0, -0.6 - Math.cos(tt) * e);
      r.legL.rotation.set(Math.sin(tt * 0.8) * 1.0 * e - 0.4, 0, 0.3);
      r.legR.rotation.set(Math.cos(tt * 0.9) * 1.0 * e - 0.4, 0, -0.3);
      r.torso.rotation.x = 0.2 + Math.sin(tt * 0.5) * 0.4 * e;
    }
    // pile-ups: traffic cars that plough into a wreck become wrecks too
    for (const c of traffic.cars) {
      if (c.wrecked || !c.alive || this.pileups > 6) continue;
      for (const w of this.wrecks) {
        if (w.car === c) continue;
        const ds = Math.abs(c.s - w.s), dd = Math.abs(c.d - w.d);
        if (ds < (c.L + w.L) / 2 - 0.3 && dd < (c.W + w.W) / 2 - 0.2 && c.v > 3) {
          const vRel = c.v;
          const nw = this.wreckCar(c, traffic);
          nw.body.angVel.set(0, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.8);
          w.body.applyImpulse(this.carWorldVel(c).multiplyScalar(900), nw.body.pos);
          const cp = nw.body.pos.clone().lerp(w.body.pos, 0.5);
          this.particles.spark(cp, nw.body.vel, 40, 6);
          this.particles.debris(cp, nw.body.vel, 20, c.model.color, false, 0.18);
          this.particles.debris(cp, nw.body.vel, 20, 0xffffff, true, 0.1);
          this.deform(c.model.body, cp, clamp(vRel / 30, 0.2, 1));
          this.pileups++;
          this.onPileup?.(vRel);
          break;
        }
      }
    }
    // camera focus follows the player's wreck (or the rider)
    const target = this.riderBody && this.t > 0.4 ? this.riderBody.pos.clone().lerp(this.wrecks[0].body.pos, 0.5) : this.wrecks[0].body.pos;
    this.focus.lerp(target, 1 - Math.exp(-dt * 6));
    this.flash = Math.max(0, this.flash - dt * 3);
  }
  onPileup: ((v: number) => void) | null = null;

  /** keep bodies on the carriageway: bounce off the median barrier / sound wall */
  private barrier(b: RigidBody, s: number, d: number, half: number) {
    if (!this.bounds) return;
    const lo = this.bounds.min + half, hi = this.bounds.max - half;
    if (d >= lo && d <= hi) return;
    const f = this.path.frame(s);
    const R = new THREE.Vector3(-Math.cos(f.heading), 0, Math.sin(f.heading));
    const pen = d < lo ? lo - d : hi - d;
    b.pos.addScaledVector(R, pen);
    const vn = b.vel.dot(R);
    if ((d < lo && vn < 0) || (d > hi && vn > 0)) {
      b.vel.addScaledVector(R, -vn * 1.35);
      b.angVel.y += (Math.random() - 0.5) * Math.abs(vn) * 0.3;
      if (Math.abs(vn) > 4) this.particles.spark(b.pos.clone(), b.vel, 12, 4);
    }
  }

  /** real-time driven time-scale curve: fast ramp into slow motion, then ease back */
  updateTimeScale(realDt: number) {
    this.real += realDt;
    const r = this.real;
    this.timeScale = r < 0.25 ? 1 - (r / 0.25) * 0.82 : r < 2.6 ? 0.18 : Math.min(0.75, 0.18 + (r - 2.6) * 0.35);
    return this.timeScale;
  }

  clear() {
    for (const p of this.parts) this.scene.remove(p.obj);
    if (this.rider?.rider) this.scene.remove(this.rider.rider.root);
    this.parts = [];
    this.wrecks = [];
    this.riderBody = undefined;
    this.rider = undefined;
    this.active = false;
    this.pileups = 0;
  }
}
