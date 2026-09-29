// In-game bike checks: keyboard S+W wheelie, front brake, crash message, aid settings, gamepad rebinding UI.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => (window as any).__app);
// weight the ride: aids off for the wheelie so it can lift
const r = await page.evaluate(async () => {
  const app = (window as any).__app;
  app.save.data.settings.aids = { abs: 2, tc: 2, aw: 1, eb: 1 };
  app.startGame('city', 'r6');
  const g = app.game;
  app.advance(3.2);
  for (const c of g.traffic.cars) if (Math.abs(c.s - g.player.phys.s) < 300) c.s += 900;
  g.player.phys.v = 9;
  const key = (t: string, c: string) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }));
  key('keydown', 'KeyW'); key('keydown', 'KeyS');
  app.advance(1.2);
  const wheelie = { pitch: g.player.phys.wheelie, fall: g.player.phys.fall, v: g.player.phys.v };
  key('keyup', 'KeyS'); key('keyup', 'KeyW');
  return { wheelie, state: g.state, score: Math.round(g.scoring.score) };
});
console.log('keyboard wheelie:', JSON.stringify(r));
await page.screenshot({ path: `${out}/b_wheelie.png` });
// crash message
const r2 = await page.evaluate(() => {
  const app = (window as any).__app;
  const g = app.game;
  g.startCrash('lowside', 20, null);
  return { state: g.state, msg: g.result?.message, ui: document.querySelector('#crashui .shame')?.textContent };
});
console.log('crash:', JSON.stringify(r2));
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/b_crash.png` });
// settings screen
await page.evaluate(() => { const a = (window as any).__app; a.ui.show('settings'); });
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#settings .panel')!.scrollTo(0, 600));
await page.screenshot({ path: `${out}/b_settings.png` });
console.log('errors:', errors.length ? errors : 'none');
await b.close();
