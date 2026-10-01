import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const rows = await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 31;
  a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
  a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; g.fuel = 1;
  a.advance(3.2, 1 / 30);
  const sF = g.features.forkAfter(0); const ph = g.player.phys;
  ph.s = sF - 300; ph.d = g.layout.laneCenter(4); ph.v = 26;
  for (const c of g.traffic.cars) c.s += 99999;
  const out: string[] = []; let last = 0; let maxJump = 0; let prevY = NaN;
  for (let i = 0; i < 1500 && ph.s - sF < 800; i++) {
    ph.v = 26; ph.vl = 0; g.fuel = 1;
    const fk = g.fork;
    if (fk && fk.state === 'open' && ph.s - sF > 0) { const t = (fk.rampIn(ph.s) + fk.rampOut(ph.s)) / 2 - 1.8; ph.d += Math.max(-0.25, Math.min(0.25, t - ph.d)); ph.psi = 0; }
    else if (fk && fk.state === 'branch') { ph.d += Math.max(-0.2, Math.min(0.2, g.layout.laneCenter(4) - ph.d)); ph.psi = 0; }
    else { ph.d = g.layout.laneCenter(4); ph.psi = 0; }
    a.advance(1 / 30, 1 / 30);
    const y = g.player.model.root.position.y;
    if (!isNaN(prevY)) maxJump = Math.max(maxJump, Math.abs(y - prevY));
    prevY = y;
    const x = ph.s - sF;
    if (x > last + 60) { last = x; const fk2 = g.fork; const surf = fk2 ? fk2.branch.frame(ph.s).y : g.path.frame(ph.s).y; out.push(`x=${Math.round(x)} carY=${y.toFixed(2)} rampY=${surf.toFixed(2)} state=${fk2?.state}`); }
  }
  out.push('maxFrameJump=' + maxJump.toFixed(2));
  return out;
});
console.log(rows.join('\n'));
await b.close();
