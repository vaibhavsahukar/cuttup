// Walk the map screen with navDir and list what is reachable. nav-check.ts
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript('window.__name = (f) => f');
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => (window as any).__app);
const r = await page.evaluate(() => {
  const ui = (window as any).__app.ui;
  ui.show('maps');
  const name = () => { const f = document.querySelector('#maps .focus') as HTMLElement | null; return f ? (f.textContent || '').trim().slice(0, 14) : '-'; };
  const log: string[] = [];
  ui.nav(0); log.push(name());
  for (const [dx, dy] of [[1,0],[1,0],[0,1],[0,1],[1,0],[0,1],[0,1],[1,0],[1,0],[0,-1],[0,-1],[0,-1]]) { ui.navDir(dx, dy); log.push(`${dx},${dy}:${name()}`); }
  return log;
});
console.log(r.join('\n'));
await b.close();
