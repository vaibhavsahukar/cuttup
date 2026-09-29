import * as THREE from 'three';
import type { RoadPath, Frame } from '../world/RoadPath';
import type { Layout, MapSpec } from '../data/maps';
import { buildTrafficModel, TRAFFIC_COLORS, TRAFFIC_TYPES, trafficDims, type TrafficType } from '../vehicles/Factory';
import type { VehicleModel } from '../vehicles/ModelKit';
import { MAT, paint } from '../vehicles/Materials';
import { clamp, lerp, mulberry32, pick, range, smoothstep } from '../core/math';

export type DriverType = 'fast' | 'slow' | 'scared';

interface DriverParams {
  T: number; s0: number; a: number; b: number; bSafe: number;
  threshold: number; keepRight: number; signalLead: [number, number]; noSignalChance: number;
  lcDur: [number, number]; decide: [number, number];
}
export const DRIVERS: Record<DriverType, DriverParams> = {
  // tailgates, weaves, tight late lane changes, often no signal
  fast: { T: 0.55, s0: 1.4, a: 3.0, b: 3.5, bSafe: 5.0, threshold: 0.05, keepRight: 0.05, signalLead: [0, 0.35], noSignalChance: 0.55, lcDur: [1.3, 1.9], decide: [0.25, 0.8] },
  // holds lane, signals early, smooth
  slow: { T: 1.9, s0: 3.5, a: 1.0, b: 1.6, bSafe: 1.8, threshold: 0.7, keepRight: 0.45, signalLead: [2.5, 3.5], noSignalChance: 0, lcDur: [4.0, 5.5], decide: [3, 6] },
  // erratic: reacts to player, brakes hard, swerves
  scared: { T: 1.6, s0: 3.0, a: 1.4, b: 2.2, bSafe: 2.5, threshold: 0.4, keepRight: 0.3, signalLead: [0.8, 2.2], noSignalChance: 0.2, lcDur: [2.5, 3.8], decide: [2, 5] },
};

export interface TrafficCar {
  id: number;
  type: TrafficType;
  model: VehicleModel;
  L: number; W: number;
  dir: 1 | -1;
  s: number; d: number; v: number; v0: number; acc: number;
  lane: number; targetLane: number;
  lcT: number; lcDur: number; dFrom: number;
  signal: -1 | 0 | 1; signalT: number; pendingLane: number;
  driver: DriverType; p: DriverParams;
  decideT: number;
  wander: number; wanderPhase: number; swerve: number; swerveTarget: number;
  panicT: number; freezeT: number; honkCd: number;
  braking: boolean;
  wrecked: boolean; // handed over to crash physics
  yaw: number; // extra yaw from lane change
  passedSign: number; // for near-miss detection
  nearMissed: boolean;
  alive: boolean;
  cop?: boolean; // driven by the Police controller, not by the traffic AI
}

export interface PlayerProxy { s: number; d: number; v: number; L: number; W: number; alive: boolean }
export interface Obstacle { s: number; d: number; L: number; W: number }

const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 };
const v3 = new THREE.Vector3();
const eul = new THREE.Euler(0, 0, 0, 'YXZ');

export class Traffic {
  cars: TrafficCar[] = [];
  root = new THREE.Group();
  private pool = new Map<TrafficType, VehicleModel[]>();
  private rng = mulberry32(99);
  private nextId = 1;
  private time = 0;
  flow: number;
  density = 1; // multiplier
  onHonk: ((car: TrafficCar, intensity: number) => void) | null = null;
  obstacles: Obstacle[] = []; // wrecks etc.
  spawnAhead: number;
  night = false;
  /** behaviour counters (debug / verification) */
  stats = { laneChanges: { fast: 0, slow: 0, scared: 0 }, signalled: { fast: 0, slow: 0, scared: 0 }, panics: 0, honks: 0, spawned: 0 };

  constructor(public path: RoadPath, public map: MapSpec, public layout: Layout, public difficulty: number, drawDist: number) {
    this.flow = map.flowSpeed * (0.9 + difficulty * 0.08);
    this.spawnAhead = Math.max(map.fogFar + 30, 260) * drawDist;
    this.spawnAhead = Math.min(this.spawnAhead, 700);
  }

