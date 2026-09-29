// Police probe: forces the score over thresholds and checks cop count, pursuit and crashes.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => (window as any).__app);
const res = await page.evaluate(() => {
  const app = (window as any).__app;
  app.startGame('city', 'zr1');
  const g = app.game;
  g.startCrash = () => undefined; // probe: the player is never wrecked, so every tier can be observed
  app.advance(3);
  const log: any[] = [];
  for (const [score, secs, spd] of [[10500, 30, 42], [12800, 25, 42], [15500, 25, 42], [20500, 25, 42], [25500, 30, 42], [26000, 30, 85]]) {
    g.scoring.score = score as number;
    let minGap = 1e9, copWrecks = 0, reachT = -1, t = 0;
    const before = g.police.wrecks.length;
    for (let i = 0; i < (secs as number) * 60; i++) {
      // invulnerable probe: player cruises on the shoulder at 45 m/s
      g.player.phys.v = spd as number; g.player.phys.psi = 0; g.player.phys.vl = 0; g.player.phys.d = g.layout.playerMax - 1.2;
      app.advance(1 / 60);
      if (g.state !== 'driving') break;
      t += 1 / 60;
      for (const c of g.police.cops) { const gap = Math.abs(c.car.s - g.player.phys.s); minGap = Math.min(minGap, gap); if (gap < 8 && reachT < 0) reachT = +t.toFixed(1); }
    }
    copWrecks = g.police.wrecks.length - before;
    log.push({ score, wanted: g.police.wanted, cops: g.police.cops.length, closestCop: Math.round(minGap), reachedAfterS: reachT, copWrecks, chargers: g.police.cops.filter((c: any) => c.charger).length, state: g.state, crashKind: g.result?.crashKind });
    if (g.state !== 'driving') break;
  }
  return log;
});
console.log(JSON.stringify(res, null, 1));
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/police.png` });
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
