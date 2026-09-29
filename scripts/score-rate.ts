// Score earned per minute on each map by a lane-keeping bot at steady speed (crashes suppressed), to balance maps.
import { chromium } from 'playwright';
const speed = Number(process.argv[2] ?? 35);
const secs = Number(process.argv[3] ?? 90);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const map of ['city', 'country', 'forest']) {
  const r = await page.evaluate(([map, speed, secs]) => {
    const app = (window as any).__app;
    app.startGame(map, 'zr1');
    const g = app.game;
    g.startCrash = () => undefined; // measure scoring only
    app.advance(3.3);
    const lane = map === 'forest' ? 0 : 2;
    const out: string[] = [];
    let last = 0;
    for (let t = 0; t < secs; t += 1 / 30) {
      const ph = g.player.phys;
      ph.v = speed; ph.d = g.layout.laneCenter(lane); ph.psi = 0; ph.vl = 0; ph.fall = null;
      app.advance(1 / 30, 1 / 30);
      const tt = Math.floor(t);
      if (tt % 30 === 29 && tt !== last) { last = tt; out.push(`${tt + 1}s: score ${Math.round(g.scoring.score)} nearMisses ${g.scoring.nearMisses} x${g.scoring.multiplier.toFixed(1)}`); }
    }
    return { out, score: Math.round(g.scoring.score), nearMisses: g.scoring.nearMisses, dist: Math.round(g.scoring.distance) };
  }, [map, speed, secs] as const);
  console.log(map.padEnd(8), `${(r.score / (secs / 60)).toFixed(0)} pts/min`, 'near misses', r.nearMisses, '\n   ', r.out.join('\n    '));
}
await b.close();
