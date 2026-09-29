// Traffic yields to police: put a fast cop alert behind cars and see them change lane / pull over.
import { chromium } from 'playwright';
const map = process.argv[2] ?? 'city';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
console.log(await page.evaluate((map) => {
  const app = (window as any).__app; app.startGame(map, 'zr1'); const g = app.game; g.startCrash = () => undefined;
  app.advance(3.3);
  const ps = g.player.phys.s;
  const cars = g.traffic.cars.filter((c: any) => c.dir > 0 && !c.cop && c.s > ps + 60 && c.s < ps + 350).slice(0, 6);
  const before = cars.map((c: any) => ({ id: c.id, lane: c.lane, d: c.d, v: c.v }));
  for (let t = 0; t < 6; t += 1 / 30) {
    g.player.phys.v = 30; g.player.phys.d = g.layout.laneCenter(map === 'forest' ? 0 : 2); g.player.phys.psi = 0;
    // a cop 50 m behind each car, 25 m/s faster, in the same lane
    g.traffic.copAlerts = cars.map((c: any) => ({ s: c.s - 50 + 25 * t, d: c.d, v: c.v + 25 }));
    app.advance(1 / 30, 1 / 30);
  }
  const after = cars.map((c: any) => ({ id: c.id, lane: c.lane, target: c.targetLane, dOffset: +(c.d - g.layout.laneCenter(0)).toFixed(2), swerve: +c.swerve.toFixed(2), v: +c.v.toFixed(1) }));
  return JSON.stringify({ before, after }, null, 0).replace(/},\{/g, '},\n{');
}, map));
await b.close();
