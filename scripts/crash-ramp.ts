// Crash at several points after taking the fork ramp and compare the wreck height with the road. crash-ramp.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript('window.__name = (f) => f');
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const at of [60, 150, 230, 245, 262, 280, 330]) {
  const r = await page.evaluate(async (at) => {
    const RP = await import('/src/world/RoadPath.ts');
    const a = (window as any).__app; (window as any).__forceSeed = 31;
    a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
    a.startGame('city', 'zr1'); const g = a.game; g.fuel = 1;
    a.advance(3.2, 1 / 30);
    const sF = g.features.forkAfter(0); const ph = g.player.phys;
    ph.s = sF - 300; ph.d = g.layout.laneCenter(4); ph.v = 30;
    for (const c of g.traffic.cars) c.s += 99999;
    const real = g.startCrash.bind(g); g.startCrash = () => undefined;
    let guard = 0;
    while (ph.s - sF < at && guard++ < 4000) {
      ph.v = 28; ph.vl = 0; g.fuel = 1;
      const fk = g.fork;
      if (fk && fk.state === 'open' && ph.s - sF > 0) { const t = (fk.rampIn(ph.s) + fk.rampOut(ph.s)) / 2 - 1.8; ph.d += Math.max(-0.25, Math.min(0.25, t - ph.d)); ph.psi = 0; }
      else if (fk && fk.state === 'branch') { ph.d += Math.max(-0.2, Math.min(0.2, g.layout.laneCenter(4) - ph.d)); ph.psi = 0; }
      else { ph.d = g.layout.laneCenter(4); ph.psi = 0; }
      a.advance(1 / 30, 1 / 30);
    }
    g.startCrash = real;
    ph.v = 28; ph.vl = 0;
    real('barrier', 30, null);
    let minRel = 99; let worst = '';
    for (let i = 0; i < 240; i++) {
      a.advance(1 / 30, 1 / 30);
      for (const w of g.crash.wrecks) {
        const pr = RP.projectToRoad(g.path, w.body.pos, w.s);
        const rel = w.body.pos.y - pr.y;
        if (rel < minRel) { minRel = rel; worst = `t=${i} s=${Math.round(pr.s - sF)} d=${pr.d.toFixed(1)} y=${w.body.pos.y.toFixed(2)} roadY=${pr.y.toFixed(2)} ground=${g.groundAt(w.body.pos).toFixed(2)}`; }
      }
      const p = g.player.model.root.position;
      const pr2 = RP.projectToRoad(g.path, p, ph.s);
      const rel2 = p.y - pr2.y;
      if (rel2 < minRel) { minRel = rel2; worst = `player t=${i} s=${Math.round(pr2.s - sF)} d=${pr2.d.toFixed(1)} y=${p.y.toFixed(2)} roadY=${pr2.y.toFixed(2)} ground=${g.groundAt(p).toFixed(2)}`; }
    }
    return `at=${at} state=${g.fork?.state} spliced=${g.path.spliced} minAboveRoad=${minRel.toFixed(2)} ${worst}`;
  }, at);
  console.log(r);
}
console.log(errs.join('\n') || 'no page errors');
await b.close();
