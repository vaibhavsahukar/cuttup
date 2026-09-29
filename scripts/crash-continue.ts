// Crash screen stays until Enter (or gamepad A): it must not end by itself, must ignore Enter in the first moments, then continue.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.evaluate(() => {
  const a = (window as any).__app;
  (window as any).__forceSeed = 7;
  a.startGame('city', 'zr1');
  a.advance(3.5, 1 / 30);
  const g = a.game;
  for (const c of g.traffic.cars) c.s += 9000;
  g.startCrash('barrier', 40, null);
});
// Enter straight away: too early to count
await page.keyboard.press('Enter');
const early = await page.evaluate(() => (window as any).__app.game.state);
// let the wreck play out for a long time (game time), far beyond the old automatic end
const long = await page.evaluate(() => { const a = (window as any).__app; a.advance(40, 1 / 30); return { state: a.game.state, mode: a.mode, screen: a.ui.current }; });
await page.waitForTimeout(2600);
await page.screenshot({ path: `${out}/crash_prompt.png` });
await page.keyboard.press('Enter');
await page.waitForFunction(() => (window as any).__app.mode !== 'game', undefined, { timeout: 20000 }).catch(() => undefined);
const after = await page.evaluate(() => { const a = (window as any).__app; return { mode: a.mode, screen: a.ui.current }; });
console.log(JSON.stringify({ afterEarlyEnter: early, after40s: long, afterEnter: after }));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
