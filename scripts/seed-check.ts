// Each run must get a different road / traffic; a pinned seed must reproduce the same one.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
console.log(await page.evaluate(() => {
  const app = (window as any).__app;
  const sig = (map: string) => {
    app.startGame(map, 'zr1');
    const g = app.game, f = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 };
    const pts = [400, 900, 1600].map((s) => { g.path.frame(s, f); return `${f.x.toFixed(0)},${f.z.toFixed(0)}`; }).join(' ');
    const cars = g.traffic.cars.slice(0, 4).map((c: any) => `${Math.round(c.s)}/${c.type}`).join(' ');
    return `seed ${g.map.seed} | road ${pts} | cars ${cars}`;
  };
  const out: string[] = [];
  for (const m of ['forest', 'forest', 'forest']) out.push('forest  ' + sig(m));
  (window as any).__forceSeed = 4321;
  for (const m of ['forest', 'forest']) out.push('pinned  ' + sig(m));
  (window as any).__forceSeed = undefined;
  out.push('city    ' + sig('city')); out.push('city    ' + sig('city'));
  return out.join('\n');
}));
await b.close();
