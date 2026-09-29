// Cop top speeds: patrol car below a CCR650R (135 mph = 60 m/s), police motorcycle about level, interceptor fast; slow units can be outrun.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const [veh, score, pv] of [['zr1', 8000, 45], ['zr1', 8000, 85], ['r6', 12000, 60], ['zr1', 60000, 85]] as const) {
  const r = await page.evaluate(([veh, score, pv]) => {
    const app = (window as any).__app;
    (window as any).__forceSeed = 3;
    app.startGame('city', veh);
    const g = app.game; g.startCrash = () => undefined;
    app.advance(3.5, 1 / 30);
    for (const c of g.traffic.cars) c.s += 4000;
    const log: string[] = [];
    let peak: Record<string, number> = {}, lost = 0, last = 0;
    for (let t = 0; t < 60; t += 0.5) {
      g.scoring.score = score;
      const ph = g.player.phys; ph.v = pv; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); ph.fall = null;
      const before = g.police.cops.length;
      app.advance(0.5, 1 / 30);
      for (const c of g.police.cops) { const k = c.charger ? 'interceptor' : c.moto ? 'moto' : 'patrol'; peak[k] = Math.max(peak[k] ?? 0, c.car.v); }
      if (g.police.cops.length < before) lost++;
      if (Math.floor(t) % 10 === 9 && t !== last) { last = t; log.push(`${Math.round(t)}s: ` + g.police.cops.map((c: any) => `${c.moto ? 'moto' : c.charger ? 'int' : 'pat'} v${c.car.v.toFixed(0)} gap${(g.player.phys.s - c.car.s).toFixed(0)}`).join(', ')); }
    }
    return { peak: Object.fromEntries(Object.entries(peak).map(([k, v]) => [k, `${(v as number).toFixed(0)} m/s (${((v as number) / 0.44704).toFixed(0)} mph)`])), lostOrGone: lost, log };
  }, [veh, score, pv] as const);
  console.log(`${veh} score ${score}, player ${pv} m/s (${(pv / 0.44704).toFixed(0)} mph):`, JSON.stringify(r, null, 1));
}
await b.close();
