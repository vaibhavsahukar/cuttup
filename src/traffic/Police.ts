import * as THREE from 'three';
import type { Traffic, TrafficCar, PlayerProxy } from './Traffic';
import { DRIVERS } from './Traffic';
import { buildTrafficModel, trafficDims } from '../vehicles/Factory';
import { paintLite } from '../vehicles/Materials';
import type { Layout, MapSpec } from '../data/maps';
import { RigidBody } from '../physics/RigidBody';
import { projectToRoad, type RoadPath } from '../world/RoadPath';
import type { Particles } from '../game/Particles';
import { clamp } from '../core/math';

/** Score thresholds -> number of pursuing police cars. */
export const POLICE_TIERS: [number, number][] = [[15000, 1], [30000, 2], [50000, 3], [100000, 5]];
export function copsForScore(score: number) {
  let n = 0;
  for (const [s, c] of POLICE_TIERS) if (score >= s) n = c;
  return n;
}

const redOn = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 4 });
const blueOn = new THREE.MeshStandardMaterial({ color: 0x2040ff, emissive: 0x0030ff, emissiveIntensity: 4 });
const lampOff = new THREE.MeshStandardMaterial({ color: 0x222228, emissive: 0x000000 });

interface Cop { car: TrafficCar; red: THREE.Mesh; blue: THREE.Mesh; skill: number; laneT: number; stuckT: number }
interface Wreck { car: TrafficCar; body: RigidBody; age: number }

/**
 * Police pursuit. Cops are TrafficCar entries (so traffic brakes for them and the player's
 * collision / crash code treats them like any car) but are driven here: they chase at speed,
 * weave around traffic, and aim to ram the player. They are skilled, not perfect: a late
 * dodge can put them into a car, which wrecks both, and a replacement is dispatched.
 */
export class Police {
  cops: Cop[] = [];
  wrecks: Wreck[] = [];
  private respawnT = 0;
  private time = 0;
  wanted = 0;
  onWreck: ((intensity: number) => void) | null = null;
  onDispatch: ((n: number) => void) | null = null;

  constructor(public traffic: Traffic, public path: RoadPath, public map: MapSpec, public layout: Layout, public particles: Particles, public ground: (p: THREE.Vector3) => number) {}

  get sirenLevel() {
    return this.cops.length;
  }

