// Screenshots of a map from the chase camera at a few positions: env-shot.ts <map> <outDir> [s1,s2,...]
import { chromium } from 'playwright';
const map = process.argv[2] ?? 'country';
const out = process.argv[3] ?? '.';
const spots = (process.argv[4] ?? '300,1500,2776').split(',').map(Number);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.evaluate((map) => { const a = (window as any).__app; a.save.data.settings.timeOfDay = 'day'; a.startGame(map, 'zr1'); a.advance(3.3); for (const c of a.game.traffic.cars) c.s += 6000; }, map);
for (const s of spots) {
  await page.evaluate((s) => {
    const a = (window as any).__app, g = a.game;
    g.player.phys.s = s; g.player.phys.v = 25; g.player.phys.psi = 0; g.player.phys.vl = 0;
    for (let k = 0; k < 8; k++) g.chunks.update(s);
    a.advance(0.3);
  }, s);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/env_${map}_${s}.png` });
}
console.log('errors:', errors.length ? errors : 'none');
await b.close();
