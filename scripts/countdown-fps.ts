// Real frame times (rAF) from the moment a run starts: countdown versus driving. Software GL, so only relative numbers matter.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const a = (window as any).__app;
  const times: [number, number][] = [];
  let last = performance.now(); const t0 = last; let on = true;
  const loop = () => { const n = performance.now(); times.push([n - t0, n - last]); last = n; if (on) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  a.startGame('city', 'zr1');
  await new Promise((res) => setTimeout(res, 9000));
  on = false;
  const st = a.game.state;
  const buckets: Record<string, number[]> = {};
  for (const [t, d] of times) { const k = `${Math.floor(t / 1000)}s`; (buckets[k] ??= []).push(d); }
  return { st, per: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, `${v.length} frames, avg ${(v.reduce((x, y) => x + y, 0) / v.length).toFixed(0)} ms`])) };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
