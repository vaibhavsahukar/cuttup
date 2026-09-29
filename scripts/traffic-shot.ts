// Rear-quarter screenshots of live (instanced) traffic, one per vehicle type: traffic-shot.ts <map> <outDir>
import { chromium } from 'playwright';
import fs from 'fs';
const map = process.argv[2] ?? 'city';
const out = process.argv[3] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 800, height: 450 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.evaluate((map) => { const a = (window as any).__app; (window as any).__forceSeed = 1234; a.save.data.settings.timeOfDay = 'day'; a.startGame(map, 'zr1'); a.advance(4, 1 / 30); }, map);
const types: string[] = await page.evaluate(() => {
  const g = (window as any).__app.game;
  return [...new Set<string>(g.traffic.cars.filter((c: any) => c.dir > 0 && !c.cop && c.s > g.player.phys.s + 15 && c.s < g.player.phys.s + 300).map((c: any) => c.type))];
});
console.log('types', types.join(','));
for (const t of types) {
  const ok = await page.evaluate(([t, cfg]) => {
    const app = (window as any).__app, g = app.game;
    const c = g.traffic.cars.find((c: any) => c.type === t && c.dir > 0 && !c.cop && c.s > g.player.phys.s + 15 && c.s < g.player.phys.s + 300);
    if (!c) return null;
    const r = c.model.root, THREE_V = r.position.constructor as any;
    const f = { x: 0, y: 0, z: 0, heading: 0, k: 0, grade: 0 };
    g.path.frame(c.s, f);
    const fwd = new THREE_V(Math.sin(f.heading), 0, Math.cos(f.heading)), right = new THREE_V(-Math.cos(f.heading), 0, Math.sin(f.heading));
    const cam = g.camera;
    cam.position.copy(r.position).addScaledVector(fwd, -cfg.back).addScaledVector(right, cfg.side).add(new THREE_V(0, cfg.up, 0));
    cam.lookAt(r.position.x, r.position.y + 0.6, r.position.z);
    cam.updateMatrixWorld(true);
    g.render();
    return g.renderer.domElement.toDataURL('image/png');
  }, [t, { back: Number(process.env.BACK ?? 6.5), side: Number(process.env.SIDE ?? -4.5), up: Number(process.env.UP ?? 1.4) }] as const);
  if (ok) fs.writeFileSync(`${out}/tr_${map}_${t}.png`, Buffer.from((ok as string).split(',')[1], 'base64'));
}
await b.close();
