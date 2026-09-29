import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 400, height: 225 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
console.log(await page.evaluate(async () => {
  const F: any = await import('/src/vehicles/Factory.ts');
  const S: any = await import('/src/vehicles/ShapeBuilder.ts');
  const out: string[] = [];
  for (const [t, id] of Object.entries(F.TRAFFIC_SHAPES) as [string, string][]) {
    const sh = S.getShape(id);
    const w = sh.wheels.find((w: any) => w.z < 0);
    out.push(`${t.padEnd(10)} width/2 ${(sh.width / 2).toFixed(2)}  rear wheel x ${w.x.toFixed(2)} w ${w.w.toFixed(2)} outer ${(w.x + w.w / 2).toFixed(2)} r ${w.r.toFixed(2)} z ${w.z.toFixed(2)} len/2 ${(sh.length / 2).toFixed(2)}`);
  }
  return out.join('\n');
}));
await b.close();
