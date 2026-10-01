import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
console.log((await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 31; a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
  const sF = g.features.forkAfter(0); const ph = g.player.phys;
  ph.s = sF - 300; ph.d = g.layout.laneCenter(4);
  for (const c of g.traffic.cars) c.s += 99999;
  const out: string[] = []; let last = -999;
  for (let i = 0; i < 1500; i++) {
    ph.v = 26; ph.vl = 0; g.fuel = 1; const fk = g.fork;
    if (fk && fk.state === 'open' && ph.s - sF > 0) { const t = (fk.rampIn(ph.s) + fk.rampOut(ph.s)) / 2 - 1.8; ph.d += Math.max(-0.25, Math.min(0.25, t - ph.d)); ph.psi = 0; }
    a.advance(1 / 30, 1 / 30);
    const x = ph.s - sF;
    if (fk && x - last > 15 && x > -20 && x < 400) { last = x; out.push(`x=${x.toFixed(0)} d=${ph.d.toFixed(2)} in=${fk.rampIn(ph.s).toFixed(1)} out=${fk.rampOut(ph.s).toFixed(1)} state=${fk.state}`); }
  }
  return out;
})).join('\n'));
await b.close();