  private laneD(dir: number, lane: number) {
    return dir > 0 ? this.layout.laneCenter(lane) : this.layout.oncomingCenter(lane);
  }
  private lanesFor(dir: number) { return dir > 0 ? this.layout.lanes : this.layout.oncomingLanes; }

  private getModel(type: TrafficType, color: number) {
    const list = this.pool.get(type);
    let m = list?.pop();
    if (!m) { m = buildTrafficModel(type, color, false); this.root.add(m.root); }
    if (type !== 'boxtruck') {
      m.body.material = paint(color);
      m.chassis.traverse((o) => { const mm = o as THREE.Mesh; if (mm.name === 'paint') mm.material = paint(color); });
    }
    m.root.visible = true;
    return m;
  }
  release(c: TrafficCar) {
    c.alive = false;
    c.model.root.visible = false;
    this.obstacles = this.obstacles.filter((o) => o !== c);
    if (c.cop) { this.root.remove(c.model.root); return; } // police models are never recycled as traffic
    if (!this.pool.has(c.type)) this.pool.set(c.type, []);
    this.pool.get(c.type)!.push(c.model);
  }

  /** target cars per km per lane, grows slowly with distance */
  densityAt(distance: number) {
    const base = this.map.road === 'highway' ? 7 : 6;
    return base * (0.7 + this.difficulty * 0.3) * this.density * (1 + Math.min(1.2, distance / 12000));
  }

  private spawn(dir: 1 | -1, s: number, lane: number, v?: number) {
    const r = this.rng;
    const roll = r();
    const driver: DriverType = roll < 0.27 ? 'fast' : roll < 0.7 ? 'slow' : 'scared';
    const hw = this.map.road === 'highway';
    // trucks keep right, fast drivers are cars
    let type: TrafficType = pick(r, TRAFFIC_TYPES);
    if (driver === 'fast' && (type === 'boxtruck' || type === 'van')) type = 'sedan';
    if (!hw && type === 'boxtruck' && r() < 0.6) type = 'hatch';
    if (hw && (type === 'boxtruck') && lane < this.lanesFor(dir) - 2) lane = this.lanesFor(dir) - 1 - Math.floor(r() * 2);
    if (hw && driver === 'slow' && r() < 0.6) lane = Math.max(lane, this.lanesFor(dir) - 2);
    const dims = trafficDims(type);
    const p = DRIVERS[driver];
    const f = this.flow * (type === 'boxtruck' ? 0.85 : 1);
    const v0 = driver === 'fast' ? f * range(r, 1.1, 1.25) : driver === 'slow' ? f * range(r, 0.78, 0.9) : f * range(r, 0.85, 1.0);
    const color = pick(r, TRAFFIC_COLORS);
    const car: TrafficCar = {
      id: this.nextId++, type, model: this.getModel(type, color), L: dims.length, W: dims.width,
      dir, s, d: this.laneD(dir, lane), v: v ?? v0 * 0.95, v0, acc: 0,
      lane, targetLane: lane, lcT: 1, lcDur: 3, dFrom: 0,
      signal: 0, signalT: 0, pendingLane: -1,
      driver, p, decideT: range(r, p.decide[0], p.decide[1]),
      wander: driver === 'scared' ? range(r, 0.15, 0.45) : driver === 'fast' ? 0.08 : 0.05, wanderPhase: r() * 10,
      swerve: 0, swerveTarget: 0, panicT: 0, freezeT: 0, honkCd: 0,
      braking: false, wrecked: false, yaw: 0, passedSign: 0, nearMissed: false, alive: true,
    };
    this.cars.push(car);
    this.stats.spawned++;
    return car;
  }

  /** is a slot free for spawning (no car within gap metres in that lane) */
  private laneFree(dir: number, lane: number, s: number, gap: number) {
    const d = this.laneD(dir, lane);
    for (const c of this.cars) if (c.dir === dir && Math.abs(c.d - d) < 2.5 && Math.abs(c.s - s) < gap) return false;
    return true;
  }

