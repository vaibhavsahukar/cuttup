// Wheelie after braking: brake hard (front or rear, to a stop or to low speed), then throttle + pull. Does the front come up?
import { VehiclePhysics } from '../src/physics/VehiclePhysics';
import { getVehicle } from '../src/data/vehicles';
const dt = 1 / 120;
for (const id of ['r6', 'cbr650']) for (const [label, v0, front, rear, brakeT] of [['from rest, no brake', 0, 0, 0, 0], ['no brake', 15, 0, 0, 0], ['rear brake 1 s', 25, 0, 1, 1], ['front brake 1 s', 25, 1, 0, 1], ['both brake to stop', 25, 1, 1, 6]] as const) {
  const p = new VehiclePhysics(getVehicle(id)); p.setAids({ abs: 2, tc: 2, aw: 1, eb: 1, manual: false }); p.reset(0, 0, v0); p.tyreTemp = 0.9;
  let t = 0;
  for (; t < brakeT && !p.fall; t += dt) p.step(dt, { throttle: 0, brake: rear, frontBrake: front, steer: 0, handbrake: false }, 0, 0);
  const after = `wheelie=${(p.wheelie * 57.3).toFixed(2)} rate=${p.pitchRate.toFixed(3)} v=${p.v.toFixed(1)}`;
  let maxP = 0;
  for (let i = 0; i < 4 * 120 && !p.fall; i++) { p.step(dt, { throttle: 1, brake: 0, frontBrake: 0, steer: 0, handbrake: false, pull: 1 }, 0, 0); maxP = Math.max(maxP, p.wheelie); }
  console.log(id.padEnd(7), label.padEnd(20), 'after braking:', after.padEnd(40), 'max wheelie after', (maxP * 57.3).toFixed(0), 'deg', p.fall ?? '');
}
