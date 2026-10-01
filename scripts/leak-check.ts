// GPU object counts across restarts and forks (a growing count means something is never disposed). leak-check.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript('window.__name = (f) => f');
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (/context|lost|WebGL/i.test(m.text())) errs.push('console: ' + m.text()); });
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const info = () => page.evaluate(() => { const i = (window as any).__app.renderer.info; return `textures=${i.memory.textures} geometries=${i.memory.geometries} programs=${i.programs?.length ?? '?'}`; });
console.log('menu', await info());
for (let run = 1; run <= 4; run++) {
  await page.evaluate(() => {
    const a = (window as any).__app; (window as any).__forceSeed = 31;
    a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
    a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; g.fuel = 1; a.advance(3.2, 1 / 30);
  });
  console.log('run', run, 'start', await info());
  // drive past two forks (taking the first)
  const r = await page.evaluate(() => {
    const a = (window as any).__app, g = a.game, ph = g.player.phys;
    const sF = g.features.forkAfter(0);
    ph.s = sF - 700; ph.d = g.layout.laneCenter(4);
    for (const c of g.traffic.cars) c.s += 99999;
    let took = false;
    for (let i = 0; i < 30 * 70 && ph.s < sF + 4500; i++) {
      ph.v = 40; ph.vl = 0; g.fuel = 1;
      const fk = g.fork;
      if (!took && fk && fk.state === 'open' && ph.s - sF > 0) { const t = (fk.rampIn(ph.s) + fk.rampOut(ph.s)) / 2 - 1.8; ph.d += Math.max(-0.25, Math.min(0.25, t - ph.d)); ph.psi = 0; }
      else if (fk && fk.state === 'branch') { took = true; ph.d += Math.max(-0.2, Math.min(0.2, g.layout.laneCenter(2) - ph.d)); ph.psi = 0; }
      else ph.d = g.layout.laneCenter(took ? 2 : 4);
      a.advance(1 / 30, 1 / 30);
    }
    const i = (window as any).__app.renderer.info;
    return `x=${Math.round(ph.s - sF)} took=${took} textures=${i.memory.textures} geometries=${i.memory.geometries}`;
  });
  console.log('run', run, 'after forks', r);
}
console.log(errs.join('\n') || 'no page errors');
await b.close();
