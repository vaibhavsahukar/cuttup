// A wanted player pulls into a highway gas station: do the cops follow onto the ramp? cop-station.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript('window.__name = (f) => f');
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const map of ['country', 'forest'] as const) {
  console.log(map, await page.evaluate((map) => {
    const a = (window as any).__app; (window as any).__forceSeed = 8; a.startGame(map, 'zr1'); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
    const F = g.features, ph = g.player.phys;
    const st = F.next(ph.s + 1500);
    ph.s = st.s0 - 700; ph.d = map === 'forest' ? F.edge - 2 : g.layout.laneCenter(4);
    for (const c of g.traffic.cars) if (!c.cop) c.s += 99999;
    // get wanted and let the cops arrive
    for (let i = 0; i < 300; i++) { g.scoring.score = 7000; ph.v = 25; ph.vl = 0; ph.psi = 0; a.advance(1 / 30, 1 / 30); }
    const log: string[] = [];
    let maxCopD = -99;
    for (let i = 0; i < 30 * 40; i++) {
      g.scoring.score = 7000; g.fuel = 0.5;
      const x = ph.s - st.s0;
      const target = st.ramp ? (x > 0 && x < 500 ? F.rampLane(x).c : ph.d) : (x > 10 && x < 180 ? F.edge + 6.5 : F.edge - 2);
      ph.d += Math.max(-0.12, Math.min(0.12, target - ph.d)); ph.psi = 0; ph.vl = 0;
      ph.v = x > 200 && x < 280 ? 3 : 16;
      a.advance(1 / 30, 1 / 30);
      for (const c of g.police.cops) maxCopD = Math.max(maxCopD, c.car.d);
      if (i % 90 === 0) log.push(`x=${Math.round(x)} pd=${ph.d.toFixed(1)} cops=[${g.police.cops.map((c: any) => `${Math.round(c.car.s - st.s0)}:${c.car.d.toFixed(1)}`).join(' ')}] wanted=${g.police.wanted} state=${g.state}`);
      if (g.state !== 'driving') break;
    }
    return `edge=${F.edge.toFixed(1)} maxCopD=${maxCopD.toFixed(1)}\n  ` + log.join('\n  ');
  }, map));
}
console.log(errs.join('\n') || 'no page errors');
await b.close();
