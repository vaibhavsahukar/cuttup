// Feature probes: near-miss scoring, oncoming near miss, pause menu, key rebinding, settings persistence.
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
const r1 = await page.evaluate(() => {
  const app = (window as any).__app;
  app.startGame('city', 'huracan');
  const g = app.game;
  app.advance(3);
  // clear traffic near the player, then place one slow car in the next lane with ~0.5 m clearance
  const ps = g.player.phys.s;
  for (const c of g.traffic.cars) if (Math.abs(c.s - ps) < 120 && c.dir > 0) c.s += 400;
  const c = g.traffic.cars.find((x: any) => x.dir > 0);
  c.lane = 3; c.targetLane = 3; c.d = g.layout.laneCenter(3); c.s = ps + 30; c.v = 20; c.v0 = 20; c.lcT = 1; c.pendingLane = -1; c.driver = 'slow'; c.p = { ...c.p, threshold: 99 };
  g.player.phys.d = c.d - (c.W + g.player.collW) / 2 - 0.5; g.player.phys.v = 45; g.player.phys.psi = 0;
  const before = g.scoring.nearMisses;
  for (let i = 0; i < 90; i++) { g.player.phys.psi = 0; g.player.phys.vl = 0; app.advance(1 / 60); }
  return { nearMisses: g.scoring.nearMisses - before, mult: g.scoring.multiplier, state: g.state, score: Math.round(g.scoring.score) };
});
console.log('near miss:', JSON.stringify(r1));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/f_nearmiss.png` });
// oncoming on the backroad
const r2 = await page.evaluate(() => {
  const app = (window as any).__app;
  app.startGame('forest', 'r6');
  const g = app.game;
  app.advance(3);
  const ps = g.player.phys.s;
  for (const c of g.traffic.cars) if (Math.abs(c.s - ps) < 200) c.s += 600;
  const c = g.traffic.cars.find((x: any) => x.dir < 0);
  c.s = ps + 60; c.d = g.layout.oncomingCenter(0); c.v = 20;
  g.player.phys.d = 0.35; g.player.phys.v = 30; // straddling the centre line
  const before = g.scoring.nearMisses;
  for (let i = 0; i < 120; i++) { g.player.phys.psi = 0; g.player.phys.vl = 0; g.player.phys.d = 0.35; app.advance(1 / 60); }
  return { nearMisses: g.scoring.nearMisses - before, state: g.state };
});
console.log('oncoming near miss:', JSON.stringify(r2));
// pause
await page.evaluate(() => { const app = (window as any).__app; app.startGame('country', 'm4'); app.advance(3.5); });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const paused = await page.evaluate(() => (window as any).__app.mode);
await page.screenshot({ path: `${out}/f_pause.png` });
console.log('pause mode:', paused);
await page.click('#pause button[data-a=settings]');
await page.waitForTimeout(300);
await page.click('#settings button[data-b=handbrake][data-i="1"]');
await page.keyboard.press('KeyB');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/f_settings.png` });
const bind = await page.evaluate(() => (window as any).__app.save.data.settings.bindings.handbrake);
console.log('handbrake binding after rebind:', JSON.stringify(bind));
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cutup-save-v1') || '{}').settings?.bindings?.handbrake);
console.log('persisted:', JSON.stringify(stored));
await page.click('#settings button[data-x=back]');
await page.waitForTimeout(200);
const back = await page.evaluate(() => (window as any).__app.ui.current);
console.log('settings back ->', back);
console.log(errors.length ? 'ERRORS ' + errors.join('\n') : 'no page errors');
await b.close();
