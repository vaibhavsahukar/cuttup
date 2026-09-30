// Braking stability: hard braking from speed, straight and with a steering input; peak sideslip angle per car.
import { VEHICLES } from '../src/data/vehicles';
import { VehiclePhysics } from '../src/physics/VehiclePhysics';
const dt = 1 / 240;
for (const spec of VEHICLES.filter((v) => v.kind === 'car')) {
  const out: string[] = [];
  for (const [v0, steer, label] of [[60, 0, 'straight'], [60, 0.25, 'steer .25'], [45, 0.5, 'steer .5'], [80, 0.15, 'fast weave']] as const) {
    const p = new VehiclePhysics(spec); p.reset(0, 0, v0);
    let maxB = 0, t = 0;
    for (; t < 6 && p.v > 3; t += dt) {
      const st = t < 0.3 ? 0 : (t > 0.3 && t < 1.2 ? steer : -steer * 0.6);
      p.step(dt, { throttle: 0, brake: 1, steer: st, handbrake: false }, 0, 0);
      maxB = Math.max(maxB, Math.abs(Math.atan2(p.vl, Math.max(1, p.v))));
    }
    out.push(`${label}: ${(maxB * 57.3).toFixed(0)}deg spin ${(Math.abs(p.psi) * 57.3).toFixed(0)}`);
  }
  console.log(spec.name.padEnd(16), out.join(' | '));
}
