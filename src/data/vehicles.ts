/**
 * SINGLE SOURCE OF TRUTH for vehicle stats and handling tuning.
 * Units: SI (kg, m, W, m/s). Real-world numbers are tuning inputs; the physics
 * converts them consistently. See README "Tuning knobs".
 */
export type Drive = 'RWD' | 'FWD' | 'AWD';
export type Kind = 'car' | 'bike';

export interface VehicleSpec {
  id: string;
  name: string;
  kind: Kind;
  model: string; // procedural model key
  color: number;
  hp: number;
  massKg: number;
  drive: Drive;
  zeroSixty: number; // reference, seconds (used for stats bars & verification)
  topSpeedMph: number; // governed/real top speed
  limited?: boolean; // electronically limited top speed
  character: string;
  // ----- handling knobs -----
  gears: number;
  redline: number; // rpm
  idleRpm: number;
  torquePeak: number; // 0..1 fraction of redline where torque peaks (low = diesel-ish shove)
  torqueFlat: number; // 0..1 how flat the torque curve is (1 = supercharged flat)
  tireMu: number; // peak lateral/longitudinal friction coefficient
  launchMu: number; // longitudinal grip multiplier for driven wheels (tire width)
  frontGrip: number; // >1 more front grip (oversteer), <1 understeer
  rearGrip: number;
  /** bikes: how readily the front lifts and how long a wheelie holds (1 = a sport bike, a supermoto is well above) */
  wheelieK?: number;
  powerOversteer: number; // how much wheelspin kills rear lateral grip (0..1.5)
  cgHeight: number; // m
  wheelbase: number; // m
  frontWeight: number; // static front weight fraction
  track: number; // m
  rollFactor: number; // visual body roll per g (rad)
  pitchFactor: number; // visual pitch per g (rad)
  brakeG: number; // max braking deceleration in g (before grip)
  downforce: number; // N per (m/s)^2
  /** bikes: stock rider electronics, the highest level each aid can be set to (0 = not fitted) */
  electronics?: { abs: number; tc: number; aw: number };
  steerLock: number; // rad at low speed
  steerSpeed: number; // rad/s steering rate
  highSpeedSteer: number; // fraction of lock kept at 60 m/s
  stability: number; // 0..1 arcade yaw assist (counter-steer help)
  yawInertia: number; // multiplier on m*(L/2)^2 (higher = slower to change direction)
  dims: { length: number; width: number; height: number };
  engine: { cylinders: number; tone: number; roughness: number };
}

const base = {
  gears: 6, redline: 7000, idleRpm: 900, torquePeak: 0.6, torqueFlat: 0.6,
  tireMu: 1.1, launchMu: 1, frontGrip: 1, rearGrip: 1, powerOversteer: 0.6,
  rollFactor: 0.05, pitchFactor: 0.025, brakeG: 1.1, downforce: 0.3,
  steerLock: 0.55, steerSpeed: 2.6, highSpeedSteer: 0.18, stability: 0.6, yawInertia: 1,
};

