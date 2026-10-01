// Visual check of the interchange, an overpass and a station exit. world-shots.ts <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript('window.__name = (f) => f');
const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
// a camera placed in a road's own frame: target (road, s, d), camera back/side/up from it
type View = { name: string; road: 'main' | 'branch' | 'deck'; s: number; d: number; back: number; side: number; up: number };
const shoot = async (views: View[]) => {
  for (const v of views) {
    await page.evaluate((v) => {
      const a = (window as any).__app, g = a.game, fk = g.fork ?? (window as any).__fk;
      const P = v.road === 'main' ? g.path : fk.branch;
      const tgt = g.player.model.root.position.clone(), pos = tgt.clone();
      if (v.road === 'deck') {
        const D = fk.deck;
        tgt.set(D.ox + D.fx * v.s + D.rx * v.d, D.yRoad, D.oz + D.fz * v.s + D.rz * v.d);
        pos.set(D.ox + D.fx * (v.s - v.back) + D.rx * (v.d + v.side), D.yRoad + v.up, D.oz + D.fz * (v.s - v.back) + D.rz * (v.d + v.side));
      } else {
        P.toWorld(v.s, v.d, 0, tgt);
        P.toWorld(v.s - v.back, v.d + v.side, v.up, pos);
      }
      const cam = g.camera;
      g.rig.update = () => undefined;
      cam.position.copy(pos); cam.lookAt(tgt);
      a.advance(1 / 30, 1 / 30);
      cam.position.copy(pos); cam.lookAt(tgt);
    }, v);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${v.name}.png` });
  }
};
// the interchange, before the player reaches it (everything built and open)
await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 31;
  a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day'; a.save.data.settings.difficulty = 1;
  a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; g.fuel = 1; a.advance(3.2, 1 / 30);
  const sF = g.features.forkAfter(0), ph = g.player.phys;
  ph.s = sF - 900; ph.d = g.layout.laneCenter(2);
  for (let i = 0; i < 30 * 30 && ph.s < sF - 120; i++) { ph.v = 30; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); g.fuel = 1; a.advance(1 / 30, 1 / 30); }
  for (let i = 0; i < 90; i++) a.advance(1 / 30, 1 / 30); // let the far chunks and the deck traffic settle
  (window as any).__fk = g.fork; (window as any).__sF = sF;
});
const sF = await page.evaluate(() => (window as any).__sF);
await shoot([
  { name: 'a_rampstart', road: 'main', s: sF + 60, d: 22, back: 70, side: -6, up: 9 },
  { name: 'b_rampmid', road: 'branch', s: sF + 420, d: 19, back: 90, side: -40, up: 26 },
  { name: 'c_join', road: 'deck', s: -10, d: 8, back: 90, side: 40, up: 30 },
  { name: 'd_join_top', road: 'deck', s: 0, d: 5, back: 1, side: 0, up: 120 },
  { name: 'e_west', road: 'deck', s: -420, d: 0, back: 120, side: 60, up: 40 },
  { name: 'f_under', road: 'main', s: (await page.evaluate(() => (window as any).__fk.sX)), d: 12, back: 120, side: -2, up: 3 },
]);
// an overpass with its cross street
await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 5;
  a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; g.fuel = 1; a.advance(3.2, 1 / 30);
});
const opS = await page.evaluate(() => {
  const a = (window as any).__app, g = a.game, ph = g.player.phys;
  // find the first overpass by driving until one is placed in the chunks ahead (hash test as in ChunkManager)
  for (let i = 0; i < 30 * 60; i++) {
    ph.v = 40; ph.psi = 0; ph.vl = 0; ph.d = g.layout.laneCenter(2); g.fuel = 1; a.advance(1 / 30, 1 / 30);
    const om = g.chunks.pools?.overpass?.mesh;
    if (om) {
      const m = new (g.camera.matrix.constructor)();
      for (let k = 0; k < om.count; k++) { om.getMatrixAt(k, m); const e = m.elements; if (Math.abs(e[0]) + Math.abs(e[10]) > 0.5) { return { x: e[12], z: e[14] }; } }
    }
  }
  return null;
});
console.log('overpass', JSON.stringify(opS));
if (opS) {
  const s = await page.evaluate(async (o) => { const RP = await import('/src/world/RoadPath.ts'); const g = (window as any).__app.game; const p = g.player.model.root.position.clone(); p.set(o.x, 0, o.z); return RP.projectToRoad(g.path, p, g.player.phys.s + 200).s; }, opS);
  await shoot([
    { name: 'g_overpass', road: 'main', s, d: 0, back: 110, side: 8, up: 14 },
    { name: 'h_overpass_side', road: 'main', s, d: 150, back: 60, side: 30, up: 45 },
  ]);
}
// a highway station exit
await page.evaluate(() => {
  const a = (window as any).__app; (window as any).__forceSeed = 8; a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; a.advance(3.2, 1 / 30);
  const F = g.features, ph = g.player.phys; const st = F.next(ph.s + 400); (window as any).__st = st.s0;
  ph.s = st.s0 - 300; for (let i = 0; i < 60; i++) { ph.v = 25; ph.d = g.layout.laneCenter(3); a.advance(1 / 30, 1 / 30); }
});
const st0 = await page.evaluate(() => (window as any).__st);
await shoot([
  { name: 'i_station_in', road: 'main', s: st0 + 140, d: 26, back: 90, side: -10, up: 12 },
  { name: 'j_station_out', road: 'main', s: st0 + 470, d: 26, back: 90, side: -10, up: 12 },
]);
console.log(errs.join('\n') || 'no page errors');
await b.close();
