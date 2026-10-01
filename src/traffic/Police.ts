import * as THREE from 'three';
import type { Traffic, TrafficCar, PlayerProxy } from './Traffic';
import { DRIVERS } from './Traffic';
import { buildCopModel, copDims, type CopType } from '../vehicles/Factory';
import type { Layout, MapSpec } from '../data/maps';
import { RigidBody } from '../physics/RigidBody';
import { projectToRoad, type RoadPath } from '../world/RoadPath';
import type { Particles } from '../game/Particles';
import { clamp } from '../core/math';
import { MAT } from '../vehicles/Materials';
import { difficultyOf, type Difficulty } from '../data/difficulty';

/** Score thresholds -> number of pursuing police cars. */
export const POLICE_TIERS: [number, number][] = [[5000, 1], [10000, 2], [15000, 3], [20000, 4], [25000, 5]];
export function copsForScore(score: number) {
  let n = 0;
  for (const [s, c] of POLICE_TIERS) if (score >= s) n = c;
  return n;
}

interface Cop { car: TrafficCar; red: THREE.Mesh; blue: THREE.Mesh; skill: number; vMax: number; charger: boolean; moto: boolean; dSm: number; laneT: number; stuckT: number; slot: number }
/** where each cop in the pack aims relative to the player until it closes in (fans out instead of queueing in one line) */
const SLOT_OFFSET = [0, -2.7, 2.7, -5.4, 5.4];
/** how far a cop is behind the player (m) */
const pl_rel = (cop: { car: TrafficCar }, player: PlayerProxy) => player.s - cop.car.s;
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
  diff: Difficulty = difficultyOf(1);
  /** seconds since a cop was last close (inside the vignette range) while wanted */
  awayT = 0;
  /** the star level that was shaken off: no wanted level until the score earns a higher one */
  clearedTier = 0;
  /** the player has been clear of the police long enough for the stars to flash */
  get fleeing() { return this.wanted > 0 && this.awayT >= Police.OUTRUN_FLASH_AFTER; }
  onCleared: (() => void) | null = null;
  onWreck: ((intensity: number) => void) | null = null;
  onDispatch: ((n: number, charger: boolean, moto: boolean) => void) | null = null;

  constructor(public traffic: Traffic, public path: RoadPath, public map: MapSpec, public layout: Layout, public particles: Particles, public ground: (p: THREE.Vector3) => number) {}

  get sirenLevel() {
    return this.cops.length;
  }

  /** Dodge Charger pursuit units only join at higher heat, and are faster and sharper */
  static CHARGER_FROM = 50000;
  static MOTO_FROM = 10000;
  /** at most this many police units are on the road at once */
  static MAX_COPS = 5;
  /** a cop closer than this (m) counts as near: the red vignette, and it resets the outrun timer */
  static NEAR = 150;
  /** a full minute without a cop getting near, the stars start to flash; 30 s later the wanted level is gone */
  static OUTRUN_FLASH_AFTER = 60;
  static OUTRUN_CLEAR_AFTER = 90;
  /** the motorcycle unit only chases riders */
  playerIsBike = false;
  private spawn(player: PlayerProxy, score: number) {
    // a motorcycle rider is also chased by one police motorcycle (from 10,000 points; never more than one at a time)
    const moto = this.playerIsBike && score >= Police.MOTO_FROM && !this.cops.some((c) => c.moto);
    const charger = !moto && score >= Police.CHARGER_FROM && Math.random() < (score >= 100000 ? 0.7 : 0.5);
    const type: CopType = charger ? 'cop_charger' : moto ? 'cop_moto' : 'cop_basic';
    const dims = copDims(type);
    // top speeds (m/s): the patrol car is slower than a CCR650R (135 mph), the police motorcycle about level with it,
    // the Conquette interceptor is the fast one and is also allowed to close up on a faster player
    const vTop = charger ? 95 : moto ? 58 : 55;
    const model = buildCopModel(type);
    // flashing red / blue light bar on the roof (part of the model)
    const red = model.lightBar!.red[0], blue = model.lightBar!.blue[0];
    this.traffic.root.add(model.root);
    // enter from behind, out of view, in a free lane near the player
    const lanes = this.layout.lanes;
    let lane = 0, best = 1e9;
    for (let l = 0; l < lanes; l++) { const dd = Math.abs(this.layout.laneCenter(l) - player.d); if (dd < best) { best = dd; lane = l; } }
    // never appear inside a traffic car: slide back until the slot is clear, and take the lane with the most room
    // while the player is getting away, replacements come from well out of range instead of right behind them
    let sSpawn = player.s - (this.awayT > 20 ? 185 : 90) - Math.random() * 30;
    for (let tries = 0; tries < 6; tries++) {
      const free = (l: number) => !this.traffic.cars.some((o) => o.alive && o.dir === 1 && Math.abs(o.d - this.layout.laneCenter(l)) < 2.6 && Math.abs(o.s - sSpawn) < 45);
      if (free(lane)) break;
      const alt = [lane - 1, lane + 1].find((l) => l >= 0 && l < lanes && free(l));
      if (alt !== undefined) { lane = alt; break; }
      sSpawn -= 40;
    }
    const car: TrafficCar = {
      id: -Math.floor(Math.random() * 1e9), type: 'sedan', model, L: dims.length, W: dims.width, dir: 1,
      s: sSpawn, d: this.layout.laneCenter(lane), v: Math.min(vTop, Math.max(25, player.v + 12)), v0: 90, acc: 0,
      lane, targetLane: lane, lcT: 1, lcDur: 1, dFrom: 0, signal: 0, signalT: 0, pendingLane: -1,
      driver: 'fast', p: DRIVERS.fast, decideT: 0, lcCool: 0, laneT: 99, prevLane: -1, tailT: 0, wander: 0, wanderPhase: 0, swerve: 0, swerveTarget: 0,
      panicT: 0, freezeT: 0, honkCd: 0, braking: false, wrecked: false, yaw: 0, passedSign: 0, nearMissed: true, alive: true, cop: true,
    };
    this.traffic.cars.push(car);
    this.cops.push({ car, red, blue, skill: charger ? 0.95 + Math.random() * 0.05 : 0.85 + Math.random() * 0.15, vMax: vTop * this.diff.copSpeed, charger, moto, dSm: car.d, laneT: 0, stuckT: 0, slot: this.cops.length });
    this.onDispatch?.(this.cops.length, charger, moto);
  }

  update(dt: number, player: PlayerProxy, playerVl: number, score: number, active: boolean) {
    this.time += dt;
    const tier = copsForScore(score / this.diff.copTier);
    this.wanted = tier > this.clearedTier ? tier : 0;
    if (this.wanted === 0 && this.cops.length) { for (const c of this.cops) this.traffic.release(c.car); this.cops = []; }
    // outrunning the police: a minute with no cop near, then 30 s of flashing stars, then the wanted level is gone
    if (this.wanted > 0 && active) {
      if (this.cops.length && this.nearest(player.s) < Police.NEAR) this.awayT = 0;
      else if (this.cops.length || this.awayT > 0 || this.respawnT > 2) this.awayT += dt;
      if (this.awayT >= Police.OUTRUN_CLEAR_AFTER) {
        this.clearedTier = this.wanted; this.wanted = 0; this.awayT = 0;
        for (const c of this.cops) this.traffic.release(c.car);
        this.cops = [];
        this.onCleared?.();
      }
    } else if (this.wanted === 0) this.awayT = 0;
    // drop cops that despawned (outrun) or wrecked
    this.cops = this.cops.filter((c) => c.car.alive && !c.car.wrecked);
    if (active && this.cops.length < Math.min(this.wanted, Police.MAX_COPS, this.diff.copMax)) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) { this.spawn(player, score); this.respawnT = 1.2; }
    }
    // an interceptor left far behind is pulled back into the chase; the slower units really can be outrun: a patrol
    // car or motorcycle more than 400 m back is lost and a replacement is dispatched after a while
    for (const cop of this.cops) {
      const back = pl_rel(cop, player);
      if (cop.charger && back > 220) { cop.car.s = player.s - 120; cop.car.v = Math.max(cop.car.v, player.v + 20); }
      else if (!cop.charger && back > 400) { this.traffic.release(cop.car); this.respawnT = 12; }
    }
    this.cops.forEach((cop, i) => { cop.slot = i; });
    // tell the traffic where the cops are so that cars ahead of them pull over and clear the way
    this.traffic.copAlerts = this.cops.map((cop) => ({ s: cop.car.s, d: cop.car.d, v: cop.car.v }));
    const hw = this.map.road === 'highway';
    const dMin = (hw ? this.layout.playerMin : this.layout.softMin) + 1.1;
    const dMax = (hw ? this.layout.playerMax : this.layout.softMax) - 1.1;
    for (const cop of this.cops) this.drive(cop, dt, player, playerVl, dMin, dMax);
    this.collisions();
    this.updateWrecks(dt, player);
    // light bar flash
    const phase = Math.floor(this.time * 7) % 4;
    for (const c of this.cops) { c.red.material = phase < 2 ? MAT.policeRed : MAT.policeOff; c.blue.material = phase >= 2 ? MAT.policeBlue : MAT.policeOff; }
  }

  private drive(cop: Cop, dt: number, pl: PlayerProxy, playerVl: number, dMin: number, dMax: number) {
    const c = cop.car;
    const rel = pl.s - c.s; // + = player ahead
    // never outrun: a cop can always exceed the player's speed by a margin, so a fast car can't just lose them
    const vMax = cop.charger ? Math.max(cop.vMax, pl.v + 35) : cop.vMax;
    // longitudinal: catch up fast, then close in to ram
    // a cop that has overshot drops back hard to tuck in behind again
    let vT = rel > 40 ? pl.v + 22 + rel * 0.15 : rel > 6 ? pl.v + 10 : rel > -4 ? pl.v + 4 : pl.v - 14;
    vT = clamp(vT, 0, vMax);
    // curve speed (cops brake for bends a bit later than traffic)
    let kMax = 0;
    for (const la of [25, 60]) kMax = Math.max(kMax, Math.abs(this.path.frame(c.s + la).k));
    vT = Math.min(vT, Math.sqrt(13 / Math.max(1e-5, kMax)));
    // lateral: aim at the player (with lead) when close, otherwise pick the clearest line
    const lead = clamp(rel / Math.max(5, c.v - pl.v + 5), 0, 1.2);
    // the pack fans out (slot offsets) while approaching, then every cop converges on the player
    const slotOff = SLOT_OFFSET[cop.slot % SLOT_OFFSET.length] * clamp((rel - 12) / 40, 0, 1);
    let dT = (rel < 35 ? pl.d + playerVl * lead * 0.6 : pl.d) + slotOff;
    // obstacle scan ahead in the cop's path
    const look = 25 + c.v * 2.2; // plan the escape line well ahead
    const blocked = (d: number) => {
      let g = 1e9, v = 0;
      for (const o of this.traffic.cars) {
        if (o === c || !o.alive || o.cop) continue;
        if (Math.abs(o.d - d) > (o.W + c.W) / 2 + 0.3) continue;
        const gap = o.s - c.s - (o.L + c.L) / 2;
        if (o.dir === 1) { if (gap > -1 && gap < g) { g = gap; v = o.v; } }
        else if (gap > -1) { // oncoming: the gap closes at both speeds, so it is effectively that much nearer
          const ge = gap * c.v / Math.max(1, c.v + o.v);
          if (ge < g) { g = ge; v = 0; }
        }
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
      // hold a safe gap to whatever is still in the current path until the new line is reached
      if (Math.abs(bestD - c.d) > 0.6) vT = Math.min(vT, here.v + Math.max(0, here.g - 6) * 0.9);
    }
    dT = clamp(dT, dMin, dMax);
    // braking-distance check on the car directly ahead in the current path (never when committed to the ram)
    if (!toPlayer && here.g < 1e8) {
      const closing = c.v - here.v;
      const need = closing > 0 ? (closing * closing) / (2 * 7) + 5 : 0;
      if (here.g < need + 4) vT = Math.min(vT, here.v + Math.max(0, here.g - 5) * 0.8);
    }
    // actuate with skill-limited rates (this is where imperfect cops make mistakes)
    let acc = clamp((vT - c.v) * 2.5, -11, (cop.charger ? 11 : cop.moto ? 9 : 7.5) * cop.skill * this.diff.copSpeed);
    // the pedals are eased on and off (a raw target flips every frame when a car ahead comes in and out of range)
    if (acc > -6) acc = c.acc + (acc - c.acc) * (1 - Math.exp(-dt / (acc > c.acc ? 0.35 : 0.2)));
    c.acc = acc;
    c.v = Math.max(0, c.v + acc * dt);
    c.braking = acc < -1;
    c.s += c.v * dt;
    const latRate = (6 + 6 * cop.skill) * clamp(c.v / 20, 0.4, 1) * (cop.moto ? 1.3 : 1);
    // the aim point is low-passed so a line that flips between two open gaps becomes one smooth drift, not a wobble
    cop.dSm += (dT - cop.dSm) * (1 - Math.exp(-dt * (toPlayer ? 9 : 4)));
    const dd = clamp(cop.dSm - c.d, -latRate * dt, latRate * dt);
    const yawT = Math.atan2(-dd / Math.max(dt, 1e-3), Math.max(3, c.v)) * 0.8;
    c.yaw += (yawT - c.yaw) * (1 - Math.exp(-dt * 8));
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
        if (rv > 10) {
          // pursuit cars are built to plough through: the traffic car is thrown aside and the cop only loses some speed
          // (a head-on at closing speeds no car survives still wrecks both)
          const headOnKill = o.dir < 0 && rv > 60;
          const pc = new THREE.Vector3();
          this.path.toWorld((c.s + o.s) / 2, (c.d + o.d) / 2, 0.6, pc);
          if (headOnKill) { this.wreck(c, 1, o, pc); this.respawnT = Math.max(this.respawnT, 2.5); }
          else { c.v = Math.max(c.v * 0.85, 12); c.d += (Math.sign(c.d - o.d) || 1) * 0.4; }
          this.wreck(o, 0.8, c, pc);
          this.particles.spark(pc, new THREE.Vector3(), 50, 7);
          this.particles.debris(pc, new THREE.Vector3(), 25, 0x111111, false, 0.16);
          this.particles.debris(pc, new THREE.Vector3(), 25, 0xffffff, true, 0.1);
          this.onWreck?.(clamp(rv / 40, 0.2, 0.8));
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
    this.traffic.materialize(car);
    car.wrecked = true;
    const body = new RigidBody(car.model.root, new THREE.Vector3(car.W / 2, 0.7, car.L / 2), car.type === 'boxtruck' ? 7000 : car.model.bike ? 350 : 1600, new THREE.Vector3(0, 0.75, 0));
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
