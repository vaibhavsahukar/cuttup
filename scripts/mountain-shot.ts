// Country map horizon (mountains and snow caps) from several seeds and view angles: mountain-shot.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(`window.__name = (f) => f; window.__pad = { connected: true, id: 'fake', index: 0, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }; navigator.getGamepads = () => [window.__pad];`);
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
let n = 0;
for (const seed of [11, 12, 13]) for (const stick of [0, 1]) {
  await page.evaluate(([seed, stick]) => {
    const a = (window as any).__app;
    (window as any).__forceSeed = seed; a.save.data.settings.timeOfDay = 'day';
    (window as any).__pad.axes[2] = stick ? 1 : 0;
    a.startGame('country', 'zr1');
    const g = a.game; g.startCrash = () => undefined;
    for (const c of g.traffic.cars) c.s += 9000;
    a.advance(3.6, 1 / 30);
  }, [seed, stick]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/mtn_${n++}.png`, clip: { x: 0, y: 60, width: 1280, height: 300 } });
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
