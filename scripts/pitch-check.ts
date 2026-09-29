// Body pitch / longitudinal acceleration jitter while driving: a rocking car shows as rapid ax / pitch reversals.
import { chromium } from 'playwright';
const veh = process.argv[2] ?? 'zr1';
const map = process.argv[3] ?? 'city';
const hold = Number(process.argv[4] ?? 25); // hold speed (m/s) or 0 = full throttle
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(([veh, map, hold]) => {
  const app = (window as any).__app;
  app.startGame(map, veh);
  const g = app.game;
  app.advance(3.3);
  for (const c of g.traffic.cars) c.s += 8000;
  const key = (t: string, c: string) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }));
  const rec: number[][] = [];
  key('keydown', 'KeyW');
  g.player.phys.v = hold || 10;
  for (let f = 0; f < 1800 && g.state === 'driving'; f++) {
    if (hold && g.player.phys.v > hold) g.player.phys.v = hold; // cruise-ish: cap
    app.advance(1 / 60);
    rec.push([g.player.phys.ax, g.player.pitch, g.player.phys.v, g.player.model.chassis.rotation.x, g.player.phys.wheelspin]);
  }
  key('keyup', 'KeyW');
  return rec;
}, [veh, map, hold] as const);
const col = (i: number) => r.map((x) => x[i]);
const rev = (a: number[]) => { let n = 0, last = 0; for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1]; const s = Math.abs(d) < 1e-6 ? 0 : Math.sign(d); if (s !== 0 && s !== last) { n++; last = s; } } return n; };
const range = (a: number[]) => `${Math.min(...a).toFixed(3)}..${Math.max(...a).toFixed(3)}`;
const hf = (a: number[]) => { let s = 0; for (let i = 2; i < a.length; i++) s += Math.abs(a[i] - 2 * a[i - 1] + a[i - 2]); return (s / a.length).toExponential(2); };
console.log(veh, map, 'hold', hold, 'frames', r.length);
console.log('ax     range', range(col(0)), 'reversals', rev(col(0)), 'hf', hf(col(0)));
console.log('pitch  range', range(col(1)), 'reversals', rev(col(1)), 'hf', hf(col(1)));
console.log('v      range', range(col(2)), 'reversals', rev(col(2)));
console.log('wheelspin max', Math.max(...col(4)).toFixed(2));
await b.close();
