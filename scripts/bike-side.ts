// Pure side / front / rear / 3/4 renders of player models on a plain backdrop: bike-side.ts <outDir> <id,id,...> [views]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const out = process.argv[2] ?? '.';
const ids = (process.argv[3] ?? 'zx6r').split(',');
const views = (process.argv[4] ?? 'side').split(',');
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1200, height: 700 } });
await page.addInitScript('window.__name = (f) => f');
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
await page.waitForTimeout(800);
for (const id of ids) for (const view of views) {
  const url = await page.evaluate(([id, view]) => {
    const a = (window as any).__app, p = a.preview, r = a.renderer;
    p.showModel((id as string).includes(":") ? id : `v:${id}`);
    p.table.rotation.y = 0;
    const cam = p.camera, m = p.current;
    const bike = !!m.bike;
    const h = bike ? 0.55 : 0.7, D = 14;
    cam.fov = bike ? 7 : 16; cam.aspect = 1200 / 700; cam.updateProjectionMatrix();
    const pos: Record<string, [number, number, number]> = {
      side: [-D, h, 0], left: [D, h, 0], front: [0, h, D], rear: [0, h, -D], q34: [-D * 0.7, h + 1.2, D * 0.7], top: [0, D, 0.01],
    };
    const v = pos[view as string];
    cam.position.set(v[0], v[1] + 0.12, v[2]);
    cam.lookAt(0, h + 0.12, 0);
    p.scene.background.set(0x8a8e96); p.scene.fog = null;
    r.setSize(1200, 700, false);
    r.render(p.scene, cam);
    return r.domElement.toDataURL('image/png');
  }, [id, view] as const);
  writeFileSync(`${out}/${id.replace(':', '_')}_${view}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
await b.close();
