// City fork: drive up to it, take the ramp (or stay on the main road), screenshots along the way. fork-check.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const take of [true, false]) {
  await page.evaluate(() => {
    const a = (window as any).__app; (window as any).__forceSeed = 31;
    a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
    a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; g.fuel = 1;
    a.advance(3.2, 1 / 30);
    const sF = g.features.forkAfter(0);
    (window as any).__sF = sF;
    const ph = g.player.phys;
    ph.s = sF - 700; ph.d = g.layout.laneCenter(4); ph.v = 30;
    for (const c of g.traffic.cars) c.s += 99999;
    for (let i = 0; i < 90; i++) { ph.v = 30; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(4); a.advance(1 / 30, 1 / 30); }
  });
  const shots = take ? [-150, 40, 160, 300, 500, 800] : [160, 500];
  const log: string[] = [];
  for (const at of shots) {
    const r = await page.evaluate(([at, take]) => {
      const a = (window as any).__app, g = a.game, ph = g.player.phys, sF = (window as any).__sF;
      let guard = 0;
      while (ph.s - sF < at && guard++ < 4000) {
        ph.v = 26; ph.vl = 0; g.fuel = 1;
        const fk = g.fork;
        if (take && fk && fk.state === 'open' && ph.s - sF > 0) {
          const target = (fk.rampIn(ph.s) + fk.rampOut(ph.s)) / 2 - 1.8; // ramp lane centre
          ph.d += Math.max(-0.25, Math.min(0.25, target - ph.d)); ph.psi = 0;
        } else if (take && fk && fk.state === 'branch') { ph.d += Math.max(-0.2, Math.min(0.2, g.layout.laneCenter(4) - ph.d)); ph.psi = 0; }
        else { ph.d = g.layout.laneCenter(take ? 4 : 2); ph.psi = 0; }
        a.advance(1 / 30, 1 / 30);
      }
      return `x=${Math.round(ph.s - sF)} d=${ph.d.toFixed(1)} fork=${g.fork?.state ?? 'none'} spliced=${g.path.spliced} state=${g.state}`;
    }, [at, take] as const);
    log.push(r);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${out}/fork_${take ? 'take' : 'stay'}_${at}.png` });
  }
  console.log(take ? 'TAKE' : 'STAY', '\n  ' + log.join('\n  '));
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
