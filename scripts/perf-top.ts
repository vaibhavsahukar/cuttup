// Biggest triangle contributors in view for a map / quality. perf-top.ts <map> <quality>
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const [map, q] = [process.argv[2] ?? 'city', process.argv[3] ?? 'high'];
const r = await page.evaluate(async ([map, q]) => {
  const a = (window as any).__app; (window as any).__forceSeed = 5;
  a.save.data.settings.quality = q; a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'dusk';
  a.startGame(map, 'zr1'); const g = a.game; a.advance(3.2, 1 / 30);
  for (let i = 0; i < 200; i++) { g.player.phys.v = 40; a.advance(1 / 60, 1 / 60); }
  g.renderer.info.autoReset = false; g.renderer.info.reset(); g.render();
  const info = g.renderer.info; const total = info.render.triangles, calls = info.render.calls;
  g.camera.updateMatrixWorld(); const THREE = (g.camera.projectionMatrix.constructor as any);
  const rows: Record<string, { tris: number; n: number }> = {};
  const frustum: any = (window as any).__frustum;
  g.scene.traverse((o: any) => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.visible) return;
    let p = o, vis = true; while (p) { if (!p.visible) vis = false; p = p.parent; } if (!vis) return;
    const geo = o.geometry; const idx = geo.index ? geo.index.count : geo.attributes.position.count;
    let n = o.isInstancedMesh ? o.count : 1; const tris = (idx / 3) * n;
    const key = (o.name || o.parent?.name || '') + '|' + (o.material?.name || o.material?.type) + (o.isInstancedMesh ? '|inst' : '') + (o.castShadow ? '|cs' : '');
    (rows[key] ??= { tris: 0, n: 0 }).tris += tris; rows[key].n++;
  });
  const top = Object.entries(rows).sort((x, y) => y[1].tris - x[1].tris).slice(0, 14).map(([k, v]) => `${k} x${v.n}: ${Math.round(v.tris / 1000)}k`);
  return { total: Math.round(total / 1000) + 'k', calls, top };
}, [map, q]);
console.log(JSON.stringify(r, null, 1));
await b.close();