  /** build spare models up front so spawning never has to create geometry mid-run */
  prewarm(perType = 3) {
    for (const t of TRAFFIC_TYPES) {
      if (!this.pool.has(t)) this.pool.set(t, []);
      for (let i = 0; i < perType; i++) {
        const m = buildTrafficModel(t, TRAFFIC_COLORS[i % TRAFFIC_COLORS.length], false);
        m.root.visible = false;
        this.root.add(m.root);
        this.pool.get(t)!.push(m);
      }
    }
  }

  populate(playerS: number) {
    // initial fill: evenly from just ahead of the player out to the spawn horizon (before the first frame)
    for (const dir of [1, -1] as const) {
      const lanes = this.lanesFor(dir);
      const perLane = (this.densityAt(0) * (this.spawnAhead + 150)) / 1000;
      for (let l = 0; l < lanes; l++) {
        for (let i = 0; i < perLane; i++) {
          const s = playerS - 150 + (i + this.rng()) * (1000 / this.densityAt(0));
          if (dir > 0 && Math.abs(s - playerS) < 40) continue;
          if (dir > 0 && l === 0 && this.map.road === 'backroad' && Math.abs(s - playerS) < 60) continue;
          if (this.laneFree(dir, l, s, 20)) this.spawn(dir, s, l);
        }
      }
    }
  }

  private manageSpawns(player: PlayerProxy, distance: number) {
    const ps = player.s;
    // despawn
    for (const c of this.cars) {
      if (!c.alive || c.wrecked) continue;
      const rel = c.s - ps;
      if (rel < -260 || rel > this.spawnAhead + 250) this.release(c);
    }
    this.cars = this.cars.filter((c) => c.alive);
    const dens = this.densityAt(distance);
    for (const dir of [1, -1] as const) {
      const lanes = this.lanesFor(dir);
      for (let l = 0; l < lanes; l++) {
        const d = this.laneD(dir, l);
        let count = 0;
        for (const c of this.cars) if (c.dir === dir && Math.abs(c.d - d) < 2 && c.s > ps - 200 && c.s < ps + this.spawnAhead + 100) count++;
        const target = (dens * (this.spawnAhead + 300)) / 1000;
        if (count >= target) continue;
        if (this.rng() > 0.25) continue; // stagger
        // spawn ahead beyond the fog horizon; behind only if traffic would catch up with the player
        const ahead = dir < 0 || player.v > this.flow * 0.8 || this.rng() < 0.5;
        const s = ahead ? ps + this.spawnAhead + range(this.rng, 0, 150) : ps - range(this.rng, 170, 230);
        if (this.laneFree(dir, l, s, 35)) this.spawn(dir, s, l);
      }
    }
  }

  /** nearest vehicle ahead (in the car's travel direction) overlapping lateral band [dA,dB] */
  private leader(c: TrafficCar, dCenter: number, halfW: number, player: PlayerProxy, from = c.s) {
    let best = 1e9, bestV = 0, bestIsPlayer = false;
    const consider = (s: number, d: number, W: number, L: number, v: number, isPlayer: boolean) => {
      if (Math.abs(d - dCenter) > halfW + W / 2 + 0.25) return;
      const gap = (s - from) * c.dir - (c.L + L) / 2;
      if (gap < -(c.L + L) / 2 + 0.01 || gap >= best) return;
      if ((s - from) * c.dir <= 0) return;
      best = gap; bestV = v; bestIsPlayer = isPlayer;
    };
    for (const o of this.cars) if (o !== c && o.alive && !o.wrecked) consider(o.s, o.d, o.W, o.L, o.v * o.dir * c.dir, false);
    for (const o of this.obstacles) consider(o.s, o.d, o.W, o.L, 0, false);
    if (player.alive) consider(player.s, player.d, player.W, player.L, player.v * c.dir, true);
    return { gap: best, v: bestV, isPlayer: bestIsPlayer };
  }
  /** nearest vehicle behind in lateral band */
  private follower(c: TrafficCar, dCenter: number, halfW: number, player: PlayerProxy) {
    let best = 1e9, bestV = 0, f: TrafficCar | null = null, isPlayer = false;
    for (const o of this.cars) {
      if (o === c || !o.alive || o.wrecked || o.dir !== c.dir) continue;
      if (Math.abs(o.d - dCenter) > halfW + o.W / 2 + 0.25) continue;
      const gap = (c.s - o.s) * c.dir - (c.L + o.L) / 2;
      if ((c.s - o.s) * c.dir <= 0 || gap >= best) continue;
      best = gap; bestV = o.v; f = o;
    }
    if (player.alive && c.dir > 0 && Math.abs(player.d - dCenter) < halfW + player.W / 2 + 0.25) {
      const gap = (c.s - player.s) - (c.L + player.L) / 2;
      if (c.s > player.s && gap < best) { best = gap; bestV = player.v; f = null; isPlayer = true; }
    }
    return { gap: best, v: bestV, car: f, isPlayer };
  }

