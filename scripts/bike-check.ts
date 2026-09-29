// Headless bike handling checks: braking, wheelies, stoppies, lean limits, falls.
// usage: npx tsx scripts/bike-check.ts [bikeId]
import { VehiclePhysics, type Controls, type RiderAids } from '../src/physics/VehiclePhysics';
import { getVehicle } from '../src/data/vehicles';

const id = process.argv[2] ?? 'r6';
const spec = getVehicle(id);
const MPH = 0.44704, dt = 1 / 120;
const deg = (r: number) => Math.round((r * 180) / Math.PI);

function run(label: string, aids: Partial<RiderAids>, v0: number, secs: number, ctl: (t: number, p: VehiclePhysics) => Partial<Controls>) {
  const p = new VehiclePhysics(spec);
  p.setAids({ abs: 2, tc: 2, aw: 2, eb: 1, manual: false, ...aids });
  p.reset(0, 0, v0);
  p.tyreTemp = 0.9;
  let t = 0, maxPitch = 0, minPitch = 0, maxLean = 0, s0 = 0, maxAx = 0;
  for (; t < secs && !p.fall; t += dt) {
    p.step(dt, { throttle: 0, brake: 0, steer: 0, handbrake: false, ...ctl(t, p) }, 0, 0);
    maxPitch = Math.max(maxPitch, p.wheelie); minPitch = Math.min(minPitch, p.wheelie); maxLean = Math.max(maxLean, Math.abs(p.lean)); maxAx = Math.max(maxAx, Math.abs(p.ax));
    if (p.v <= 0.05 && s0 === 0 && v0 > 0) s0 = p.s;
  }
  console.log(`${label.padEnd(44)} t=${t.toFixed(2)}s v=${(p.v / MPH).toFixed(0)}mph stop=${(s0 || p.s).toFixed(1)}m pitch=[${deg(minPitch)}°,${deg(maxPitch)}°] lean=${deg(maxLean)}° fall=${p.fall ?? '-'} peak=${(maxAx / 9.81).toFixed(2)}g`);
  return p;
}

console.log(`--- ${spec.name} ---`);
run('rear brake only from 60 mph (ABS 2)', {}, 60 * MPH, 10, () => ({ brake: 1 }));
run('rear brake only from 60 mph (ABS off)', { abs: 0 }, 60 * MPH, 10, () => ({ brake: 1 }));
run('front brake slammed from 60 mph (ABS 2)', {}, 60 * MPH, 10, () => ({ frontBrake: 1 }));
run('front brake slammed from 60 mph (ABS 1)', { abs: 1 }, 60 * MPH, 10, () => ({ frontBrake: 1 }));
run('front brake slammed from 60 mph (ABS off)', { abs: 0 }, 60 * MPH, 10, () => ({ frontBrake: 1 }));
run('both brakes 70% from 60 mph (ABS off)', { abs: 0 }, 60 * MPH, 10, () => ({ frontBrake: 0.7, brake: 0.7 }));
run('full throttle launch (AW 3)', { aw: 3 }, 0, 6, () => ({ throttle: 1 }));
run('full throttle launch (AW 2)', { aw: 2 }, 0, 6, () => ({ throttle: 1 }));
run('full throttle launch (AW 1)', { aw: 1 }, 0, 6, () => ({ throttle: 1 }));
run('full throttle launch (AW off, TC off)', { aw: 0, tc: 0 }, 0, 6, () => ({ throttle: 1 }));
run('full lean at 10 mph (assisted)', {}, 10 * MPH, 4, () => ({ steer: 1, throttle: 0.15 }));
run('full lean at 25 mph (assisted)', {}, 25 * MPH, 4, () => ({ steer: 1, throttle: 0.2 }));
run('full lean at 60 mph (assisted)', {}, 60 * MPH, 4, () => ({ steer: 1, throttle: 0.3 }));
run('full lean at 10 mph (manual)', { manual: true }, 10 * MPH, 4, () => ({ steer: 1, throttle: 0.15 }));
run('full lean at 60 mph (manual, hanging off)', { manual: true }, 60 * MPH, 4, () => ({ steer: 1, hang: 1, throttle: 0.3 }));
run('lane weave at 80 mph (assisted)', {}, 80 * MPH, 8, (t) => ({ steer: Math.sin(t * 2.5) * 0.6, throttle: 0.6 }));
run('leaned + front brake slam, 50 mph, ABS off', { abs: 0 }, 50 * MPH, 4, (t) => ({ steer: 0.6, frontBrake: t > 1.2 ? 1 : 0, throttle: t > 1.2 ? 0 : 0.3 }));
run('leaned + front brake slam, 50 mph, ABS 2', {}, 50 * MPH, 4, (t) => ({ steer: 0.6, frontBrake: t > 1.2 ? 1 : 0, throttle: t > 1.2 ? 0 : 0.3 }));
run('leaned + full throttle at 30 mph, TC off', { tc: 0, aw: 0 }, 30 * MPH, 4, (t) => ({ steer: 0.9, throttle: t > 1 ? 1 : 0.2 }));
run('leaned + full throttle at 30 mph, TC 3', { tc: 3 }, 30 * MPH, 4, (t) => ({ steer: 0.9, throttle: t > 1 ? 1 : 0.2 }));
run('coast from 60 mph (engine braking low)', { eb: 0 }, 60 * MPH, 3, () => ({}));
run('coast from 60 mph (engine braking high)', { eb: 2 }, 60 * MPH, 3, () => ({}));
run('pull wheelie 20 mph, W+S held 3 s (AW 1)', { aw: 1 }, 20 * MPH, 3, () => ({ throttle: 1, pull: 1 }));
run('pull wheelie 20 mph, W+S held 3 s (AW off)', { aw: 0 }, 20 * MPH, 3, () => ({ throttle: 1, pull: 1 }));
run('pull wheelie 20 mph, pulse S (AW off)', { aw: 0 }, 20 * MPH, 5, (t) => ({ throttle: 1, pull: t % 1 < 0.35 ? 1 : 0 }));
run('pull wheelie 20 mph (AW 3)', { aw: 3 }, 20 * MPH, 3, () => ({ throttle: 1, pull: 1 }));
run('pull at 90 mph (AW off)', { aw: 0 }, 90 * MPH, 3, () => ({ throttle: 1, pull: 1 }));
run('wheelie then rear brake to land (AW off)', { aw: 0 }, 20 * MPH, 3, (t) => (t < 0.5 ? { throttle: 1, pull: 1 } : { brake: 1 }));
run('assisted: full lean + full throttle at 50 mph', {}, 50 * MPH, 4, () => ({ steer: 1, throttle: 1 }));
run('assisted: hard braking both, leaned 40 mph', {}, 40 * MPH, 4, (t) => ({ steer: 0.7, throttle: t < 1 ? 0.4 : 0, brake: t > 1 ? 1 : 0, frontBrake: t > 1 ? 1 : 0 }));
run('assisted: stop and hold lean input at standstill', {}, 15 * MPH, 6, (t) => ({ steer: 1, frontBrake: t < 3 ? 1 : 0 }));
