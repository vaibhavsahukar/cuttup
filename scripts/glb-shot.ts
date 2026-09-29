// Screenshot the imported model gallery: tsx scripts/glb-shot.ts <ids|all> <out.png> [rot]
import { chromium } from 'playwright';
const [ids, out, rot] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs: string[] = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`http://localhost:5173/?glb=${ids}&rot=${rot ?? 0.6}`);
await p.waitForFunction(() => (window as any).__ready, null, { timeout: 180000 });
await p.waitForTimeout(3000);
await p.screenshot({ path: out });
console.log(errs.join('\n') || 'ok');
await b.close();
