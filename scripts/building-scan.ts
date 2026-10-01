// Finds city buildings that overlap a road near a fork. building-scan.ts [seed]
import { chromium } from 'playwright';
const seed = Number(process.argv[2] ?? 31);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const res = await page.evaluate(async ([seed]) => {
  const RP = await import('/src/world/RoadPath.ts');
  const T = await import('/node_modules/.vite/deps/three.js').catch(() => null) as any;
  const a = (window as any).__app; (window as any).__forceSeed = seed;
  a.save.data.settings.weather = 'clear'; a.save.data.settings.timeOfDay = 'day';
  a.startGame('city', 'zr1'); const g = a.game; g.startCrash = () => undefined; g.fuel = 1;
  a.advance(3.2, 1 / 30);
  const sF = g.features.forkAfter(0); const ph = g.player.phys;
  ph.s = sF - 700; ph.d = g.layout.laneCenter(4); ph.v = 30;
  for (const c of g.traffic.cars) c.s += 99999;
  const E = g.layout.roadHalfWidth - 1;
  const hits: string[] = [];
  const scan = (tag: string) => {
    g.scene.traverse((o: any) => {
      if (!o.isInstancedMesh || !o.material.emissiveMap) return;
      const m = o.matrix?.constructor ? new (o.matrix.constructor)() : null;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        const e = m.elements;
        const sx = Math.hypot(e[0], e[1], e[2]), sz = Math.hypot(e[8], e[9], e[10]);
        if (sx < 1e-3) continue;
        const cx = e[12], cz = e[14];
        const ux = e[0] / sx, uz = e[2] / sx, vx = e[8] / sz, vz = e[10] / sz;
        const pts: [number, number][] = [[cx, cz]];
        for (const [a1, b1] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) pts.push([cx + ux * a1 * sx / 2 + vx * b1 * sz / 2, cz + uz * a1 * sx / 2 + vz * b1 * sz / 2]);
        for (const [px, pz] of pts) {
          const p = { x: px, y: 0, z: pz, set() { return this; } } as any;
          const pm = RP.projectToRoad(g.path, p, ph.s);
          if (Math.abs(pm.d) < E - 0.5 && pm.s > sF - 300 && pm.s < sF + 1500 && g.path.spliced === false) { hits.push(`${tag} main s=${Math.round(pm.s - sF)} d=${pm.d.toFixed(1)} size=${sx.toFixed(0)}x${sz.toFixed(0)}`); break; }
          const fk = g.fork;
          if (fk) {
            const pb = RP.projectToRoad(fk.branch, p, Math.max(fk.sF, ph.s));
            if (pb.s > fk.sF + 30 && pb.s < fk.sF + 1400 && pb.d > fk.dC - 0.5 && pb.d < E - 0.5) { hits.push(`${tag} branch s=${Math.round(pb.s - sF)} d=${pb.d.toFixed(1)} size=${sx.toFixed(0)}x${sz.toFixed(0)} unfold=${fk.unfold(pb.s).toFixed(2)}`); break; }
          }
        }
      }
    });
  };
  let x0 = -700;
  for (let step = 0; step < 14; step++) {
    const target = -700 + step * 130;
    let guard = 0;
    while (ph.s - sF < target && guard++ < 3000) {
      ph.v = 30; ph.vl = 0; g.fuel = 1;
      const fk = g.fork;
      if (fk && fk.state === 'open' && ph.s - sF > 0) { const t = (fk.rampIn(ph.s) + fk.rampOut(ph.s)) / 2 - 1.8; ph.d += Math.max(-0.25, Math.min(0.25, t - ph.d)); ph.psi = 0; }
      else if (fk && fk.state === 'branch') { ph.d += Math.max(-0.2, Math.min(0.2, g.layout.laneCenter(4) - ph.d)); ph.psi = 0; }
      else { ph.d = g.layout.laneCenter(4); ph.psi = 0; }
      a.advance(1 / 30, 1 / 30);
    }
    scan('x=' + Math.round(ph.s - sF));
  }
  void x0; void T;
  return [...new Set(hits)].slice(0, 30);
}, [seed] as const);
console.log(res.length ? res.join('\n') : 'no overlaps');
await b.close();
