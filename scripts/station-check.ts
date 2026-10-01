// Gas: standing starts per map, station screenshots, fuel use, drive through refuel, running dry (free and wanted).
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const map of ['city', 'country', 'forest']) {
  const r = await page.evaluate((map) => {
    const a = (window as any).__app; (window as any).__forceSeed = 8;
    a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
    a.startGame(map, 'zr1'); const g = a.game; g.startCrash = () => undefined;
    const v0 = g.player.phys.v, d0 = g.player.phys.d;
    a.advance(3.2, 1 / 30);
    return { startV: v0, startD: +d0.toFixed(1), afterCountdownV: +g.player.phys.v.toFixed(2), state: g.state, inRefuel: g.features.inRefuel(g.player.phys.s, g.player.phys.d), nextGas: Math.round(g.features.next(g.player.phys.s).s0) };
  }, map);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/start_${map}.png` });
  console.log('start', map, JSON.stringify(r));
}
// fly through a station on the countryside highway: drive the ramp lane, look at it, refuel
console.log('refuel', await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 8; a.startGame('country', 'zr1'); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
  const F = g.features, ph = g.player.phys;
  const st = F.next(ph.s + 600);
  g.fuel = 0.3;
  ph.s = st.s0 + 150; ph.d = F.rampLane(150).c; ph.psi = 0; ph.vl = 0;
  let filled = 0, minV = 99; const t0 = g.fuel;
  for (let i = 0; i < 300; i++) { const x = ph.s - st.s0; ph.d = F.rampLane(x).c; ph.psi = 0; ph.vl = 0; ph.v = 9; a.advance(1 / 30, 1 / 30); if (g.fuelStatus === 'filling') filled++; minV = Math.min(minV, ph.v); }
  return { fuelBefore: t0, fuelAfter: +g.fuel.toFixed(2), framesFilling: filled, state: g.state, x: Math.round(ph.s - st.s0) };
}));
await page.evaluate(() => { const a = (window as any).__app, g = a.game, F = g.features; const st = F.next(g.player.phys.s - 200); const ph = g.player.phys; ph.s = st.s0 + 240; ph.d = F.rampLane(240).c; ph.v = 4; (window as any).__app.advance(0.5, 1 / 30); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/station_lane.png` });
await page.evaluate(() => { const a = (window as any).__app, g = a.game, F = g.features; const st = F.next(g.player.phys.s + 300); const ph = g.player.phys; ph.s = st.s0 - 120; ph.d = g.layout.laneCenter(4); ph.v = 30; a.advance(0.4, 1 / 30); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/station_approach.png` });
// fuel use over a mile at full throttle
console.log('use', await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 2; a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
  for (const c of g.traffic.cars) c.s += 9000;
  const s0 = g.player.phys.s;
  const upd = g.input.update.bind(g.input); g.input.update = (dt: number) => { upd(dt); g.input.throttle = 1; };
  for (let i = 0; i < 60 * 30 && g.player.phys.s - s0 < 1609; i++) { g.player.phys.d = g.layout.laneCenter(2); g.player.phys.psi = 0; a.advance(1 / 30, 1 / 30); }
  return { usedPerMile: +(1 - g.fuel).toFixed(3) };
}));
// running dry, not wanted, then wanted
for (const score of [0, 6000]) {
  console.log('dry', score, await page.evaluate((score) => {
    const a = (window as any).__app; (window as any).__forceSeed = 2; a.startGame('city', 'zr1'); const g = a.game; a.advance(3.2, 1 / 30);
    let banner = ''; g.onCrash = (m: string, c: boolean, b: string) => { banner = b + ' / ' + m; };
    g.scoring.score = score; g.fuel = 0.0005; g.player.phys.v = 25;
    for (let i = 0; i < 70 * 10 && g.state === 'driving'; i++) { g.scoring.score = Math.max(g.scoring.score, score); g.player.phys.d = g.layout.laneCenter(2); g.player.phys.psi = 0; a.advance(0.1, 1 / 30); }
    return { state: g.state, banner, kind: g.result?.crashKind, caught: g.result?.caught };
  }, score));
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
