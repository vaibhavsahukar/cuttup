// Zoomed shots of traffic ahead as seen from the chase camera: traffic-zoom.ts <map> <outDir> [n]
import { chromium } from 'playwright';
import fs from 'fs';
const map = process.argv[2] ?? 'city';
const out = process.argv[3] ?? '.';
const n = Number(process.argv[4] ?? 4);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 800, height: 450 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.evaluate((map) => { const a = (window as any).__app; a.save.data.settings.timeOfDay = 'day'; a.startGame(map, 'zr1'); a.advance(4, 1 / 30); }, map);
for (let i = 0; i < n; i++) {
  const url = await page.evaluate((i) => {
    const app = (window as any).__app, g = app.game;
    for (const c of g.traffic.cars) if (!c.cop) c.s += 0; // no-op
    g.player.phys.v = 30; app.advance(2.5 + i, 1 / 30);
    const cars = g.traffic.cars.filter((c: any) => c.dir > 0 && !c.cop && c.s > g.player.phys.s + 25 && c.s < g.player.phys.s + 140).sort((a: any, b: any) => a.s - b.s);
    const c = cars[Math.min(cars.length - 1, i)];
    if (!c) return null;
    const cam = g.camera, r = c.model.root;
    cam.fov = 14; cam.updateProjectionMatrix();
    cam.lookAt(r.position.x, r.position.y + 0.8, r.position.z);
    cam.updateMatrixWorld(true);
    g.render();
    const u = g.renderer.domElement.toDataURL('image/png');
    cam.fov = 60; cam.updateProjectionMatrix();
    return { u, t: c.type, d: Math.round(c.s - g.player.phys.s) };
  }, i);
  if (url) { fs.writeFileSync(`${out}/tz_${map}_${i}_${(url as any).t}_${(url as any).d}m.png`, Buffer.from((url as any).u.split(',')[1], 'base64')); }
}
await b.close();
