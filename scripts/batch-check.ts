// Probes for: outrun and clear wanted level, 5 s wall scrape, bump vs wreck, explosion, drift effects, high beam, tailgating, PR popup, school bus.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const start = (map: string, veh: string, seed = 21) => page.evaluate(([map, veh, seed]) => {
  const a = (window as any).__app; (window as any).__forceSeed = seed; a.save.data.settings.timeOfDay = 'day';
  a.startGame(map, veh); const g = a.game; a.advance(3.5, 1 / 30); return g.state;
}, [map, veh, seed] as const);

// 1. outrun: stars flash after 60 s, wanted gone after 90 s
await start('city', 'zr1');
console.log('outrun', await page.evaluate(() => {
  const a = (window as any).__app, g = a.game; g.startCrash = () => undefined;
  for (const c of g.traffic.cars) c.s += 8000;
  g.scoring.score = 6000;
  const log: string[] = [];
  const popups: string[] = []; g.onPopup = (p: any) => popups.push(p.text);
  for (let t = 0; t < 100; t += 0.5) {
    g.scoring.score = 6000;
    const ph = g.player.phys; ph.v = 90; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); ph.fall = null;
    a.advance(0.5, 1 / 30);
    if ([10, 40, 61, 75, 95].includes(Math.round(t))) log.push(`${Math.round(t)}s wanted=${g.police.wanted} cops=${g.police.cops.length} away=${g.police.awayT.toFixed(0)} fleeing=${g.police.fleeing}`);
  }
  return { log, popups: popups.slice(-3), wantedNow: g.police.wanted, flashClass: document.querySelector('#hud .stars')?.className };
}));
// 2. a cop getting near resets the timer
console.log('cop near resets', await page.evaluate(() => {
  const a = (window as any).__app, g = a.game;
  g.scoring.score = 12000; // a higher tier than the cleared one: stars come back
  g.police.clearedTier = 0;
  for (let i = 0; i < 6; i++) { const ph = g.player.phys; ph.v = 40; ph.d = g.layout.laneCenter(2); a.advance(0.5, 1 / 30); }
  const before = g.police.wanted;
  g.police.awayT = 70; const c = g.police.cops[0]; if (c) c.car.s = g.player.phys.s - 40; a.advance(0.5, 1 / 30);
  return { wanted: before, awayAfterNear: g.police.awayT };
}));

// 3. wall scrape
await start('city', 'zr1');
console.log('wall', await page.evaluate(() => {
  const a = (window as any).__app, g = a.game;
  for (const c of g.traffic.cars) c.s += 8000;
  const res: string[] = [];
  for (let t = 0; t < 8 && g.state === 'driving'; t += 1 / 30) {
    const ph = g.player.phys; ph.v = 30; ph.psi = 0; ph.vl = 0; ph.d = g.layout.playerMin + 0.6; ph.fall = null;
    a.advance(1 / 30, 1 / 30);
    if (Math.abs(t - 3) < 0.02 || Math.abs(t - 4.9) < 0.02) res.push(`${t.toFixed(1)}s ${g.state}`);
  }
  return { res, final: g.state, kind: g.result?.crashKind };
}));

// 4. bump versus wreck
for (const [label, dv] of [['gentle 3 m/s', 3], ['hard 20 m/s', 20]] as const) {
  await start('city', 'zr1');
  console.log('collision', label, await page.evaluate((dv) => {
    const a = (window as any).__app, g = a.game;
    const ph = g.player.phys; ph.v = 30; ph.d = g.layout.laneCenter(2);
    for (const c of g.traffic.cars) if (!c.cop && c.dir > 0 && Math.abs(c.s - ph.s) < 400) c.s += 8000;
    g.scoring.multiplier = 4;
    const car = g.traffic.cars.find((c: any) => !c.cop && c.dir > 0 && c.s > 7000);
    car.s = ph.s + 5.4; car.d = ph.d; car.v = 30 - (dv as number); car.v0 = car.v;
    for (let i = 0; i < 20 && g.state === 'driving'; i++) { ph.d = g.layout.laneCenter(2); a.advance(1 / 30, 1 / 30); }
    return { state: g.state, multiplier: g.scoring.multiplier };
  }, dv));
}

