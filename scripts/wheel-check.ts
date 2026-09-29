// Every traffic / cop type: how many wheels, where they sit, and whether the instanced wheel geometry has all of them.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
console.log(await page.evaluate(async () => {
  const F: any = await import('/src/vehicles/Factory.ts');
  const out: string[] = [];
  const check = (name: string, m: any) => {
    m.root.updateMatrixWorld(true);
    const ws = m.wheels.map((w: any) => { const p = w.obj.position; return `${p.x.toFixed(2)},${p.z.toFixed(2)}`; });
    const mesh = m.wheels[0]?.spin.children[0];
    const vc = mesh ? mesh.geometry.attributes.position.count : 0;
    out.push(`${name.padEnd(12)} wheels ${m.wheels.length} [${ws.join(' | ')}] len ${m.length.toFixed(2)} vertsPerWheel ${vc}`);
  };
  for (const t of F.TRAFFIC_TYPES) check(t, F.buildTrafficModel(t, 0xffffff));
  for (const t of F.TRAFFIC_TYPES) check('full ' + t, F.buildViewerModel('t:' + t, () => null));
  check('cop_basic', F.buildCopModel('cop_basic')); check('cop_charger', F.buildCopModel('cop_charger'));
  return out.join('\n');
}));
await b.close();
