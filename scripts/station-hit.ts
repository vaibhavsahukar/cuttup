// Driving into a gas station's shop / pumps must wreck the car. station-hit.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(() => {
  const out: any = {};
  for (const map of ['country', 'city', 'forest']) {
    (window as any).__forceSeed = 5; const a = (window as any).__app; a.save.data.settings.weather = 'clear'; a.save.data.settings.difficulty = 1;
    a.startGame(map, 'zr1'); let g = a.game; a.advance(3.2, 1 / 30);
    const F = g.features; const st = F.between(0, 6000)[0]; const f = F.forecourt(st); const shop = f.solids[f.solids.length - 1];
    let ph = g.player.phys; let hit0 = false;
    const tests: any = {};
    for (const [name, s, d] of [['shop', shop.s, shop.d - shop.hw - 1.6], ['pump', f.solids[4].s, f.solids[4].d - 1.5], ['clear lane', f.s - 30, f.c]] as const) {
      if (hit0) { a.startGame(map, 'zr1'); a.advance(3.2, 1 / 30); g = a.game; ph = g.player.phys; }
      ph.s = s; ph.d = d; ph.v = 12; ph.psi = 0;
      g.state = 'driving';
      let hit = false;
      for (let i = 0; i < (name === 'clear lane' ? 90 : 30) && !hit; i++) { ph.d += name === 'clear lane' ? 0 : 0.25; ph.s += name === 'clear lane' ? 0.5 : 0; a.advance(1 / 30, 1 / 30); hit = g.state === 'crash'; }
      tests[name] = { hit, d: +ph.d.toFixed(1) };
      hit0 = hit;
    }
    out[map] = tests;
  }
  return out;
});
console.log(JSON.stringify(r), errs);
await b.close();
