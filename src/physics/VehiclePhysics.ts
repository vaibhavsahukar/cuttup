import type { VehicleSpec } from '../data/vehicles';
import { clamp, lerp } from '../core/math';

/**
 * Arcade vehicle dynamics in road coordinates.
 *  - Dynamic bicycle model (front / rear axle) with a simplified Pacejka lateral curve.
 *  - Longitudinal load transfer (cg height), downforce, drag, rolling resistance, grade.
 *  - Engine torque curve + automatic gearbox; drive layout decides which axle can put power down,
 *    and wheelspin eats that axle's lateral grip (friction circle) -> power oversteer for RWD.
 *  - Arcade assists: limit-aware steering, auto counter-steer and yaw damping scaled by `stability`.
 *  - Motorcycles: separate front / rear brakes, lean-driven turning with a grip and speed
 *    dependent lean limit, pitch dynamics (wheelies, stoppies, looping, going over the bars),
 *    tyre temperature and wear, rider aids (ABS, TC, anti-wheelie, engine braking) capped by
 *    each bike's stock electronics, and crash detection (lowside, highside, tip-over).
 * Position is kept as (s along road, d lateral + right, psi heading relative to road + left).
 */
export const G = 9.81;
const MPH = 0.44704;
/** arcade lateral grip multiplier: makes cornering and lane changes much easier than real tyres */
export const ARCADE_GRIP = 1.35;
/** bikes: pitch inertia multiplier (rider + wheels), slows wheelies / stoppies to a catchable pace */
const PITCH_I = 3.4;

export interface Controls {
  throttle: number; brake: number; steer: number; handbrake: boolean;
  /** bikes: front brake lever (brake = rear brake on bikes); cars treat it as extra brake */
  frontBrake?: number;
  /** bikes, manual riding style: rider weight shift -1 (right) .. 1 (left) */
  hang?: number;
  /** bikes: rider pulls back on the bars / shifts weight back (0..1) to lift the front */
  pull?: number;
}
/** rider aid levels; 0 = off. abs 0..2, tc 0..3, aw 0..3, eb 0..2 (engine braking low / medium / high) */
export interface RiderAids { abs: number; tc: number; aw: number; eb: number; manual: boolean }
export type BikeFall = 'lowside' | 'highside' | 'looped' | 'endo' | 'tipover';

export class VehiclePhysics {
  // road-frame pose
  s = 0; d = 0; psi = 0;
  // body-frame velocity
  v = 0; vl = 0; r = 0;
  steerAngle = 0;
  gear = 1; rpm = 0; shiftT = 0;
  ax = 0; ay = 0; // accelerations (for visuals / audio)
  wheelspin = 0; // 0..1+
  slip = 0; // lateral slide amount (for tyre squeal)
  lean = 0; // bike lean (rad, + = left)
  wheelie = 0; // pitch (rad, + nose up)
  wobble = 0;
  frontAngVel = 0; rearAngVel = 0; frontRot = 0; rearRot = 0;
  onGrass = false;
  throttle = 0; brake = 0; frontBrake = 0;
  // ---- bike state ----
  aids: RiderAids = { abs: 2, tc: 2, aw: 1, eb: 1, manual: false };
  pull = 0; // rider weight back (0..1), smoothed
  wheelieT = 0; // seconds with the front up (scoring)
  private pullPrev = 0; private clutchT = 0;
  /** set when the rider falls; the game turns it into a crash */
  fall: BikeFall | null = null;
  pitchRate = 0;
  hang = 0; // rider weight shift (+ left)
  tyreTemp = 0.45; // 0 cold, 1 optimal, >1.1 overheating
  tyreWear = 0; // 0 new .. 1 worn out
  frontLock = 0; rearLock = 0; // 0..1 (skidding)
  absOn = false; tcOn = false; awOn = false; // aid intervening this step (HUD)
  leanEq = 0;
  ayTurn = 0; // lateral acceleration the tyres are giving the turn (bikes)
  bikeLean = 0; // lean of the bike itself (rider hanging off makes it smaller than the turn needs) // lean the current turn actually supports
  private unbalanced = 0; private washout = 0; private slideT = 0; private lastSpin = 0;

  readonly m: number; readonly L: number; readonly a: number; readonly b: number; readonly h: number;
  readonly Iz: number; readonly P: number; readonly cD: number; readonly vTop: number; readonly vLimit: number;
  readonly gearTop: number[]; readonly Fpeak: number[];
  readonly bike: boolean;
  private K = 1;
  private time = 0;
  /** launch factor (auto-calibrated so 0-60 matches spec.zeroSixty); fades out above ~35 m/s */
  launchK = 1;
  private static calib = new Map<string, number>();

