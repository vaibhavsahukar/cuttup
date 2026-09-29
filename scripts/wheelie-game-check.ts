// In-game keyboard wheelie (hold W + S) on both bikes at a few speeds, default aids.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
for (const id of ['r6', 'cbr650']) {
  const rows = await page.evaluate((id) => {
    const app = (window as any).__app;
    const out: string[] = [];
    for (const v0 of [3, 9, 15, 22, 30]) {
      app.startGame('city', id);
      const g = app.game;
      app.advance(3.3);
      for (const c of g.traffic.cars) c.s += 6000;
      const key = (t: string, c: string) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }));
      g.player.phys.v = v0;
      key('keydown', 'KeyW'); key('keydown', 'KeyS');
      let peak = 0;
      for (let i = 0; i < 180 && g.state === 'driving'; i++) { app.advance(1 / 60); peak = Math.max(peak, g.player.phys.wheelie); }
      key('keyup', 'KeyS'); key('keyup', 'KeyW');
      out.push(`${Math.round(v0 * 2.237)}mph: peak ${Math.round(peak * 57.3)}° state ${g.state}${g.result ? ' ' + g.result.crashKind : ''}`);
    }
    return out.join(' | ');
  }, id);
  console.log(id, rows);
}
await b.close();
