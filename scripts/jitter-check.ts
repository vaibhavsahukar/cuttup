// Uneven frame times must not make the car lurch relative to the camera: measure camera-to-car distance per frame.
import { chromium } from 'playwright';
const veh = process.argv[2] ?? 'zr1';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate((veh) => {
  const app = (window as any).__app;
  app.startGame('city', veh);
  const g = app.game;
  app.advance(3.3);
  for (const c of g.traffic.cars) c.s += 8000;
  const key = (t: string, c: string) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }));
  key('keydown', 'KeyW');
  g.player.phys.v = 40;
  const out: Record<string, number[]> = { even: [], jitter: [] };
  for (const mode of ['even', 'jitter']) {
    for (let f = 0; f < 240; f++) {
      const dt = mode === 'even' ? 1 / 60 : (f % 3 === 0 ? 0.033 : 0.011); // 60 fps average, wildly uneven
      app.advance(dt, dt);
      g.player.phys.v = Math.min(40, g.player.phys.v + 0.02);
      out[mode].push(g.camera.position.distanceTo(g.player.model.root.position));
    }
  }
  key('keyup', 'KeyW');
  const spread = (a: number[]) => (Math.max(...a.slice(30)) - Math.min(...a.slice(30))).toFixed(3);
  return { evenSpread_m: spread(out.even), jitterSpread_m: spread(out.jitter) };
}, veh);
console.log(veh, JSON.stringify(r));
await b.close();