// 5. explosion screenshot + drift
await start('country', 'zr1');
await page.evaluate(() => {
  const a = (window as any).__app, g = a.game;
  for (const c of g.traffic.cars) c.s += 8000;
  const ph = g.player.phys; ph.v = 60; ph.d = g.layout.laneCenter(2);
  g.startCrash('barrier', 60, null);
  a.advance(0.6, 1 / 30);
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/explosion.png` });
await start('country', 'zr1');
await page.evaluate(() => {
  const a = (window as any).__app, g = a.game; g.startCrash = () => undefined;
  for (const c of g.traffic.cars) c.s += 8000;
  const ph = g.player.phys;
  for (let i = 0; i < 45; i++) { ph.v = 38; ph.vl = 9; ph.psi = 0.25; ph.r = 0; ph.fall = null; ph.d = g.layout.laneCenter(2); a.advance(1 / 30, 1 / 30); }
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/drift.png` });

// 6. high beam, tailgating
await start('city', 'zr1', 33);
console.log('highbeam', await page.evaluate(() => {
  const a = (window as any).__app, g = a.game; g.startCrash = () => undefined;
  const ph = g.player.phys;
  const car = g.traffic.cars.find((c: any) => !c.cop && c.dir > 0 && c.s > ph.s + 30);
  car.s = ph.s + 25; car.d = g.layout.laneCenter(2); car.v = 28; car.v0 = 28; ph.d = g.layout.laneCenter(2);
  g.highBeamOn = true;
  let maxSwerve = 0, rattled = 0;
  for (let i = 0; i < 90; i++) { ph.v = 28; ph.d = g.layout.laneCenter(2); car.s = Math.min(car.s, ph.s + 25); a.advance(1 / 30, 1 / 30); maxSwerve = Math.max(maxSwerve, Math.abs(car.swerve)); if (car.rattle > 0) rattled++; }
  return { maxSwerve: +maxSwerve.toFixed(2), rattledFrames: rattled, beamOn: g.player.highBeam.intensity };
}));
let tailRuns = 0, moved = 0;
for (let k = 0; k < 6; k++) {
  await start('city', 'zr1', 40 + k);
  const r = await page.evaluate(() => {
    const a = (window as any).__app, g = a.game; g.startCrash = () => undefined;
    const ph = g.player.phys;
    const car = g.traffic.cars.find((c: any) => !c.cop && c.dir > 0 && c.driver !== 'fast' && c.s > ph.s + 30 && c.lane === 2);
    if (!car) return null;
    for (const o of g.traffic.cars) if (o !== car && !o.cop && o.dir > 0 && Math.abs(o.s - car.s) < 150) o.s += 9000; // clear the neighbouring lanes
    ph.d = car.d; car.v0 = 26; car.v = 26; const lane0 = car.lane;
    for (let t = 0; t < 14; t += 1 / 30) { ph.v = car.v + 0.5; ph.d = car.d; ph.psi = 0; ph.s = car.s - 9; a.advance(1 / 30, 1 / 30); if (car.targetLane !== lane0) return { movedAfter: +t.toFixed(1) }; }
    return { movedAfter: -1 };
  });
  if (r) { tailRuns++; if (r.movedAfter > 0) moved++; console.log('tailgate run', k, JSON.stringify(r)); }
}
console.log('tailgate: moved over in', moved, 'of', tailRuns);

// 7. school bus + PR + difficulty
console.log('bus', await page.evaluate(() => {
  const a = (window as any).__app; let n = 0, bus = 0;
  for (let k = 0; k < 8; k++) { (window as any).__forceSeed = 300 + k; a.startGame('country', 'zr1'); a.advance(3.5, 1 / 30); for (const c of a.game.traffic.cars) { n++; if (c.type === 'schoolbus') bus++; } }
  return { cars: n, buses: bus };
}));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