  constructor(public spec: VehicleSpec, calibrate = true) {
    this.bike = spec.kind === 'bike';
    this.m = spec.massKg;
    this.L = spec.wheelbase;
    this.b = this.L * spec.frontWeight; // cg -> rear axle
    this.a = this.L - this.b; // cg -> front axle
    this.h = spec.cgHeight;
    this.Iz = this.m * (this.L * 0.5) ** 2 * spec.yawInertia * (this.bike ? 0.8 : 1.15);
    this.P = spec.hp * 745.7 * 0.9;
    this.vLimit = spec.topSpeedMph * MPH;
    // natural (drag-limited) top speed: limited cars could go faster
    this.vTop = this.vLimit * (spec.limited ? 1.12 : 1.0);
    const roll = 0.012 * this.m * G;
    this.cD = (this.P * 0.97 - roll * this.vTop) / this.vTop ** 3;
    // gearing: top gear reaches redline slightly above top speed
    const n = spec.gears;
    const vgN = this.vTop * 1.04;
    // single speed (electric): one ratio covers the whole range
    const vg1 = n === 1 ? vgN : vgN * (this.bike ? 0.36 : n >= 8 ? 0.2 : n === 7 ? 0.24 : 0.28);
    const q = n === 1 ? 1 : Math.pow(vgN / vg1, 1 / (n - 1));
    this.gearTop = [];
    for (let i = 0; i < n; i++) this.gearTop.push(vg1 * Math.pow(q, i));
    // K = max(T(r) * r) so that peak power == P in every gear
    let K = 0;
    for (let r = 0.05; r <= 1; r += 0.01) K = Math.max(K, this.torque(r) * r);
    this.K = K;
    this.Fpeak = this.gearTop.map((vg) => this.P / (K * vg));
    this.rpm = spec.idleRpm;
    if (calibrate) this.launchK = VehiclePhysics.calibrate(spec);
    if (this.bike) this.launchK = Math.min(this.launchK, 1.2); // bikes are wheelie-limited, not grip-limited
  }

