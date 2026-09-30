// Merge test: a slower car ahead in the next lane is told to merge into the lane of a fast player.
// How often does the player end up hitting it, and how often does the car go anyway?
import { chromium } from 'playwright';
const trials = Number(process.argv[2] ?? 30);
const pv = Number(process.argv[3] ?? 55);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(([trials, pv]) => {
  const app = (window as any).__app;
  let ran = 0, hits = 0, merged = 0, refused = 0;
  const gaps: number[] = [];
  for (let k = 0; k < (trials as number); k++) {
    (window as any).__forceSeed = 100 + k;
    app.startGame('city', 'zr1');
    const g = app.game;
    let hit: any = null;
    g.startCrash = (_kind: string, _impact: number, c: any) => { if (c && !hit) hit = c; };
    app.advance(3.5, 1 / 30);
    const ph = g.player.phys;
    ph.v = pv; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); ph.fall = null;
    // clear the player's own lane ahead so the test is only about the merging car
    for (const c of g.traffic.cars) if (!c.cop && c.dir === 1 && Math.abs(c.d - ph.d) < 2.4 && c.s > ph.s - 30) c.s += 6000;
    const cand = g.traffic.cars.filter((c: any) => !c.cop && c.dir === 1 && (c.lane === 1 || c.lane === 3) && c.lcT >= 1 && c.s - ph.s > 45 && c.s - ph.s < 120 && c.v < pv - 15);
    if (!cand.length) continue;
    const c = cand[0];
    ran++;
    const gap0 = c.s - ph.s; gaps.push(gap0);
    c.pendingLane = 2; c.signal = c.lane < 2 ? 1 : -1; c.signalT = 0.05; c.decideT = 1e9; c.lcCool = 0;
    let started = false;
    for (let t = 0; t < 7 && !hit; t += 1 / 30) {
      ph.v = pv; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); ph.fall = null;
      app.advance(1 / 30, 1 / 30);
      if (c.lcT < 1 && c.targetLane === 2) started = true;
    }
    if (started) merged++; else refused++;
    if (hit === c) hits++;
  }
  return { ran, merged, refused, hits, avgGap: Math.round(gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)) };
}, [trials, pv] as const);
console.log(`player ${pv} m/s:`, JSON.stringify(r));
await b.close();