  private idm(c: TrafficCar, v0: number, gap: number, vLead: number) {
    const p = c.p;
    const dv = c.v - vLead;
    const sStar = p.s0 + Math.max(0, c.v * p.T + (c.v * dv) / (2 * Math.sqrt(p.a * p.b)));
    const g = Math.max(0.1, gap);
    return p.a * (1 - Math.pow(Math.max(0, c.v) / Math.max(1, v0), 4) - (gap > 1e8 ? 0 : (sStar / g) ** 2));
  }

  update(dt: number, player: PlayerProxy, distance: number) {
    this.time += dt;
    this.manageSpawns(player, distance);
    const r = this.rng;
    const hw = this.map.road === 'highway';
    for (const c of this.cars) {
      if (!c.alive || c.wrecked || c.cop) continue;
      const lanes = this.lanesFor(c.dir);
      // curve speed: look ahead for the tightest curvature
      let kMax = 0;
      for (const la of [20, 50, 90]) kMax = Math.max(kMax, Math.abs(this.path.frame(c.s + c.dir * la, fr).k));
      let v0 = Math.min(c.v0, Math.sqrt(2.6 / Math.max(1e-5, kMax)));
      if (c.freezeT > 0) { c.freezeT -= dt; v0 *= 0.45; }

      // ------------- scared driver reactions -------------
      const relS = (player.s - c.s) * c.dir; // >0 player ahead of car (in car's direction)
      const latGap = Math.abs(player.d - c.d) - (player.W + c.W) / 2;
      if (player.alive && c.dir > 0) {
        const closing = player.v - c.v;
        const behindClose = relS < 0 && relS > -30 && closing > 6 && latGap < 2.5;
        const besideClose = Math.abs(relS) < 6 && latGap < 1.2;
        if (c.driver === 'scared' && (behindClose || besideClose) && c.panicT <= 0) {
          c.panicT = range(r, 0.8, 1.8);
          this.stats.panics++;
          const away = Math.sign(c.d - player.d) || (r() < 0.5 ? -1 : 1);
          c.swerveTarget = away * range(r, 0.5, 1.1);
          if (r() < 0.35) c.freezeT = range(r, 1, 2.5);
          if (c.honkCd <= 0 && r() < 0.8) { this.onHonk?.(c, 1); c.honkCd = 3; }
        } else if (c.driver !== 'scared' && besideClose && closing > 15 && c.honkCd <= 0 && r() < 0.01) {
          this.onHonk?.(c, 0.6); c.honkCd = 5;
        }
      }
      // oncoming cars facing the player in their lane: brake, honk, dodge to the shoulder
      if (player.alive && c.dir < 0 && relS > 0 && relS < 120 && latGap < 0.8) {
        if (c.honkCd <= 0) { this.onHonk?.(c, 1); c.honkCd = 2.5; }
        c.swerveTarget = -1.2; // toward their shoulder (more negative d)
        c.panicT = 0.6;
      }
      c.honkCd -= dt;
      if (c.panicT > 0) c.panicT -= dt; else c.swerveTarget *= Math.max(0, 1 - dt * 1.5);

      // ------------- longitudinal (IDM) -------------
      const dNow = c.d;
      const lead = this.leader(c, dNow, c.W / 2, player);
      let acc = this.idm(c, v0, lead.gap, lead.v);
      if (c.lcT < 1) { // also respect the target lane while changing
        const l2 = this.leader(c, this.laneD(c.dir, c.targetLane), c.W / 2, player);
        acc = Math.min(acc, this.idm(c, v0, l2.gap, l2.v));
      }
      if (c.panicT > 0 && c.driver === 'scared' && c.dir > 0) acc = Math.min(acc, -range(r, 3, 6.5));
      if (c.dir < 0 && c.panicT > 0) acc = Math.min(acc, -6);
      acc = clamp(acc, -9, c.p.a);
      c.acc = acc;
      c.v = Math.max(0, c.v + acc * dt);
      // hard non-overlap guarantee
      if (lead.gap < 0.3 && !lead.isPlayer) c.v = Math.min(c.v, Math.max(0, lead.v));
      c.braking = acc < -0.6 || c.v < 0.5;
      c.s += c.dir * c.v * dt;

      // ------------- lane changes (MOBIL-style) -------------
      if (hw && lanes > 1) {
        c.decideT -= dt;
        if (c.pendingLane >= 0 && c.lcT >= 1) {
          // signalling, waiting for the lead time (and a safe gap) before moving over
          c.signalT -= dt;
          if (c.signalT <= 0) {
            if (this.safeToChange(c, c.pendingLane, player)) { this.beginChange(c, c.pendingLane); c.pendingLane = -1; }
            else if (c.signalT < -4) { c.pendingLane = -1; c.signal = 0; } // give up
          }
        } else if (c.decideT <= 0 && c.lcT >= 1) {
          c.decideT = range(r, c.p.decide[0], c.p.decide[1]);
          let best = -1, bestGain = c.p.threshold;
          const aCur = acc;
          for (const nl of [c.lane - 1, c.lane + 1]) {
            if (nl < 0 || nl >= lanes) continue;
            if (!this.safeToChange(c, nl, player)) continue;
            const ln = this.leader(c, this.laneD(c.dir, nl), c.W / 2, player);
            const aNew = this.idm(c, v0, ln.gap, ln.v);
            let gain = aNew - aCur + (nl > c.lane ? c.p.keepRight : -c.p.keepRight * 0.3);
            if (c.driver === 'fast') gain += r() * 0.4; // weaving
            if (c.driver === 'scared' && r() < 0.1) gain += 0.8; // unpredictable
            if (gain > bestGain) { bestGain = gain; best = nl; }
          }
          if (best >= 0) {
            const noSig = r() < c.p.noSignalChance;
            c.pendingLane = best;
            c.signal = noSig ? 0 : best < c.lane ? -1 : 1;
            c.signalT = noSig ? 0.01 : range(r, c.p.signalLead[0], c.p.signalLead[1]);
            if (noSig) { if (this.safeToChange(c, best, player)) this.beginChange(c, best); c.pendingLane = -1; }
          }
        }
      }
      // ------------- lateral motion -------------
      let dTarget = this.laneD(c.dir, c.targetLane);
      if (c.lcT < 1) {
        c.lcT = Math.min(1, c.lcT + dt / c.lcDur);
        dTarget = lerp(c.dFrom, this.laneD(c.dir, c.targetLane), smoothstep(0, 1, c.lcT));
        if (c.lcT >= 1) { c.lane = c.targetLane; c.signal = 0; }
      }
      c.swerve = lerp(c.swerve, c.swerveTarget, clamp(dt * (c.driver === 'scared' ? 3 : 1.5), 0, 1));
      // don't swerve into an occupied neighbour lane
      if (Math.abs(c.swerve) > 0.3) {
        const probe = this.leader(c, c.d + Math.sign(c.swerve) * 1.2, c.W / 2, player, c.s - c.dir * 6);
        if (probe.gap < 8) c.swerveTarget *= 0.5;
      }
      const wander = Math.sin(this.time * 0.35 + c.wanderPhase) * c.wander + (c.driver === 'scared' ? Math.sin(this.time * 1.3 + c.wanderPhase * 2) * c.wander * 0.4 : 0);
      const newD = dTarget + c.swerve + wander * 0.6;
      const dd = (newD - c.d);
      c.yaw = Math.atan2(-dd / Math.max(dt, 1e-3), Math.max(3, c.v)) * c.dir * 0.8;
      c.d = newD;
    }
    // resolve any residual overlaps between traffic cars (never phase through each other)
    this.separate();
  }

