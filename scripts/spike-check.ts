// Finds which subsystem causes frame spikes: max time and count of >8 ms calls per subsystem.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage();
await page.addInitScript('window.__name = (f) => f');
await page.goto(process.argv[2] ?? 'http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app, null, { timeout: 120000 });
for (const m of (process.argv[3] ?? 'city,forest').split(',')) console.log(m, JSON.stringify(await page.evaluate((mm) => {
  const app = (window as any).__app; app.startGame(mm, 'zr1'); const g = app.game; app.advance(3);
  const mx: Record<string, number> = {}; const cnt: Record<string, number> = {};
  const wrap = (obj: any, fn: string, name: string) => { const o = obj[fn].bind(obj); obj[fn] = (...a: any[]) => { const t = performance.now(); const r = o(...a); const d = performance.now() - t; mx[name] = Math.max(mx[name] || 0, +d.toFixed(1)); if (d > 8) cnt[name] = (cnt[name] || 0) + 1; return r; }; };
  wrap(g.chunks, 'update', 'chunks'); wrap(g.traffic, 'update', 'traffic'); wrap(g.traffic, 'sync', 'tsync'); wrap(g.police, 'update', 'police'); wrap(g.particles, 'update', 'particles'); wrap(g.env, 'update', 'env'); wrap(g.rig, 'update', 'cam');
  for (let i = 0; i < 900; i++) { g.player.phys.v = 50; g.player.phys.psi = 0; app.advance(1 / 60); }
  return { mx, cnt };
}, m)));
await b.close();
