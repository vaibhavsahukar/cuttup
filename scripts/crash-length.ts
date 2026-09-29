// How long a crash plays before the results screen, per speed / kind / vehicle, and how fast the wreck still moves at the end.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const cases: [string, string, string, number][] = [
  ['city', 'zr1', 'barrier', 30], ['city', 'zr1', 'barrier', 75], ['country', 'zr1', 'car', 60], ['forest', 'zr1', 'tree', 45],
  ['city', 'r6', 'lowside', 50], ['city', 'r6', 'highside', 70], ['city', 'r6', 'looped', 25],
];
for (const [map, veh, kind, v] of cases) {
  const r = await page.evaluate(([map, veh, kind, v]) => {
    const app = (window as any).__app;
    app.startGame(map, veh);
    const g = app.game;
    app.advance(3.3);
    for (const c of g.traffic.cars) c.s += 5000;
    g.player.phys.v = v;
    app.advance(0.4);
    g.startCrash(kind, v, null);
    // the crash screen now waits for the player: measure until the wreck has been at rest for 1.4 s
    let f = 0, calm = 0;
    while (g.state === 'crash' && f < 60 * 30 && calm < 1.4) { g.update(1 / 60); f++; calm = g.crash.settled() ? calm + 1 / 60 : 0; }
    const w = g.crash.wrecks[0];
    return { seconds: +(f / 60).toFixed(1), state: g.state, wreckSpeed: +w.body.vel.length().toFixed(2) };
  }, [map, veh, kind, v] as const);
  console.log(`${map} ${veh} ${kind} ${v}`.padEnd(26), JSON.stringify(r));
}
await b.close();
