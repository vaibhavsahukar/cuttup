// Traffic density before and after taking the fork (or staying), on Easy. fork-density.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 480, height: 270 } });
await page.addInitScript('window.__name = (f) => f');
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const take of [true, false]) {
  console.log(take ? 'TAKE' : 'STAY', await page.evaluate((take) => {
    const a = (window as any).__app; (window as any).__forceSeed = 31;
    a.save.data.settings.difficulty = 0; a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
    a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; g.fuel = 1;
    a.advance(3.2, 1 / 30);
    const sF = g.features.forkAfter(0), ph = g.player.phys;
    const out: string[] = [];
    const count = () => {
      let same = 0, onc = 0;
      for (const c of g.traffic.cars) { if (!c.alive || c.cop) continue; const r = c.s - ph.s; if (r > -200 && r < 800) { if (c.dir > 0) same++; else onc++; } }
      return `${same}/${onc}`;
    };
    // cruise from the start to the fork at traffic speed, sampling every 400 m
    let last = ph.s;
    for (let i = 0; i < 30 * 400 && ph.s - sF < 2500; i++) {
      ph.v = 27; ph.vl = 0; g.fuel = 1;
      const fk = g.fork;
      if (take && fk && fk.state === 'open' && ph.s - sF > 0) { const t = (fk.rampIn(ph.s) + fk.rampOut(ph.s)) / 2 - 1.8; ph.d += Math.max(-0.25, Math.min(0.25, t - ph.d)); ph.psi = 0; }
      else if (fk && fk.state === 'branch') { ph.d += Math.max(-0.2, Math.min(0.2, g.layout.laneCenter(2) - ph.d)); ph.psi = 0; }
      else { ph.d = take && ph.s > sF - 300 ? g.layout.laneCenter(4) : g.layout.laneCenter(2); ph.psi = 0; }
      // ghost through traffic: keep the test about density, not crashes
      for (const c of g.traffic.cars) if (!c.cop && Math.abs(c.s - ph.s) < 6 && Math.abs(c.d - ph.d) < 3) c.s += 12;
      a.advance(1 / 30, 1 / 30);
      if (ph.s - last > 400) { last = ph.s; out.push(`x=${Math.round(ph.s - sF)} cars(same/oncoming within -200..800)=${count()} dens=${g.traffic.densityAt(g.scoring.distance).toFixed(1)}`); }
    }
    return '\n  ' + out.join('\n  ');
  }, take));
}
console.log(errs.join('\n') || 'no page errors');
await b.close();