export const VEHICLES: VehicleSpec[] = [
  // ---------------- MOTORCYCLES ----------------
  { ...base, id: 'cbr650', name: 'Honder CCR650R', kind: 'bike', model: 'cbr650', color: 0xc8141c, electronics: { abs: 2, tc: 1, aw: 0 },
    hp: 94, massKg: 208 + 75, drive: 'RWD', zeroSixty: 3.6, topSpeedMph: 140,
    character: 'Inline four with a broad midrange, neutral and easy to ride',
    gears: 6, redline: 12500, idleRpm: 1400, torquePeak: 0.76, torqueFlat: 0.45,
    tireMu: 1.18, frontGrip: 1.04, powerOversteer: 0.25, cgHeight: 0.74, wheelbase: 1.37, frontWeight: 0.5, track: 0.2,
    rollFactor: 0, pitchFactor: 0.045, brakeG: 1.15, downforce: 0.02, steerLock: 0.5, steerSpeed: 3.9, highSpeedSteer: 0.2,
    stability: 0.92, yawInertia: 0.85,
    dims: { length: 2.03, width: 0.69, height: 1.13 }, engine: { cylinders: 4, tone: 1.35, roughness: 0.15 } },
  { ...base, id: 'r6', name: 'Yamiha R6', kind: 'bike', model: 'r6', color: 0x1f4fbf, electronics: { abs: 2, tc: 3, aw: 3 },
    hp: 118, massKg: 190 + 75, drive: 'RWD', zeroSixty: 3.1, topSpeedMph: 160,
    character: 'Screaming 16k rpm inline four, sharp and light, lives at the top of the rev range',
    gears: 6, redline: 16000, idleRpm: 1400, torquePeak: 0.85, torqueFlat: 0.3,
    tireMu: 1.18, frontGrip: 1.04, powerOversteer: 0.25, cgHeight: 0.74, wheelbase: 1.37, frontWeight: 0.5, track: 0.2,
    rollFactor: 0, pitchFactor: 0.045, brakeG: 1.15, downforce: 0.02, steerLock: 0.5, steerSpeed: 4.2, highSpeedSteer: 0.2,
    stability: 0.92, yawInertia: 0.85,
    dims: { length: 2.04, width: 0.7, height: 1.15 }, engine: { cylinders: 4, tone: 1.6, roughness: 0.15 } },
  { ...base, id: 'zx6r', name: 'ZR6X Samurai', kind: 'bike', model: 'zx6r', color: 0x131416, electronics: { abs: 2, tc: 3, aw: 2 },
    hp: 122, massKg: 197 + 75, drive: 'RWD', zeroSixty: 3.2, topSpeedMph: 160,
    character: 'Torquey inline four, calm and stable at speed, holds a line and forgives mid corner changes',
    gears: 6, redline: 16000, idleRpm: 1400, torquePeak: 0.72, torqueFlat: 0.5,
    tireMu: 1.18, frontGrip: 1.04, powerOversteer: 0.25, cgHeight: 0.74, wheelbase: 1.4, frontWeight: 0.5, track: 0.2,
    rollFactor: 0, pitchFactor: 0.045, brakeG: 1.15, downforce: 0.02, steerLock: 0.5, steerSpeed: 3.7, highSpeedSteer: 0.2,
    stability: 0.96, yawInertia: 0.9,
    dims: { length: 2.03, width: 0.72, height: 1.11 }, engine: { cylinders: 4, tone: 1.5, roughness: 0.12 } },
  { ...base, id: 'fs450', name: 'Husky SF450', kind: 'bike', model: 'fs450', color: 0xf1f3f5, electronics: { abs: 1, tc: 0, aw: 1 },
    hp: 63, massKg: 115 + 75, drive: 'RWD', zeroSixty: 3.6, topSpeedMph: 110,
    character: 'Supermoto: featherweight, the quickest to flick side to side, wheelies on a whim, rear steps out when you ask it to',
    gears: 5, redline: 11500, idleRpm: 1900, torquePeak: 0.55, torqueFlat: 0.55, wheelieK: 2.4,
    tireMu: 1.22, frontGrip: 1.04, powerOversteer: 0.6, cgHeight: 0.86, wheelbase: 1.48, frontWeight: 0.44, track: 0.2,
    rollFactor: 0, pitchFactor: 0.075, brakeG: 1.15, downforce: 0.01, steerLock: 0.55, steerSpeed: 5.4, highSpeedSteer: 0.24,
    stability: 0.66, yawInertia: 0.62,
    dims: { length: 2.1, width: 0.7, height: 1.2 }, engine: { cylinders: 1, tone: 1.0, roughness: 0.5 } },
  { ...base, id: 'zr1', name: 'Conquette', kind: 'car', model: 'zr1', color: 0x0c0c0e,
    hp: 638, massKg: 1530, drive: 'RWD', zeroSixty: 3.3, topSpeedMph: 205,
    character: 'Brutal supercharged torque, tail-happy on throttle, stable at speed',
    gears: 6, redline: 6600, idleRpm: 800, torquePeak: 0.58, torqueFlat: 0.92,
    tireMu: 1.08, launchMu: 1.05, frontGrip: 1.0, rearGrip: 1.02, powerOversteer: 1.35,
    cgHeight: 0.46, wheelbase: 2.69, frontWeight: 0.51, track: 1.6, rollFactor: 0.03, pitchFactor: 0.02,
    brakeG: 1.2, downforce: 0.9, steerLock: 0.52, steerSpeed: 2.6, highSpeedSteer: 0.16, stability: 0.35, yawInertia: 1.0,
    dims: { length: 4.46, width: 1.93, height: 1.24 }, engine: { cylinders: 8, tone: 0.8, roughness: 0.45 } },
  { ...base, id: 'm4', name: 'BWM W4', kind: 'car', model: 'm4', color: 0x1d5fd6,
    hp: 503, massKg: 1725, drive: 'RWD', zeroSixty: 3.8, topSpeedMph: 155, limited: true,
    character: 'Balanced, oversteers on throttle',
    gears: 7, redline: 7500, idleRpm: 800, torquePeak: 0.4, torqueFlat: 0.85,
    tireMu: 1.06, launchMu: 0.95, frontGrip: 1.0, rearGrip: 1.0, powerOversteer: 0.95,
    cgHeight: 0.5, wheelbase: 2.81, frontWeight: 0.52, track: 1.58, rollFactor: 0.045,
    brakeG: 1.12, downforce: 0.3, steerLock: 0.54, steerSpeed: 2.8, stability: 0.55, yawInertia: 1.0,
    dims: { length: 4.8, width: 1.89, height: 1.39 }, engine: { cylinders: 6, tone: 1.0, roughness: 0.3 } },
  { ...base, id: 'huracan', name: 'Hurricane', kind: 'car', model: 'huracan', color: 0x33c436,
    hp: 630, massKg: 1500, drive: 'AWD', zeroSixty: 2.9, topSpeedMph: 200,
    character: 'Huge grip, explosive acceleration, stable',
    gears: 7, redline: 8500, idleRpm: 1000, torquePeak: 0.75, torqueFlat: 0.6,
    tireMu: 1.22, launchMu: 1.15, frontGrip: 1.0, rearGrip: 1.05, powerOversteer: 0.25,
    cgHeight: 0.42, wheelbase: 2.62, frontWeight: 0.43, track: 1.67, rollFactor: 0.025,
    brakeG: 1.3, downforce: 1.0, steerLock: 0.52, steerSpeed: 3.0, stability: 0.85, yawInertia: 0.95,
    dims: { length: 4.46, width: 1.93, height: 1.17 }, engine: { cylinders: 10, tone: 1.15, roughness: 0.25 } },
  { ...base, id: 'civic', name: 'Honder Civiz', kind: 'car', model: 'civic', color: 0xf2f2f2,
    hp: 315, massKg: 1430, drive: 'FWD', zeroSixty: 5.0, topSpeedMph: 171,
    character: 'Sharp front drive hot hatch, grips hard, understeers at the limit',
    gears: 6, redline: 6800, idleRpm: 750, torquePeak: 0.35, torqueFlat: 0.8,
    tireMu: 1.1, launchMu: 0.95, frontGrip: 0.9, rearGrip: 1.08, powerOversteer: 0,
    cgHeight: 0.52, wheelbase: 2.7, frontWeight: 0.61, track: 1.55, rollFactor: 0.06,
    brakeG: 1.0, downforce: 0.05, steerLock: 0.58, steerSpeed: 3.2, stability: 0.8, yawInertia: 0.85,
    dims: { length: 4.6, width: 1.89, height: 1.41 }, engine: { cylinders: 4, tone: 1.05, roughness: 0.2 } },
  { ...base, id: 'tesla', name: 'Tesler', kind: 'car', model: 'tesla', color: 0xb3141c,
    hp: 450, massKg: 1847, drive: 'AWD', zeroSixty: 3.2, topSpeedMph: 155, limited: true,
    character: 'Silent instant torque, heavy battery keeps it planted',
    gears: 1, redline: 16000, idleRpm: 0, torquePeak: 0.05, torqueFlat: 0.95,
    tireMu: 1.08, launchMu: 1.1, frontGrip: 0.98, rearGrip: 1.04, powerOversteer: 0.2,
    cgHeight: 0.46, wheelbase: 2.88, frontWeight: 0.48, track: 1.58, rollFactor: 0.045,
    brakeG: 1.1, downforce: 0.2, steerLock: 0.55, steerSpeed: 2.8, stability: 0.85, yawInertia: 1.1,
    dims: { length: 4.69, width: 1.85, height: 1.44 }, engine: { cylinders: 0, tone: 1, roughness: 0 } },
  { ...base, id: 'c63', name: 'Mercado C65 S', kind: 'car', model: 'c63', color: 0x111214,
    hp: 500, massKg: 1750, drive: 'RWD', zeroSixty: 3.8, topSpeedMph: 180,
    character: 'Torque-heavy, easy to oversteer',
    gears: 7, redline: 7000, idleRpm: 700, torquePeak: 0.3, torqueFlat: 0.9,
    tireMu: 1.06, launchMu: 1.0, frontGrip: 1.03, rearGrip: 0.97, powerOversteer: 1.15,
    cgHeight: 0.52, wheelbase: 2.84, frontWeight: 0.55, track: 1.6, rollFactor: 0.05,
    brakeG: 1.12, downforce: 0.3, steerLock: 0.54, steerSpeed: 2.7, stability: 0.45, yawInertia: 1.05,
    dims: { length: 4.75, width: 1.84, height: 1.43 }, engine: { cylinders: 8, tone: 0.82, roughness: 0.5 } },

];

export const getVehicle = (id: string) => VEHICLES.find((v) => v.id === id) ?? VEHICLES.find((v) => v.id === 'zr1')!;

/** Stats for menu bars, normalised 0..1 across the roster. */
export function statBars(v: VehicleSpec) {
  const clamp01 = (x: number) => Math.max(0.05, Math.min(1, x));
  return {
    speed: clamp01((v.topSpeedMph - 100) / 110),
    accel: clamp01((8 - v.zeroSixty) / 5.3),
    handling: clamp01(((v.tireMu - 0.85) / 0.4) * 0.6 + (v.steerSpeed / 5.2) * 0.25 + (1.5 - v.yawInertia) * 0.3),
    braking: clamp01((v.brakeG - 0.8) / 0.55),
    control: clamp01(v.stability * 0.8 + (1.4 - v.powerOversteer) * 0.2),
  };
}
