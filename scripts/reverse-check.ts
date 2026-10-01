// A car reversing with full steering: yaw rate, sideslip and whether it spins out. reverse-check.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(() => {
  const out: any = {};
  for (const veh of ['zr1', 'civic', 'huracan']) {
    const a = (window as any).__app; (window as any).__forceSeed = 5; a.save.data.settings.weather = 'clear';
    a.startGame('city', veh); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
    const inp = g.input, ph = g.player.phys; inp.update = () => undefined;
    const log: any[] = [];
    for (let i = 0; i < 150; i++) {
      inp.throttle = 0; inp.brake = 1; inp.steer = i < 100 ? 1 : 0;
      a.advance(1 / 30, 1 / 30);
      if (i % 25 === 24) log.push({ i, v: +ph.v.toFixed(1), r: +ph.r.toFixed(2), vl: +ph.vl.toFixed(2), psi: +ph.psi.toFixed(2), steer: +ph.steerAngle.toFixed(2) });
    }
    out[veh] = log;
  }
  return out;
});
console.log(JSON.stringify(r));
await b.close();