  /** time for 0-60 mph at full throttle with a given launch factor */
  static zeroSixty(spec: VehicleSpec, k: number) {
    const p = new VehiclePhysics(spec, false);
    p.launchK = k;
    p.aids = { abs: 2, tc: 2, aw: 3, eb: 1, manual: false };
    p.reset(0, 0, 0);
    const dt = 1 / 120;
    let t = 0;
    while (p.v < 60 * MPH && t < 20) { p.step(dt, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 0, 0); t += dt; }
    return t;
  }
  static calibrate(spec: VehicleSpec) {
    const hit = VehiclePhysics.calib.get(spec.id);
    if (hit !== undefined) return hit;
    let lo = 0.4, hi = 2.2;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (VehiclePhysics.zeroSixty(spec, mid) > spec.zeroSixty) lo = mid; else hi = mid;
    }
    const k = (lo + hi) / 2;
    VehiclePhysics.calib.set(spec.id, k);
    return k;
  }

  /** normalised torque curve 0..1 over normalised rpm */
  torque(r: number) {
    const { torquePeak: p, torqueFlat: f } = this.spec;
    if (r < p) return lerp(0.45 + 0.4 * f, 1, Math.pow(r / p, 0.9));
    const u = (r - p) / Math.max(0.05, 1 - p);
    return 1 - (1 - f * 0.75) * u * u * 0.8;
  }

  reset(s: number, d: number, v: number) {
    this.s = s; this.d = d; this.psi = 0; this.v = v; this.vl = 0; this.r = 0;
    this.steerAngle = 0; this.lean = 0; this.wheelie = 0; this.pitchRate = 0; this.fall = null; this.hang = 0;
    this.unbalanced = 0; this.washout = 0; this.slideT = 0; this.frontLock = 0; this.rearLock = 0;
    this.gear = 1;
    while (this.gear < this.spec.gears && v > this.gearTop[this.gear - 1] * 0.85) this.gear++;
  }

  /** apply the player's aid settings, capped by the bike's stock electronics */
  setAids(a: RiderAids) {
    const e = this.spec.electronics ?? { abs: 2, tc: 3, aw: 3 };
    this.aids = { abs: Math.min(a.abs, e.abs), tc: Math.min(a.tc, e.tc), aw: Math.min(a.aw, e.aw), eb: a.eb, manual: a.manual };
  }

  /** the lean angle to draw: the physical lean scaled down with speed (~52 deg slow, ~39 deg at 60 mph, ~22 deg at 120 mph) */
  get visLean() { return this.lean * lerp(1, 0.38 / 0.9, clamp((Math.abs(this.v) - 8) / 45, 0, 1)); }

  /** cg to rear axle, shortened when the rider shifts back (lower balance point, easier lift) */
  get bEff() { return this.b - 0.12 * this.pull + 0.04 * (1 - this.pull) * (this.wheelie > 0 ? 1 : 0); }

  /** tyre grip factor from temperature and wear */
  get tyreGrip() {
    const T = this.tyreTemp;
    const temp = T < 1 ? 0.8 + 0.2 * T : T > 1.1 ? Math.max(0.82, 1 - (T - 1.1) * 0.6) : 1;
    return temp * (1 - this.tyreWear * 0.25);
  }

  /** Pacejka-ish lateral force: slip angle -> force */
  private lat(alpha: number, Fz: number, mu: number, rear: boolean) {
    // rear axle is stiffer in the linear range (stable, slight understeer); peak grip decides limit behaviour
    const B = (this.bike ? 16 : 20) * (rear ? 1.6 : 1), C = this.bike ? 1.15 : 1.3;
    return -mu * ARCADE_GRIP * Fz * Math.sin(C * Math.atan(B * alpha));
  }

  step(dt: number, c: Controls, curvature: number, grade: number) {
    const sp = this.spec;
    this.time += dt;
    this.throttle = c.throttle; this.brake = c.brake; this.frontBrake = c.frontBrake ?? 0;
    const v = this.v;
    const av = Math.abs(v);
    const bk = this.bike, A = this.aids;
    this.absOn = false; this.tcOn = false; this.awOn = false;
    const mu = sp.tireMu * (this.onGrass ? 0.55 : 1) * (bk ? this.tyreGrip : 1);
    // bikes lean on the tyres: what the turn uses laterally is not available for braking / drive
    const latUse = bk ? Math.min(0.95, Math.abs(Math.tan(this.lean)) / (mu * ARCADE_GRIP)) : 0;
    const longK = Math.sqrt(1 - latUse * latUse);
    // assists weaken with traction control on bikes (TC off = a slide is yours to catch)
    const stab = bk ? sp.stability * (0.55 + 0.15 * A.tc) : sp.stability;
    const down = sp.downforce * v * v;

    // ---------------- loads ----------------
    const W = this.m * G;
    let Fzf = (W * this.b) / this.L - (this.m * this.ax * this.h) / this.L + down * 0.45;
    let Fzr = (W * this.a) / this.L + (this.m * this.ax * this.h) / this.L + down * 0.55;
    const minLoad = this.bike ? 0 : W * 0.08;
    Fzf = Math.max(minLoad, Fzf); Fzr = Math.max(minLoad, Fzr);
    // a wheel in the air carries nothing
    if (bk && this.wheelie > 0.005) { Fzr += Fzf; Fzf = 0; } else if (bk && this.wheelie < -0.005) { Fzf += Fzr; Fzr = 0; }

    // ---------------- engine & gearbox ----------------
    const vg = this.gearTop[this.gear - 1];
    let rN = Math.abs(v) / vg;
    if (this.shiftT > 0) this.shiftT -= dt;
    else if (v > 0 && rN > 0.97 && this.gear < sp.gears) { this.gear++; this.shiftT = this.bike ? 0.06 : 0.14; }
    else if (this.gear > 1 && rN < 0.5 * (this.gear > 2 ? 1 : 0.8)) { this.gear--; this.shiftT = 0.08; }
    const vg2 = this.gearTop[this.gear - 1];
    rN = Math.abs(v) / vg2;
    const clutchR = Math.max(rN, 0.3 + 0.35 * c.throttle * (1 - clamp(rN / 0.4, 0, 1))); // slipping clutch at launch
    let Fdrive = 0;
    const reverse = !this.bike && c.brake > 0.5 && c.throttle < 0.1 && v < 1.0;
    if (this.shiftT <= 0) Fdrive = c.throttle * this.Fpeak[this.gear - 1] * this.torque(Math.min(1, clutchR));
    // electric motor: flat maximum force up to base speed, then constant power
    if (sp.gears === 1) Fdrive = c.throttle * Math.min(this.m * G * 1.25, this.P / Math.max(1, Math.abs(v)));
    if (rN >= 1.0) Fdrive = 0; // rev limiter
    // traction control, strength by stability (ZR1 ~ nearly off, Huracan strong)
    if (!bk) Fdrive *= 1 - clamp(this.wheelspin * sp.stability * sp.stability * 1.5, 0, 0.6);
    if (v > this.vLimit && sp.limited) Fdrive *= clamp(1 - (v - this.vLimit) * 0.5, 0, 1); // governor
    if (reverse) Fdrive = -this.m * 3;
    const targetRpm = sp.idleRpm + (sp.redline - sp.idleRpm) * clamp(clutchR, 0, 1.02);
    this.rpm = lerp(this.rpm, this.shiftT > 0 ? targetRpm * 0.85 : targetRpm, clamp(dt * 18, 0, 1));

    // ---------------- traction per axle ----------------
    const lk = lerp(this.launchK, 1, clamp((av - 25) / 15, 0, 1));
    const lm = sp.launchMu * lk;
    Fdrive *= lk;
    // bikes: the launch factor only helps upright; leaned, the tyre's own grip is the limit
    const lmR = bk ? lerp(lm, 1, clamp(latUse / 0.3, 0, 1)) : lm;
    const capF = mu * lm * 1.18 * Fzf, capR = mu * lmR * 1.18 * Fzr * (bk ? longK : 1);
    if (bk) {
      // pulling back: rider weight moves rearward; pulling from rest-ish with the throttle open pops the clutch
      const pullIn = clamp(c.pull ?? 0, 0, 1);
      this.pull += clamp(pullIn - this.pull, -4 * dt, 6 * dt);
      if (pullIn > 0.5 && this.pullPrev <= 0.5 && c.throttle > 0.5 && this.wheelie < 0.05) this.clutchT = 0.35;
      this.pullPrev = pullIn;
      if (this.clutchT > 0) {
        this.clutchT -= dt;
        Fdrive *= 1 + 0.25 * clamp(1 - av / 30, 0, 1); // revs dumped through the clutch
        if (this.wheelie <= 0.001) this.pitchRate = Math.max(this.pitchRate, 0.45 * clamp(1 - av / 35, 0, 1) * c.throttle);
      }
    }
    if (bk && Fdrive > 0) {
      // traction control: 1 lets some spin through, 3 keeps the tyre just under the limit
      if (A.tc > 0) { const keep = [1, 1.3, 1.12, 0.98][A.tc]; if (Fdrive > capR * keep) { Fdrive = capR * keep; this.tcOn = true; } }
      // anti-wheelie: 3 keeps the front down, 2 / 1 allow a small / bigger lift before cutting power
      // riding assist: an assisted rider who deliberately pulls a wheelie keeps it balanced even on a bike whose stock
      // electronics have no anti-wheelie (otherwise it just loops out); manual riding leaves that entirely to you
      const awLvl = A.aw > 0 ? A.aw : !A.manual && this.pull > 0.3 ? 1 : 0;
      if (awLvl > 0) {
        // allow the front up to `cap`, then pick the drive that brings pitch back toward it
        // when the rider asks for a wheelie, levels 1 / 2 only stop a loop-out; 3 keeps it tiny
        const cap = this.pull > 0.3 ? [0, 0.55, 0.35, 0.08][awLvl] : [0, 0.1, 0.04, 0][awLvl], t = Math.max(0, this.wheelie);
        const bw = this.bEff;
        const hE = this.h * Math.cos(t) + bw * Math.sin(t), bE = bw * Math.cos(t) - this.h * Math.sin(t);
        const accWant = -14 * (t - cap * 0.8) - 5 * this.pitchRate;
        const Fmax = (this.m * (accWant * (this.h * this.h + bw * bw) * PITCH_I + G * bE)) / hE * (awLvl === 3 && this.pull < 0.3 ? 0.97 : 1);
        if (Fdrive > Fmax && (t > 0 || awLvl === 3 || Fmax < (this.m * G * bw) / this.h)) { Fdrive = Math.max(0, Fmax); this.awOn = true; }
      }
    }
    let FxF = 0, FxR = 0;
    let spin = 0;
    const distribute = (F: number, cap: number) => {
      if (Math.abs(F) <= cap) return [F, 0] as const;
      const over = Math.abs(F) / Math.max(1, cap) - 1;
      return [Math.sign(F) * cap * (1 - Math.min(0.15, over * 0.1)), over] as const;
    };
    if (sp.drive === 'RWD') { const [f, o] = distribute(Fdrive, capR); FxR = f; spin = o; }
    else if (sp.drive === 'FWD') { const [f, o] = distribute(Fdrive, capF); FxF = f; spin = o; }
    else {
      const [f1, o1] = distribute(Fdrive * 0.4, capF); const [f2, o2] = distribute(Fdrive * 0.6, capR);
      FxF = f1; FxR = f2; spin = Math.max(o1, o2) * 0.6;
    }
    this.wheelspin = lerp(this.wheelspin, clamp(spin, 0, 2), clamp(dt * 10, 0, 1));

    const brkAny = Math.max(c.brake, this.frontBrake);
    if (bk) {
      // separate levers: front does the real stopping, rear alone is weak (the rear unloads)
      const capFb = mu * Fzf * 1.05 * longK, capRb = mu * Fzr * 1.05 * longK;
      let fl = 0, rl = 0;
      if (v > 0.3) {
        const dF = sp.brakeG * 1.1 * W * this.frontBrake, dR = W * 0.6 * c.brake;
        // ABS 2 is cornering ABS: it also leaves side grip for the lean
        const capAbs = capFb * (A.abs >= 2 ? 0.98 * (1 - latUse * 0.7) : 0.93);
        if (dF > capFb || (A.abs >= 2 && dF > capAbs)) { if (A.abs > 0) { FxF -= Math.min(dF, capAbs); this.absOn = true; } else { FxF -= capFb * 0.75; fl = 1; } } else FxF -= dF;
        const capAbsR = capRb * (A.abs >= 2 ? 0.95 * (1 - latUse * 0.7) : 0.95);
        if (dR > capRb || (A.abs >= 2 && dR > capAbsR)) { if (A.abs > 0) { FxR -= Math.min(dR, capAbsR); this.absOn = true; } else { FxR -= capRb * 0.7; rl = 1; } } else FxR -= dR;
        // cornering ABS (level 2) also stops the rear from lifting
        if (A.abs >= 2) {
          const maxD = ((this.m * G * this.a) / this.h) * (this.wheelie < -0.01 ? 0.75 : 0.9), tot = -(FxF + FxR);
          if (tot > maxD) { const k = maxD / tot; FxF *= k; FxR *= k; this.absOn = true; }
        }
      }
      this.frontLock = fl; this.rearLock = rl;
      // engine braking off throttle (a slipper clutch keeps it from locking the rear)
      if (c.throttle < 0.05 && v > 2 && this.shiftT <= 0) FxR -= Math.min([0.3, 0.75, 1.3][A.eb] * this.Fpeak[this.gear - 1] * 0.16 * clamp(rN, 0.3, 1), capRb * 0.9 * (1 - latUse * 0.8));
    } else if (brkAny > 0 && v > 0.3) {
      // brakes (ABS-clamped)
      const Fb = sp.brakeG * W * brkAny;
      FxF -= Math.min(Fb * 0.68, mu * Fzf * 1.05);
      FxR -= Math.min(Fb * 0.32, mu * Fzr * 1.05);
    }
    if (c.handbrake && v > 0.5 && !bk) FxR -= Math.min(W * 0.6, mu * Fzr);

    // ---------------- steering ----------------
    const lockLimit = (this.L * mu * ARCADE_GRIP * G) / Math.max(25, v * v) + 0.11;
    let target: number;
    if (bk) {
      // steer by leaning. Assisted: the input asks for a turn and the bike leans only as far as
      // that turn needs, so at low speed (tight steering lock) it can't lean far. Manual: the input
      // leans the bike directly; lean the speed can't hold and the bike falls over.
      const ayGrip = mu * ARCADE_GRIP * G * 0.8; // assisted keeps a margin to the tyre limit
      const ayLock = (av * av * Math.tan(0.12)) / this.L;
      const hangT = A.manual ? clamp(c.hang ?? 0, -1, 1) : clamp(this.lean / 0.6, -1, 1) * 0.7;
      this.hang += clamp(hangT - this.hang, -3 * dt, 3 * dt);
      // the bike's own lean is capped by ground clearance; hanging off to the inside adds to it
      // The physical lean (what sets the turn radius) keeps its full range at every speed. Only the DRAWN lean is
      // limited by speed (see visLean): gyroscopic stiffness makes a real bike lean less at speed for the same turn.
      const maxLean = 0.9 + Math.max(0, this.hang * Math.sign(c.steer || this.lean)) * 0.14;
      let leanTarget = clamp(A.manual ? c.steer * 1.05 : Math.atan((c.steer * Math.min(ayGrip, ayLock)) / G), -maxLean, maxLean);
      // assisted: the bike never leans much past what the turn is actually holding (runs wide instead of falling)
      if (!A.manual && av > 3) leanTarget = clamp(leanTarget, this.leanEq - 0.35, this.leanEq + 0.35);
      const rate = sp.steerSpeed * 1.15 * clamp(0.45 + av / 25, 0.45, 1);
      this.lean += clamp(leanTarget - this.lean, -rate * dt, rate * dt);
      this.bikeLean = this.lean - this.hang * 0.14;
      target = av > 3 ? (this.L * G * Math.tan(this.lean)) / Math.max(9, v * v) + this.lean * 0.04 : c.steer * sp.steerLock;
      // high speed weave
      const wob = clamp((av / this.vTop - 0.82) / 0.18, 0, 1) * (1.1 - sp.stability * 0.6);
      this.wobble = wob;
      target += Math.sin(this.time * 38) * 0.004 * wob + Math.sin(this.time * 7.3) * 0.002 * wob;
      target = clamp(target, -sp.steerLock, sp.steerLock);
      this.steerAngle = target;
    } else {
      const lim = Math.min(sp.steerLock, lockLimit * (1 + sp.highSpeedSteer));
      target = c.steer * lim;
      // auto counter-steer toward the slide (arcade assist)
      const beta = av > 2 ? Math.atan2(this.vl, av) : 0;
      if (!c.handbrake) target += clamp(beta * sp.stability * 0.9, -0.25, 0.25);
      const rate = sp.steerSpeed * (Math.abs(target) < Math.abs(this.steerAngle) ? 1.6 : 1);
      this.steerAngle += clamp(target - this.steerAngle, -rate * dt, rate * dt);
    }
    const delta = this.steerAngle;

    // ---------------- lateral tyre forces ----------------
    let Fyf = 0, Fyr = 0, bikeGripF = 1, bikeGripR = 1;
    const lowBlend = clamp((av - 1.5) / 4, 0, 1); // 0 = kinematic at crawling speed
    if (lowBlend > 0) {
      const vx = Math.max(av, 1.5) * Math.sign(v || 1);
      const alphaF = Math.atan2(this.vl + this.a * this.r, Math.abs(vx)) - delta * Math.sign(vx);
      const alphaR = Math.atan2(this.vl - this.b * this.r, Math.abs(vx));
      // friction circle: longitudinal usage & wheelspin reduce lateral grip
      const useF = clamp(Math.abs(FxF) / Math.max(1, mu * Fzf), 0, 0.98);
      const useR = clamp(Math.abs(FxR) / Math.max(1, mu * Fzr), 0, 0.98);
      let gripF = sp.frontGrip * Math.sqrt(1 - useF * useF * 0.8);
      let gripR = sp.rearGrip * Math.sqrt(1 - useR * useR * 0.8);
      if (sp.drive === 'RWD') gripR *= 1 - clamp(this.wheelspin * sp.powerOversteer * 0.45, 0, 0.55);
      if (sp.drive === 'FWD') gripF *= 1 - clamp(this.wheelspin * 0.4, 0, 0.5);
      if (sp.drive === 'AWD') gripR *= 1 - clamp(this.wheelspin * sp.powerOversteer * 0.3, 0, 0.4);
      if (c.handbrake && !bk) gripR *= 0.35;
      if (bk) {
        // tyre edge: grip falls off at extreme bike lean; a locked wheel has almost no side grip
        const edge = 1 - 0.12 * clamp((Math.abs(this.bikeLean) - 0.6) / 0.35, 0, 1);
        gripF *= edge * (this.frontLock ? 0.25 : 1); gripR *= edge * (this.rearLock ? 0.4 : 1);
        gripR *= 1 - clamp(this.wheelspin * 0.6, 0, 0.7);
      }
      if (bk) { bikeGripF = gripF; bikeGripR = gripR; }
      Fyf = this.lat(alphaF, Fzf, mu * gripF, false) * Math.sign(vx);
      Fyr = this.lat(alphaR, Fzr, mu * gripR, true) * Math.sign(vx);
      this.slip = clamp((Math.abs(alphaR) + Math.abs(alphaF) * 0.6 - 0.08) * 4, 0, 1.5) * lowBlend;
    } else this.slip = 0;
    // bikes ride on the lean, not on slip angles: the lean sets the turn and the tyres cap it
    const bikeLat = bk && av > 3 && this.wheelie <= 0.02;
    if (bikeLat) { Fyf = 0; Fyr = 0; }

    // ---------------- integrate body velocities ----------------
    const drag = this.cD * v * Math.abs(v) + (av > 0.1 ? 0.012 * W * Math.sign(v) : 0) + (this.onGrass ? 0.25 * W * Math.sign(v) * clamp(av / 3, 0, 1) : 0);
    const Fgrade = -W * grade;
    const cosd = Math.cos(delta), sind = Math.sin(delta);
    const Fx = FxF * cosd - Fyf * sind + FxR - drag + Fgrade;
    let dv = Fx / this.m + this.vl * this.r * lowBlend;
    if (brkAny > 0 && v <= 0.3 && v >= 0 && !reverse) dv = Math.min(dv, 0);
    this.v += dv * dt;
    if (!reverse && this.v < 0 && brkAny > 0) this.v = Math.max(this.v, 0);
    if (this.v < 0 && Fdrive > 0) this.v += 4 * dt;

    const dvl = (Fyf * cosd + FxF * sind + Fyr) / this.m - this.v * this.r;
    const Mz = this.a * (Fyf * cosd + FxF * sind) - this.b * Fyr;
    let dr = Mz / this.Iz;
    // yaw damping assist, stronger with stability
    dr -= this.r * stab * 0.4 * lowBlend;
    // ESC-lite: pull yaw rate back toward what the grip can support (weaker for low-stability cars)
    if (!c.handbrake && av > 5) {
      const rLim = (mu * ARCADE_GRIP * G * 1.05) / av;
      const over = Math.abs(this.r) - rLim;
      if (over > 0) dr -= Math.sign(this.r) * over * (2 + 14 * stab * stab) * lowBlend;
      // sideslip recovery torque (arcade): straightens a slide once the driver counter-steers or lifts
      const beta = Math.atan2(this.vl, av);
      dr += beta * (0.8 + 5 * stab) * (1 - 0.5 * c.throttle) * lowBlend;
    }
    if (bk && this.wheelie > 0.02 && av > 3) {
      // front in the air: lean steers the bike gently on the rear tyre
      const rT = (G * Math.tan(this.lean) * 0.35) / Math.max(5, av);
      dr = (rT - this.r) * 4;
    }
    if (bikeLat) {
      // each tyre's side force is its own load x tan(lean): overload = tan(lean) / what that tyre can give
      const tl = Math.abs(Math.tan(this.lean));
      const fOver = tl / Math.max(0.05, mu * ARCADE_GRIP * bikeGripF), rOver = tl / Math.max(0.05, mu * ARCADE_GRIP * bikeGripR);
      // the turn can't be tighter than the steering allows at this speed (too slow for the lean = falls in)
      const ayLockMax = (av * av * Math.tan(0.16)) / this.L;
      let ay = Math.sign(this.lean) * Math.min(G * tl, ayLockMax);
      // front over its limit: the turn widens (the bike runs wide / tucks if the lean is held)
      if (fOver > 1) ay /= fOver;
      this.ayTurn = ay;
      const ayD = ay;
      // rear over its limit: the rear steps out; when it grips again the slide dies away
      if (rOver > 1) this.vl -= Math.sign(ayD) * Math.min(12, (rOver - 1) * 9) * dt;
      else this.vl *= Math.exp(-(3 + 3 * stab) * dt);
      const rT = ay / Math.max(3, this.v) - this.vl * 0.35;
      this.r += (rT - this.r) * clamp(dt * 12, 0, 1);
      this.slip = clamp(Math.max(fOver, rOver) - 0.92, 0, 1) * 4 + Math.abs(this.vl) * 0.15;
    } else if (lowBlend > 0) {
      this.vl += dvl * dt * lowBlend;
      this.r += dr * dt * lowBlend;
    }
    // kinematic blend at very low speed
    const rKin = (this.v * Math.tan(delta)) / this.L;
    if (!bikeLat) { this.r = lerp(rKin, this.r, lowBlend); this.vl = lerp(0, this.vl, lowBlend); }
    // keep slides recoverable: cap sideslip
    const maxVl = Math.max(2, av * 0.9);
    this.vl = clamp(this.vl, -maxVl, maxVl);
    this.r = clamp(this.r, -3.5, 3.5);

    this.ax = lerp(this.ax, Fx / this.m, clamp(dt * 8, 0, 1));
    this.ay = lerp(this.ay, this.v * this.r + dvl * 0.1, clamp(dt * 8, 0, 1));

    if (bk) this.bikeStep(dt, Fx / this.m, av);

    // ---------------- road-frame kinematics ----------------
    const cp = Math.cos(this.psi), spsi = Math.sin(this.psi);
    const sdot = (this.v * cp - this.vl * spsi) / (1 + curvature * this.d);
    const ddot = -this.v * spsi - this.vl * cp;
    this.s += sdot * dt;
    this.d += ddot * dt;
    this.psi += (this.r - curvature * sdot) * dt;
    // wheel spin visuals
    this.frontRot += (this.v / 0.33) * dt;
    this.rearRot += ((this.v + this.wheelspin * 6 * Math.sign(c.throttle)) / 0.33) * dt;
    return sdot;
  }

  /** bikes: pitch dynamics (wheelie / stoppie about the contact patch), tyre heat, falls */
  private bikeStep(dt: number, Ax: number, av: number) {
    // ---- pitch: torque about the wheel still on the ground ----
    const th = this.wheelie, bw = this.bEff;
    const liftF = Ax * this.h - G * bw, liftR = -Ax * this.h - G * this.a;
    let acc = 0;
    if (th > 1e-4 || (th >= 0 && liftF > 0 && av > 0.5)) {
      const t = Math.max(0, th);
      const hE = this.h * Math.cos(t) + bw * Math.sin(t), bE = bw * Math.cos(t) - this.h * Math.sin(t);
      acc = (Ax * hE - G * bE) / ((this.h * this.h + bw * bw) * PITCH_I);
    } else if (th < -1e-4 || (liftR > 0 && av > 0.5)) {
      const t = Math.max(0, -th);
      const hE = this.h * Math.cos(t) + this.a * Math.sin(t), aE = this.a * Math.cos(t) - this.h * Math.sin(t);
      acc = -(-Ax * hE - G * aE) / ((this.h * this.h + this.a * this.a) * PITCH_I);
    } else { this.pitchRate = 0; }
    // the rider heaves on the bars when a wheelie is asked for: extra lift that fades with speed, so a wheelie is
    // possible from a standstill up to roughly 100 mph (engine torque alone only lifts the front at low speed)
    if (this.pull > 0.5 && this.throttle > 0.5 && th >= 0) acc += 3 * this.pull * clamp(1 - th / 0.4, 0, 1) * clamp(1 - av / 55, 0, 1) * (this.aids.manual ? 0.6 : 1);
    if (acc !== 0 || th !== 0 || this.pitchRate !== 0) {
      this.pitchRate = (this.pitchRate + acc * dt) * Math.exp(-2 * dt);
      this.wheelie += this.pitchRate * dt;
      // landing: the wheel comes back down (suspension soaks it up)
      if ((th > 0 && this.wheelie <= 0) || (th < 0 && this.wheelie >= 0)) { this.wheelie = 0; this.pitchRate = 0; }
    }
    this.wheelieT = this.wheelie > 0.1 ? this.wheelieT + dt : 0;

    // ---- tyres warm with work, cool toward ambient, and wear ----
    const work = (Math.abs(this.ay) / G) * 0.02 + (Math.abs(this.ax) / G) * 0.02 + this.wheelspin * 0.05 + this.slip * 0.05 + (this.frontLock + this.rearLock) * 0.06;
    this.tyreTemp += (0.03 * Math.min(1, av / 25) + work - 0.06 * (this.tyreTemp - 0.3)) * dt;
    this.tyreWear = Math.min(1, this.tyreWear + (0.0004 + 0.004 * (this.wheelspin + this.slip + this.frontLock + this.rearLock)) * dt * Math.min(1, av / 10));

    // ---- falls ----
    if (this.fall) return;
    if (this.wheelie > Math.atan2(this.bEff, this.h) + 0.12) { this.fall = 'looped'; return; }
    if (this.wheelie < -(Math.atan2(this.a, this.h) + 0.1)) { this.fall = 'endo'; return; }
    // balance: a lean the current turn doesn't support (too slow, or the front washed out)
    this.leanEq = Math.atan(this.ayTurn / G);
    const mis = Math.abs(this.lean - this.leanEq);
    this.unbalanced = mis > 0.45 && this.wheelie <= 0.05 ? this.unbalanced + dt : Math.max(0, this.unbalanced - dt * 2);
    if (this.unbalanced > 0.3 || (av < 0.8 && Math.abs(this.lean) > 0.3)) { this.fall = av < 8 ? 'tipover' : 'lowside'; return; }
    // a locked front tucks: almost instantly when leaned, after a moment when upright
    this.washout = this.frontLock ? this.washout + dt : Math.max(0, this.washout - dt * 2);
    if (this.washout > (Math.abs(this.lean) > 0.15 ? 0.12 : 0.7) && av > 3) { this.fall = 'lowside'; return; }
    // rear slides: too far = lowside; a big slide that suddenly grips again = highside
    const beta = Math.atan2(this.vl, Math.max(1, av));
    if (Math.abs(beta) > 0.5 && Math.abs(this.lean) > 0.3) { this.fall = 'lowside'; return; }
    this.slideT = Math.abs(beta) > 0.14 ? this.slideT + dt : Math.max(0, this.slideT - dt * 3);
    if (this.slideT > 0.25 && this.lastSpin - this.wheelspin > 1.2 * dt * 10 && Math.abs(this.lean) > 0.25) { this.fall = 'highside'; return; }
    this.lastSpin = this.wheelspin;
  }

  /** lateral velocity in road frame (+ right), for barrier impacts */
  get dDot() { return -this.v * Math.sin(this.psi) - this.vl * Math.cos(this.psi); }
  get speed() { return Math.hypot(this.v, this.vl); }
}
