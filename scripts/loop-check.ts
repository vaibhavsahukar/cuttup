// Loop-out crash: pull a wheelie with aids off until the bike falls, then track its pitch through the wreck.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(async () => {
  const app = (window as any).__app;
  app.save.data.settings.aids = { abs: 2, tc: 0, aw: 0, eb: 1 };
  app.startGame('city', 'r6');
  const g = app.game;
  app.advance(3.3);
  for (const c of g.traffic.cars) c.s += 5000;
  g.player.phys.v = 9;
  const key = (t: string, c: string) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true }));
  key('keydown', 'KeyW'); key('keydown', 'KeyS');
  for (let i = 0; i < 400 && g.state === 'driving'; i++) app.advance(1 / 60);
  key('keyup', 'KeyS'); key('keyup', 'KeyW');
  const pitchAt: number[] = [];
  const fwd = new (g.player.model.root.position.constructor as any)();
  for (let t = 0; t < 3; t += 0.25) {
    for (let k = 0; k < 15; k++) g.update(1 / 60);
    const q = g.player.model.root.quaternion;
    fwd.set(0, 0, 1).applyQuaternion(q);
    pitchAt.push(Math.round(Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 57.3) * 1);
  }
  return { state: g.state, kind: g.result?.crashKind, msg: g.result?.message, shame: (document.querySelector('#crashui .shame') as HTMLElement | null)?.hidden, up: (new (g.player.model.root.position.constructor as any)(0, 1, 0)).applyQuaternion(g.player.model.root.quaternion).y.toFixed(2), pitchAt };
});
console.log(JSON.stringify(r));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/loop_end.png` });
console.log('errors:', errors.length ? errors : 'none');
await b.close();
