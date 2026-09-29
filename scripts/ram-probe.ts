// Who rams the player? A bot drives a steady, careful line (brakes for cars ahead so rear ending is not its fault),
// weaves between lanes now and then, and every would be crash with traffic is logged with what the other car was doing.
import { chromium } from 'playwright';
const secs = Number(process.argv[2] ?? 120);
const speed = Number(process.argv[3] ?? 42);
const weave = process.argv[4] !== '0';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const map of ['city', 'country', 'forest']) {
  const r = await page.evaluate(([map, speed, secs, weave]) => {
    const app = (window as any).__app;
    app.startGame(map, 'zr1');
    const g = app.game;
    const hits: any[] = [];
    const seen = new Map<number, number>();
    let t = 0;
    g.startCrash = (kind: string, impact: number, c: any) => {
      if (!c) return;
      if (seen.has(c.id) && t - (seen.get(c.id) as number) < 4) return;
      seen.set(c.id, t);
      const ph = g.player.phys;
      const rel = c.s - ph.s;
      let who = 'other';
      if (c.dir < 0) who = 'oncoming';
      else if (rel < -1.5) who = 'from behind';
      else if (c.lcT < 1) who = 'lane change into me';
      else if (rel > 1.5) who = 'i hit its rear';
      else who = 'side';
      hits.push({ t: +t.toFixed(1), who, driver: c.driver, rel: +rel.toFixed(1), cv: +c.v.toFixed(1), pv: +ph.v.toFixed(1), lcT: +c.lcT.toFixed(2), swerve: +c.swerve.toFixed(2), panic: +c.panicT.toFixed(1), dd: +(c.d - ph.d).toFixed(2), kind });
    };
    app.advance(3.3);
    const lanes = map === 'forest' ? 1 : g.layout.lanes;
    let lane = Math.min(2, lanes - 1), nextChange = 6, dTarget = 0;
    const laneD = (l: number) => g.layout.laneCenter(l);
    let v = speed as number;
    for (; t < (secs as number); t += 1 / 30) {
      const ph = g.player.phys;
      if (weave && t > nextChange && lanes > 1) { lane = Math.max(0, Math.min(lanes - 1, lane + (Math.random() < 0.5 ? -1 : 1))); nextChange = t + 2 + Math.random() * 4; }
      dTarget = laneD(lane);
      // brake for anything ahead in the player's lane
      let lead = 1e9, lv = 0;
      for (const c of g.traffic.cars) {
        if (!c.alive || c.wrecked || c.dir < 0) continue;
        const rel = c.s - ph.s;
        if (rel > 0 && Math.abs(c.d - ph.d) < 2.4) { const gap = rel - (c.L + 4.5) / 2; if (gap < lead) { lead = gap; lv = c.v; } }
      }
      const want = lead < 30 + v * 0.8 ? Math.min(speed as number, lv + Math.max(0, (lead - 8) * 0.4)) : (speed as number);
      v += Math.max(-8 / 30, Math.min(3 / 30, (want - v) * 0.3));
      ph.v = v; ph.psi = 0; ph.vl = 0; ph.fall = null;
      const step = Math.max(-2.2 / 30, Math.min(2.2 / 30, dTarget - ph.d));
      ph.d += step; ph.dDot = step * 30;
      app.advance(1 / 30, 1 / 30);
      if (g.state !== 'driving') break;
    }
    const by: Record<string, number> = {};
    for (const h of hits) by[h.who] = (by[h.who] ?? 0) + 1;
    return { minutes: +(t / 60).toFixed(1), total: hits.length, by, hits: hits.slice(0, 14) };
  }, [map, speed, secs, weave] as const);
  console.log(map, JSON.stringify(r.by), 'total', r.total, 'in', r.minutes, 'min');
  for (const h of r.hits) console.log('  ', JSON.stringify(h));
}
await b.close();
