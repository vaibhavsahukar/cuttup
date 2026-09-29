import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
console.log(await page.evaluate(async () => {
  const app = (window as any).__app; const out: string[] = [];
  const T: any = null;
  for (const veh of ['cbr', 'r6', 'zr1', 'tesla']) {
    try {
      app.startGame('city', veh);
      const p = app.game.player;
      p.model.root.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(p.model.root);
      const sz = box.getSize(new T.Vector3());
      out.push(`${veh.padEnd(6)} coll ${p.collW.toFixed(2)} x ${p.collL.toFixed(2)}  dims ${p.spec.dims.width} x ${p.spec.dims.length}  model bbox ${sz.x.toFixed(2)} x ${sz.z.toFixed(2)} x h ${sz.y.toFixed(2)} bike ${!!p.bike}`);
    } catch (e: any) { out.push(veh + ' ' + e.message); }
  }
  return out.join('\n');
}));
await b.close();
