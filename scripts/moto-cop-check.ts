// Police motorcycle: only chases riders, from 10k, at most one, never more than 5 cops alive. Also takes a chase screenshot.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
if (!process.env.SHOT_ONLY) {
for (const veh of ['r6', 'zr1']) {
  const res = await page.evaluate((veh) => {
    const app = (window as any).__app;
    (window as any).__forceSeed = 5;
    app.startGame('city', veh);
    const g = app.game; g.startCrash = () => undefined;
    app.advance(3.5, 1 / 30);
    const rows: any[] = [];
    let maxCops = 0, maxMoto = 0;
    for (const score of [6000, 9900, 10100, 16000, 26000, 60000]) {
      g.scoring.score = score;
      for (let i = 0; i < 40; i++) {
        const ph = g.player.phys; ph.v = 40; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); ph.fall = null;
        app.advance(0.5, 1 / 30);
        maxCops = Math.max(maxCops, g.police.cops.length);
        maxMoto = Math.max(maxMoto, g.police.cops.filter((c: any) => c.moto).length);
      }
      rows.push({ score, cops: g.police.cops.length, moto: g.police.cops.filter((c: any) => c.moto).length, charger: g.police.cops.filter((c: any) => c.charger).length });
    }
    return { rows, maxCops, maxMoto };
  }, veh);
  console.log(veh, JSON.stringify(res));
}
}
// screenshot with a motorcycle cop just ahead of the rider (SHOT_ONLY=1 skips the counting checks)
await page.evaluate(() => {
  const app = (window as any).__app;
  (window as any).__forceSeed = 5;
  app.save.data.settings.timeOfDay = 'day';
  app.startGame('city', 'r6');
  const g = app.game; g.startCrash = () => undefined;
  app.advance(3.5, 1 / 30);
  g.scoring.score = 10500;
  for (let i = 0; i < 40; i++) { const ph = g.player.phys; ph.v = 30; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); ph.fall = null; app.advance(0.5, 1 / 30); }
  const m = g.police.cops.find((c: any) => c.moto);
  if (m) { m.car.s = g.player.phys.s + 16; m.car.d = g.layout.laneCenter(3); m.car.v = g.player.phys.v; }
  app.advance(0.2, 1 / 30);
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/moto_cop_chase.png` });
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
