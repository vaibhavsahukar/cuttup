// Adaptive resolution: in slow software GL the render scale should drop until frames are steadier.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.evaluate(() => { const a = (window as any).__app; a.save.data.settings.showFps = true; a.startGame('city', 'zr1'); });
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(4000);
  console.log(await page.textContent('#hud .fps'));
}
console.log('errors:', errors.length ? errors : 'none');
await b.close();
