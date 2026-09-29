// Steering responsiveness: lateral offset after 1 s of full steer, and peak lateral g, at 30 m/s.
import { VEHICLES } from '../src/data/vehicles';
import { VehiclePhysics } from '../src/physics/VehiclePhysics';
const dt = 1 / 240;
for (const spec of VEHICLES) {
  const p = new VehiclePhysics(spec); p.reset(0, 0, 30);
  let steer = 0, maxAy = 0;
  for (let i = 0; i < 240; i++) {
    steer = Math.min(1, steer + dt * 7); // keyboard ramp
    p.step(dt, { throttle: 0.3, brake: 0, steer, handbrake: false }, 0, 0);
    maxAy = Math.max(maxAy, Math.abs(p.v * p.r));
  }
  console.log(spec.name.padEnd(28), 'lateral move 1s', (-p.d).toFixed(2), 'm   yaw', (p.psi * 57.3).toFixed(1), 'deg   peak', (maxAy / 9.81).toFixed(2), 'g');
}
