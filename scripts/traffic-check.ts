// Headless traffic behaviour probe: player cruises (invulnerable probe), we sample overlaps and lane-change stats.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:5173/';
const map = process.argv[3] ?? 'city';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
const errors: string[] = [];
await page.addInitScript('window.__name = (f) => f');
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => (window as any).__app);
const res = await page.evaluate((m) => {
  const app = (window as any).__app;
  app.startGame(m, 'civic');
  const g = app.game;
  let overlaps = 0, samples = 0, maxCars = 0, visibleSpawns = 0;
  const seen = new Set<number>();
  const lanes: Record<string, number[]> = { fast: [], slow: [], scared: [] };
  for (let i = 0; i < 60 * 90; i++) {
    // probe: keep the player moving in the rightmost shoulder, immune (disable crash by moving off)
    g.player.phys.v = 26; g.player.phys.d = g.map.road === "highway" ? g.layout.playerMax - 1 : g.layout.softMax + 0.2; g.player.phys.psi = 0;
    app.advance(1 / 60);
    if (g.state !== 'driving' && g.state !== 'countdown') break;
    const cs = g.traffic.cars.filter((c: any) => c.alive && !c.wrecked);
    maxCars = Math.max(maxCars, cs.length);
    for (const c of cs) {
      if (!seen.has(c.id)) { seen.add(c.id); if (i > 60 && Math.abs(c.s - g.player.phys.s) < 200) visibleSpawns++; }
    }
    if (i % 15 === 0) {
      samples++;
      for (let a = 0; a < cs.length; a++) for (let bb = a + 1; bb < cs.length; bb++) {
        const A = cs[a], B = cs[bb];
        if (A.dir !== B.dir) continue;
        if (Math.abs(A.s - B.s) < (A.L + B.L) / 2 - 0.05 && Math.abs(A.d - B.d) < (A.W + B.W) / 2 - 0.05) overlaps++;
      }
      for (const c of cs) if (c.dir > 0) lanes[c.driver].push(c.v);
    }
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return { state: g.state, overlaps, samples, maxCars, visibleSpawns, stats: g.traffic.stats, flow: g.traffic.flow, avgSpeed: { fast: avg(lanes.fast), slow: avg(lanes.slow), scared: avg(lanes.scared) } };
}, map);
console.log(map, JSON.stringify(res, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
