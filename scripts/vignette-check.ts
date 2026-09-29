// Cop vignette: red screen border that grows as the nearest cop closes in. vignette-check.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.evaluate(() => {
  const a = (window as any).__app;
  (window as any).__forceSeed = 4; a.save.data.settings.timeOfDay = 'day';
  a.startGame('country', 'zr1');
  const g = a.game; g.startCrash = () => undefined;
  for (const c of g.traffic.cars) c.s += 9000;
  a.advance(3.6, 1 / 30);
  g.scoring.score = 6000;
  for (let i = 0; i < 12; i++) { const ph = g.player.phys; ph.v = 40; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); a.advance(0.5, 1 / 30); }
});
const level = async (gap: number | null) => {
  await page.evaluate((gap) => {
    const a = (window as any).__app, g = a.game;
    const cop = g.police.cops[0];
    if (cop && gap !== null) { cop.car.s = g.player.phys.s - gap; cop.car.v = g.player.phys.v; }
  }, gap);
  await page.waitForTimeout(1500);
  return page.evaluate(() => (document.querySelector('#hud .copvig') as HTMLElement).style.opacity);
};
for (const gap of [300, 120, 60, 25]) {
  const op = await level(gap);
  console.log(`cop ${gap} m behind -> vignette opacity ${op}`);
  if (gap === 25) await page.screenshot({ path: `${out}/vignette.png` });
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
