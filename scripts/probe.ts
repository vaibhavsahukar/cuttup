// Screenshot probe: menu + a run with given settings, prints renderer stats.
import { chromium } from 'playwright';
const [base, out, map, veh, extra] = [process.argv[2], process.argv[3], process.argv[4] ?? 'city', process.argv[5] ?? 'zr1', process.argv[6] ?? '{}'];
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base);
await page.waitForFunction(() => (window as any).__app);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/p_menu.png` });
const info = await page.evaluate(([m, v, ex]) => {
  const app = (window as any).__app;
  Object.assign(app.save.data.settings, JSON.parse(ex));
  app.startGame(m, v);
  app.advance(4);
  app.input.bindings.throttle.push('X'); // noop
  const g = app.game;
  g.player.phys.v = 40;
  app.advance(3);
  return true;
}, [map, veh, extra]);
await page.waitForTimeout(1500);
const stats = await page.evaluate(() => { const g = (window as any).__app.game; const i = g.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, cars: g.traffic.cars.length, state: g.state }; });
console.log(JSON.stringify(stats));
await page.screenshot({ path: `${out}/p_${map}_${veh}.png` });
console.log(errors.length ? errors.join('\n') : 'no errors', info);
await b.close();
