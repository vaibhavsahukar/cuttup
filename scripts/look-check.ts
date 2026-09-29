// Free look camera: keys J / L show the sides, Left Shift the rear, the right stick swings the view. Screenshots into <outDir>.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript(`window.__name = (f) => f; window.__pad = { connected: true, id: 'fake', index: 0, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }; navigator.getGamepads = () => [window.__pad];`);
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.evaluate(() => {
  const a = (window as any).__app;
  (window as any).__forceSeed = 4; a.save.data.settings.timeOfDay = 'day';
  a.startGame('country', 'zr1');
  const g = a.game; g.startCrash = () => undefined;
  for (const c of g.traffic.cars) c.s += 9000;
  a.advance(3.6, 1 / 30);
});
const shot = async (name: string, ms = 2500) => { await page.waitForTimeout(ms); await page.screenshot({ path: `${out}/look_${name}.png` }); };
await shot('center', 1500);
await page.keyboard.down('KeyJ'); await shot('key_left'); await page.keyboard.up('KeyJ');
await page.keyboard.down('KeyL'); await shot('key_right'); await page.keyboard.up('KeyL');
await page.keyboard.down('ShiftLeft'); await shot('key_back'); await page.keyboard.up('ShiftLeft');
await page.evaluate(() => { (window as any).__pad.axes[2] = 0.7; }); await shot('stick_right_70');
await page.evaluate(() => { (window as any).__pad.axes[2] = -1; }); await shot('stick_left_full');
await page.evaluate(() => { (window as any).__pad.axes[2] = 0; }); await shot('released');
const yaw = await page.evaluate(() => (window as any).__app.game.input?.lookYaw);
console.log('lookYaw after release', yaw, errors.length ? errors.join('\n') : 'no page errors');
await b.close();