  private spawn(player: PlayerProxy) {
    const dims = trafficDims('sedan');
    const model = buildTrafficModel('sedan', 0x101114, false);
    // livery: white doors, roof light bar
    const white = paintLite(0xf2f2f2);
    const side = new THREE.BoxGeometry(0.03, 0.42, 1.9);
    for (const sx of [1, -1]) {
      const m = new THREE.Mesh(side, white);
      m.position.set(sx * (dims.width / 2 + 0.005), 0.62, 0.1);
      model.chassis.add(m);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.28), lampOff);
    bar.position.set(0, dims.height + 0.06, -0.1);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.24), redOn);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.24), blueOn);
    red.position.set(0.27, dims.height + 0.08, -0.1);
    blue.position.set(-0.27, dims.height + 0.08, -0.1);
    model.chassis.add(bar, red, blue);
    this.traffic.root.add(model.root);
    // enter from behind, out of view, in a free lane near the player
    const lanes = this.layout.lanes;
    let lane = 0, best = 1e9;
    for (let l = 0; l < lanes; l++) { const dd = Math.abs(this.layout.laneCenter(l) - player.d); if (dd < best) { best = dd; lane = l; } }
    const car: TrafficCar = {
      id: -Math.floor(Math.random() * 1e9), type: 'sedan', model, L: dims.length, W: dims.width, dir: 1,
      s: player.s - 140 - Math.random() * 40, d: this.layout.laneCenter(lane), v: Math.max(20, player.v + 8), v0: 90, acc: 0,
      lane, targetLane: lane, lcT: 1, lcDur: 1, dFrom: 0, signal: 0, signalT: 0, pendingLane: -1,
      driver: 'fast', p: DRIVERS.fast, decideT: 0, wander: 0, wanderPhase: 0, swerve: 0, swerveTarget: 0,
      panicT: 0, freezeT: 0, honkCd: 0, braking: false, wrecked: false, yaw: 0, passedSign: 0, nearMissed: true, alive: true, cop: true,
    };
    this.traffic.cars.push(car);
    this.cops.push({ car, red, blue, skill: 0.75 + Math.random() * 0.2, laneT: 0, stuckT: 0 });
    this.onDispatch?.(this.cops.length);
  }

  update(dt: number, player: PlayerProxy, playerVl: number, score: number, active: boolean) {
    this.time += dt;
    this.wanted = copsForScore(score);
    // drop cops that despawned (outrun) or wrecked
    this.cops = this.cops.filter((c) => c.car.alive && !c.car.wrecked);
    if (active && this.cops.length < this.wanted) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) { this.spawn(player); this.respawnT = 3.5; }
    }
    const hw = this.map.road === 'highway';
    const dMin = (hw ? this.layout.playerMin : this.layout.softMin) + 1.1;
    const dMax = (hw ? this.layout.playerMax : this.layout.softMax) - 1.1;
    for (const cop of this.cops) this.drive(cop, dt, player, playerVl, dMin, dMax);
    this.collisions();
    this.updateWrecks(dt, player);
    // light bar flash
    const phase = Math.floor(this.time * 7) % 4;
    for (const c of this.cops) { c.red.material = phase < 2 ? redOn : lampOff; c.blue.material = phase >= 2 ? blueOn : lampOff; }
  }

  private drive(cop: Cop, dt: number, pl: PlayerProxy, playerVl: number, dMin: number, dMax: number) {
    const c = cop.car;
    const rel = pl.s - c.s; // + = player ahead
    const vMax = 88;
    // longitudinal: catch up fast, then close in to ram
    let vT = rel > 40 ? pl.v + 14 + rel * 0.06 : rel > 6 ? pl.v + 6 : rel > -4 ? pl.v + 3 : pl.v - 6;
    vT = clamp(vT, 0, vMax);
    // curve speed (cops brake for bends a bit later than traffic)
    let kMax = 0;
    for (const la of [25, 60]) kMax = Math.max(kMax, Math.abs(this.path.frame(c.s + la).k));
    vT = Math.min(vT, Math.sqrt(4.5 / Math.max(1e-5, kMax)));
    // lateral: aim at the player (with lead) when close, otherwise pick the clearest line
    const lead = clamp(rel / Math.max(5, c.v - pl.v + 5), 0, 1.2);
    let dT = rel < 35 ? pl.d + playerVl * lead * 0.6 : pl.d;
    // obstacle scan ahead in the cop's path
    const look = 12 + c.v * 1.1 * cop.skill;
    const blocked = (d: number) => {
      let g = 1e9, v = 0;
      for (const o of this.traffic.cars) {
        if (o === c || !o.alive || o.dir !== 1 || o.cop) continue;
        if (Math.abs(o.d - d) > (o.W + c.W) / 2 + 0.3) continue;
        const gap = o.s - c.s - (o.L + c.L) / 2;
        if (gap > -1 && gap < g) { g = gap; v = o.v; }
      }
      for (const o of this.traffic.obstacles) {
        if (o === c) continue;
        if (Math.abs(o.d - d) > (o.W + c.W) / 2 + 0.3) continue;
        const gap = o.s - c.s - (o.L + c.L) / 2;
        if (gap > -1 && gap < g) { g = gap; v = 0; }
      }
      return { g, v };
    };
    const here = blocked(c.d);
    const toPlayer = Math.abs(rel) < 12 && Math.abs(pl.d - c.d) < 3.5; // committed to the ram
    if (here.g < look && !toPlayer) {
      // find the nearest lateral line that is open far enough ahead
      let bestD = c.d, bestScore = -1e9;
      for (let d = dMin; d <= dMax + 0.01; d += 0.9) {
        const b = blocked(d);
        const sc = Math.min(b.g, look * 2) + b.v * 0.5 - Math.abs(d - c.d) * 0.8 - Math.abs(d - dT) * 0.15;
        if (sc > bestScore) { bestScore = sc; bestD = d; }
      }
      dT = bestD;
      // only slow down when the car directly ahead is close and the escape line is not yet reached
      if (here.g < 10 + c.v * 0.25 && Math.abs(bestD - c.d) > 1) vT = Math.min(vT, here.v + here.g * 0.6);
    }
    dT = clamp(dT, dMin, dMax);
    // actuate with skill-limited rates (this is where imperfect cops make mistakes)
    const acc = clamp((vT - c.v) * 2, -9, 7 * cop.skill);
    c.acc = acc;
    c.v = Math.max(0, c.v + acc * dt);
    c.braking = acc < -1;
    c.s += c.v * dt;
    const latRate = (4 + 5 * cop.skill) * clamp(c.v / 20, 0.4, 1);
    const dd = clamp(dT - c.d, -latRate * dt, latRate * dt);
    c.yaw = Math.atan2(-dd / Math.max(dt, 1e-3), Math.max(3, c.v)) * 0.8;
    c.d += dd;
    c.lane = 0; c.targetLane = 0; c.lcT = 1;
  }

  /** cop vs traffic: hard hits wreck both (and a new cop gets dispatched) */
  private collisions() {
    for (const cop of this.cops) {
      const c = cop.car;
      if (c.wrecked) continue;
      for (const o of this.traffic.cars) {
        if (o === c || !o.alive || o.wrecked) continue;
        if (Math.abs(o.s - c.s) > (o.L + c.L) / 2 - 0.1 || Math.abs(o.d - c.d) > (o.W + c.W) / 2 - 0.05) continue;
        const rv = Math.abs(c.v - o.v * o.dir);
        if (rv > 6 || o.dir < 0) {
          const pc = new THREE.Vector3();
          this.path.toWorld((c.s + o.s) / 2, (c.d + o.d) / 2, 0.6, pc);
          this.wreck(c, 1, o, pc);
          this.wreck(o, 0.6, c, pc);
          this.particles.spark(pc, new THREE.Vector3(), 50, 7);
          this.particles.debris(pc, new THREE.Vector3(), 25, 0x111111, false, 0.16);
          this.particles.debris(pc, new THREE.Vector3(), 25, 0xffffff, true, 0.1);
          this.onWreck?.(clamp(rv / 30, 0.2, 0.8));
          this.respawnT = Math.max(this.respawnT, 4);
          break;
        } else {
          // scrape past: nudge apart
          const sg = Math.sign(c.d - o.d) || 1;
          c.d += sg * 0.3; c.v *= 0.97;
        }
      }
    }
  }

  private wreck(car: TrafficCar, sev: number, other: TrafficCar, at: THREE.Vector3) {
    if (car.wrecked) return;
    car.wrecked = true;
    const body = new RigidBody(car.model.root, new THREE.Vector3(car.W / 2, 0.7, car.L / 2), car.type === 'boxtruck' ? 7000 : 1600, new THREE.Vector3(0, 0.75, 0));
    const f = this.path.frame(car.s);
    const fwd = new THREE.Vector3(Math.sin(f.heading), 0, Math.cos(f.heading));
    const ov = other.v * other.dir, mv = car.v * car.dir;
    body.vel.copy(fwd).multiplyScalar(mv * 0.5 + ov * 0.4);
    body.vel.y = 2 + sev * 4;
    body.angVel.set((Math.random() - 0.5) * 4 * sev, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5 * sev);
    body.applyImpulse(new THREE.Vector3(), at);
    this.wrecks.push({ car, body, age: 0 });
    this.traffic.obstacles.push(car);
  }

  private updateWrecks(dt: number, pl: PlayerProxy) {
    for (const w of this.wrecks) {
      w.age += dt;
      for (let i = 0; i < 3; i++) w.body.step(dt / 3, this.ground);
      w.body.sync();
      const pr = projectToRoad(this.path, w.body.pos, w.car.s);
      w.car.s = pr.s; w.car.d = pr.d;
      if (w.age > 3 && pl.s - w.car.s > 300) { this.traffic.release(w.car); w.age = -1; }
    }
    this.wrecks = this.wrecks.filter((w) => w.age >= 0);
  }

  /** nearest cop distance (m), Infinity if none */
  nearest(ps: number) {
    let d = Infinity;
    for (const c of this.cops) d = Math.min(d, Math.abs(c.car.s - ps));
    return d;
  }

  clear() {
    this.wrecks = [];
    this.cops = [];
  }
}
