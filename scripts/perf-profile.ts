// Per map and quality: simulation CPU per step, draw calls, triangles, lights, shadow casters. perf-profile.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const maps = (process.argv[2] ?? 'city,country,forest').split(',');
for (const q of (process.argv[3] ?? 'low,medium,high,ultra').split(',')) for (const map of maps) {
  const r = await page.evaluate(async ([map, q]) => {
    const a = (window as any).__app; (window as any).__forceSeed = 5;
    a.save.data.settings.quality = q; a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'dusk';
    a.startGame(map, 'zr1'); const g = a.game; a.advance(3.2, 1 / 30);
    for (let i = 0; i < 200; i++) { g.player.phys.v = 40; a.advance(1 / 60, 1 / 60); }
    const t0 = performance.now(); for (let i = 0; i < 120; i++) { g.player.phys.v = 40; a.advance(1 / 60, 1 / 60); } const cpu = (performance.now() - t0) / 120;
    g.renderer.info.reset(); g.render();
    const info = g.renderer.info;
    let shadowCasters = 0, meshes = 0, lights = 0, transparent = 0;
    g.scene.traverse((o: any) => { if (o.isMesh || o.isInstancedMesh) { meshes++; if (o.castShadow && o.visible) shadowCasters++; if (o.material?.transparent) transparent++; } if (o.isLight) lights++; });
    return { cpuMs: +cpu.toFixed(2), calls: info.render.calls, tris: Math.round(info.render.triangles / 1000) + 'k', geos: info.memory.geometries, tex: info.memory.textures, meshes, shadowCasters, lights, transparent };
  }, [map, q]);
  console.log(q.padEnd(7), map.padEnd(8), JSON.stringify(r));
}
await b.close();
