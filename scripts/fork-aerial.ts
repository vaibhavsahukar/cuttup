// Aerial views of the city interchange (bridge, ramp, both roads). fork-aerial.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 31;
  a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
  a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; g.fuel = 1;
  a.advance(3.2, 1 / 30);
  const sF = g.features.forkAfter(0); (window as any).__sF = sF;
  const ph = g.player.phys; ph.s = sF - 900; ph.d = g.layout.laneCenter(2);
  for (let i = 0; i < 60; i++) { ph.v = 30; ph.psi = 0; ph.vl = 0; a.advance(1 / 30, 1 / 30); }
  while (ph.s < sF - 60) { ph.v = 30; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); a.advance(1 / 30, 1 / 30); }
});
const views: [string, number, number, number, number, number][] = [
  // targets are metres along the ramp (branch s from the fork); camera is behind and above in the branch's own frame
  ['t1', 360, 20, 420, 1, 0],
  ['t2', 100, 20, 160, 1, 0],
  ['t3', 250, 20, 160, 1, 0],
  ['t4', 520, 20, 160, 1, 0],
];
for (const [name, ts, td, h, back, side] of views) {
  await page.evaluate(([ts, td, h, back, side]) => {
    const a = (window as any).__app, g = a.game, sF = (window as any).__sF;
    const T = (window as any).THREE ?? null;
    const fk = g.fork;
    const tgt = fk.branch.toWorld(sF + ts, td, 0, g.player.model.root.position.clone());
    const pos = fk.branch.toWorld(sF + ts - back, td + side, h, tgt.clone());
    const cam = g.camera;
    g.rig.update = () => undefined;
    g.scene.fog = null; g.applyLight = () => undefined;
    
    cam.position.copy(pos); cam.far = 5000; cam.updateProjectionMatrix(); cam.lookAt(tgt);
    a.advance(1 / 30, 1 / 30);
    void T;
  }, [ts, td, h, back, side]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/aerial_${name}.png` });
}
await b.close();
