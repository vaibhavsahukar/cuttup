// Police rework: backroad one unit per tier, highway Samurai for riders at 20k, one Conquette at five stars, road rage.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const [map, veh, scores] of [['forest', 'zr1', [6000, 11000, 16000, 21000]], ['city', 'r6', [12000, 21000, 26000]], ['city', 'zr1', [21000, 26000, 40000]]] as const) {
  const r = await page.evaluate(([map, veh, scores]) => {
    const a = (window as any).__app; (window as any).__forceSeed = 9; a.startGame(map, veh); const g = a.game; g.startCrash = () => undefined; a.advance(3.5, 1 / 30);
    const out: string[] = [];
    for (const sc of scores as number[]) {
      for (let i = 0; i < 40; i++) { g.scoring.score = sc; const ph = g.player.phys; ph.v = map === 'forest' ? 28 : 40; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(map === 'forest' ? 0 : 2); ph.fall = null; a.advance(0.25, 1 / 30); }
      out.push(`${sc}: wanted=${g.police.wanted} units=[${g.police.cops.map((c: any) => c.kind + (c.retiring > 0 ? '(retiring)' : '')).join(', ')}]`);
    }
    return out;
  }, [map, veh, scores] as const);
  console.log(map, veh, '\n  ' + r.join('\n  '));
}
// road rage: force it on the nearest car ahead and watch it chase
console.log('rage', await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 12; a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; a.advance(3.5, 1 / 30);
  const ph = g.player.phys;
  const car = g.traffic.cars.filter((c: any) => c.dir > 0 && !c.cop && c.s < ph.s - 10 && c.s > ph.s - 80)[0] ?? g.traffic.cars.find((c: any) => c.dir > 0 && !c.cop);
  const pops: string[] = []; g.onPopup = (p: any) => pops.push(p.text);
  const ok = g.police.startRage(car);
  const log: string[] = [];
  let minGap = 1e9;
  for (let i = 0; i < 40; i++) { ph.v = 45; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); a.advance(0.5, 1 / 30); minGap = Math.min(minGap, Math.abs(car.s - ph.s)); if (i % 8 === 7) log.push(`t=${(i + 1) / 2}s gap=${(ph.s - car.s).toFixed(0)} v=${car.v.toFixed(0)} rage=${!!car.rage}`); }
  return { ok, type: car.type, minGap: +minGap.toFixed(1), log, pops };
}));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
