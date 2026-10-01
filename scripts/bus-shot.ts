// The school bus in the model viewer (3 angles) and in traffic. bus-shot.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript('window.__name = (f) => f');
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
// as traffic: put a bus right ahead of the player and look from behind and from the side
await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 4;
  a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
  a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
  const ph = g.player.phys;
  for (const c of g.traffic.cars) if (!c.cop && c.dir > 0 && Math.abs(c.s - ph.s) < 120) c.s += 99999;
  const bus = g.traffic.adopt(1, ph.s + 26, 2, 22, 'schoolbus', 0xf2b400);
  (window as any).__bus = bus;
  ph.v = 22; ph.d = g.layout.laneCenter(2);
});
await page.evaluate(() => { const a = (window as any).__app; for (let i = 0; i < 20; i++) { const g = a.game; g.player.phys.v = 22; g.player.phys.d = g.layout.laneCenter(2); a.advance(1 / 30, 1 / 30); g.render(); } });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/bus_traffic_rear.png`, timeout: 120000 });
await page.evaluate(() => {
  const a = (window as any).__app, g = a.game, bus = (window as any).__bus;
  g.rig.update = () => undefined;
  const pos = bus.model.root.position;
  const tgt = pos.clone(); tgt.y += 1.5;
  const R = new (pos.constructor)(); // side view from the right
  const f = g.path.frame(bus.s);
  const rx = -Math.cos(f.heading), rz = Math.sin(f.heading);
  g.camera.position.set(pos.x + rx * 16 + Math.sin(f.heading) * 6, pos.y + 3.2, pos.z + rz * 16 + Math.cos(f.heading) * 6);
  g.camera.lookAt(tgt);
  void R;
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/bus_traffic_side.png`, timeout: 120000 });
console.log(errs.join('\n') || 'no page errors');
await b.close();
