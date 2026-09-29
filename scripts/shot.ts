import { chromium } from 'playwright';
const url = process.argv[2];
const out = process.argv[3];
const wait = Number(process.argv[4] ?? 3000);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs: string[] = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await p.goto(url);
await p.waitForTimeout(wait);
if (process.argv[5]) { await p.evaluate(process.argv[5]); await p.waitForTimeout(Number(process.argv[6] ?? 2000)); }
await p.screenshot({ path: out });
console.log(errs.slice(0, 20).join('\n') || 'no console errors');
await b.close();
