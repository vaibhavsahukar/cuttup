// Chase-camera rear view of player vehicles: rear-shot.ts <outDir> <id,id,...>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const ids = (process.argv[3] ?? 'tesla,c63').split(',');
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 900, height: 506 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const id of ids) {
  await page.evaluate((id) => { const a = (window as any).__app; (window as any).__forceSeed = 42; a.save.data.settings.timeOfDay = 'day'; a.startGame('country', id); a.game.startCrash = () => undefined; for (const c of a.game.traffic.cars) c.s += 9000; a.advance(3.6, 1 / 30); }, id);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/rear_${id}.png`, clip: { x: 250, y: 200, width: 400, height: 260 } });
}
await b.close();