  private separate() {
    const cs = this.cars;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      if (a.wrecked) continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        if (b.wrecked || a.dir !== b.dir) continue;
        const ds = b.s - a.s, dl = Math.abs(b.d - a.d);
        const minS = (a.L + b.L) / 2 + 0.2;
        if (dl < (a.W + b.W) / 2 && Math.abs(ds) < minS) {
          const push = (minS - Math.abs(ds)) / 2;
          const sg = Math.sign(ds) || 1;
          a.s -= sg * push; b.s += sg * push;
          const back = (a.s - b.s) * a.dir < 0 ? a : b;
          const front = back === a ? b : a;
          back.v = Math.min(back.v, front.v);
        }
      }
    }
  }

  private safeToChange(c: TrafficCar, nl: number, player: PlayerProxy) {
    const d = this.laneD(c.dir, nl);
    const lead = this.leader(c, d, c.W / 2, player);
    const fol = this.follower(c, d, c.W / 2, player);
    const tight = c.driver === 'fast' ? 0.5 : 1;
    if (lead.gap < (4 + c.v * 0.35) * tight) return false;
    if (fol.gap < (5 + Math.max(0, fol.v - c.v) * 1.6) * tight) return false;
    // MOBIL safety: new follower must not need to brake harder than bSafe
    if (fol.gap < 1e8) {
      const T = 1.2, s0 = 2;
      const sStar = s0 + Math.max(0, fol.v * T + (fol.v * (fol.v - c.v)) / (2 * Math.sqrt(1.5 * 2)));
      const accF = 1.5 * (1 - (sStar / Math.max(0.1, fol.gap)) ** 2);
      if (accF < -c.p.bSafe) return false;
    }
    return true;
  }
  private beginChange(c: TrafficCar, nl: number) {
    this.stats.laneChanges[c.driver]++;
    if (c.signal !== 0) this.stats.signalled[c.driver]++;
    c.targetLane = nl;
    c.lcT = 0;
    c.dFrom = c.d;
    c.lcDur = range(this.rng, c.p.lcDur[0], c.p.lcDur[1]);
    if (c.signal === 0 && c.driver !== 'fast') c.signal = nl < c.lane ? -1 : 1;
  }

  /** push transforms / lights to the scene */
  sync(dt: number, playerS = 0) {
    const blink = Math.floor(this.time * 3) % 2 === 0;
    for (const c of this.cars) {
      if (!c.alive) continue;
      // LOD: drop detail meshes far away (fog hides them anyway)
      const far = Math.abs(c.s - playerS) > 160;
      if (c.model.lod) for (const o of c.model.lod) o.visible = !far;
      if (c.model.wheelMesh) c.model.wheelMesh.visible = Math.abs(c.s - playerS) < 320;
      if (c.wrecked) continue;
      this.path.frame(c.s, fr);
      this.path.toWorld(c.s, c.d, 0, v3, fr);
      const m = c.model;
      m.root.position.copy(v3);
      const yaw = fr.heading + (c.dir < 0 ? Math.PI : 0) + c.yaw;
      eul.set(-Math.atan(fr.grade) * c.dir, yaw, 0);
      m.root.quaternion.setFromEuler(eul);
      // body dive under braking, squat on accel
      m.chassis.rotation.x = clamp(c.acc * 0.006, -0.03, 0.02);
      const spin = (c.v / 0.34) * dt;
      for (const w of m.wheels) w.spin.rotation.x += spin;
      const lights = c.braking ? MAT.tailOn : MAT.tailOff;
      for (const b of m.brake) b.material = lights;
      // signals: on the car's left/right
      const left = c.signal === -1 ? -1 : c.signal === 1 ? 1 : 0;
      // lane index increases to the car's right; signal -1 means moving toward lower index (car's left)
      for (const s of m.sigL) s.material = left === -1 && blink ? MAT.sigOn : MAT.sigOff;
      for (const s of m.sigR) s.material = left === 1 && blink ? MAT.sigOn : MAT.sigOff;
    }
  }

  clear() {
    for (const c of this.cars) this.release(c);
    this.cars = [];
    this.obstacles = [];
  }
}
