// Realistic pursuit probe: the player weaves through dense traffic (picks the emptiest lane) at a given speed
// with a fixed heat level; reports how often / how soon cops get on the player's bumper, and how many cops wreck.
import { chromium } from 'playwright';
const map = process.argv[2] ?? 'city';
const speed = Number(process.argv[3] ?? 65);
const wanted = Number(process.argv[4] ?? 3);
const secs = Number(process.argv[5] ?? 90);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(([map, speed, wanted, secs]) => {
  const app = (window as any).__app;
  app.startGame(map, 'zr1');
  const g = app.game;
  g.startCrash = () => undefined;
  app.advance(3.3);
  const scoreFor = [0, 10500, 12800, 15500, 20500, 25500][wanted];
  g.scoring.score = scoreFor;
  const hw = g.map.road === 'highway';
  const lanes = g.layout.lanes;
  let lane = hw ? Math.floor(lanes / 2) : 0;
  const tl: string[] = [];
  let near = 0, frames = 0, firstReach = -1, minGap = 1e9, t = 0, maxBehind = 0, copSum = 0;
  const wrecks0 = g.police.wrecks.length;
  for (; t < secs; t += 1 / 30) {
    g.scoring.score = Math.max(g.scoring.score, scoreFor);
    const ph = g.player.phys;
    let v = speed;
    if (hw) {
      const gapOf = (l: number) => { let m = 300; const d = g.layout.laneCenter(l); for (const c of g.traffic.cars) if (c.alive && !c.cop && c.dir > 0 && Math.abs(c.d - d) < 2.2 && c.s > ph.s && c.s - ph.s < m) m = c.s - ph.s; return m; };
      const cur = gapOf(lane);
      if (cur < 110) { let best = lane, bg = cur; for (const l of [lane - 1, lane + 1]) if (l >= 0 && l < lanes && gapOf(l) > bg + 30) { best = l; bg = gapOf(l); } lane = best; }
      const dT = g.layout.laneCenter(lane);
      ph.d += Math.max(-4 / 30, Math.min(4 / 30, dT - ph.d));
      v = Math.min(speed, Math.max(15, gapOf(lane) < 60 ? 40 : speed));
    } else { ph.d = g.layout.laneCenter(0); v = speed; }
    ph.v = v; ph.psi = 0; ph.vl = 0; ph.fall = null;
    app.advance(1 / 30, 1 / 30);
    frames++;
    let closest = 1e9, behind = 0;
    for (const c of g.police.cops) { const rel = g.player.phys.s - c.car.s; closest = Math.min(closest, Math.abs(rel)); behind = Math.max(behind, rel); }
    copSum += g.police.cops.length;
    if (Math.abs(t % 3) < 1 / 30) tl.push(`${Math.round(t)}s n${g.police.cops.length} w${g.police.wrecks.length} ` + g.police.cops.map((c: any) => `${Math.round(g.player.phys.s - c.car.s)}@${Math.round(c.car.v)}`).join(','));
    if (closest < 25) { near++; if (firstReach < 0) firstReach = +t.toFixed(1); }
    minGap = Math.min(minGap, closest); maxBehind = Math.max(maxBehind, behind);
  }
  return { cops: +(copSum / frames).toFixed(1), firstReachS: firstReach, pctTimeWithinHalfCarLen25m: +(100 * near / frames).toFixed(0), minGap: Math.round(minGap), maxBehind: Math.round(maxBehind), copWrecks: g.police.wrecks.length - wrecks0, tl };
}, [map, speed, wanted, secs] as const);
const { tl, ...rest } = r as any; console.log(map.padEnd(8), 'speed', speed, 'heat', wanted, JSON.stringify(rest)); if (process.env.TL) console.log(tl.join('\n'));
await b.close();
