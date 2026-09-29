// Wheelie loop outs: a held wheelie loops below 75 mph, never above it. usage: npx tsx scripts/loop-check.ts [bikeId]
import { VehiclePhysics, type RiderAids } from '../src/physics/VehiclePhysics';
import { getVehicle } from '../src/data/vehicles';
const spec = getVehicle(process.argv[2] ?? 'r6');
const MPH = 0.44704, dt = 1 / 120;
function run(label: string, aids: Partial<RiderAids>, mph: number, secs: number, holdFor = secs) {
  const p = new VehiclePhysics(spec);
  p.setAids({ abs: 2, tc: 2, aw: 1, eb: 1, manual: false, ...aids });
  p.reset(0, 0, mph * MPH); p.tyreTemp = 0.9;
  let t = 0, maxPitch = 0, loopedAt = -1, loopMph = 0;
  for (; t < secs && !p.fall; t += dt) {
    const hold = t < holdFor;
    p.step(dt, { throttle: 1, brake: 0, steer: 0, handbrake: false, pull: hold ? 1 : 0 }, 0, 0);
    maxPitch = Math.max(maxPitch, p.wheelie);
  }
  if (p.fall === 'looped') { loopedAt = t; loopMph = p.v / MPH; }
  console.log(label.padEnd(58), p.fall ? `${p.fall} at ${t.toFixed(1)}s (${loopMph.toFixed(0)} mph)` : 'no fall', ` max pitch ${(maxPitch * 57.3).toFixed(0)}deg, end ${(p.v / MPH).toFixed(0)} mph`);
  return loopedAt;
}
run('assisted AW1, hold from 15 mph, 12 s', {}, 15, 12);
run('assisted AW1, hold from 30 mph, 12 s', {}, 30, 12);
run('assisted AW1, hold from 55 mph, 15 s', {}, 55, 15);
run('assisted AW1, hold from 80 mph, 12 s (no loop above 75)', {}, 80, 12);
run('assisted AW1, hold from 100 mph, 12 s (no loop above 75)', {}, 100, 12);
run('assisted AW1, hold only 1.5 s from 20 mph', {}, 20, 8, 1.5);
run('assisted AW1, hold only 2.5 s from 20 mph', {}, 20, 8, 2.5);
run('assisted AW2, hold from 20 mph, 12 s', { aw: 2 }, 20, 12);
run('assisted AW3, hold from 20 mph, 12 s (anti wheelie holds it down)', { aw: 3 }, 20, 12);
run('manual, AW off, hold from 20 mph', { manual: true, aw: 0, tc: 0 }, 20, 6);
run('manual, AW off, hold from 85 mph (no loop above 75)', { manual: true, aw: 0, tc: 0 }, 85, 8);
