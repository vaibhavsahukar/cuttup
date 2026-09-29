// Headless smoke test: boots the game, drives each map, forces a crash, reaches results. Fails on console errors.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const only = process.argv[4];
const vehicles = (process.argv[5] ?? 'zr1').split(',');
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
await page.goto(base);
await page.waitForFunction(() => (window as any).__app, null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/01_menu.png` });
await page.click('text=Vehicle Select');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/02_garage.png` });
await page.keyboard.press('Escape');
const maps = only ? [only] : ['city', 'country', 'forest'];
for (const map of maps) for (const veh of vehicles) {
  await page.evaluate(([m, v]) => (window as any).__app.startGame(m, v), [map, veh]);
  const adv = (s: number) => page.evaluate((x) => (window as any).__app.advance(x), s);
  await adv(3);
  await page.keyboard.down('KeyW');
  await adv(6);
  await page.keyboard.down('KeyA'); await adv(0.6); await page.keyboard.up('KeyA');
  await adv(2);
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => { const g = (window as any).__app.game; return { state: g.state, v: g.player.phys.v, s: g.player.phys.s, d: g.player.phys.d, cars: g.traffic.cars.length, fps: (window as any).__fps, score: g.scoring.score }; });
  console.log(map, veh, JSON.stringify(st));
  await page.screenshot({ path: `${out}/10_${map}_${veh}_drive.png` });
  await page.keyboard.press('KeyC');
  await adv(0.1);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/11_${map}_${veh}_hood.png` });
  await page.keyboard.press('KeyC');
  await page.keyboard.up('KeyW');
  // force a crash into the nearest car ahead if still alive
  await page.evaluate(() => {
    const g = (window as any).__app.game;
    if (g.state !== 'driving') return;
    const ahead = g.traffic.cars.filter((c: any) => c.dir > 0 && c.s > g.player.phys.s + 10).sort((a: any, b: any) => a.s - b.s)[0];
    if (ahead) { g.player.phys.d = ahead.d; g.player.phys.s = ahead.s - ahead.L / 2 - g.player.collL / 2 - 0.5; g.player.phys.v = ahead.v + 25; }
  });
  await adv(0.3);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/12_${map}_${veh}_crash.png` });
  await adv(1.5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/13_${map}_${veh}_crash2.png` });
  await adv(6);
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => (window as any).__app.mode);
  console.log('after crash mode:', m);
  await page.screenshot({ path: `${out}/14_${map}_${veh}_results.png` });
}
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 10).join('\n') : 'NO CONSOLE ERRORS');
await b.close();
process.exit(errors.length ? 1 : 0);
