// Find a chunk with a roadside sign and screenshot it (city / country).
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const map of ['city', 'country']) {
  const found = await page.evaluate((map) => {
    const app = (window as any).__app;
    app.startGame(map, 'r6');
    const g = app.game;
    app.advance(3.3);
    for (const c of g.traffic.cars) c.s += 5000;
    for (let idx = 3; idx < 400; idx++) {
      g.player.phys.s = idx * 64 - 40; g.player.phys.v = 0.5;
      for (let k = 0; k < 6; k++) g.chunks.update(g.player.phys.s);
      const sign = g.chunks.pools.sign.mesh;
      const im = sign.instanceMatrix.array as Float32Array;
      for (let i = 0; i < sign.count; i++) if (im[i * 16] !== 0) return { idx, s: g.player.phys.s };
    }
    return null;
  }, map);
  console.log(map, JSON.stringify(found));
  if (!found) continue;
  await page.evaluate(() => { const g = (window as any).__app.game; g.state = 'driving'; (window as any).__app.advance(0.2); g.render(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/sign_${map}.png` });
}
await b.close();
