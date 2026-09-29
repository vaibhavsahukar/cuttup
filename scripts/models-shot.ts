// Screenshot the procedural model lineup (?models=cars|bikes|traffic|<id>)
import { chromium } from 'playwright';
const [url, out] = [process.argv[2], process.argv[3]];
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs: string[] = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(url); await p.waitForTimeout(5000);
await p.screenshot({ path: out });
console.log(errs.join('\n') || 'ok');
await b.close();
