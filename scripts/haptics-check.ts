// Fake a pad with a vibrationActuator and record the rumble a short drive and a crash produce. haptics-check.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(`window.__name = (f) => f; window.__rumble = [];
navigator.getGamepads = () => [{ connected: true, buttons: [], axes: [0,0,0,0], vibrationActuator: { playEffect: (t, o) => { window.__rumble.push([o.strongMagnitude, o.weakMagnitude]); return Promise.resolve(); } } }];`);
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 5;
  a.startGame('city', 'zr1'); const g = a.game; a.advance(3.2, 1 / 30);
  for (let i = 0; i < 60; i++) { g.player.phys.v = 30; a.advance(1 / 30, 1 / 30); }
  const drive = (window as any).__rumble.slice(-3);
  g.startCrash('barrier', 30, null); a.advance(0.3, 1 / 30);
  return { drive, crash: Math.max(...(window as any).__rumble.map((x: number[]) => x[0])), n: (window as any).__rumble.length };
});
console.log(JSON.stringify(r), errs);
await b.close();
