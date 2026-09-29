// How often do NPCs start lane changes near the player, and how often does one flip straight back?
import { chromium } from 'playwright';
const speed = Number(process.argv[2] ?? 40);
const secs = Number(process.argv[3] ?? 90);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const map of ['city', 'country']) {
  const r = await page.evaluate(([map, speed, secs]) => {
    const app = (window as any).__app;
    app.startGame(map, 'zr1');
    const g = app.game; g.startCrash = () => undefined;
    app.advance(3.3);
    const last = new Map<number, { tl: number; t: number }>();
    const near = { fast: 0, slow: 0, scared: 0 } as Record<string, number>, all = { fast: 0, slow: 0, scared: 0 } as Record<string, number>;
    let flips = 0, changes = 0, ahead: number[] = [];
    let t = 0;
    for (; t < secs; t += 1 / 30) {
      const ph = g.player.phys; ph.v = speed; ph.d = g.layout.laneCenter(2); ph.psi = 0; ph.vl = 0; ph.fall = null;
      app.advance(1 / 30, 1 / 30);
      for (const c of g.traffic.cars) {
        if (c.cop || c.dir < 0 || !c.alive) continue;
        const p = last.get(c.id);
        if (!p) { last.set(c.id, { tl: c.targetLane, t }); continue; }
        if (c.targetLane !== p.tl) {
          changes++; all[c.driver]++;
          const rel = c.s - ph.s;
          if (rel > -30 && rel < 250) near[c.driver]++;
          if (t - p.t < 14) flips++;
          last.set(c.id, { tl: c.targetLane, t });
        }
      }
    }
    return { changes, perMin: +(changes / (secs / 60)).toFixed(1), near, all, flips };
  }, [map, speed, secs] as const);
  console.log(map, JSON.stringify(r));
}
await b.close();
