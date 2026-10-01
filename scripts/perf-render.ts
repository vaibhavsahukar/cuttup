// Software GL render time per map and quality (relative numbers only). perf-render.ts [maps] [qualities]
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const q of (process.argv[3] ?? 'low,medium,high,ultra').split(',')) for (const map of (process.argv[2] ?? 'city,country,forest').split(',')) {
  const r = await page.evaluate(async ([map, q]) => {
    const a = (window as any).__app; (window as any).__forceSeed = 5;
    a.save.data.settings.quality = q; a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
    a.startGame(map, 'zr1'); const g = a.game; a.advance(3.2, 1 / 30);
    for (let i = 0; i < 200; i++) { g.player.phys.v = 40; a.advance(1 / 60, 1 / 60); }
    g.render(); g.render();
    g.renderer.info.autoReset = false; g.renderer.info.reset();
    const t0 = performance.now(); const N = 8; for (let i = 0; i < N; i++) { g.render(); g.renderer.getContext().finish(); } const ms = (performance.now() - t0) / N;
    return { ms: +ms.toFixed(0), calls: Math.round(g.renderer.info.render.calls / N), tris: Math.round(g.renderer.info.render.triangles / N / 1000) + 'k', pr: g.renderer.getPixelRatio() };
  }, [map, q]);
  console.log(q.padEnd(7), map.padEnd(8), JSON.stringify(r));
}
await b.close();
