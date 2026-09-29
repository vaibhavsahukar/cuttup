// A cop hit shows CAUGHT with a cop line; a normal traffic hit still shows WRECKED.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1000, height: 560 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const run = async (mapId: string, veh: string, cop: boolean) => {
  await page.evaluate(([mapId, veh, cop]) => {
    const a = (window as any).__app; a.save.data.settings.timeOfDay = 'day'; a.startGame(mapId, veh); const g = a.game;
    a.advance(3.3, 1 / 30);
    if (cop) g.scoring.score = 5200;
    for (let i = 0; i < 400 && (cop ? g.police.cops.length === 0 : true) && i < (cop ? 400 : 1); i++) { g.player.phys.v = 30; a.advance(1 / 30, 1 / 30); }
    for (let i = 0; i < 60; i++) { g.player.phys.v = 30; g.player.phys.psi = 0; a.advance(1 / 30, 1 / 30); }
    if (cop) {
      const c = g.police.cops[0].car, ph = g.player.phys;
      c.s = ph.s + 2.5; c.d = ph.d; c.v = 5; // the cop is right in front, we drive into it
      for (let i = 0; i < 90 && g.state === 'driving'; i++) { ph.v = 30; ph.psi = 0; ph.d = c.d; a.advance(1 / 60, 1 / 60); }
    } else {
      const car = g.traffic.cars.find((c: any) => !c.cop && c.dir > 0), ph = g.player.phys;
      car.s = ph.s + 3; car.d = ph.d; car.v = 5;
      for (let i = 0; i < 90 && g.state === 'driving'; i++) { ph.v = 30; ph.psi = 0; ph.d = car.d; a.advance(1 / 60, 1 / 60); }
    }
  }, [mapId, veh, cop] as const);
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => { const a = (window as any).__app, g = a.game; return JSON.stringify({ state: g.state, kind: g.result?.crashKind, caught: g.result?.caught, banner: document.querySelector('#crashui .wreck')!.textContent, msg: g.result?.message }); });
  console.log(mapId, veh, cop ? 'COP' : 'CAR', r);
  return r;
};
await run('city', 'zr1', true);
await page.screenshot({ path: `${out}/caught.png` });
await run('forest', 'r6', true);
await run('country', 'zr1', false);
await b.close();
