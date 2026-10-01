// Stay on the old highway past the fork and look at its right shoulder. stay-shot.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 960, height: 400 } });
await page.addInitScript('window.__name = (f) => f');
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 31;
  a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
  a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; g.fuel = 1; a.advance(3.2, 1 / 30);
  const sF = g.features.forkAfter(0), ph = g.player.phys; (window as any).__sF = sF;
  ph.s = sF - 600;
  for (let i = 0; i < 30 * 40 && ph.s < sF + 300; i++) { ph.v = 30; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); g.fuel = 1; a.advance(1 / 30, 1 / 30); }
});
const sF = await page.evaluate(() => (window as any).__sF);
for (const [name, x] of [['s1', 190], ['s2', 240], ['s3', 280]] as const) {
  await page.evaluate(([x]) => {
    const a = (window as any).__app, g = a.game, sF = (window as any).__sF;
    g.rig.update = () => undefined;
    g.scene.fog = null;
    const tgt = g.path.toWorld(sF + x, 20, 0, g.player.model.root.position.clone());
    const pos = g.path.toWorld(sF + x - 30, 14, 26, tgt.clone());
    g.camera.position.copy(pos); g.camera.lookAt(tgt);
    a.advance(1 / 30, 1 / 30); g.camera.position.copy(pos); g.camera.lookAt(tgt);
  }, [x]);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 120000 });
}
console.log('sF', sF, await page.evaluate(() => (window as any).__app.game.fork?.state), errs.join('\n') || 'no page errors');
await b.close();
