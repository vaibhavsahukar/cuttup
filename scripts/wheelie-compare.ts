// Wheelie behaviour per bike: full throttle plus a pull from a standstill, and a pull while rolling at 40 mph. wheelie-compare.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(() => {
  const out: any = {};
  for (const id of ['cbr650', 'zx6r', 'cbr1000rr', 'fs450']) for (const mode of ['standing', 'rolling', 'no pull']) {
    const a = (window as any).__app; (window as any).__forceSeed = 5; a.save.data.settings.weather = 'clear'; a.save.data.settings.difficulty = 0;
    a.startGame('city', id); const g = a.game; g.startCrash = (k: string) => { g.__fall = k; }; a.advance(3.2, 1 / 30);
    const inp = g.input, ph = g.player.phys; inp.update = () => undefined;
    ph.d = g.layout.laneCenter(2); if (mode === 'rolling') ph.v = 18;
    let t20 = -1, max = 0, tUp = 0, tAbove = 0, vAtPeak = 0, fell = '';
    for (let i = 0; i < 300; i++) {
      inp.throttle = 1; inp.brake = 0; inp.steer = 0; inp.wheelie = mode === 'no pull' ? 0 : (i < 150 ? 1 : 0); inp.brakePad = 0;
      ph.d += (g.layout.laneCenter(2) - ph.d) * 0.2;
      a.advance(1 / 60, 1 / 60);
      if (ph.wheelie > max) { max = ph.wheelie; vAtPeak = ph.v; }
      if (t20 < 0 && ph.wheelie > 0.35) t20 = i / 60;
      if (ph.wheelie > 0.1) tUp += 1 / 60;
      if (ph.wheelie > 0.35) tAbove += 1 / 60;
      if (g.__fall) { fell = g.__fall; break; }
    }
    (out[id] ??= {})[mode] = { secTo20deg: +t20.toFixed(2), maxDeg: Math.round(max * 57.3), secUp: +tUp.toFixed(1), secAbove20deg: +tAbove.toFixed(1), mphAtPeak: Math.round(vAtPeak * 2.237), fell };
  }
  return out;
});
console.log(JSON.stringify(r, null, 1), errs);
await b.close();
