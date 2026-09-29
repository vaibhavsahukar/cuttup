// CPU profile per frame (simulation only) + scene complexity + model build cost.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:5173/';
const map = process.argv[3] ?? 'city';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate((m) => {
  const app = (window as any).__app;
  const t0 = performance.now();
  app.startGame(m, 'zr1');
  const startMs = performance.now() - t0;
  const g = app.game;
  app.advance(3);
  const times: number[] = [];
  for (let i = 0; i < 600; i++) {
    g.player.phys.v = 50; g.player.phys.psi = 0;
    const a = performance.now(); app.advance(1 / 60); times.push(performance.now() - a);
  }
  times.sort((x, y) => x - y);
  let tris = 0, meshes = 0, lights = 0;
  g.scene.traverse((o: any) => { if (o.isLight) lights++; if (o.isMesh && o.visible) { meshes++; const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
  const THREE = g.scene.constructor;
  return { startMs: Math.round(startMs), med: times[300].toFixed(2), p95: times[570].toFixed(2), max: times[599].toFixed(1), meshes, lights, tris: Math.round(tris), cars: g.traffic.cars.length };
}, map);
console.log(map, JSON.stringify(r), errors.join(' | ') || 'no errors');
await b.close();
