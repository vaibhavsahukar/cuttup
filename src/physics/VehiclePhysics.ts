import type { VehicleSpec } from '../data/vehicles';
import { clamp, lerp } from '../core/math';

/**
 * Arcade vehicle dynamics in road coordinates.
 *  - Dynamic bicycle model (front / rear axle) with a simplified Pacejka lateral curve.
 *  - Longitudinal load transfer (cg height), downforce, drag, rolling resistance, grade.
 *  - Engine torque curve + automatic gearbox; drive layout decides which axle can put power down,
 *    and wheelspin eats that axle's lateral grip (friction circle) -> power oversteer for RWD.
 *  - Arcade assists: limit-aware steering, auto counter-steer and yaw damping scaled by `stability`.
 *  - Motorcycles steer by leaning; wheelie / stoppie emerge from load transfer.
 * Position is kept as (s along road, d lateral + right, psi heading relative to road + left).
 */
export const G = 9.81;
const MPH = 0.44704;
/** arcade lateral grip multiplier: makes cornering and lane changes much easier than real tyres */
export const ARCADE_GRIP = 1.35;

export interface Controls { throttle: number; brake: number; steer: number; handbrake: boolean }

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
  throttle = 0; brake = 0;

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
    const vg1 = vgN * (this.bike ? 0.36 : n >= 8 ? 0.2 : n === 7 ? 0.24 : 0.28);
    const q = Math.pow(vgN / vg1, 1 / (n - 1));
    this.gearTop = [];
    for (let i = 0; i < n; i++) this.gearTop.push(vg1 * Math.pow(q, i));
    // K = max(T(r) * r) so that peak power == P in every gear
    let K = 0;
    for (let r = 0.05; r <= 1; r += 0.01) K = Math.max(K, this.torque(r) * r);
    this.K = K;
    this.Fpeak = this.gearTop.map((vg) => this.P / (K * vg));
    this.rpm = spec.idleRpm;
    if (calibrate) this.launchK = VehiclePhysics.calibrate(spec);
  }

  /** time for 0-60 mph at full throttle with a given launch factor */
  static zeroSixty(spec: VehicleSpec, k: number) {
    const p = new VehiclePhysics(spec, false);
    p.launchK = k;
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
    this.steerAngle = 0; this.lean = 0; this.wheelie = 0;
    this.gear = 1;
    while (this.gear < this.spec.gears && v > this.gearTop[this.gear - 1] * 0.85) this.gear++;
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
    this.throttle = c.throttle; this.brake = c.brake;
    const v = this.v;
    const av = Math.abs(v);
    const mu = sp.tireMu * (this.onGrass ? 0.55 : 1);
    const down = sp.downforce * v * v;

    // ---------------- loads ----------------
    const W = this.m * G;
    let Fzf = (W * this.b) / this.L - (this.m * this.ax * this.h) / this.L + down * 0.45;
    let Fzr = (W * this.a) / this.L + (this.m * this.ax * this.h) / this.L + down * 0.55;
    const minLoad = this.bike ? 0 : W * 0.08;
    Fzf = Math.max(minLoad, Fzf); Fzr = Math.max(minLoad, Fzr);

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
    const reverse = c.brake > 0.5 && c.throttle < 0.1 && v < 1.0;
    if (this.shiftT <= 0) Fdrive = c.throttle * this.Fpeak[this.gear - 1] * this.torque(Math.min(1, clutchR));
    if (rN >= 1.0) Fdrive = 0; // rev limiter
    // traction control, strength by stability (ZR1 ~ nearly off, Huracan strong)
    Fdrive *= 1 - clamp(this.wheelspin * sp.stability * sp.stability * 1.5, 0, 0.6);
    if (v > this.vLimit && sp.limited) Fdrive *= clamp(1 - (v - this.vLimit) * 0.5, 0, 1); // governor
    if (reverse) Fdrive = -this.m * 3;
    const targetRpm = sp.idleRpm + (sp.redline - sp.idleRpm) * clamp(clutchR, 0, 1.02);
    this.rpm = lerp(this.rpm, this.shiftT > 0 ? targetRpm * 0.85 : targetRpm, clamp(dt * 18, 0, 1));

    // ---------------- traction per axle ----------------
    const lk = lerp(this.launchK, 1, clamp((av - 25) / 15, 0, 1));
    const lm = sp.launchMu * lk;
    Fdrive *= lk;
    const capF = mu * lm * 1.18 * Fzf, capR = mu * lm * 1.18 * Fzr;
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

    // brakes (ABS-clamped)
    if (c.brake > 0 && v > 0.3) {
      const Fb = sp.brakeG * W * c.brake;
      FxF -= Math.min(Fb * 0.68, mu * Fzf * 1.05);
      FxR -= Math.min(Fb * 0.32, mu * Fzr * 1.05);
    }
    if (c.handbrake && v > 0.5) FxR -= Math.min(W * 0.6, mu * Fzr);
    // bikes: stoppie / wheelie limit from load transfer: never let a wheel go below zero load too far
    if (this.bike) {
      const maxAcc = (G * this.b) / this.h; // front unloads
      const maxDec = (G * this.a) / this.h; // rear unloads
      const Fx = FxF + FxR;
      if (Fx > this.m * maxAcc * 1.08) { const k = (this.m * maxAcc * 1.08) / Fx; FxF *= k; FxR *= k; }
      if (Fx < -this.m * maxDec * 1.08) { const k = (-this.m * maxDec * 1.08) / Fx; FxF *= k; FxR *= k; }
    }

    // ---------------- steering ----------------
    const lockLimit = (this.L * mu * ARCADE_GRIP * G) / Math.max(25, v * v) + 0.11;
    let target: number;
    if (this.bike) {
      // steer by leaning: input sets target lean, lean drives the turn
      const maxLean = Math.min(1.0, Math.atan(mu * ARCADE_GRIP * 0.95)) * clamp(av / 6, 0, 1);
      const leanTarget = c.steer * maxLean;
      const rate = sp.steerSpeed * 1.15;
      this.lean += clamp(leanTarget - this.lean, -rate * dt, rate * dt);
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
    let Fyf = 0, Fyr = 0;
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
      if (c.handbrake) gripR *= 0.35;
      Fyf = this.lat(alphaF, Fzf, mu * gripF, false) * Math.sign(vx);
      Fyr = this.lat(alphaR, Fzr, mu * gripR, true) * Math.sign(vx);
      this.slip = clamp((Math.abs(alphaR) + Math.abs(alphaF) * 0.6 - 0.08) * 4, 0, 1.5) * lowBlend;
    } else this.slip = 0;

    // ---------------- integrate body velocities ----------------
    const drag = this.cD * v * Math.abs(v) + (av > 0.1 ? 0.012 * W * Math.sign(v) : 0) + (this.onGrass ? 0.25 * W * Math.sign(v) * clamp(av / 3, 0, 1) : 0);
    const Fgrade = -W * grade;
    const cosd = Math.cos(delta), sind = Math.sin(delta);
    const Fx = FxF * cosd - Fyf * sind + FxR - drag + Fgrade;
    let dv = Fx / this.m + this.vl * this.r * lowBlend;
    if (c.brake > 0 && v <= 0.3 && v >= 0 && !reverse) dv = Math.min(dv, 0);
    this.v += dv * dt;
    if (!reverse && this.v < 0 && c.brake > 0) this.v = Math.max(this.v, 0);
    if (this.v < 0 && Fdrive > 0) this.v += 4 * dt;

    const dvl = (Fyf * cosd + FxF * sind + Fyr) / this.m - this.v * this.r;
    const Mz = this.a * (Fyf * cosd + FxF * sind) - this.b * Fyr;
    let dr = Mz / this.Iz;
    // yaw damping assist, stronger with stability
    dr -= this.r * sp.stability * 0.4 * lowBlend;
    // ESC-lite: pull yaw rate back toward what the grip can support (weaker for low-stability cars)
    if (!c.handbrake && av > 5) {
      const rLim = (mu * ARCADE_GRIP * G * 1.05) / av;
      const over = Math.abs(this.r) - rLim;
      if (over > 0) dr -= Math.sign(this.r) * over * (2 + 14 * sp.stability * sp.stability) * lowBlend;
      // sideslip recovery torque (arcade): straightens a slide once the driver counter-steers or lifts
      const beta = Math.atan2(this.vl, av);
      dr += beta * (0.8 + 5 * sp.stability) * (1 - 0.5 * c.throttle) * lowBlend;
    }
    if (lowBlend > 0) {
      this.vl += dvl * dt * lowBlend;
      this.r += dr * dt * lowBlend;
    }
    // kinematic blend at very low speed
    const rKin = (this.v * Math.tan(delta)) / this.L;
    this.r = lerp(rKin, this.r, lowBlend);
    this.vl = lerp(0, this.vl, lowBlend);
    // keep slides recoverable: cap sideslip
    const maxVl = Math.max(2, av * 0.9);
    this.vl = clamp(this.vl, -maxVl, maxVl);
    this.r = clamp(this.r, -3.5, 3.5);

    this.ax = lerp(this.ax, Fx / this.m, clamp(dt * 8, 0, 1));
    this.ay = lerp(this.ay, this.v * this.r + dvl * 0.1, clamp(dt * 8, 0, 1));

    // bike pitch (wheelie / stoppie)
    if (this.bike) {
      const maxAcc = (G * this.b) / this.h, maxDec = (G * this.a) / this.h;
      // front lifts when acceleration approaches the load-transfer limit (low gears, full throttle)
      const up = clamp((this.ax / maxAcc - 0.45) * 2.5, 0, 1) * clamp((c.throttle - 0.7) * 4, 0, 1) * clamp(1 - av / 45, 0, 1);
      const stp = clamp((-this.ax / maxDec - 0.6) * 3, 0, 1) * clamp((c.brake - 0.7) * 4, 0, 1) * clamp(av / 8, 0, 1);
      const tgt = up * (sp.id === 'smc' ? 0.5 : 0.2) - stp * 0.16;
      this.wheelie = lerp(this.wheelie, tgt, clamp(dt * 3, 0, 1));
    }

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

  /** lateral velocity in road frame (+ right), for barrier impacts */
  get dDot() { return -this.v * Math.sin(this.psi) - this.vl * Math.cos(this.psi); }
  get speed() { return Math.hypot(this.v, this.vl); }
}
