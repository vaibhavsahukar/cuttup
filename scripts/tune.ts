// Headless handling verification: straight-line launch, top speed, braking, max lateral g, throttle-oversteer.
import { VEHICLES } from '../src/data/vehicles';
import { VehiclePhysics } from '../src/physics/VehiclePhysics';
const dt = 1 / 240, MPH = 2.23694;
const rows: string[] = [];
for (const spec of VEHICLES) {
  const p = new VehiclePhysics(spec);
  p.reset(0, 0, 0);
  let t = 0, t60 = NaN, t100 = NaN;
  while (t < 150) {
    p.step(dt, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 0, 0);
    t += dt;
    if (isNaN(t60) && p.v * MPH >= 60) t60 = t;
    if (isNaN(t100) && p.v * MPH >= 100) t100 = t;
  }
  const top = p.v * MPH;
  // braking 60-0
  const b = new VehiclePhysics(spec); b.reset(0, 0, 60 / MPH);
  const s0 = b.s; while (b.v > 0.2) b.step(dt, { throttle: 0, brake: 1, steer: 0, handbrake: false }, 0, 0);
  const brakeDist = b.s - s0;
  // max lateral acceleration at 30 m/s with full steer (steady state after 3 s)
  const c = new VehiclePhysics(spec); c.reset(0, 0, 30);
  let maxAy = 0;
  for (let i = 0; i < 240 * 3; i++) { c.step(dt, { throttle: 0.35, brake: 0, steer: 1, handbrake: false }, 0, 0); maxAy = Math.max(maxAy, Math.abs(c.ay)); }
  // throttle oversteer: 18 m/s, half steer, full throttle for 1.5 s -> peak sideslip angle
  const o = new VehiclePhysics(spec); o.reset(0, 0, 18);
  for (let i = 0; i < 240; i++) o.step(dt, { throttle: 0.2, brake: 0, steer: 0.6, handbrake: false }, 0, 0);
  let maxBeta = 0;
  for (let i = 0; i < 360; i++) { o.step(dt, { throttle: 1, brake: 0, steer: 0.6, handbrake: false }, 0, 0); maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(o.vl, Math.max(1, o.v)))); }
  rows.push(`${spec.name.padEnd(28)} 0-60 ${t60.toFixed(2)}s (ref ${spec.zeroSixty})  0-100 ${t100.toFixed(1).padStart(5)}s  top ${top.toFixed(0)} mph (ref ${spec.topSpeedMph})  60-0 ${brakeDist.toFixed(1)} m  lat ${(maxAy / 9.81).toFixed(2)} g  powerslide ${(maxBeta * 57.3).toFixed(1)} deg`);
}
console.log(rows.join('\n'));
