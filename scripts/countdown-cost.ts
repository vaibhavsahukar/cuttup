// CPU cost of a simulated frame during the 3-2-1 countdown versus driving (render excluded).
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
console.log(await page.evaluate(() => {
  const a = (window as any).__app; a.startGame('city', 'zr1'); const g = a.game;
  const time = (n: number) => { const t0 = performance.now(); a.advance(n / 60, 1 / 60); return ((performance.now() - t0) / n).toFixed(2) + ' ms/frame'; };
  const cd = time(60), cd2 = time(60);
  a.advance(3, 1 / 60);
  return { countdown: [cd, cd2], driving: time(120), state: g.state, particles: g.particles?.count ?? 'n/a' };
}));
await b.close();
