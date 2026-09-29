// Rocks are solid: fast hit = rock crash, crawl = scrape, near miss beside = nothing.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
console.log(await page.evaluate(() => {
  const app = (window as any).__app; const out: string[] = [];
  (window as any).__forceSeed = 555;
  const run = (veh: string, speed: number, dOff: number) => {
    app.startGame('forest', veh); const g = app.game;
    app.advance(3.3, 1 / 30);
    for (const c of g.traffic.cars) c.s += 8000; // clear traffic
    const ph0 = g.player.phys; ph0.s = 500; g.sGuess = 500;
    for (let k = 0; k < 12; k++) g.chunks.update(500);
    const L = g.layout;
    // a rock the player can actually reach: its near edge inside the lateral limit
    const rocks = g.chunks.rocksNear(500, 500).filter((r: any) => Math.abs(r.d) - r.r < L.playerMax - 1.2).sort((a: any, b: any) => a.s - b.s);
    const r = rocks.find((q: any) => q.s > 470);
    if (!r) return `${veh} no reachable rock among ${g.chunks.rocksNear(500, 500).length}`;
    const sgn = Math.sign(r.d), dp = sgn * Math.min(Math.abs(r.d) - 0.6 * r.r, L.playerMax - 0.8);
    const ph = g.player.phys;
    ph.s = r.s - 12; ph.d = dp - sgn * dOff; ph.v = speed; ph.psi = 0; ph.vl = 0; ph.fall = null;
    g.sGuess = ph.s;
    for (let i = 0; i < 240 && g.state === 'driving'; i++) { ph.d = dp - sgn * dOff; ph.psi = 0; ph.vl = 0; app.advance(1 / 60, 1 / 60); }
    const kind = g.result?.crashKind;
    return `${veh} v ${speed} offset ${dOff}: state ${g.state} crash ${kind ?? '-'} rock r ${r.r.toFixed(2)} at d ${r.d.toFixed(1)}  speed after ${g.player.phys.v.toFixed(1)}`;
  };
  out.push(run('zr1', 30, 0));
  out.push(run('zr1', 20, 1.1)); out.push(run('zr1', 12, 0));
  out.push(run('zr1', 30, 4.5));
  out.push(run('r6', 30, 0));
  out.push(run('r6', 30, 2.6));
  return out.join('\n');
}));
await b.close();
