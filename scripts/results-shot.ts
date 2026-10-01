// Crash, continue, and screenshot the run over screen. results-shot.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errs: string[] = [];
for (const [w, h] of [[1280, 720], [390, 844]] as const) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript('window.__name = (f) => f');
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => (window as any).__app);
  const r = await page.evaluate(() => {
    const a = (window as any).__app; (window as any).__forceSeed = 3;
    a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
    a.startGame('city', 'zr1'); const g = a.game; a.advance(3.2, 1 / 30);
    for (let i = 0; i < 120; i++) { g.player.phys.v = 40; a.advance(1 / 30, 1 / 30); }
    g.startCrash('barrier', 30, null);
    a.advance(2.5, 1 / 30);
    g.continueCrash();
    a.advance(0.5, 1 / 30);
    return `mode=${a.mode} screen=${a.ui.current}`;
  });
  console.log(w, r);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/results_${w}.png` });
  await page.close();
}
console.log(errs.join('\n') || 'no page errors');
await b.close();
