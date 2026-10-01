// Fork traffic routing: how many right lane cars take the ramp, and do they follow it.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
console.log(await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 31; a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
  const sF = g.features.forkAfter(0); const ph = g.player.phys;
  ph.s = sF - 900; ph.d = g.layout.laneCenter(1);
  const seen = new Map<number, { exit: boolean; maxD: number; maxX: number }>();
  for (let i = 0; i < 30 * 50; i++) {
    ph.v = 24; ph.d = g.layout.laneCenter(1); ph.psi = 0; g.fuel = 1;
    a.advance(1 / 30, 1 / 30);
    for (const c of g.traffic.cars) if (c.exitFork !== undefined && !c.cop) {
      const r = seen.get(c.id) ?? { exit: !!c.exitFork, maxD: 0, maxX: -1e9 };
      if (c.alive) { r.maxD = Math.max(r.maxD, c.d); r.maxX = Math.max(r.maxX, c.s - sF); }
      seen.set(c.id, r);
    }
  }
  const all = [...seen.values()];
  return { decided: all.length, exiting: all.filter((r) => r.exit).length, exitMaxD: all.filter((r) => r.exit).map((r) => `${r.maxD.toFixed(0)}@${r.maxX.toFixed(0)}`).slice(0, 6), stayMaxD: Math.max(...all.filter((r) => !r.exit).map((r) => r.maxD), 0).toFixed(1), fork: g.fork?.state ?? 'gone' };
}));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
