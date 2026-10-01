// Bike at full throttle from rest: front-wheel lift with the left stick pushed forward or not. push-check.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(() => {
  const a = (window as any).__app; const out: any = {};
  for (const [name, push, pull] of [['plain', 0, 0], ['pull', 0, 1], ['pull+push', 1, 1], ['push', 1, 0]] as const) {
    (window as any).__forceSeed = 5; a.save.data.settings.weather = 'clear';
    a.startGame('city', 'cbr650'); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
    const inp = g.input ?? a.input; let max = 0;
    for (let i = 0; i < 150; i++) {
      inp.update = () => undefined; inp.throttle = 1; inp.push = push; inp.wheelie = push > 0.3 ? 0 : pull; inp.brake = 0; inp.steer = 0;
      a.advance(1 / 30, 1 / 30); max = Math.max(max, g.player.phys.wheelie);
    }
    out[name] = { maxWheelie: +max.toFixed(2), v: +g.player.phys.v.toFixed(1), bike: g.player.phys.bike };
  }
  return out;
});
console.log(JSON.stringify(r));
await b.close();
