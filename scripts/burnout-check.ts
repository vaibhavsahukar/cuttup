// Both pedals down from a standstill: speed, revs, wheelspin, yaw and the effects it makes. burnout-check.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '/tmp/claude-0';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 800, height: 450 } });
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(() => {
  const out: any = {};
  for (const veh of ['zr1', 'civic', 'm4', 'tesla']) {
    const a = (window as any).__app; (window as any).__forceSeed = 5; a.save.data.settings.weather = 'clear'; a.save.data.settings.difficulty = 1;
    a.startGame('city', veh); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
    const inp = g.input, ph = g.player.phys; inp.update = () => undefined;
    ph.d = g.layout.laneCenter(2); ph.s += 30;
    const log: any[] = [];
    const s0 = ph.s, d0 = ph.d;
    for (let i = 0; i < 150; i++) {
      inp.throttle = 1; inp.brake = 1; inp.steer = i < 60 ? 0 : i < 120 ? 1 : 0;
      a.advance(1 / 30, 1 / 30);
      if (i % 30 === 29) log.push({ i, v: +ph.v.toFixed(2), rpm: Math.round(ph.rpm), spin: +ph.wheelspin.toFixed(2), burn: +ph.burnout.toFixed(2), r: +ph.r.toFixed(2), psi: +ph.psi.toFixed(2), ds: +(ph.s - s0).toFixed(1), dd: +(ph.d - d0).toFixed(1) });
    }
    out[veh] = log;
  }
  return out;
});
console.log(JSON.stringify(r));
// one picture of the smoke with the car turning
await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 5; a.save.data.settings.timeOfDay = 'day';
  a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
  const inp = g.input; inp.update = () => undefined; g.player.phys.d = g.layout.laneCenter(2);
  for (let i = 0; i < 100; i++) { inp.throttle = 1; inp.brake = 1; inp.steer = i > 40 ? 1 : 0; a.advance(1 / 30, 1 / 30); }
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/burnout.png` });
console.log(errs);
await b.close();
