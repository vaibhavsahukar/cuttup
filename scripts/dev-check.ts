// DEV MODE: fly along the city road toward the first fork and look at it. dev-check.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 31;
  a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
  a.startGame('city', 'zr1'); a.advance(3.2, 1 / 30);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' }));
});
const key = (code: string, down: boolean) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c as string })), [code, down] as const);
await page.waitForTimeout(300);
console.log(await page.evaluate(() => `dev=${(window as any).__app.game.dev} hud=${document.querySelector('#hud')?.className}`));
// fly forward fast and up
await key('ShiftLeft', true); await key('KeyW', true); await key('Space', true);
for (let i = 0; i < 40; i++) await page.evaluate(() => (window as any).__app.advance(1 / 30, 1 / 30));
await key('Space', false);
for (let i = 0; i < 40; i++) await page.evaluate(() => (window as any).__app.advance(1 / 30, 1 / 30));
await key('KeyW', false); await key('ShiftLeft', false);
await key('KeyF', true); await key('KeyF', false);
await page.evaluate(() => (window as any).__app.advance(1 / 30, 1 / 30));
const info = await page.evaluate(() => { const g = (window as any).__app.game; return `cam=(${g.camera.position.x.toFixed(0)},${g.camera.position.y.toFixed(0)},${g.camera.position.z.toFixed(0)}) sG=${g.sGuess.toFixed(0)} fork=${g.fork ? Math.round(g.fork.sF) : 'none'} fog=${g.env.fogMul}`; });
console.log(info);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/dev1.png` });
console.log(errs.join('\n') || 'no page errors');
await b.close();
