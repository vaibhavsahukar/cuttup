// CPU cost of game.update() per frame while driving (spikes = stutter): p50 / p95 / max and the worst frames.
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
  const key = (t: string, c: string) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }));
  key('keydown', 'KeyW');
  const times: { t: number; s: number }[] = [];
  for (let f = 0; f < 1500 && g.state === 'driving'; f++) {
    // keep the player alive: clear anything close ahead
    for (const c of g.traffic.cars) if (c.s > g.player.phys.s && c.s - g.player.phys.s < 40 && Math.abs(c.d - g.player.phys.d) < 3) c.s += 400;
    const a = performance.now();
    app.game.update(1 / 60);
    times.push({ t: performance.now() - a, s: g.player.phys.s });
  }
  key('keyup', 'KeyW');
  const sorted = times.map((x) => x.t).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))].toFixed(2);
  const worst = times.map((x, i) => ({ i, ...x })).sort((a, b) => b.t - a.t).slice(0, 8).map((x) => `#${x.i}:${x.t.toFixed(1)}ms@${Math.round(x.s)}m`);
  return { frames: times.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over4ms: sorted.filter((t) => t > 4).length, worst };
}, [veh, map]);
console.log(veh, map, JSON.stringify(r));
await b.close();
