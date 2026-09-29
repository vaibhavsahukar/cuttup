// Crash camera smoothness: frame-to-frame camera movement and view-direction change during a wreck.
import { chromium } from 'playwright';
const veh = process.argv[2] ?? 'zr1';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 800, height: 450 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate((veh) => {
  const app = (window as any).__app;
  app.startGame('city', veh);
  const g = app.game;
  app.advance(3.3);
  for (const c of g.traffic.cars) c.s += 5000;
  g.player.phys.v = 40;
  app.advance(0.5);
  g.startCrash('barrier', 30, null);
  const cam = g.camera, d = new (cam.position.constructor as any)(), pd = new (cam.position.constructor as any)();
  const out: number[][] = []; let pp: any = null, pdir: any = null;
  for (let f = 0; f < 240; f++) {
    g.update(1 / 60);
    cam.getWorldDirection(d);
    if (pp) out.push([cam.position.distanceTo(pp), d.angleTo(pdir) * 57.3]);
    pp = cam.position.clone(); pdir = d.clone();
  }
  const jump = (i: number) => { const a = out.map((x) => x[i]); const d2: number[] = []; for (let k = 1; k < a.length; k++) d2.push(Math.abs(a[k] - a[k - 1])); return Math.max(...d2).toFixed(3); };
  return { frames: out.length, maxMovePerFrame_m: Math.max(...out.map((x) => x[0])).toFixed(3), maxTurnPerFrame_deg: Math.max(...out.map((x) => x[1])).toFixed(2), maxChangeInMove_m: jump(0), maxChangeInTurn_deg: jump(1) };
}, veh);
console.log(veh, JSON.stringify(r));
await b.close();
