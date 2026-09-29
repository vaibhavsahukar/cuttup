// Smoothness probe: drive at steady speed with perfectly even frames and look for jerks in the camera path.
// A smooth ride has tiny second differences of position / view direction; spikes are what you feel as stutter.
import { chromium } from 'playwright';
const veh = process.argv[2] ?? 'zr1';
const map = process.argv[3] ?? 'city';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(([veh, map]) => {
  const app = (window as any).__app;
  app.startGame(map, veh);
  const g = app.game;
  app.advance(3.3);
  for (const c of g.traffic.cars) c.s += 8000;
  g.police.cops?.splice?.(0);
  const key = (t: string, c: string) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }));
  key('keydown', 'KeyW');
  const cam = g.camera, root = g.player.model.root;
  const rec: any[] = [];
  const fwd = new (cam.position.constructor as any)();
  for (let f = 0; f < 1200 && g.state === 'driving'; f++) {
    // hold speed near 30 m/s
    g.player.phys.v = Math.min(g.player.phys.v, 30);
    g.update(1 / 60);
    cam.getWorldDirection(fwd);
    rec.push({ s: g.player.phys.s, v: g.player.phys.v, cx: cam.position.x, cy: cam.position.y, cz: cam.position.z, dx: fwd.x, dy: fwd.y, dz: fwd.z, mx: root.position.x, my: root.position.y, mz: root.position.z, fov: cam.fov });
  }
  key('keyup', 'KeyW');
  return rec;
}, [veh, map]);
// second differences
const spikes: { name: string; val: number; at: number }[] = [];
const stat = (name: string, get: (a: any) => number) => {
  const d2: number[] = [];
  for (let i = 2; i < r.length; i++) d2.push(Math.abs(get(r[i]) - 2 * get(r[i - 1]) + get(r[i - 2])));
  const sorted = [...d2].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)], p99 = sorted[Math.floor(sorted.length * 0.99)], max = sorted[sorted.length - 1];
  const at = d2.indexOf(max) + 2;
  console.log(`${name.padEnd(12)} median ${med.toExponential(1)}  p99 ${p99.toExponential(1)}  max ${max.toExponential(1)} (x${(max / Math.max(1e-9, med)).toFixed(0)} median) at frame ${at}, s=${Math.round(r[at].s)}`);
  spikes.push({ name, val: max / Math.max(1e-9, med), at });
};
console.log(veh, map, 'frames', r.length, 'speed', r[r.length - 1].v.toFixed(1));
stat('cam x', (a) => a.cx); stat('cam y', (a) => a.cy); stat('cam z', (a) => a.cz);
stat('view dx', (a) => a.dx); stat('view dy', (a) => a.dy); stat('view dz', (a) => a.dz);
stat('car y', (a) => a.my); stat('fov', (a) => a.fov);
await b.close();
