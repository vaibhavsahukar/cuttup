import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(() => {
  const a = (window as any).__app; a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; g.fuel = 1;
  a.advance(3.5, 1 / 30);
  const ph = g.player.phys;
  for (let i = 0; i < 150; i++) { ph.v = 30; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); a.advance(1 / 30, 1 / 30); }
  const c = g.traffic.cars.filter((c: any) => c.dir > 0 && !c.cop && c.s < ph.s - 20 && c.s > ph.s - 80)[0] ?? g.traffic.cars.find((c: any) => c.dir > 0 && !c.cop);
  const ok = g.police.startRage(c);
  let crashed = 0, maxGap = 0;
  for (let i = 0; i < 600; i++) { ph.v = 30; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); a.advance(1 / 30, 1 / 30); if (c.wrecked) crashed = i; if (i === 120) (window as any).__x = 1; }
  return `started=${ok} ragers=${g.police.ragers.length} wrecked=${c.wrecked} gap=${(ph.s - c.s).toFixed(0)} rageFlag=${c.rage}`;
});
console.log(r);
await page.waitForTimeout(800);
await page.screenshot({ path: out + '/rage.png' });
console.log(errs.join('\n') || 'no page errors');
await b.close();
